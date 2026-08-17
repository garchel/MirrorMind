use super::contract::ReadinessAssessment;
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const NOTIFICATION_SETTINGS_FILE: &str = "review-notifications.json";
const DAY_MS: u64 = 86_400_000;

/// Preferencia global de notificacoes de revisao, persistida na pasta de
/// configuracao da aplicacao (nao no Vault). Um unico resumo diario evita uma
/// notificacao por nota.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNotificationSettings {
    /// Resumo diario habilitado.
    pub enabled: bool,
    /// Hora local do resumo (0-23).
    pub hour: u8,
    /// Minuto local do resumo (0-59).
    pub minute: u8,
    /// Silenciar: mantem a configuracao, mas nao notifica.
    pub muted: bool,
    /// Inicio do dia local (unix ms) da ultima notificacao enviada, para
    /// garantir no maximo um resumo por dia.
    pub last_notified_day_start: Option<u64>,
}

impl Default for ReviewNotificationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            hour: 9,
            minute: 0,
            muted: false,
            last_notified_day_start: None,
        }
    }
}

impl ReviewNotificationSettings {
    fn validate(&self) -> Result<()> {
        if self.hour > 23 {
            bail!("A hora deve estar entre 0 e 23.");
        }
        if self.minute > 59 {
            bail!("O minuto deve estar entre 0 e 59.");
        }
        Ok(())
    }
}

/// Vista serializada para o frontend (sem rastreio interno de ultimo envio).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNotificationSettingsView {
    pub enabled: bool,
    pub hour: u8,
    pub minute: u8,
    pub muted: bool,
}

impl From<&ReviewNotificationSettings> for ReviewNotificationSettingsView {
    fn from(settings: &ReviewNotificationSettings) -> Self {
        Self {
            enabled: settings.enabled,
            hour: settings.hour,
            minute: settings.minute,
            muted: settings.muted,
        }
    }
}

impl From<ReviewNotificationSettings> for ReviewNotificationSettingsView {
    fn from(settings: ReviewNotificationSettings) -> Self {
        Self::from(&settings)
    }
}

/// Resultado de uma checagem: se notificou, quantas vencidas haviam e por que
/// nada foi enviado (para exibir na interface).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNotificationCheckView {
    pub sent: bool,
    pub due_count: usize,
    pub skipped_reason: Option<String>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_config_dir()?
        .join(NOTIFICATION_SETTINGS_FILE))
}

pub fn load_settings(app: &tauri::AppHandle) -> ReviewNotificationSettings {
    let path = settings_path(app);
    let Ok(path) = path else {
        return ReviewNotificationSettings::default();
    };
    if !path.exists() {
        return ReviewNotificationSettings::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|error| {
            log::warn!(
                "Configuracao de notificacoes corrompida em '{}' ({error}); usando padroes.",
                path.display()
            );
            ReviewNotificationSettings::default()
        }),
        Err(_) => ReviewNotificationSettings::default(),
    }
}

pub fn save_settings(app: &tauri::AppHandle, settings: &ReviewNotificationSettings) -> Result<()> {
    settings.validate()?;
    let path = settings_path(app)?;
    let parent = path
        .parent()
        .context("Nao foi possivel encontrar a pasta de configuracao da aplicacao.")?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("Nao foi possivel criar '{}'.", parent.display()))?;
    std::fs::write(&path, serde_json::to_string_pretty(settings)?)
        .with_context(|| format!("Nao foi possivel escrever '{}'.", path.display()))
}

/// Conta notas vencidas com o mesmo predicado da fila (inscrita, pronta e com
/// data passada) sem ler o Markdown de cada arquivo — suficiente para o resumo
/// diario.
pub fn count_due_notes(vault_root: &Path, now_unix_ms: u64) -> Result<usize> {
    let mut due_count = 0usize;
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let enrolled = document.note.enrollment.is_enrolled()
            && matches!(document.note.readiness, ReadinessAssessment::Ready { .. });
        if enrolled
            && document
                .scheduling
                .next_review_at_unix_ms
                .is_some_and(|next| next <= now_unix_ms)
        {
            due_count += 1;
        }
    }
    Ok(due_count)
}

/// O inicio do dia local vem do cliente. Um valor ausente, obsoleto ou
/// corrompido nao pode produzir uma decisao enganosa: fora de uma janela de um
/// dia em torno de agora, cai para o dia alinhado em UTC (mesmo clamp do
/// dashboard), evitando que o parametro controle quando e quantas vezes o
/// resumo e enviado.
fn sanitize_local_day_start(now_unix_ms: u64, local_day_start_unix_ms: u64) -> u64 {
    let within_window = local_day_start_unix_ms.saturating_sub(now_unix_ms) <= DAY_MS
        && now_unix_ms.saturating_sub(local_day_start_unix_ms) <= DAY_MS;
    if within_window {
        local_day_start_unix_ms
    } else {
        now_unix_ms - (now_unix_ms % DAY_MS)
    }
}

