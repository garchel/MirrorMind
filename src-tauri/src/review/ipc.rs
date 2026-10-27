use super::calibrated::proposals::ImprovementScope;
use super::calibrated::typesafe::TYPESAFE_ENDPOINT;
use super::calibrated::{CalibratedProvider, TypeSafeProvider};
use super::calibration::{load_calibration_config, set_calibration_strategy, CalibrationStrategy};
use super::comparability::{
    build_divergence_report, evaluate_with_provider, DivergenceReport, CASES,
    MARKDOWN as COMPARABILITY_MARKDOWN,
};
use super::contract::{ReviewMode, UnitEvaluation};
use super::coverage::{select_session_units, SessionPlan};
use super::credentials::{
    credential_status, delete_gemini_api_key, delete_openai_compatible_provider,
    delete_typesafe_api_key, has_gemini_consent, has_openai_compatible_consent,
    has_typesafe_consent, load_gemini_api_key, load_openai_compatible_provider,
    load_typesafe_api_key, save_gemini_api_key, save_openai_compatible_provider,
    save_typesafe_api_key, set_gemini_consent, set_openai_compatible_consent, set_typesafe_consent,
    NativeCredentialStore,
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
use super::queue::{list_due_reviews, list_upcoming_reviews, DueReviewItem, UpcomingReviewQueue};
use super::reports::{
    build_retention_report as collect_retention_report,
    list_review_reports as collect_review_reports, RetentionReport, ReviewReportItem,
};
use super::session::{
    complete_review_session_with_calibration, continue_review_conversation,
    continue_review_conversation_with_calibration, start_review_session_with_coverage,
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
/// Um trecho selecionado e uma palavra ou uma frase, nao a nota colada a mao.
/// O limite e validado antes de qualquer chamada ao provider.
const MAX_SELECTION_CHARS: usize = 2_000;
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
pub(crate) fn reserve_ai_call(
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

pub(crate) fn provider_for_selection(
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
            if !has_openai_compatible_consent(&store).map_err(|error| error.to_string())? {
                return Err(
                    "Autorize o envio do conteudo ao servidor OpenAI-compatible antes de usar este provedor."
                        .to_string(),
                );
            }
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

/// Descritor visual (visao multimodal) para a leitura de imagens na sessao:
/// so existe para o Gemini, e apenas quando o provider ja foi autorizado (o
/// proprio `provider_for_selection` exige o consentimento antes de construir
/// o Gemini). Outros provedores devolvem `None` e as imagens permanecem
/// listadas sem interpretacao visual.
fn vision_describer_for_selection(
    provider: &dyn StructuredAiProvider,
) -> Option<std::sync::Arc<dyn super::session_sources::ImageDescriber>> {
    if provider.kind() != super::provider::ProviderKind::Gemini {
        return None;
    }
    let store = NativeCredentialStore::new();
    let gemini = GeminiProvider::from_store(&store).ok()?;
    Some(std::sync::Arc::new(gemini))
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

/// Estado do motor calibrado, lido junto da configuracao de IA.
///
/// Vai no mesmo payload em vez de um comando separado porque a tela de
/// configuracao precisa dos dois ao mesmo tempo, e porque `calibrationValidated`
/// e o que decide se o numero de confianca pode ser renderizado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationConfiguration {
    /// Estrategia ativa. `off` enquanto ninguem escolheu outra coisa.
    pub strategy: CalibrationStrategy,
    /// Chave da TypeSafe AI presente no cofre nativo.
    pub typesafe_configured: bool,
    /// Consentimento de egresso concedido no dialogo do sistema operacional.
    pub typesafe_consent: bool,
    /// O harness de F1 ja validou a calibracao? Enquanto `false`, a UI nao
    /// exibe numeros de confianca - numero nao validado e teatro, e theater
    /// exibido como verdade e pior que a ausencia dele.
    pub calibration_validated: bool,
    /// Endpoint, so para a UI mostrar a quem os dados saem. Nao configuravel.
    pub typesafe_endpoint: &'static str,
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

/// Le o estado do motor calibrado para o Vault aberto.
#[tauri::command]
pub(crate) fn get_calibration_configuration(
    vault_root: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationConfiguration, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    calibration_configuration_for(&root)
}

/// Resolve e **autoriza** a raiz do Vault.
///
/// Sem isto, `vault_root` seria um caminho arbitrário vindo da interface: os
/// comandos abaixo gravam e leem `.mirmind/` a partir dele, e uma interface
/// comprometida conseguiria escrever um arquivo de configuração fora do Vault
/// autorizado - ou ler um `.mirmind/review-calibration.json` de um Vault que o
/// usuário não abriu.
///
/// Os outros 38 pontos deste arquivo já faziam isso; estes três foram escritos
/// sem a checagem.
fn authorized_vault_root(
    vault_root: &str,
    authorized_paths: &crate::AuthorizedPaths,
) -> Result<PathBuf, String> {
    let root =
        crate::canonicalize_directory(Path::new(vault_root)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    Ok(root)
}

/// Monta o estado do motor calibrado. Separado do comando para que os testes
/// possam exercitar a logica sem passar pelo Tauri.
fn calibration_configuration_for(vault_root: &Path) -> Result<CalibrationConfiguration, String> {
    let store = NativeCredentialStore::new();
    let config = load_calibration_config(vault_root).map_err(|error| error.to_string())?;
    Ok(CalibrationConfiguration {
        strategy: config.strategy,
        typesafe_configured: load_typesafe_api_key(&store)
            .map_err(|error| error.to_string())?
            .is_some(),
        typesafe_consent: has_typesafe_consent(&store).map_err(|error| error.to_string())?,
        calibration_validated: config.calibration_validated,
        typesafe_endpoint: TYPESAFE_ENDPOINT,
    })
}

/// Troca o motor das funcionalidades calibradas.
///
/// A decisao e por Vault e nao global: comparar dois provedores dentro da
/// mesma sessao exige que ambos vejam exatamente o mesmo conteudo, e um toggle
/// global permitiria misturar notas avaliadas por maquinas diferentes no mesmo
/// historico de agendamento.
#[tauri::command]
pub(crate) fn set_calibration_strategy_for_vault(
    vault_root: String,
    strategy: CalibrationStrategy,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationConfiguration, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    // Falhar cedo e legivel: escolher `jev` sem chave nem consentimento
    // deixaria o app quebrado na proxima avaliacao, em vez de na escolha.
    if strategy.requires_jev() {
        let store = NativeCredentialStore::new();
        if load_typesafe_api_key(&store)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err(
                "Configure a chave da TypeSafe AI antes de ativar o motor calibrado.".to_string(),
            );
        }
        if !has_typesafe_consent(&store).map_err(|error| error.to_string())? {
            return Err(
                "Autorize o envio do conteudo a TypeSafe AI antes de ativar o motor calibrado."
                    .to_string(),
            );
        }
    }
    set_calibration_strategy(&root, strategy).map_err(|error| error.to_string())?;
    calibration_configuration_for(&root)
}

/// Constrói o provider calibrado para o Vault, se a estratégia exigir um.
///
/// Espelha `provider_for_selection`: exige consentimento **antes** de
/// construir o cliente, para que a chave existir no cofre nunca seja tratada
/// como autorização de envio.
///
/// `Ok(None)` quando a estratégia é `off` - nenhum outro caminho chama
/// `CalibratedProvider`, e um cliente HTTP a mais seria recurso gasto sem uso.
pub(crate) fn calibrated_provider_for(
    strategy: CalibrationStrategy,
) -> Result<Option<Box<dyn CalibratedProvider>>, String> {
    if !strategy.requires_jev() {
        return Ok(None);
    }
    let store = NativeCredentialStore::new();
    if !has_typesafe_consent(&store).map_err(|error| error.to_string())? {
        return Err(
            "Autorize o envio do conteudo a TypeSafe AI antes de usar o motor calibrado."
                .to_string(),
        );
    }
    let api_key = load_typesafe_api_key(&store).map_err(|error| error.to_string())?;
    let Some(api_key) = api_key else {
        return Err(
            "Configure a chave da TypeSafe AI antes de usar o motor calibrado.".to_string(),
        );
    };
    Ok(Some(Box::new(
        TypeSafeProvider::new(api_key).map_err(|error| error.message)?,
    )))
}

#[tauri::command]
pub(crate) fn configure_typesafe_api_key(
    vault_root: String,
    api_key: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationConfiguration, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    save_typesafe_api_key(&NativeCredentialStore::new(), &api_key)
        .map_err(|error| error.to_string())?;
    calibration_configuration_for(&root)
}

#[tauri::command]
pub(crate) fn remove_typesafe_api_key(
    vault_root: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationConfiguration, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    delete_typesafe_api_key(&NativeCredentialStore::new()).map_err(|error| error.to_string())?;
    // Sem chave, `jev` e `dual` deixam de ser escolhas validas; o toggle volta
    // para `off` em vez de deixar a configuracao num estado impossivel.
    let config = load_calibration_config(&root).map_err(|error| error.to_string())?;
    if config.strategy.requires_jev() {
        set_calibration_strategy(&root, CalibrationStrategy::Off)
            .map_err(|error| error.to_string())?;
    }
    calibration_configuration_for(&root)
}

/// Revogar o consentimento e tem efeito colateral: derruba a estrategia para
/// `off`, porque consentir e o que autoriza o egresso.
#[tauri::command]
pub(crate) fn set_typesafe_data_consent(
    vault_root: String,
    consent: bool,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationConfiguration, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    if consent {
        // O consentimento so e concedido pelo dialogo nativo; uma interface
        // comprometida nao pode autoautorizar o envio.
        return calibration_configuration_for(&root);
    }
    set_typesafe_consent(&NativeCredentialStore::new(), false)
        .map_err(|error| error.to_string())?;
    let config = load_calibration_config(&root).map_err(|error| error.to_string())?;
    if config.strategy.requires_jev() {
        set_calibration_strategy(&root, CalibrationStrategy::Off)
            .map_err(|error| error.to_string())?;
    }
    calibration_configuration_for(&root)
}

/// Concede o consentimento de envio a TypeSafe AI SOMENTE pelo dialogo nativo
/// do sistema operacional (fora do renderer), espelhando o fluxo do Gemini.
#[tauri::command]
pub fn confirm_typesafe_data_consent(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let confirmed = app
        .dialog()
        .message("O MirrorMind enviara o trecho da nota selecionado e os dados da sessao atual a TypeSafe AI, servico externo hospedado nos Estados Unidos que usa um modelo de decisao estruturada. Nada sera enviado sem esta autorizacao, e voce pode revoga-la a qualquer momento nas configuracoes.")
        .title("Autorizar envio a TypeSafe AI")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Autorizar".to_string(),
            "Cancelar".to_string(),
        ))
        .blocking_show();
    if confirmed {
        set_typesafe_consent(&NativeCredentialStore::new(), true)
            .map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
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
pub fn set_openai_compatible_data_consent(consent: bool) -> Result<(), String> {
    if consent {
        return Ok(());
    }
    set_openai_compatible_consent(&NativeCredentialStore::new(), false)
        .map_err(|error| error.to_string())
}

/// Concede o consentimento de envio ao servidor OpenAI-compatible SOMENTE
/// pelo dialogo nativo do SO (fora do renderer), espelhando o fluxo do Gemini.
#[tauri::command]
pub fn confirm_openai_compatible_data_consent(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let confirmed = app
        .dialog()
        .message("O MirrorMind enviara apenas o Markdown da nota selecionada e os dados da sessao atual ao servidor OpenAI-compatible configurado. O endereco, o modelo e a politica do provedor determinam onde os dados serao tratados (possivel transferencia internacional). Nada sera enviado sem esta autorizacao, e voce pode revoga-la a qualquer momento nas configuracoes.")
        .title("Autorizar envio ao servidor OpenAI-compatible")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Autorizar".to_string(),
            "Cancelar".to_string(),
        ))
        .blocking_show();
    if confirmed {
        set_openai_compatible_consent(&NativeCredentialStore::new(), true)
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

/// Comparabilidade REAL entre provedores: avalia a MESMA nota fixa, com as
/// MESMAS perguntas e respostas, pelo caminho de producao em cada provedor
/// disponivel (Ollama local + Gemini ou OpenAI-compatible configurado) e
/// devolve o relatorio de divergencia. Nenhum lado falho derruba a operacao:
/// o relatorio registra o erro legivel de cada lado.
#[tauri::command]
pub async fn run_provider_comparability() -> Result<DivergenceReport, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = NativeCredentialStore::new();
        let ollama = OllamaProvider::new().map_err(|error| error.to_string())?;
        let ollama_name = "ollama-qwen2.5:7b";
        // Segundo lado: Gemini se configurado, senao OpenAI-compatible. Como
        // os demais caminhos, exige o consentimento correspondente: a chave
        // existir nao autoriza o envio.
        let remote_name: &'static str;
        let remote: Box<dyn StructuredAiProvider>;
        match load_gemini_api_key(&store).map_err(|error| error.to_string())? {
            Some(_) => {
                if !has_gemini_consent(&store).map_err(|error| error.to_string())? {
                    return Err("Autorize o envio do conteudo ao Gemini antes de comparar provedores.".to_string());
                }
                remote_name = "gemini-3.5-flash";
                remote = Box::new(GeminiProvider::from_store(&store).map_err(|error| error.to_string())?);
            }
            None => match load_openai_compatible_provider(&store)
                .map_err(|error| error.to_string())?
            {
                Some(configuration) => {
                    if !has_openai_compatible_consent(&store).map_err(|error| error.to_string())? {
                        return Err("Autorize o envio do conteudo ao servidor OpenAI-compatible antes de comparar provedores.".to_string());
                    }
                    remote_name = "openai-compatible";
                    remote = Box::new(
                        OpenAiCompatibleProvider::new(
                            configuration.base_url,
                            configuration.model,
                            configuration.api_key,
                        )
                        .map_err(|error| error.to_string())?,
                    );
                }
                None => {
                    return Err("Nenhum provedor remoto configurado: configure o Gemini ou um provedor OpenAI-compatible para comparar com o Ollama.".to_string())
                }
            },
        }
        let ollama_outcome =
            evaluate_with_provider(&ollama, ollama_name, COMPARABILITY_MARKDOWN, CASES);
        let gemini_outcome = evaluate_with_provider(&*remote, remote_name, COMPARABILITY_MARKDOWN, CASES);
        Ok(build_divergence_report(ollama_outcome, gemini_outcome))
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a comparacao de provedores.".to_string())?
}

/// Verifica os fatos de uma nota contra o conhecimento do modelo, em uma
/// operacao SEPARADA da avaliacao de memoria: nunca altera o Markdown, nunca
/// modifica pontuacoes de revisoes nem o estado DSR/FSRS. Distingue
/// claramente fatos confirmados, divergentes e incertos, com fontes/razoes.
///
/// O caminho e escolhido pela estrategia do Vault: em `off` roda o legado
/// intacto; em `jev` extrai as afirmacoes com o provider generativo e
/// classifica com o motor calibrado. A reserva de orcamento acontece uma vez
/// por caminho - no calibrado, a extracao e a classificacao sao duas chamadas
/// de motores diferentes e por isso custam como duas.
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
        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;
        let provider = provider_for_selection(provider)?;
        let calibrated = calibrated_provider_for(strategy)?;

        match calibrated {
            // Caminho legado, byte a byte como antes: nenhuma linha de
            // `fact_check::verify_note_facts` muda quando a estrategia e off.
            None => {
                reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
                super::fact_check::verify_note_facts(provider.as_ref(), &markdown)
                    .map_err(|error| error.to_string())
            }
            Some(calibrated) => {
                // Extracao (generativa) e classificacao (calibrada) sao duas
                // chamadas: reservar duas antes de qualquer custo.
                reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
                reserve_ai_call(&root, provider.as_ref(), markdown.len() / 2)?;
                super::calibrated::fact_check::verify_facts_with_calibrated_engine(
                    provider.as_ref(),
                    calibrated.as_ref(),
                    &markdown,
                )
                .map_err(|failure: super::provider::ProviderFailure| failure.message)
            }
        }
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
/// Le o registro de comparacao do Vault.
///
/// O sidecar so e escrito no modo `Dual`, entao uma resposta vazia significa
/// "ainda nao houve comparacao" e nao "os motores concordam sempre".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationComparison {
    /// Quantas avaliacoes comparadas existem.
    pub total: usize,
    /// Quantas divergiram.
    pub divergences: usize,
    /// A fracao que divergiu, de 0 a 1.
    pub divergence_rate: Option<f64>,
    /// As divergencias, mais recentes primeiro.
    pub recent: Vec<CalibrationDivergence>,
    /// `true` quando o modo `Dual` esta ligado - o que e a condicao para o
    /// sidecar existir.
    pub collecting: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationDivergence {
    pub at_unix_ms: u64,
    pub relative_path: String,
    pub dimension: String,
    pub primary_engine: String,
    pub primary_label: Option<String>,
    pub secondary_engine: String,
    pub secondary_label: Option<String>,
    pub primary_confidence: Option<f64>,
    /// A distribuicao do lado que julgou, para o usuario ver *por que* ele
    /// decidiu diferente.
    pub primary_distribution: Option<std::collections::BTreeMap<String, f64>>,
}

#[tauri::command]
pub(crate) fn get_calibration_comparison(
    vault_root: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<CalibrationComparison, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    let log = super::calibrated::comparison::load_comparison(&root);
    let strategy = super::calibration::load_calibration_config(&root)
        .map_err(|error| error.to_string())?
        .strategy;
    let divergences: Vec<CalibrationDivergence> = log
        .records
        .iter()
        .rev()
        .filter(|record| !record.agreed)
        .take(50)
        .map(|record| CalibrationDivergence {
            at_unix_ms: record.at_unix_ms,
            relative_path: record.relative_path.clone(),
            dimension: record.dimension.clone(),
            primary_engine: record.primary.engine.clone(),
            primary_label: record.primary.label.clone(),
            secondary_engine: record.secondary.engine.clone(),
            secondary_label: record.secondary.label.clone(),
            primary_confidence: record.primary.confidence,
            primary_distribution: record.primary.distribution.clone(),
        })
        .collect();
    let total = log.records.len();
    let diverging = log.records.iter().filter(|record| !record.agreed).count();
    Ok(CalibrationComparison {
        total,
        divergences: diverging,
        divergence_rate: if total == 0 {
            None
        } else {
            Some(diverging as f64 / total as f64)
        },
        recent: divergences,
        collecting: strategy == CalibrationStrategy::Dual,
    })
}

/// A divergencia do motor calibrado nesta nota, se houver.
///
/// Fica na nota porque e **la** que o usuario decide: a tela de comparacao nas
/// configuracoes mostra o agregado, e o agregado nao diz o que fazer com esta
/// nota.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCalibrationDivergence {
    pub at_unix_ms: u64,
    pub dimension: String,
    pub primary_engine: String,
    pub primary_label: Option<String>,
    pub secondary_engine: String,
    pub secondary_label: Option<String>,
    pub primary_confidence: Option<f64>,
}

#[tauri::command]
pub(crate) fn get_note_calibration_divergence(
    vault_root: String,
    relative_path: String,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<Option<NoteCalibrationDivergence>, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    let log = super::calibrated::comparison::load_comparison(&root);
    // O registro mais recente desta nota: uma avaliacao nova substitui a
    // antiga, e mostrar a divergencia antiga seria mostrar um dado que ja nao
    // descreve a nota.
    let record = log
        .records
        .iter()
        .rev()
        .find(|record| record.relative_path == relative_path);
    let Some(record) = record else {
        return Ok(None);
    };
    Ok(Some(NoteCalibrationDivergence {
        at_unix_ms: record.at_unix_ms,
        dimension: record.dimension.clone(),
        primary_engine: record.primary.engine.clone(),
        primary_label: record.primary.label.clone(),
        secondary_engine: record.secondary.engine.clone(),
        secondary_label: record.secondary.label.clone(),
        primary_confidence: record.primary.confidence,
    }))
}

/// Uma expansao de trecho que o aluno escreveu apressado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImprovementExpansion {
    /// O trecho original da nota, literal.
    pub source_quote: String,
    /// A frase completa que o aluno quis dizer.
    pub expanded: String,
    /// Onde o trecho original comeca, em offset UTF-16.
    pub start_utf16: u64,
    /// Onde o trecho original termina, em offset UTF-16.
    pub end_utf16: u64,
}

/// Uma sugestao de melhoria da nota, ja confirmada.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImprovementSuggestion {
    pub term: String,
    pub definition: String,
    /// A citacao da nota onde o termo e usado sem definicao.
    pub source_quote: String,
    /// Onde a definicao seria inserida, em offset UTF-16.
    pub start_utf16: u64,
    /// A confianca do motor na confirmacao.
    pub confidence: f64,
}

/// As sugestoes de melhoria de uma nota.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImprovementReport {
    /// As expansoes de trecho apressado, prontas para aplicar.
    pub expansions: Vec<NoteImprovementExpansion>,
    /// As definicoes que faltam, ja confirmadas.
    pub suggestions: Vec<NoteImprovementSuggestion>,
    /// Quantas propostas o provider fez e o filtro recusou.
    ///
    /// O numero e diagnostico: se quase tudo e recusado, o provider esta
    /// propondo mal; se quase nada e recusado, o filtro nao esta filtrando.
    pub rejected: usize,
    /// Termos que o dicionario do Vault ja explica e por isso nao viraram
    /// sugestao. Fica separado de `rejected` porque nao e proposta ruim: e
    /// proposta desnecessaria.
    pub already_known: Vec<String>,
    /// `true` quando o provider nao respondeu no contrato.
    pub invalid: bool,
}

