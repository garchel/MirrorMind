use super::contract::{ReviewMode, UnitEvaluation};
use super::coverage::{select_session_units, SessionPlan};
use super::credentials::{
    credential_status, delete_gemini_api_key, delete_openai_compatible_provider,
    has_gemini_consent, load_openai_compatible_provider, save_gemini_api_key,
    save_openai_compatible_provider, set_gemini_consent, NativeCredentialStore,
};
use super::dashboard::{build_vault_review_dashboard, VaultReviewDashboard};
use super::evaluation::{
    evaluate_readiness, source_hash, GroundedReadinessSource, ReadinessAttempt, ReadinessReport,
    ReadinessStatus,
};
use super::gaps::{latest_review_gaps, latest_review_units, NoteReviewGapView, NoteReviewUnitView};
use super::gemini::{GeminiProvider, GEMINI_MODEL};
use super::notifications::{
    check_daily_notification, load_settings as load_notification_settings,
    save_settings as save_notification_settings, send_test_notification,
    ReviewNotificationCheckView, ReviewNotificationSettingsView,
};
use super::policy::{
    load_note_review_policy, set_note_review_policy as update_note_review_policy,
    set_note_review_priority as update_note_review_priority, NoteReviewPolicyInput,
    NoteReviewPolicyView,
};
use super::policy_config::{
    apply_deadline_change as apply_deadline_change_in_root, load_segmentation_limits,
    load_vault_review_policy_config, preview_deadline_change as preview_deadline_change_in_root,
    preview_vault_review_defaults, preview_vault_review_tag_rules, set_vault_review_defaults,
    set_vault_review_tag_rules, set_vault_segmentation, SegmentationLimits,
    VaultReviewDefaultsInput, VaultReviewDefaultsPreview, VaultReviewPolicyConfigView,
};
use super::provider::{
    OllamaProvider, OpenAiCompatibleProvider, StructuredAiProvider, OLLAMA_ENDPOINT, OLLAMA_MODEL,
};
use super::queue::{list_due_reviews, DueReviewItem};
use super::reports::{
    build_retention_report as collect_retention_report,
    list_review_reports as collect_review_reports, RetentionReport, ReviewReportItem,
};
use super::session::{
    complete_review_session, continue_review_conversation, start_review_session_with_coverage,
    ConversationTurnAttempt, ReviewCompletionAttempt, ReviewCompletionInput, ReviewExchange,
    ReviewGenerationAttempt, ReviewPrompt,
};
use super::state::{
    load_note_review_state, persist_readiness_assessment, persist_readiness_attempt,
    reset_note_learning as reset_note_learning_state, set_manual_enrollment, NoteReadinessStatus,
    NoteReviewState, NoteSchedulingStatus,
};
use super::storage::{
    discard_unrecoverable_learning_document as discard_unrecoverable_learning_in_root,
    export_unrecoverable_learning_document as export_unrecoverable_learning_in_root,
    list_unrecoverable_learning_documents, load_learning_document, load_learning_document_for_path,
    reconcile_external_learning_paths as reconcile_learning_paths, write_learning_document,
    UnrecoverableLearningDocument,
};
use super::structural_audit::{audit_note_structure as run_structural_audit, StructuralAudit};
use super::tag_policy::TagReviewPolicyRule;
use super::workload::{estimate_policy_workload, WorkloadEstimate};
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
use tauri::{Emitter, State};

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
    /// Unidades selecionadas pela cobertura adaptativa: somente elas pontuam
    /// e evoluem o estado de memoria ao concluir a sessao.
    target_unit_ids: Vec<String>,
    /// Texto das unidades-alvo (subset do Markdown): e a fonte que a IA ve em
    /// toda a sessao (geracao, continuacao da conversa e avaliacao final).
    session_markdown: String,
    created_at_unix_ms: u64,
}

static ACTIVE_REVIEW_SESSIONS: OnceLock<Mutex<HashMap<String, ActiveReviewSession>>> =
    OnceLock::new();