fn minutes_since_day_start(now_unix_ms: u64, local_day_start_unix_ms: u64) -> Option<u32> {
    let elapsed = now_unix_ms.checked_sub(local_day_start_unix_ms)?;
    if elapsed > DAY_MS * 2 {
        return None;
    }
    Some((elapsed / 60_000) as u32)
}

/// Decide se o resumo diario deve ser enviado agora.
///
/// Regras (uma unica notificacao por dia local):
/// - desabilitado ou silenciado -> skip;
/// - ja notificou no dia local atual -> skip;
/// - a hora configurada ainda nao chegou -> skip;
/// - sem revisoes vencidas -> skip (sem marcar o dia, para notificar assim que
///   surgirem vencidas ainda no mesmo dia).
fn should_notify(
    settings: &ReviewNotificationSettings,
    now_unix_ms: u64,
    local_day_start_unix_ms: u64,
    due_count: usize,
) -> Result<Option<String>> {
    if !settings.enabled {
        return Ok(Some("Resumo diario desabilitado.".to_string()));
    }
    if settings.muted {
        return Ok(Some("Notificacoes silenciadas.".to_string()));
    }
    if settings.last_notified_day_start == Some(local_day_start_unix_ms) {
        return Ok(Some("Resumo ja enviado hoje.".to_string()));
    }
    let Some(minutes_today) = minutes_since_day_start(now_unix_ms, local_day_start_unix_ms) else {
        return Ok(Some("Horario local do dia indisponivel.".to_string()));
    };
    let configured = u32::from(settings.hour) * 60 + u32::from(settings.minute);
    if minutes_today < configured {
        return Ok(Some(
            "Ainda nao e a hora configurada para o resumo.".to_string(),
        ));
    }
    if due_count == 0 {
        return Ok(Some("Nenhuma revisao vencida agora.".to_string()));
    }
    Ok(None)
}

fn send_notification(app: &tauri::AppHandle, due_count: usize) -> Result<()> {
    use tauri_plugin_notification::NotificationExt;
    let body = if due_count == 1 {
        "Voce tem 1 revisao vencida hoje.".to_string()
    } else {
        format!("Voce tem {due_count} revisoes vencidas hoje.")
    };
    app.notification()
        .builder()
        .title("MirrorMind — Revisoes vencidas")
        .body(&body)
        .show()
        .map_err(|error| anyhow::anyhow!("Nao foi possivel enviar a notificacao: {error}"))
}

/// Trava global de envio: serializa a sequencia decide -> envia -> marca o dia,
/// impedindo que o timer periodico e o check manual enviem duas notificacoes no
/// mesmo instante antes que o dia seja marcado.
static NOTIFICATION_SEND_LOCK: Mutex<()> = Mutex::new(());

/// Executa a checagem do resumo diario para o vault informado. Idempotente:
/// envia no maximo uma notificacao por dia local. Nao falha o fluxo do app se
/// o sistema nao suportar notificacoes — registra e segue.
pub fn check_daily_notification(
    app: &tauri::AppHandle,
    vault_root: &Path,
    now_unix_ms: u64,
    local_day_start_unix_ms: u64,
) -> Result<ReviewNotificationCheckView> {
    let day_start = sanitize_local_day_start(now_unix_ms, local_day_start_unix_ms);
    let _guard = NOTIFICATION_SEND_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = load_settings(app);
    let due_count = count_due_notes(vault_root, now_unix_ms)?;
    let skipped_reason = should_notify(&settings, now_unix_ms, day_start, due_count)?;
    if let Some(reason) = skipped_reason {
        return Ok(ReviewNotificationCheckView {
            sent: false,
            due_count,
            skipped_reason: Some(reason),
        });
    }
    match send_notification(app, due_count) {
        Ok(()) => {
            settings.last_notified_day_start = Some(day_start);
            let _ = save_settings(app, &settings);
            Ok(ReviewNotificationCheckView {
                sent: true,
                due_count,
                skipped_reason: None,
            })
        }
        Err(error) => Ok(ReviewNotificationCheckView {
            sent: false,
            due_count,
            skipped_reason: Some(format!("Nao foi possivel notificar: {error}")),
        }),
    }
}