/// Sugere melhorias para uma nota: expansoes de trechos apressados e
/// definicoes que faltam.
///
/// O provider **generativo** propoe (ele escreve texto) e o **motor
/// calibrado** confirma (ele julga). A ordem importa: as checagens
/// deterministicas rodam entre as duas, porque cada proposta recusada ali e
/// uma chamada de JEV que nao precisa acontecer.
///
/// A expansao **nao** passa pelo motor calibrado: o motor julga se um termo
/// precisa de definicao, o que ele nao faz e dizer o que o aluno quis
/// escrever. E um texto gerado, revisado pelo usuario.
#[tauri::command]
pub(crate) async fn propose_note_improvements(
    path: String,
    relative_path: String,
    provider: AiProviderSelection,
    scope: super::calibrated::proposals::ImprovementScope,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<NoteImprovementReport, String> {
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

        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;

        // O dicionario do Vault entra no pedido: o que ja tem verbete nao
        // precisa de sugestao. Um dicionario ilegivel nao pode derrubar a
        // sugestao - o filtro deterministico continua valendo, so sem a lista.
        let known_terms: Vec<String> = if scope == ImprovementScope::Expansions {
            Vec::new()
        } else {
            crate::dictionary::load_dictionary(&root)
                .unwrap_or_default()
                .entries
                .into_iter()
                .map(|entry| entry.term)
                .collect()
        };

        // 1. O provider generativo propoe.
        let outcome = super::calibrated::proposals::propose_improvements(
            provider.as_ref(),
            &markdown,
            scope,
            &known_terms,
        )
        .map_err(|failure| failure.message)?;
        if outcome.invalid {
            return Ok(NoteImprovementReport {
                expansions: Vec::new(),
                suggestions: Vec::new(),
                rejected: outcome.rejected.len(),
                already_known: outcome.already_known,
                invalid: true,
            });
        }

        // 2. O motor calibrado confirma as que sobreviveram. Sem o motor
        // calibrado configurado, as sugestoes do provider vao direto: ele ja
        // filtrou, e a confirmacao e o que agrega valor.
        let mut suggestions = Vec::new();
        match calibrated_provider_for(strategy)? {
            Some(calibrated) => {
                reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
                let verdicts = super::calibrated::improvements::confirm_definition_proposals(
                    calibrated.as_ref(),
                    &markdown,
                    &outcome.proposals,
                )
                .map_err(|failure| failure.message)?;
                for (proposal, verdict) in outcome.proposals.iter().zip(verdicts) {
                    if !verdict.needs_definition {
                        continue;
                    }
                    suggestions.push(NoteImprovementSuggestion {
                        term: proposal.term.clone(),
                        definition: proposal.definition.clone(),
                        source_quote: proposal.source_quote.clone(),
                        start_utf16: proposal.start_utf16,
                        confidence: verdict.confidence,
                    });
                }
            }
            None => {
                for proposal in &outcome.proposals {
                    suggestions.push(NoteImprovementSuggestion {
                        term: proposal.term.clone(),
                        definition: proposal.definition.clone(),
                        source_quote: proposal.source_quote.clone(),
                        start_utf16: proposal.start_utf16,
                        confidence: proposal.confidence,
                    });
                }
            }
        }

        let expansions = outcome
            .expansions
            .into_iter()
            .map(|expansion| NoteImprovementExpansion {
                source_quote: expansion.source_quote,
                expanded: expansion.expanded,
                start_utf16: expansion.start_utf16,
                end_utf16: expansion.end_utf16,
            })
            .collect();

        Ok(NoteImprovementReport {
            expansions,
            suggestions,
            rejected: outcome.rejected.len(),
            already_known: outcome.already_known,
            invalid: false,
        })
    })
    .await
    .map_err(|_| "Nao foi possivel sugerir melhorias para a nota.".to_string())?
}

