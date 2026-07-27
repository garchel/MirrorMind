use super::contract::ReviewMode;
use super::credentials::{
    credential_status, delete_gemini_api_key, has_gemini_consent, save_gemini_api_key,
    set_gemini_consent, NativeCredentialStore,
};
use super::evaluation::{evaluate_readiness, source_hash, ReadinessAttempt};
use super::gemini::{GeminiProvider, GEMINI_MODEL};
use super::policy::{
    load_note_review_policy, set_note_review_policy as update_note_review_policy,
    NoteReviewPolicyInput, NoteReviewPolicyView,
};
use super::policy_config::{
    load_vault_review_policy_config, preview_vault_review_defaults, preview_vault_review_tag_rules,
    set_vault_review_defaults, set_vault_review_tag_rules, VaultReviewDefaultsInput,
    VaultReviewDefaultsPreview, VaultReviewPolicyConfigView,
};
use super::provider::{OllamaProvider, StructuredAiProvider, OLLAMA_ENDPOINT, OLLAMA_MODEL};
use super::queue::{list_due_reviews, DueReviewItem};
use super::session::{
    complete_review_session, continue_review_conversation, start_review_session,
    ConversationTurnAttempt, ReviewCompletionAttempt, ReviewCompletionInput, ReviewExchange,
    ReviewGenerationAttempt, ReviewPrompt,
};
use super::state::{
    load_note_review_state, persist_readiness_attempt, set_manual_enrollment, NoteReadinessStatus,
    NoteReviewState, NoteSchedulingStatus,
};
use super::storage::load_learning_document;
use super::tag_policy::TagReviewPolicyRule;
use anyhow::{bail, Context, Result as AnyResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;
static NEXT_REVIEW_SESSION_ID: AtomicU64 = AtomicU64::new(1);
const MAX_ACTIVE_REVIEW_SESSIONS: usize = 128;
const ACTIVE_REVIEW_SESSION_TTL_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveReviewMode {
    Exam,
    Conversation,
}

#[derive(Debug, Clone)]
struct ActiveReviewSession {
    vault_root: PathBuf,
    relative_path: String,
    note_id: String,
    note_content_hash: String,
    provider: AiProviderSelection,
    mode: ActiveReviewMode,
    prompts: Vec<ReviewPrompt>,
    created_at_unix_ms: u64,
}

static ACTIVE_REVIEW_SESSIONS: OnceLock<Mutex<HashMap<String, ActiveReviewSession>>> =
    OnceLock::new();

fn active_review_sessions() -> &'static Mutex<HashMap<String, ActiveReviewSession>> {
    ACTIVE_REVIEW_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_mode(mode: &ReviewMode) -> ActiveReviewMode {
    match mode {
        ReviewMode::Exam => ActiveReviewMode::Exam,
        ReviewMode::Conversation => ActiveReviewMode::Conversation,
    }
}

fn session_lock(
) -> Result<std::sync::MutexGuard<'static, HashMap<String, ActiveReviewSession>>, String> {
    active_review_sessions()
        .lock()
        .map_err(|_| "O registro de sessoes esta temporariamente indisponivel.".to_string())
}

fn register_active_session(
    session_id: &str,
    session: ActiveReviewSession,
    now: u64,
) -> Result<(), String> {
    let mut sessions = session_lock()?;
    sessions.retain(|_, current| {
        now.saturating_sub(current.created_at_unix_ms) <= ACTIVE_REVIEW_SESSION_TTL_MS
    });
    if sessions.len() >= MAX_ACTIVE_REVIEW_SESSIONS {
        return Err(
            "Ha sessoes de revisao demais em andamento. Abandone uma sessao e tente novamente."
                .to_string(),
        );
    }
    sessions.insert(session_id.to_string(), session);
    Ok(())
}

fn load_bound_session(
    session_id: &str,
    root: &Path,
    relative_path: &str,
    provider: AiProviderSelection,
    note_id: &str,
    note_content_hash: &str,
    mode: &ReviewMode,
    exchanges: &[ReviewExchange],
) -> Result<ActiveReviewSession, String> {
    if session_id.trim().is_empty() || session_id.len() > 256 {
        return Err("O identificador da sessao e invalido.".to_string());
    }
    let session = session_lock()?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "A sessao nao foi iniciada ou expirou.".to_string())?;
    if session.vault_root != root
        || session.relative_path != relative_path
        || session.provider != provider
        || session.note_id != note_id
        || session.note_content_hash != note_content_hash
        || session.mode != active_mode(mode)
        || exchanges.len() > session.prompts.len()
    {
        return Err("A sessao nao corresponde ao registro emitido pelo aplicativo.".to_string());
    }
    for (exchange, prompt) in exchanges.iter().zip(&session.prompts) {
        if exchange.prompt_id != prompt.id
            || exchange.prompt != prompt.text
            || exchange.prompt_id.len() > 256
        {
            return Err(
                "As respostas nao correspondem as perguntas emitidas para esta sessao.".to_string(),
            );
        }
    }
    Ok(session)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderSelection {
    Gemini,
    Ollama,
}