/// Notificacao de teste enviada imediatamente, ignorando horario e silencio.
/// Usa um corpo proprio para nao parecer que ha revisoes vencidas de verdade.
pub fn send_test_notification(app: &tauri::AppHandle) -> Result<()> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("MirrorMind — Notificacoes")
        .body("Isso e um teste de notificacao do MirrorMind.")
        .show()
        .map_err(|error| anyhow::anyhow!("Nao foi possivel enviar a notificacao: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::state::{persist_readiness_assessment, set_manual_enrollment};
    use crate::review::storage::{load_learning_document, write_learning_document};
    use tempfile::tempdir;

    const DAY_MS: u64 = 24 * 60 * 60 * 1_000;
    const MARKDOWN: &str = "# Memoria\n\nIdeia um.\n\nIdeia dois.";

    fn create_ready_note(vault: &Path, path: &str, ready_at: u64) {
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let state = persist_readiness_assessment(vault, path, MARKDOWN, &report, ready_at)
            .expect("persist readiness");
        set_manual_enrollment(vault, path, MARKDOWN, true, ready_at).expect("enroll note");
        // Define a proxima revisao como vencida (ready_at no passado) para
        // simular uma nota na fila.
        let loaded = load_learning_document(vault, &state.note_id)
            .expect("load document")
            .expect("document exists");
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        document.revision += 1;
        document.scheduling.next_review_at_unix_ms = Some(ready_at);
        write_learning_document(vault, &state.note_id, Some(expected_revision), &document)
            .expect("persist scheduling");
    }

    #[test]
    fn default_settings_are_disabled_with_morning_hour() {
        let settings = ReviewNotificationSettings::default();
        assert!(!settings.enabled);
        assert_eq!((settings.hour, settings.minute), (9, 0));
        assert!(!settings.muted);
        assert_eq!(settings.last_notified_day_start, None);
    }

    #[test]
    fn invalid_hour_is_rejected_when_saving() {
        let settings = ReviewNotificationSettings {
            hour: 24,
            minute: 0,
            ..ReviewNotificationSettings::default()
        };
        // save_settings requer AppHandle; a validacao pura e testada aqui.
        assert!(settings.validate().is_err());
        let settings = ReviewNotificationSettings {
            hour: 9,
            minute: 61,
            ..ReviewNotificationSettings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn counts_only_enrolled_ready_overdue_notes() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Vencida.md", now - 2 * DAY_MS);
        create_ready_note(vault.path(), "Futura.md", now + 5 * DAY_MS);
        assert_eq!(count_due_notes(vault.path(), now).expect("count"), 1);
    }

    #[test]
    fn daily_summary_respects_enabled_muted_already_sent_and_hour() {
        let now = 1_730_000_000_000;
        let day_start = now - 10 * 60 * 60 * 1_000; // 10h de dia ja passaram

        // Desabilitado.
        let settings = ReviewNotificationSettings::default();
        assert_eq!(
            should_notify(&settings, now, day_start, 3).expect("decide"),
            Some("Resumo diario desabilitado.".to_string())
        );

        // Silenciado.
        let settings = ReviewNotificationSettings {
            enabled: true,
            muted: true,
            ..ReviewNotificationSettings::default()
        };
        assert_eq!(
            should_notify(&settings, now, day_start, 3).expect("decide"),
            Some("Notificacoes silenciadas.".to_string())
        );

        // Ja notificou hoje.
        let settings = ReviewNotificationSettings {
            enabled: true,
            last_notified_day_start: Some(day_start),
            ..ReviewNotificationSettings::default()
        };
        assert_eq!(
            should_notify(&settings, now, day_start, 3).expect("decide"),
            Some("Resumo ja enviado hoje.".to_string())
        );

        // Ainda nao e a hora configurada (17h da tarde vs 9h da manha).
        let late_day_start = now - 2 * 60 * 60 * 1_000;
        let settings = ReviewNotificationSettings {
            enabled: true,
            hour: 9,
            minute: 0,
            ..ReviewNotificationSettings::default()
        };
        assert_eq!(
            should_notify(&settings, now, late_day_start, 3).expect("decide"),
            Some("Ainda nao e a hora configurada para o resumo.".to_string())
        );

        // Sem vencidas: skip sem marcar o dia.
        let settings = ReviewNotificationSettings {
            enabled: true,
            ..ReviewNotificationSettings::default()
        };
        assert_eq!(
            should_notify(&settings, now, day_start, 0).expect("decide"),
            Some("Nenhuma revisao vencida agora.".to_string())
        );

        // Hora configurada passou e ha vencidas: envia.
        let settings = ReviewNotificationSettings {
            enabled: true,
            hour: 9,
            minute: 0,
            ..ReviewNotificationSettings::default()
        };
        assert_eq!(
            should_notify(&settings, now, day_start, 3).expect("decide"),
            None
        );
    }

    #[test]
    fn minutes_since_day_start_is_bounded() {
        let now = 1_730_000_000_000;
        assert_eq!(minutes_since_day_start(now, now - 60_000), Some(1));
        assert_eq!(minutes_since_day_start(now, now - 3 * DAY_MS), None);
        assert_eq!(minutes_since_day_start(now - 60_000, now), None);
    }

    #[test]
    fn local_day_start_outside_the_window_falls_back_to_utc_day() {
        let now = 1_730_000_000_000;
        // Dentro da janela de um dia: preserva o valor do cliente.
        let near = now - 5 * 60 * 60 * 1_000;
        assert_eq!(sanitize_local_day_start(now, near), near);
        // Obsoleto (ontem ha mais de um dia): cai para o dia alinhado em UTC.
        let stale = now - 3 * DAY_MS;
        assert_eq!(sanitize_local_day_start(now, stale), now - (now % DAY_MS));
        // Futuro alem de um dia: tambem cai para o dia alinhado em UTC.
        let future = now + 2 * DAY_MS;
        assert_eq!(sanitize_local_day_start(now, future), now - (now % DAY_MS));
    }
}