/// O conceito sugerido para um trecho selecionado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryConceptSuggestion {
    /// O verbete sugerido (editavel na tela).
    pub term: String,
    /// A definicao sugerida (editavel na tela).
    pub concept: String,
    /// O verbete que ja cobre este termo no Dicionario do Vault, se houver.
    ///
    /// Vem do backend porque a comparacao de variantes (`estroma` e `estroma
    /// dos cloroplastos`) e a mesma do `upsert`, e a interface nao deve
    /// reimplementar essa regra.
    pub existing: Option<crate::dictionary::DictionaryEntry>,
    /// `true` quando a IA nao respondeu no contrato.
    pub invalid: bool,
}

/// Sugere o conceito de UM trecho que o usuario selecionou na nota.
///
/// ## Por que a nota vem do chamador
///
/// As outras operacoes de melhoria leem a nota do disco porque trabalham na
/// nota inteira e o usuario pode salvar antes. Aqui o pedido nasce de uma
/// **selecao no rascunho**: com o autosave desligado (o padrao), ler o disco
/// daria ao modelo um contexto que o usuario ja mudou. O tamanho e validado
/// antes de qualquer custo, e o conteudo continua sendo dado nao confiavel
/// no prompt.
///
/// A reserva de orcamento usa o contexto **recortado** que vai ao provider,
/// e nao a nota inteira: uma nota de 2 MB nao deve ser cobrada como se toda
/// ela saisse do Vault.
#[tauri::command]
pub(crate) async fn suggest_dictionary_concept(
    path: String,
    term: String,
    markdown: String,
    provider: AiProviderSelection,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<DictionaryConceptSuggestion, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let selection = term.trim().to_string();
    if selection.is_empty() {
        return Err("O trecho selecionado esta vazio.".to_string());
    }
    if selection.chars().count() > MAX_SELECTION_CHARS {
        return Err(format!(
            "O trecho selecionado tem mais de {MAX_SELECTION_CHARS} caracteres. \
             Selecione uma palavra ou uma frase curta."
        ));
    }
    if markdown.trim().is_empty() {
        return Err("A nota esta vazia: nao ha contexto para sugerir o conceito.".to_string());
    }
    if markdown.len() as u64 > MAX_NOTE_BYTES {
        return Err("A nota e grande demais para sugerir um conceito.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let provider = provider_for_selection(provider)?;
        let context = super::calibrated::term_concept::concept_context(&markdown, &selection);
        reserve_ai_call(&root, provider.as_ref(), context.len() + selection.len())?;
        let suggestion = super::calibrated::term_concept::suggest_concept_with_context(
            provider.as_ref(),
            &selection,
            &context,
        )
        .map_err(|failure| failure.message)?;

        // O dicionario e por Vault e a variante e decidida pela mesma regra do
        // `upsert`: registrar `estroma` nao pode criar um segundo verbete
        // quando ja existe `estroma dos cloroplastos`.
        let existing = crate::dictionary::load_dictionary(&root)
            .unwrap_or_default()
            .entries
            .into_iter()
            .find(|entry| crate::dictionary::same_knowledge(&entry.term, &suggestion.term));

        Ok(DictionaryConceptSuggestion {
            term: suggestion.term,
            concept: suggestion.concept,
            existing,
            invalid: suggestion.invalid,
        })
    })
    .await
    .map_err(|_| "Nao foi possivel sugerir o conceito do trecho.".to_string())?
}

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
        // dos anexos referenciados (PDFs, notas embutidas e, quando o provedor
        // tem visao, a interpretacao das imagens), claramente rotulado por
        // fonte. O descritor visual so existe para provedores com visao e
        // autorizacao de egresso (Gemini); cada imagem reserva uma chamada de
        // visao (parada dura de orcamento) ANTES de qualquer byte sair do
        // Vault.
        let provider = provider_for_selection(provider)?;
        let provider_kind = provider.kind();
        let describer = vision_describer_for_selection(provider.as_ref());
        let mut reserve_vision = |image_bytes: usize| {
            super::usage::check_and_record_vision_call(&root, provider_kind, image_bytes)
                .map(|_| ())
        };
        let material = super::session_sources::build_session_material(
            &root,
            &markdown,
            describer.as_deref(),
            &mut reserve_vision,
        )
        .map_err(|error| error.to_string())?;
        reserve_ai_call(&root, provider.as_ref(), material.len() + synthesis.len())?;
        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;

        // A sintese fica no caminho legado, e isso e uma DECISAO medida, nao
        // uma omissao.
        //
        // Os dois motores respondem a perguntas **diferentes** aqui: o legado
        // da um score 0-100 a partir da sintese do usuario, e o JEV classifica
        // a mesma frase em cinco niveis com a sua propria rubrica. Nao sao
        // equivalentes, entao "concordar" nao e o mesmo que "errar junto".
        //
        // Contra a revisao independente (19 casos, `golden-review-gemini.json`),
        // o legado acerta 23 de 32 dimensoes e o JEV 19 de 32 - o legado erra
        // menos, sobretudo em `application` (6/8 contra 3/8). Trocar a sintese
        // para o JEV pioraria o que o usuario ve.
        //
        // E, se o score do legado e o que vale, **nao ha razao para chamar o
        // JEV**: a chamada custaria dinheiro e latencia para um numero que
        // seria descartado. O caminho calibrado continua valendo para
        // prontidao, fatos, assertions e `shouldFinish`, onde os dois motores
        // respondem a MESMA pergunta e o JEV ganha de lavada.
        let _ = strategy;
        super::synthesis::evaluate_synthesis(provider.as_ref(), &material, &synthesis)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Nao foi possivel avaliar a sintese.".to_string())?
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

        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;
        let calibrated = calibrated_provider_for(strategy)?;

        let attempt = evaluate_readiness(
            provider.as_ref(),
            &markdown,
            max_whole_note_words,
            expected_source_hash.as_deref(),
        )
        .map_err(|error| error.to_string())?;

        let calibrated = match calibrated {
            Some(calibrated) => calibrated,
            // Sem JEV configurado: caminho legado puro.
            None => {
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
                return Ok(attempt);
            }
        };

        // A prosa decide se a tentativa e valida: sem texto ancorado nao ha o
        // que mostrar, e o caminho calibrado nao inventa grounding.
        let ReadinessAttempt::Valid {
            source_hash,
            report,
        } = attempt
        else {
            return Ok(attempt);
        };

        // Estas duas chamadas NAO sao paralelas, ao contrario de F2/F3/F4.
        // O JEV reclassifica os issues que o legado acabou de produzir, entao a
        // segunda depende da primeira por dados, nao por escolha. Rodar em
        // paralelo exigiria classificar issues obsoletos de uma avaliacao
        // anterior, que e o modo de falha que o portao de confianca existe
        // justamente para evitar.
        //
        // Uma chamada de reserva: o JEV e a segunda via, entao ela e orcada
        // separadamente. Sem isso o modo Dual dobraria a conta sem nenhuma
        // variavel de controle.
        reserve_ai_call(&root, provider.as_ref(), markdown.len())?;
        let now = current_unix_ms().map_err(|error| error.to_string())?;
        // O trecho calibrado vive em `calibrated::dispatch` para ser testavel
        // de ponta a ponta. Um caminho de producao sem teste e o tipo de
        // coisa que esconde um bug ate o usuario avaliar a primeira nota - a
        // sintese esteve quebrada assim.
        let assessment = super::calibrated::dispatch::assess_with_calibration(
            super::calibrated::dispatch::CalibratedInput {
                vault_root: &root,
                strategy,
                calibrated: calibrated.as_ref(),
                markdown: &markdown,
                legacy_report: &report,
                source_hash: &source_hash,
                relative_path: &relative_path,
                now_unix_ms: now,
            },
        )
        .map_err(|failure| failure.message)?;
        let merged = assessment.report;

        let attempt = ReadinessAttempt::Valid {
            source_hash,
            report: merged,
        };
        let current_markdown =
            read_bounded_markdown(&root, &note_path).map_err(|error| error.to_string())?;
        persist_readiness_attempt(&root, &relative_path, &current_markdown, &attempt, now)
            .map_err(|error| error.to_string())?;
        Ok(attempt)
    })
    .await
    .map_err(|_| "Nao foi possivel concluir a avaliacao da nota.".to_string())?
}