fn active_review_sessions() -> &'static Mutex<HashMap<String, ActiveReviewSession>> {
    ACTIVE_REVIEW_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Uma sessao pode iniciar quando a nota esta vencida, ou quando a calibracao
/// inicial ainda nao observou todas as unidades da nota segmentada e o usuario
/// escolheu continuar imediatamente (uma etapa por dia e o ritmo minimo, nao
/// um limite: a continuacao imediata fica a criterio do usuario).
fn may_start_session(
    status: &NoteSchedulingStatus,
    allow_calibration_continuation: bool,
    calibrating: bool,
) -> bool {
    match status {
        NoteSchedulingStatus::Due => true,
        // A calibracao de uma nota agendada (nao vencida) so continua por
        // escolha explicita do usuario enquanto houver unidades nao observadas.
        NoteSchedulingStatus::Scheduled => allow_calibration_continuation && calibrating,
        NoteSchedulingStatus::NotScheduled | NoteSchedulingStatus::Paused => false,
    }
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
            // O flag de esclarecimento vem do prompt emitido pelo backend e
            // nao pode ser alterado pelo cliente: a contagem deterministica
            // de esclarecimentos depende disso.
            || exchange.is_clarification != prompt.is_clarification
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
    OpenAiCompatible,
}

/// Reserva uma chamada de IA no orcamento do Vault ANTES do custo acontecer,
/// estimando o custo pelo tamanho do prompt em caracteres (para o teto mensal
/// e a medicao exibida). O provedor E2E deterministico (sem rede e sem custo)
/// fica fora do orcamento.
fn reserve_ai_call(
    vault_root: &Path,
    provider: &dyn StructuredAiProvider,
    input_chars: usize,
) -> Result<(), String> {
    if std::env::var_os("MIRRORMIND_E2E_MOCK_AI").is_some() {
        return Ok(());
    }
    super::usage::check_and_record_call(vault_root, provider.kind(), input_chars)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn provider_for_selection(
    selection: AiProviderSelection,
) -> Result<Box<dyn StructuredAiProvider>, String> {
    // Builds E2E: provedor deterministico sem rede, ativado por ambiente.
    #[cfg(feature = "e2e")]
    if std::env::var_os("MIRRORMIND_E2E_MOCK_AI").is_some() {
        return Ok(Box::new(crate::review::e2e_mock::MockE2eProvider));
    }
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
        AiProviderSelection::OpenAiCompatible => {
            let store = NativeCredentialStore::new();
            let configuration =
                load_openai_compatible_provider(&store).map_err(|error| error.to_string())?;
            let configuration = configuration.ok_or_else(|| {
                "Configure um servidor OpenAI-compatible antes de usa-lo na revisao.".to_string()
            })?;
            Ok(Box::new(
                OpenAiCompatibleProvider::new(
                    configuration.base_url,
                    configuration.model,
                    configuration.api_key,
                )
                .map_err(|error| error.to_string())?,
            ))
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfiguration {
    gemini_configured: bool,
    gemini_model: &'static str,
    ollama_endpoint: &'static str,
    ollama_model: &'static str,
    open_ai_compatible_configured: bool,
    open_ai_compatible_base_url: Option<String>,
    open_ai_compatible_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    reachable: bool,
    model_installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationRecalcProgress {
    pub processed: usize,
    pub total: usize,
    pub changed: usize,
}

#[tauri::command]
pub fn get_review_ai_configuration() -> Result<AiConfiguration, String> {
    let store = NativeCredentialStore::new();
    let status = credential_status(&store).map_err(|error| error.to_string())?;
    let open_ai_compatible = load_openai_compatible_provider(&store)
        .map_err(|error| error.to_string())?
        .map(|configuration| (configuration.base_url, configuration.model));
    Ok(AiConfiguration {
        gemini_configured: status.gemini_configured,
        gemini_model: GEMINI_MODEL,
        ollama_endpoint: OLLAMA_ENDPOINT,
        ollama_model: OLLAMA_MODEL,
        open_ai_compatible_configured: open_ai_compatible.is_some(),
        open_ai_compatible_base_url: open_ai_compatible
            .as_ref()
            .map(|(base_url, _)| base_url.clone()),
        open_ai_compatible_model: open_ai_compatible.map(|(_, model)| model),
    })
}

/// Configura o provedor OpenAI-compatible (endereco, modelo e chave) no cofre
/// nativo. Endereco e modelo ficam visiveis na configuracao; a chave nunca
/// sai do cofre.
#[tauri::command]
pub fn configure_openai_compatible_provider(
    base_url: String,
    model: String,
    api_key: String,
) -> Result<AiConfiguration, String> {
    save_openai_compatible_provider(&NativeCredentialStore::new(), &base_url, &model, &api_key)
        .map_err(|error| error.to_string())?;
    get_review_ai_configuration()
}

#[tauri::command]
pub fn remove_openai_compatible_provider() -> Result<AiConfiguration, String> {
    delete_openai_compatible_provider(&NativeCredentialStore::new())
        .map_err(|error| error.to_string())?;
    get_review_ai_configuration()
}

#[tauri::command]
pub fn configure_gemini_api_key(api_key: String) -> Result<AiConfiguration, String> {
    save_gemini_api_key(&NativeCredentialStore::new(), &api_key)
        .map_err(|error| error.to_string())?;
    get_review_ai_configuration()
}

#[tauri::command]
pub fn set_gemini_data_consent(consent: bool) -> Result<(), String> {
    if consent {
        // O consentimento so e concedido pelo dialogo nativo
        // (confirm_gemini_data_consent): uma interface comprometida nao pode
        // autoautorizar o egresso chamando este comando diretamente. A
        // revogacao continua permitida e a persistencia do flag so acontece
        // quando o usuario confirma no dialogo do sistema operacional.
        return Ok(());
    }
    set_gemini_consent(&NativeCredentialStore::new(), false).map_err(|error| error.to_string())
}

/// Concede o consentimento de envio ao Gemini SOMENTE pelo dialogo nativo do
/// sistema operacional (fora do renderer): uma interface comprometida nao
/// consegue falsificar a confirmacao, pois quem desenha o dialogo e o SO. O
/// consentimento e persistido no cofre apenas quando o usuario confirma
/// (`Autorizar`); cancelar nao altera nada. O egresso continua sendo
/// bloqueado no backend enquanto o flag confiavel estiver ausente.
#[tauri::command]
pub fn confirm_gemini_data_consent(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let confirmed = app
        .dialog()
        .message("O MirrorMind enviara apenas o Markdown da nota selecionada e os dados da sessao atual ao Gemini, servico externo da Google. Nada sera enviado sem esta autorizacao, e voce pode revoga-la a qualquer momento nas configuracoes.")
        .title("Autorizar envio ao Gemini")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Autorizar".to_string(),
            "Cancelar".to_string(),
        ))
        .blocking_show();
    if confirmed {
        set_gemini_consent(&NativeCredentialStore::new(), true)
            .map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
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

/// Verifica os fatos de uma nota contra o conhecimento do modelo, em uma
/// operacao SEPARADA da avaliacao de memoria: nunca altera o Markdown, nunca
/// modifica pontuacoes de revisoes nem o estado DSR/FSRS. Distingue
/// claramente fatos confirmados, divergentes e incertos, com fontes/razoes.
#[tauri::command]
pub(crate) async fn verify_note_facts(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<super::fact_check::FactCheckAttempt, String> {
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
        reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
        super::fact_check::verify_note_facts(provider.as_ref(), &markdown)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a verificacao factual.".to_string())?
}

/// Lista as fontes consideradas de uma sessao de revisao: os anexos
/// referenciados pela nota (`![[...]]` de imagens/PDFs e notas embutidas),
/// resolvidos com seguranca contra o inventario do Vault. A sessao indica
/// claramente quais fontes foram consideradas no material permitido; a
/// interpretacao visual do conteudo de imagens/PDFs e uma evolucao futura.
#[tauri::command]
pub(crate) async fn note_session_sources(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<super::session_sources::ResolvedSessionSource>, String> {
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
        let extracted = super::session_sources::extract_attachment_references(&markdown);
        let attachment_paths = crate::collect_attachment_files(&root)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|path| crate::to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        let markdown_paths = crate::collect_markdown_files(&root)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|path| crate::to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        let mut sources = super::session_sources::resolve_session_sources(
            &extracted,
            &attachment_paths,
            &markdown_paths,
        );
        super::session_sources::enrich_sources_with_extracted_text(&root, &mut sources);
        Ok(sources)
    })
    .await
    .map_err(|_| "Nao foi possivel listar as fontes da sessao.".to_string())?
}

/// Avalia o modelo mental integrado (sintese) que o usuario construiu de uma
/// nota, em quatro dimensoes separadas (cerne, conexoes, aplicacao e
/// integracao de lacunas). Avaliacao formativa: nao altera o estado DSR/FSRS
/// nem as proximas datas de revisao.
#[tauri::command]
pub(crate) async fn assess_note_synthesis(
    path: String,
    relative_path: String,
    synthesis: String,
    provider: AiProviderSelection,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<super::synthesis::SynthesisAttempt, String> {
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
        // Material permitido da sessao: o Markdown da nota + o texto extraido
        // dos anexos referenciados (PDFs e notas embutidas), claramente
        // rotulado por fonte. Imagens ficam listadas como fontes consideradas
        // sem texto (interpretacao visual exige OCR — fora do escopo local).
        let material = super::session_sources::build_session_material(&root, &markdown)
            .map_err(|error| error.to_string())?;
        let provider = provider_for_selection(provider)?;
        reserve_ai_call(&root, provider.as_ref(), material.len() + synthesis.len())?;
        super::synthesis::evaluate_synthesis(provider.as_ref(), &material, &synthesis)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a avaliacao da sintese.".to_string())?
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
        reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
        // A prontidao section-aware usa a mesma regra de segmentacao das
        // sessoes, com o limite de palavras configurado no Vault: o plano de
        // unidades (ranges + caminho de secao) vai no prompt para a IA
        // avaliar a coerencia por secao.
        let limits = load_segmentation_limits(&root).map_err(|error| error.to_string())?;
        let max_whole_note_words =
            usize::try_from(limits.max_whole_note_words).unwrap_or(usize::MAX);

        let attempt = evaluate_readiness(
            provider.as_ref(),
            &markdown,
            max_whole_note_words,
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

/// Auditoria estrutural deterministica da nota (sem IA): usa a regra de
/// segmentacao por secoes para propor melhorias de estrutura que encaixem a
/// nota na categorizacao de revisao. Leitura pura — nao altera nada.
#[tauri::command]
pub(crate) async fn audit_note_structure(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<StructuralAudit, String> {
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
        let limits = load_segmentation_limits(&root).map_err(|error| error.to_string())?;
        let max_whole_note_words =
            usize::try_from(limits.max_whole_note_words).unwrap_or(usize::MAX);
        Ok(run_structural_audit(&markdown, max_whole_note_words))
    })
    .await
    .map_err(|_| "Nao foi possivel auditar a estrutura da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn start_note_review_session(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    mode: ReviewMode,
    allow_calibration_continuation: bool,
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
        // A calibracao inicial de notas longas permite continuar imediatamente
        // apos uma etapa, mesmo sem a nota estar vencida, enquanto houver
        // unidades ainda nao observadas; a fila continua exigindo vencimento.
        let calibrating = document.units.iter().any(|unit| {
            !matches!(
                unit.latest_evaluation,
                Some(UnitEvaluation::Evaluated { .. })
            )
        });
        if !may_start_session(
            &state.scheduling_status,
            allow_calibration_continuation,
            calibrating,
        ) {
            return Err("A nota ainda nao esta vencida para revisao.".to_string());
        }
        let provider_selection = provider;
        let provider = provider_for_selection(provider_selection)?;
        reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
        let (attempt, coverage) = start_review_session_with_coverage(
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
                    target_unit_ids: coverage.target_unit_ids,
                    session_markdown: coverage.session_markdown,
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

/// Plano estimado de uma sessao antes de iniciar: quantas unidades serao
/// cobertas, a fracao da nota, a duracao estimada e quantas sessoes seriam
/// necessarias para cobrir tudo com o orcamento atual. Deterministico e sem
/// IA — usa exatamente a mesma selecao de cobertura da sessao real, entao o
/// que o usuario ve na preparacao e o que a sessao executara.
#[tauri::command]
pub(crate) async fn preview_review_session_plan(
    path: String,
    relative_path: String,
    mode: ReviewMode,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<SessionPlan, String> {
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
        Ok(select_session_units(&document, &markdown, mode).plan)
    })
    .await
    .map_err(|_| "Nao foi possivel estimar a sessao de revisao.".to_string())?
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
        reserve_ai_call(&root, provider.as_ref(), bound.session_markdown.len())?;
        // A conversa continua com o subset das unidades-alvo (cobertura
        // adaptativa), para os turnos nunca sairem do escopo da sessao.
        let attempt =
            continue_review_conversation(provider.as_ref(), &bound.session_markdown, &exchanges)
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
        reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
        let input = ReviewCompletionInput {
            session_id: session_id.clone(),
            note_id: note_id.clone(),
            note_content_hash,
            mode,
            provider: provider.kind(),
            exchanges,
            // As alternativas e o indice correto vem do registro interno da
            // sessao (emitido no inicio), nunca do cliente.
            prompts: bound.prompts.clone(),
            // A cobertura adaptativa (unidades-alvo e subset) tambem vem do
            // registro interno da sessao, nunca do cliente.
            target_unit_ids: bound.target_unit_ids.clone(),
            session_markdown: bound.session_markdown.clone(),
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
        // Qualquer desfecho terminal (valido ou inconclusivo) encerra a sessao
        // ativa: um relatorio inconclusivo nao persiste nada, mas refazer cria
        // uma sessao nova, e a antiga nao pode mais continuar.
        if !matches!(attempt, ReviewCompletionAttempt::Invalid { .. }) {
            session_lock()?.remove(&session_id);
        }
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a sessao de revisao.".to_string())?
}

/// Estado de consumo de IA do Vault: chamadas por provedor no dia, limites
/// vigentes e se o orcamento foi estourado. Medicao visivel para o usuario.
#[tauri::command]
pub(crate) async fn review_usage_status(
    path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<super::usage::UsageStatusView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        super::usage::usage_status(&root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel ler o uso de IA do Vault.".to_string())?
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
pub(crate) async fn list_review_reports(
    path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<ReviewReportItem>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        collect_review_reports(&root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar os relatorios de revisao.".to_string())?
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

/// Semeadura exclusiva de testes E2E: cria (ou atualiza) o estado de
/// aprendizado de uma nota existente como `pronta + inscrita + vencida`
/// usando somente codigo de dominio. Em builds sem a feature `e2e` o comando
/// recusa; com a feature, qualquer invocacao vinda do app compilado para os
/// testes funciona de forma deterministica (o hash real da nota e usado).
#[tauri::command]
pub(crate) async fn seed_e2e_review_state(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<(), String> {
    if !cfg!(feature = "e2e") {
        return Err("O comando de semeadura E2E so existe em builds de teste.".to_string());
    }
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
        let quotes: Vec<String> = markdown
            .split('\n')
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
        let grounded = |quote: String| {
            let source_quote = quote.chars().take(320).collect::<String>();
            let start_bytes = markdown.find(&source_quote).unwrap_or(0);
            let start_utf16 = markdown[..start_bytes].encode_utf16().count() as u32;
            let end_utf16 = start_utf16
                + u32::try_from(source_quote.encode_utf16().count()).unwrap_or(u32::MAX);
            GroundedReadinessSource {
                source_quote,
                source_start_utf16: start_utf16,
                source_end_utf16: end_utf16,
            }
        };
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Semeadura E2E: nota pronta para revisao.".to_string(),
            central_idea: quotes.first().cloned().map(grounded),
            evaluable_points: quotes.iter().take(3).cloned().map(grounded).collect(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(&root, &relative_path, &markdown, &report, now)
            .map_err(|error| error.to_string())?;
        set_manual_enrollment(&root, &relative_path, &markdown, true, now)
            .map_err(|error| error.to_string())?;
        // Forca o vencimento imediato (a fila exige next_review <= now).
        let loaded = load_learning_document_for_path(&root, &relative_path)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O estado semeado nao foi criado.".to_string())?;
        let note_id = loaded.document.note.id.clone();
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        document.scheduling.next_review_at_unix_ms = Some(now.saturating_sub(1));
        document.scheduling.status = crate::review::contract::SchedulingStatus::Due;
        document.revision = document.revision.saturating_add(1);
        write_learning_document(&root, &note_id, Some(expected_revision), &document)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel semear o estado E2E.".to_string())?
}

#[tauri::command]
pub(crate) async fn reset_note_learning(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<NoteReviewState, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Diferente dos comandos que dependem do conteudo, o reinicio opera
        // apenas sobre o documento de aprendizado: nao precisa ler nem conferir
        // o hash do Markdown (a nota pode inclusive ja ter sido alterada).
        reset_note_learning_state(
            &root,
            &relative_path,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel reiniciar o aprendizado da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn set_note_unit_classification(
    path: String,
    relative_path: String,
    unit_id: String,
    score: u8,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<NoteReviewState, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::review::state::set_unit_classification(
            &root,
            &relative_path,
            &unit_id,
            score,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel corrigir a classificacao da unidade.".to_string())?
}

/// Lista os documentos de aprendizado que nao podem ser carregados (principal
/// corrompido ou ausente e nenhum backup valido), com o caminho relativo da
/// nota quando ele ainda pode ser extraido do conteudo bruto. A interface usa
/// essa lista para oferecer a exportacao do arquivo antes de descartar o
/// aprendizado e recomecar.
#[tauri::command]
pub(crate) async fn get_unrecoverable_learning_documents(
    path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<UnrecoverableLearningDocument>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        list_unrecoverable_learning_documents(&root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel listar os documentos irrecuperaveis.".to_string())?
}

/// Exporta o arquivo principal e os backups de um documento irrecuperavel para
/// o destino escolhido pelo usuario (dialog de salvamento), preservando a
/// evidencia antes de descartar o aprendizado. Devolve a quantidade de arquivos
/// copiados.
#[tauri::command]
pub(crate) async fn export_unrecoverable_learning_document(
    path: String,
    storage_key: String,
    destination_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<usize, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let destination = PathBuf::from(&destination_path);
        export_unrecoverable_learning_in_root(&root, &storage_key, &destination)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel exportar o arquivo irrecuperavel.".to_string())?
}

/// Isola (quarentena) o documento irrecuperavel — principal e backups — para
/// que a nota possa ser reavaliada e o aprendizado recomecar do zero. Deve ser
/// usado somente depois que o usuario exportou o arquivo.
#[tauri::command]
pub(crate) async fn discard_unrecoverable_learning_document(
    path: String,
    storage_key: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<usize, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        discard_unrecoverable_learning_in_root(&root, &storage_key)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel descartar o arquivo irrecuperavel.".to_string())?
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkloadEstimateInput {
    first_review_interval_days: u64,
    target_retention: f64,
    min_interval_days: u64,
    max_interval_days: u64,
}

/// Estimativa de carga de uma politica de revisao (simulacao deterministica de
/// uma nota tipica com acertos consistentes), usada para calibrar os valores
/// sem depender das notas reais do vault. Nao toca o vault: e um calculo puro.
#[tauri::command]
pub(crate) fn estimate_review_workload(
    input: WorkloadEstimateInput,
) -> Result<WorkloadEstimate, String> {
    if input.first_review_interval_days == 0
        || input.min_interval_days == 0
        || input.max_interval_days < input.min_interval_days
    {
        return Err("Os intervalos da politica sao invalidos.".to_string());
    }
    if !(0.5..=0.99).contains(&input.target_retention) {
        return Err("A retencao desejada deve ficar entre 50% e 99%.".to_string());
    }
    Ok(estimate_policy_workload(
        input.first_review_interval_days,
        input.target_retention,
        input.min_interval_days,
        input.max_interval_days,
    ))
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
pub(crate) async fn preview_vault_deadline_change(
    path: String,
    tag: String,
    new_deadline: Option<u64>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewDefaultsPreview, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        preview_deadline_change_in_root(
            &root,
            &tag,
            new_deadline,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel calcular o impacto do novo prazo.".to_string())?
}

#[tauri::command]
pub(crate) async fn apply_vault_deadline_change(
    path: String,
    expected_revision: u64,
    tag: String,
    new_deadline: Option<u64>,
    expected_affected_note_count: usize,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewPolicyConfigView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        apply_deadline_change_in_root(
            &root,
            expected_revision,
            &tag,
            new_deadline,
            expected_affected_note_count,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel alterar o prazo.".to_string())?
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
pub(crate) async fn set_vault_review_policy_segmentation(
    path: String,
    expected_revision: u64,
    max_whole_note_words: u64,
    app: tauri::AppHandle,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewPolicyConfigView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut on_progress = |processed: usize, total: usize, changed: usize| {
            let _ = app.emit(
                "segmentation-recalc-progress",
                SegmentationRecalcProgress {
                    processed,
                    total,
                    changed,
                },
            );
        };
        set_vault_segmentation(
            &root,
            expected_revision,
            SegmentationLimits {
                max_whole_note_words,
            },
            current_unix_ms().map_err(|error| error.to_string())?,
            &mut on_progress,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel salvar a segmentacao do Vault.".to_string())?
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
pub(crate) async fn set_note_review_priority(
    path: String,
    relative_path: String,
    priority_weight: f64,
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
        update_note_review_priority(
            &root,
            &relative_path,
            &markdown,
            priority_weight,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel alterar a prioridade da nota.".to_string())?
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

#[tauri::command]
pub(crate) async fn get_vault_review_dashboard(
    path: String,
    local_day_start_unix_ms: u64,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<VaultReviewDashboard, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        build_vault_review_dashboard(
            &root,
            current_unix_ms().map_err(|error| error.to_string())?,
            local_day_start_unix_ms,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar o painel do Vault.".to_string())?
}

#[tauri::command]
pub(crate) async fn get_retention_report(
    path: String,
    local_day_start_unix_ms: u64,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<RetentionReport, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        collect_retention_report(
            &root,
            current_unix_ms().map_err(|error| error.to_string())?,
            local_day_start_unix_ms,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar o relatorio de retencao.".to_string())?
}

#[tauri::command]
pub(crate) async fn get_note_review_gaps(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<NoteReviewGapView>, String> {
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
        let state = load_note_review_state(
            &root,
            &relative_path,
            &markdown,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "A nota ainda nao possui estado de aprendizado.".to_string())?;
        let content_hash = state.content_hash.clone();
        let document = load_learning_document(&root, &state.note_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O estado de aprendizado da nota nao existe.".to_string())?
            .document;
        latest_review_gaps(&document, &markdown, &content_hash).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar as lacunas da revisao.".to_string())?
}

#[tauri::command]
pub(crate) async fn get_note_review_units(
    path: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<NoteReviewUnitView>, String> {
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
        let state = load_note_review_state(
            &root,
            &relative_path,
            &markdown,
            current_unix_ms().map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "A nota ainda nao possui estado de aprendizado.".to_string())?;
        let content_hash = state.content_hash.clone();
        let document = load_learning_document(&root, &state.note_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O estado de aprendizado da nota nao existe.".to_string())?
            .document;
        latest_review_units(&document, &markdown, &content_hash).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel carregar a avaliacao por unidade da nota.".to_string())?
}

#[tauri::command]
pub(crate) async fn reconcile_external_learning_paths(
    path: String,
    removed_paths: Vec<String>,
    created_paths: Vec<String>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<(String, String)>, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_learning_paths(&root, &removed_paths, &created_paths)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel reconciliar a identidade de aprendizado.".to_string())?
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
#[tauri::command]
pub(crate) async fn get_review_notification_settings(
    app: tauri::AppHandle,
) -> Result<ReviewNotificationSettingsView, String> {
    Ok(ReviewNotificationSettingsView::from(
        load_notification_settings(&app),
    ))
}

#[tauri::command]
pub(crate) async fn set_review_notification_settings(
    app: tauri::AppHandle,
    settings: ReviewNotificationSettingsView,
) -> Result<ReviewNotificationSettingsView, String> {
    let mut stored = load_notification_settings(&app);
    stored.enabled = settings.enabled;
    stored.hour = settings.hour;
    stored.minute = settings.minute;
    stored.muted = settings.muted;
    save_notification_settings(&app, &stored).map_err(|error| error.to_string())?;
    Ok(ReviewNotificationSettingsView::from(&stored))
}

#[tauri::command]
pub(crate) async fn check_review_notifications(
    path: String,
    now_unix_ms: u64,
    local_day_start_unix_ms: u64,
    app: tauri::AppHandle,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<ReviewNotificationCheckView, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        check_daily_notification(&app, &root, now_unix_ms, local_day_start_unix_ms)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel verificar as notificacoes de revisao.".to_string())?
}

#[tauri::command]
pub(crate) async fn send_review_test_notification(app: tauri::AppHandle) -> Result<(), String> {
    send_test_notification(&app).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn calibration_continuation_allows_starting_a_not_yet_due_note() {
        use super::may_start_session;
        use crate::review::state::NoteSchedulingStatus;
        // Vencida sempre pode iniciar.
        assert!(may_start_session(&NoteSchedulingStatus::Due, false, false));
        assert!(may_start_session(&NoteSchedulingStatus::Due, true, true));
        // Nao vencida so inicia com a continuacao de calibracao e unidades
        // ainda nao observadas; sem calibracao em andamento, permanece.
        assert!(!may_start_session(
            &NoteSchedulingStatus::Scheduled,
            false,
            true
        ));
        assert!(!may_start_session(
            &NoteSchedulingStatus::Scheduled,
            true,
            false
        ));
        assert!(may_start_session(
            &NoteSchedulingStatus::Scheduled,
            true,
            true
        ));
        assert!(!may_start_session(
            &NoteSchedulingStatus::Paused,
            true,
            true
        ));
    }
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
            kind: crate::review::session::PromptKind::MultipleChoice,
            options: vec![
                "Uma".to_string(),
                "Duas".to_string(),
                "Tres".to_string(),
                "Quatro".to_string(),
            ],
            correct_option_index: Some(2),
            expected_answer: None,
            source_quote: None,
            is_clarification: false,
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
                target_unit_ids: vec!["unit-1".to_string()],
                session_markdown: "Conteudo da nota.".to_string(),
                created_at_unix_ms: 1,
            },
            1,
        )
        .expect("register session");
        let valid = vec![ReviewExchange {
            prompt_id: prompt.id,
            prompt: prompt.text,
            answer: "Minha resposta.".to_string(),
            assistance_used: false,
            is_clarification: false,
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
        let mut tampered = valid.clone();
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
        // O flag de esclarecimento nao pode ser forjado pelo cliente: a
        // contagem deterministica depende de vir do prompt emitido.
        let mut forged_clarification = valid;
        forged_clarification[0].is_clarification = true;
        assert!(load_bound_session(
            &session_id,
            &root,
            "Nota.md",
            AiProviderSelection::Ollama,
            "note-1",
            "sha256:content",
            &ReviewMode::Exam,
            &forged_clarification
        )
        .is_err());
    }
    #[test]
    fn accepts_the_three_v1_provider_identifiers() {
        assert_eq!(
            serde_json::from_str::<AiProviderSelection>("\"gemini\"").unwrap(),
            AiProviderSelection::Gemini
        );
        assert_eq!(
            serde_json::from_str::<AiProviderSelection>("\"ollama\"").unwrap(),
            AiProviderSelection::Ollama
        );
        assert_eq!(
            serde_json::from_str::<AiProviderSelection>("\"openAiCompatible\"").unwrap(),
            AiProviderSelection::OpenAiCompatible
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