fn provider_for_selection(
    selection: AiProviderSelection,
) -> Result<Box<dyn StructuredAiProvider>, String> {
    match selection {
        AiProviderSelection::Gemini => {
            let store = NativeCredentialStore::new();
            if !has_gemini_consent(&store).map_err(|error| error.to_string())? {
                return Err(
                    "Autorize o envio do conteudo ao Gemini antes de usar este provedor."
                        .to_string(),
                );
            }
            Ok(Box::new(
                GeminiProvider::from_store(&store).map_err(|error| error.to_string())?,
            ))
        }
        AiProviderSelection::Ollama => Ok(Box::new(
            OllamaProvider::new().map_err(|error| error.to_string())?,
        )),
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfiguration {
    gemini_configured: bool,
    gemini_model: &'static str,
    ollama_endpoint: &'static str,
    ollama_model: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    reachable: bool,
    model_installed: bool,
}

#[tauri::command]
pub fn get_review_ai_configuration() -> Result<AiConfiguration, String> {
    let status =
        credential_status(&NativeCredentialStore::new()).map_err(|error| error.to_string())?;
    Ok(AiConfiguration {
        gemini_configured: status.gemini_configured,
        gemini_model: GEMINI_MODEL,
        ollama_endpoint: OLLAMA_ENDPOINT,
        ollama_model: OLLAMA_MODEL,
    })
}

#[tauri::command]
pub fn configure_gemini_api_key(api_key: String) -> Result<AiConfiguration, String> {
    save_gemini_api_key(&NativeCredentialStore::new(), &api_key)
        .map_err(|error| error.to_string())?;
    get_review_ai_configuration()
}

#[tauri::command]
pub fn set_gemini_data_consent(consent: bool) -> Result<(), String> {
    set_gemini_consent(&NativeCredentialStore::new(), consent).map_err(|error| error.to_string())
}
#[tauri::command]
pub fn remove_gemini_api_key() -> Result<AiConfiguration, String> {
    delete_gemini_api_key(&NativeCredentialStore::new()).map_err(|error| error.to_string())?;
    get_review_ai_configuration()
}

#[tauri::command]
pub async fn check_ollama_review_status() -> Result<OllamaStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let provider = OllamaProvider::new().map_err(|error| error.to_string())?;
        let status = provider
            .check_readiness()
            .map_err(|failure| failure.message)?;
        Ok(OllamaStatus {
            reachable: status.reachable,
            model_installed: status.model_installed,
        })
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a verificacao do Ollama.".to_string())?
}

#[tauri::command]
pub(crate) async fn assess_note_readiness(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    expected_source_hash: Option<String>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<ReadinessAttempt, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        let provider = provider_for_selection(provider)?;

        let attempt = evaluate_readiness(
            provider.as_ref(),
            &markdown,
            expected_source_hash.as_deref(),
        )
        .map_err(|error| error.to_string())?;
        let current_markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        persist_readiness_attempt(
            &root,
            &relative_path,
            &current_markdown,
            &attempt,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a avaliacao da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn start_note_review_session(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    mode: ReviewMode,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<ReviewGenerationAttempt, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        let now = current_unix_ms().map_err(|error| error.to_string())?;
        let state = load_note_review_state(&root, &relative_path, &markdown, now)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "A nota ainda nao possui estado de aprendizado.".to_string())?;
        let document = load_learning_document(&root, &state.note_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O estado de aprendizado da nota nao existe.".to_string())?
            .document;
        if state.scheduling_status != NoteSchedulingStatus::Due {
            return Err("A nota ainda nao esta vencida para revisao.".to_string());
        }
        let provider_selection = provider;
        let provider = provider_for_selection(provider_selection)?;
        let attempt = start_review_session(
            provider.as_ref(),
            &document,
            &markdown,
            mode,
            next_review_session_id().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if let ReviewGenerationAttempt::Valid { draft } = &attempt {
            register_active_session(
                &draft.session_id,
                ActiveReviewSession {
                    vault_root: root.clone(),
                    relative_path: relative_path.clone(),
                    note_id: draft.note_id.clone(),
                    note_content_hash: draft.note_content_hash.clone(),
                    provider: provider_selection,
                    mode: active_mode(&draft.mode),
                    prompts: draft.prompts.clone(),
                    created_at_unix_ms: now,
                },
                now,
            )?;
        }
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel iniciar a sessao de revisao.".to_string())?
}

#[tauri::command]
pub(crate) async fn continue_note_review_conversation(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    session_id: String,
    note_id: String,
    note_content_hash: String,
    exchanges: Vec<ReviewExchange>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<ConversationTurnAttempt, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        let now = current_unix_ms().map_err(|error| error.to_string())?;
        let state = load_note_review_state(&root, &relative_path, &markdown, now)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "A nota ainda nao possui estado de aprendizado.".to_string())?;
        if state.note_id != note_id
            || state.content_hash != note_content_hash
            || source_hash(&markdown) != note_content_hash
            || state.readiness != NoteReadinessStatus::Ready
            || !state.enrolled
        {
            return Err("A sessao pertence a outra nota ou versao do conteudo.".to_string());
        }
        let mode = ReviewMode::Conversation;
        let bound = load_bound_session(
            &session_id,
            &root,
            &relative_path,
            provider,
            &note_id,
            &note_content_hash,
            &mode,
            &exchanges,
        )?;
        let provider = provider_for_selection(provider)?;
        let attempt = continue_review_conversation(provider.as_ref(), &markdown, &exchanges)
            .map_err(|error| error.to_string())?;
        if let ConversationTurnAttempt::Valid {
            prompt: Some(prompt),
            ..
        } = &attempt
        {
            let mut sessions = session_lock()?;
            let current = sessions
                .get_mut(&session_id)
                .ok_or_else(|| "A sessao expirou durante a conversa.".to_string())?;
            if current.prompts.len() != bound.prompts.len() {
                return Err("A sessao foi atualizada concorrentemente.".to_string());
            }
            current.prompts.push(prompt.clone());
        }
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel continuar a conversa de revisao.".to_string())?
}

#[tauri::command]
pub(crate) async fn complete_note_review_session(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    session_id: String,
    note_id: String,
    note_content_hash: String,
    mode: ReviewMode,
    exchanges: Vec<ReviewExchange>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<ReviewCompletionAttempt, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        let bound = load_bound_session(
            &session_id,
            &root,
            &relative_path,
            provider,
            &note_id,
            &note_content_hash,
            &mode,
            &exchanges,
        )?;
        if exchanges.len() != bound.prompts.len() {
            return Err("A sessao ainda possui perguntas sem resposta.".to_string());
        }
        let provider = provider_for_selection(provider)?;
        let input = ReviewCompletionInput {
            session_id: session_id.clone(),
            note_id: note_id.clone(),
            note_content_hash,
            mode,
            provider: provider.kind(),
            exchanges,
        };
        let attempt = complete_review_session(
            &root,
            &note_id,
            provider.as_ref(),
            &markdown,
            input,
            current_unix_ms().map_err(|error| error.to_string())?,
            || read_bounded_markdown(&root, &note_path),
        )
        .map_err(|error| error.to_string())?;
        if matches!(attempt, ReviewCompletionAttempt::Valid { .. }) {
            session_lock()?.remove(&session_id);
        }
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a sessao de revisao.".to_string())?
}
#[tauri::command]
pub(crate) async fn list_due_review_queue(
    path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<DueReviewItem>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        list_due_reviews(
            &root,
            current_unix_ms().map_err(|error| error.to_string())?,
            |relative_path| {
                let note_path = crate::resolve_note_path(&root, relative_path)?;
                match fs::symlink_metadata(&note_path) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(error) => return Err(error.into()),
                    Ok(_) => {}
                }
                read_bounded_markdown(&root, &note_path).map(Some)
            },
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar a fila de revisao.".to_string())?
}
#[tauri::command]
pub(crate) async fn get_note_review_state(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Option<NoteReviewState>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        load_note_review_state(
            &root,
            &relative_path,
            &markdown,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar o estado de revisao da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_note_review_enrollment(
    path: String,
    relative_path: String,
    enabled: bool,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<NoteReviewState, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        set_manual_enrollment(
            &root,
            &relative_path,
            &markdown,
            enabled,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel alterar a participacao da nota nas revisoes.".to_string())?
}

#[tauri::command]
pub(crate) async fn get_vault_review_policy_config(
    path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewPolicyConfigView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        load_vault_review_policy_config(&root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar a politica padrao do Vault.".to_string())?
}

#[tauri::command]
pub(crate) async fn preview_vault_review_policy_defaults(
    path: String,
    defaults: VaultReviewDefaultsInput,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewDefaultsPreview, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        preview_vault_review_defaults(&root, defaults).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel calcular o impacto da politica do Vault.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_vault_review_policy_defaults(
    path: String,
    expected_revision: u64,
    defaults: VaultReviewDefaultsInput,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewPolicyConfigView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        set_vault_review_defaults(
            &root,
            expected_revision,
            defaults,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel salvar a politica padrao do Vault.".to_string())?
}
#[tauri::command]
pub(crate) async fn preview_vault_review_policy_tag_rules(
    path: String,
    tag_rules: Vec<TagReviewPolicyRule>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewDefaultsPreview, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        preview_vault_review_tag_rules(
            &root,
            tag_rules,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel calcular o impacto das regras de tag.".to_string())?
}
#[tauri::command]
pub(crate) async fn set_vault_review_policy_tag_rules(
    path: String,
    expected_revision: u64,
    tag_rules: Vec<TagReviewPolicyRule>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewPolicyConfigView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        set_vault_review_tag_rules(
            &root,
            expected_revision,
            tag_rules,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel salvar as regras de tag para revisao.".to_string())?
}

#[tauri::command]
pub(crate) async fn get_note_review_policy(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Option<NoteReviewPolicyView>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        load_note_review_policy(
            &root,
            &relative_path,
            &markdown,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar a politica de revisao da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_note_review_policy(
    path: String,
    relative_path: String,
    policy: NoteReviewPolicyInput,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<NoteReviewPolicyView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let note_path =
            crate::resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
        let markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        update_note_review_policy(
            &root,
            &relative_path,
            &markdown,
            policy,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel salvar a politica de revisao da nota.".to_string())?
}

fn next_review_session_id() -> AnyResult<String> {
    let now = current_unix_ms()?;
    let sequence = NEXT_REVIEW_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    Ok(format!("session-{now}-{sequence}"))
}
fn current_unix_ms() -> AnyResult<u64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .with_context(|| "O relogio do sistema esta antes da epoca Unix.")?
        .as_millis();
    u64::try_from(millis).with_context(|| "O relogio do sistema excede o limite suportado.")
}
pub(crate) fn read_bounded_markdown(root: &Path, note_path: &Path) -> AnyResult<String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    let mut file = options
        .open(note_path)
        .with_context(|| "Nao foi possivel abrir a nota selecionada.")?;
    let opened_metadata = file
        .metadata()
        .with_context(|| "Nao foi possivel validar a nota selecionada.")?;
    if !opened_metadata.is_file() {
        bail!("A nota precisa ser um arquivo Markdown regular.");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if opened_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            bail!("Links e pontos de nova analise nao podem ser usados como notas.");
        }
    }

    let canonical_note = note_path
        .canonicalize()
        .with_context(|| "Nao foi possivel confirmar o caminho da nota.")?;
    if !canonical_note.starts_with(root) {
        bail!("A nota precisa ficar dentro do Vault atual.");
    }
    if !same_file_identity(&file, &canonical_note)? {
        bail!("A nota mudou durante a abertura. Tente novamente.");
    }

    let mut bytes =
        Vec::with_capacity(usize::try_from(opened_metadata.len().min(MAX_NOTE_BYTES)).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(MAX_NOTE_BYTES + 1)
        .read_to_end(&mut bytes)
        .with_context(|| "Nao foi possivel ler a nota selecionada.")?;
    if bytes.len() as u64 > MAX_NOTE_BYTES {
        bail!("A nota excede o limite seguro para avaliacao.");
    }
    String::from_utf8(bytes)
        .map_err(|_| anyhow::anyhow!("A nota precisa ser um arquivo Markdown UTF-8 valido."))
}

#[cfg(unix)]
fn same_file_identity(file: &fs::File, path: &Path) -> AnyResult<bool> {
    use std::os::unix::fs::MetadataExt as _;
    let opened = file.metadata()?;
    let current = fs::metadata(path)?;
    Ok(opened.dev() == current.dev() && opened.ino() == current.ino())
}

#[cfg(windows)]
fn same_file_identity(file: &fs::File, path: &Path) -> AnyResult<bool> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let current = fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;

    fn identity(file: &fs::File) -> AnyResult<(u32, u64)> {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut information = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        let handle = file.as_raw_handle();
        if unsafe { GetFileInformationByHandle(handle, &mut information) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let index =
            (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
        Ok((information.dwVolumeSerialNumber, index))
    }

    Ok(identity(file)? == identity(&current)?)
}

#[cfg(not(any(unix, windows)))]
fn same_file_identity(file: &fs::File, path: &Path) -> AnyResult<bool> {
    let opened = file.metadata()?;
    let current = fs::metadata(path)?;
    Ok(opened.len() == current.len() && opened.modified().ok() == current.modified().ok())
}
#[cfg(test)]
mod tests {
    use super::{
        load_bound_session, read_bounded_markdown, register_active_session, ActiveReviewMode,
        ActiveReviewSession, AiProviderSelection, MAX_NOTE_BYTES,
    };
    use crate::review::contract::ReviewMode;
    use crate::review::session::{ReviewExchange, ReviewPrompt};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn binds_completion_transcripts_to_the_backend_issued_session() {
        let temporary = tempdir().expect("temp dir");
        let root = temporary.path().canonicalize().expect("canonical root");
        let session_id = format!("bound-session-{}", std::process::id());
        let prompt = ReviewPrompt {
            id: "question-1".to_string(),
            text: "Explique o conceito.".to_string(),
            assistance: "Pense na definicao.".to_string(),
        };
        register_active_session(
            &session_id,
            ActiveReviewSession {
                vault_root: root.clone(),
                relative_path: "Nota.md".to_string(),
                note_id: "note-1".to_string(),
                note_content_hash: "sha256:content".to_string(),
                provider: AiProviderSelection::Ollama,
                mode: ActiveReviewMode::Exam,
                prompts: vec![prompt.clone()],
                created_at_unix_ms: 1,
            },
            1,
        )
        .expect("register session");
        let valid = vec![ReviewExchange {
            prompt_id: prompt.id,
            prompt: prompt.text,
            answer: "Minha resposta.".to_string(),
        }];
        assert!(load_bound_session(
            &session_id,
            &root,
            "Nota.md",
            AiProviderSelection::Ollama,
            "note-1",
            "sha256:content",
            &ReviewMode::Exam,
            &valid
        )
        .is_ok());
        let mut tampered = valid;
        tampered[0].prompt = "Pergunta fabricada.".to_string();
        assert!(load_bound_session(
            &session_id,
            &root,
            "Nota.md",
            AiProviderSelection::Ollama,
            "note-1",
            "sha256:content",
            &ReviewMode::Exam,
            &tampered
        )
        .is_err());
    }
    #[test]
    fn accepts_only_the_two_v1_provider_identifiers() {
        assert_eq!(
            serde_json::from_str::<AiProviderSelection>("\"gemini\"").unwrap(),
            AiProviderSelection::Gemini
        );
        assert_eq!(
            serde_json::from_str::<AiProviderSelection>("\"ollama\"").unwrap(),
            AiProviderSelection::Ollama
        );
        assert!(serde_json::from_str::<AiProviderSelection>("\"openAi\"").is_err());
    }

    #[test]
    fn bounded_reader_rejects_an_oversized_or_non_utf8_note() {
        let temporary = tempdir().expect("temp dir");
        let root = temporary.path().canonicalize().expect("canonical root");
        let oversized = root.join("oversized.md");
        let file = fs::File::create(&oversized).expect("create oversized note");
        file.set_len(MAX_NOTE_BYTES + 1).expect("grow note");
        assert!(read_bounded_markdown(&root, &oversized)
            .expect_err("oversized note")
            .to_string()
            .contains("limite"));

        let invalid = root.join("invalid.md");
        fs::write(&invalid, [0xff, 0xfe]).expect("write invalid UTF-8");
        assert!(read_bounded_markdown(&root, &invalid)
            .expect_err("invalid UTF-8")
            .to_string()
            .contains("UTF-8"));
    }

    #[test]
    fn bounded_reader_rejects_a_final_component_symlink() {
        let temporary = tempdir().expect("temp dir");
        let root = temporary.path().canonicalize().expect("canonical root");
        let target = root.join("target.md");
        let link = root.join("linked.md");
        fs::write(&target, "conteudo").expect("write target");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&target, &link).is_err() {
            return;
        }

        assert!(read_bounded_markdown(&root, &link).is_err());
    }
}