/// Auditoria estrutural deterministica da nota (sem IA): usa a regra de
/// segmentacao por secoes para propor melhorias de estrutura que encaixem a
/// nota na categorizacao de revisao. Leitura pura - nao altera nada.
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
/// IA - usa exatamente a mesma selecao de cobertura da sessao real, entao o
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
        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;
        let calibrated = calibrated_provider_for(strategy)?;
        // A conversa continua com o subset das unidades-alvo (cobertura
        // adaptativa), para os turnos nunca sairem do escopo da sessao.
        //
        // C6: com motor calibrado, sao ate DUAS chamadas neste caminho - a
        // decisao de encerrar e a pergunta. Isso encarece o turno mais sensivel
        // de latencia da UX, entao a reserva de orcamento e feita duas vezes e
        // o caminho sem JEV continua sendo exatamente o legado.
        let attempt = match calibrated {
            Some(calibrated) => {
                reserve_ai_call(&root, provider.as_ref(), bound.session_markdown.len())?;
                continue_review_conversation_with_calibration(
                    provider.as_ref(),
                    calibrated.as_ref(),
                    &bound.session_markdown,
                    &exchanges,
                )
            }
            None => {
                continue_review_conversation(provider.as_ref(), &bound.session_markdown, &exchanges)
            }
        }
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
        let strategy = super::calibration::load_calibration_config(&root)
            .map_err(|error| error.to_string())?
            .strategy;
        let calibrated = calibrated_provider_for(strategy)?;
        // A classificacao calibrada e uma chamada extra sobre a avaliacao
        // generativa, que ja rodou porque as lacunas e o resumo sao texto.
        if calibrated.is_some() {
            reserve_ai_call(&root, provider.as_ref(), markdown.len() / 2)?;
        }
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
            // Quem julgou. O campo e preenchido aqui, no unico ponto onde a
            // estrategia esta resolvida, para que nenhum caminho de avaliacao
            // possa esquecer de preenche-lo: sem isto, a comparabilidade do §11
            // nao tem como attributir um numero ao motor que o produziu.
            calibration: Some(super::calibration::provenance_for(
                strategy,
                calibrated.as_deref(),
            )),
        };
        let attempt = complete_review_session_with_calibration(
            &root,
            &note_id,
            provider.as_ref(),
            calibrated.as_deref(),
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

/// Página da fila de vencimento (próximas a vencer, futuro próximo primeiro).
/// `limit` é limitado no backend; `offset` avança a janela para a rolagem
/// infinita sem repetir itens.
#[tauri::command]
pub(crate) async fn list_upcoming_review_queue(
    path: String,
    limit: usize,
    offset: usize,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<UpcomingReviewQueue, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        list_upcoming_reviews(
            &root,
            current_unix_ms().map_err(|error| error.to_string())?,
            limit,
            offset,
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
    .map_err(|_| "Nao foi possivel carregar os proximos vencimentos.".to_string())?
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
            confidence: None,
            status_probabilities: None,
            confidence_degraded: None,
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

/// Isola (quarentena) o documento irrecuperavel - principal e backups - para
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
