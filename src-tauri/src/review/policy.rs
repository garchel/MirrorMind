use super::contract::{
    PolicySource, PolicySourceKind, ReadinessAssessment, ReviewMode, SchedulingStatus,
};
use super::evaluation::source_hash;
use super::policy_config::load_inherited_review_policy;
use super::session::{adjust_schedule_for_deadline, interval_days_for_retention};
use super::storage::{load_learning_document_for_path, write_learning_document};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

const DAY_MS: u64 = 86_400_000;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum NoteReviewPolicyField {
    FirstReviewIntervalDays,
    TargetRetention,
    PriorityWeight,
    MinIntervalDays,
    MaxIntervalDays,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteReviewPolicyInput {
    pub first_review_interval_days: u64,
    pub target_retention: f64,
    pub priority_weight: f64,
    pub min_interval_days: u64,
    pub max_interval_days: u64,
    pub preferred_mode: ReviewMode,
    pub override_fields: Vec<NoteReviewPolicyField>,
    #[serde(default)]
    pub inherit_fields: Vec<NoteReviewPolicyField>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySourceView {
    kind: &'static str,
    source_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReviewPolicySourcesView {
    first_review_interval_days: PolicySourceView,
    target_retention: PolicySourceView,
    priority_weight: PolicySourceView,
    min_interval_days: PolicySourceView,
    max_interval_days: PolicySourceView,
    deadline_at_unix_ms: Option<PolicySourceView>,
    active_deadline: Option<PolicySourceView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReviewPolicyView {
    pub first_review_interval_days: u64,
    pub target_retention: f64,
    pub priority_weight: f64,
    pub min_interval_days: u64,
    pub max_interval_days: u64,
    pub deadline_at_unix_ms: Option<u64>,
    pub preferred_mode: &'static str,
    /// O modo preferido foi definido explicitamente nesta nota (senao e herdado
    /// das tags ou usa o padrao Prova).
    pub mode_manual: bool,
    pub sources: NoteReviewPolicySourcesView,
    pub first_review_at_unix_ms: Option<u64>,
    pub next_review_at_unix_ms: Option<u64>,
    pub completed_review_count: usize,
    pub enrolled: bool,
    pub due: bool,
}

pub fn load_note_review_policy(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    now_unix_ms: u64,
) -> Result<Option<NoteReviewPolicyView>> {
    let Some(loaded) = load_learning_document_for_path(vault_root, relative_path)? else {
        return Ok(None);
    };
    if loaded.document.note.content_hash != source_hash(markdown) {
        bail!("A nota mudou desde a avaliacao. Avalie a prontidao novamente.");
    }
    Ok(Some(view_from_document(&loaded.document, now_unix_ms)))
}

pub fn set_note_review_policy(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    input: NoteReviewPolicyInput,
    now_unix_ms: u64,
) -> Result<NoteReviewPolicyView> {
    validate_input(&input)?;
    let loaded = load_learning_document_for_path(vault_root, relative_path)?.ok_or_else(|| {
        anyhow::anyhow!("Avalie a prontidao da nota antes de configurar revisoes.")
    })?;
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    if document.note.content_hash != source_hash(markdown) {
        bail!("A nota mudou desde a avaliacao. Avalie a prontidao novamente.");
    }

    document.note.enrollment.preferred_mode = input.preferred_mode;
    // Salvar a politica da nota define o modo explicitamente: a partir dai as
    // tags nao sobrescrevem esta preferencia.
    document.note.enrollment.mode_manual = true;
    let override_fields: HashSet<_> = input.override_fields.iter().copied().collect();
    let inherit_fields: HashSet<_> = input.inherit_fields.iter().copied().collect();
    if !inherit_fields.is_empty() {
        let inherited = load_inherited_review_policy(vault_root, markdown, now_unix_ms)?.policy;
        if inherit_fields.contains(&NoteReviewPolicyField::FirstReviewIntervalDays) {
            document.effective_policy.first_review_interval_days =
                inherited.first_review_interval_days;
            document.effective_policy.sources.first_review_interval_days =
                inherited.sources.first_review_interval_days;
        }
        if inherit_fields.contains(&NoteReviewPolicyField::TargetRetention) {
            document.effective_policy.target_retention = inherited.target_retention;
            document.effective_policy.sources.target_retention = inherited.sources.target_retention;
        }
        if inherit_fields.contains(&NoteReviewPolicyField::PriorityWeight) {
            document.effective_policy.priority_weight = inherited.priority_weight;
            document.effective_policy.sources.priority_weight = inherited.sources.priority_weight;
        }
        if inherit_fields.contains(&NoteReviewPolicyField::MinIntervalDays) {
            document.effective_policy.min_interval_days = inherited.min_interval_days;
            document.effective_policy.sources.min_interval_days =
                inherited.sources.min_interval_days;
        }
        if inherit_fields.contains(&NoteReviewPolicyField::MaxIntervalDays) {
            document.effective_policy.max_interval_days = inherited.max_interval_days;
            document.effective_policy.sources.max_interval_days =
                inherited.sources.max_interval_days;
        }
    }
    let note_source = || PolicySource {
        kind: PolicySourceKind::Note,
        source_id: Some(note_id.clone()),
    };
    if override_fields.contains(&NoteReviewPolicyField::FirstReviewIntervalDays) {
        document.effective_policy.first_review_interval_days = input.first_review_interval_days;
        document.effective_policy.sources.first_review_interval_days = note_source();
    }
    if override_fields.contains(&NoteReviewPolicyField::TargetRetention) {
        document.effective_policy.target_retention = input.target_retention;
        document.effective_policy.sources.target_retention = note_source();
    }
    if override_fields.contains(&NoteReviewPolicyField::PriorityWeight) {
        document.effective_policy.priority_weight = input.priority_weight;
        document.effective_policy.sources.priority_weight = note_source();
    }
    if override_fields.contains(&NoteReviewPolicyField::MinIntervalDays) {
        document.effective_policy.min_interval_days = input.min_interval_days;
        document.effective_policy.sources.min_interval_days = note_source();
    }
    if override_fields.contains(&NoteReviewPolicyField::MaxIntervalDays) {
        document.effective_policy.max_interval_days = input.max_interval_days;
        document.effective_policy.sources.max_interval_days = note_source();
    }

    document.effective_policy.validate()?;
    reschedule(&mut document, now_unix_ms)?;
    document.revision = expected_revision.saturating_add(1);
    write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    Ok(view_from_document(&document, now_unix_ms))
}

/// Acao rapida de revisao: altera somente o peso de prioridade da nota,
/// criando uma sobrescrita de nota sobre a heranca (Vault/tag), preservando
/// todos os demais campos, o historico e o estado DSR/FSRS. A data de revisao
/// nao muda (prioridade so afeta a ordem da fila), mas o reschedule mantem o
/// documento consistente.
pub fn set_note_review_priority(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    priority_weight: f64,
    now_unix_ms: u64,
) -> Result<NoteReviewPolicyView> {
    if !priority_weight.is_finite() || priority_weight <= 0.0 || priority_weight > 100.0 {
        bail!("A prioridade deve ser maior que zero e no maximo 100.");
    }
    let loaded = load_learning_document_for_path(vault_root, relative_path)?.ok_or_else(|| {
        anyhow::anyhow!("Avalie a prontidao da nota antes de configurar revisoes.")
    })?;
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    if document.note.content_hash != source_hash(markdown) {
        bail!("A nota mudou desde a avaliacao. Avalie a prontidao novamente.");
    }
    document.effective_policy.priority_weight = priority_weight;
    document.effective_policy.sources.priority_weight = PolicySource {
        kind: PolicySourceKind::Note,
        source_id: Some(note_id.clone()),
    };
    document.effective_policy.validate()?;
    reschedule(&mut document, now_unix_ms)?;
    document.revision = expected_revision.saturating_add(1);
    write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    Ok(view_from_document(&document, now_unix_ms))
}

fn validate_input(input: &NoteReviewPolicyInput) -> Result<()> {
    let unique_override_fields: HashSet<_> = input.override_fields.iter().copied().collect();
    if unique_override_fields.len() != input.override_fields.len() {
        bail!("Uma politica nao pode repetir campos de sobrescrita.");
    }
    let unique_inherit_fields: HashSet<_> = input.inherit_fields.iter().copied().collect();
    if unique_inherit_fields.len() != input.inherit_fields.len() {
        bail!("Uma politica nao pode repetir campos de heranca.");
    }
    if unique_override_fields
        .iter()
        .any(|field| unique_inherit_fields.contains(field))
    {
        bail!("Um campo nao pode ser sobrescrito e herdado na mesma operacao.");
    }
    if input.first_review_interval_days == 0 || input.first_review_interval_days > 3_650 {
        bail!("O intervalo da primeira revisao deve estar entre 1 e 3650 dias.");
    }
    if !input.target_retention.is_finite() || !(0.5..=0.99).contains(&input.target_retention) {
        bail!("A retencao desejada deve estar entre 50% e 99%.");
    }
    if !input.priority_weight.is_finite()
        || input.priority_weight <= 0.0
        || input.priority_weight > 100.0
    {
        bail!("A prioridade deve ser maior que zero e no maximo 100.");
    }
    if input.min_interval_days == 0
        || input.min_interval_days > 3_650
        || input.max_interval_days < input.min_interval_days
        || input.max_interval_days > 36_500
    {
        bail!("Os intervalos minimo e maximo sao invalidos.");
    }
    Ok(())
}

pub(crate) fn reschedule(
    document: &mut super::contract::LearningDocument,
    now_unix_ms: u64,
) -> Result<()> {
    let enrolled = document.note.enrollment.is_enrolled();
    let mut next_review = next_review_for_effective_policy(document)?;
    // Ajuste do agendamento para a tag ativa com prazo: quando a politica muda
    // (prazo novo ou alterado), a proxima data e recalculada projetando a
    // retencao na prova e antecipando somente as revisoes necessarias. O flag
    // de risco e derivado a cada leitura (state/dashboard), nunca persistido.
    if document.effective_policy.deadline_at_unix_ms.is_some() {
        let ready_at = super::session::note_ready_at(document);
        if let (Some(adjusted), _) = adjust_schedule_for_deadline(
            now_unix_ms,
            &document.effective_policy,
            &document.units,
            ready_at,
        )? {
            next_review = Some(adjusted);
        }
    }
    if document.sessions.is_empty() {
        document.scheduling.first_review_at_unix_ms = next_review;
    }

    if enrolled {
        document.scheduling.next_review_at_unix_ms = next_review;
        document.scheduling.status = match next_review {
            Some(next) if next <= now_unix_ms => SchedulingStatus::Due,
            Some(_) => SchedulingStatus::Scheduled,
            None => SchedulingStatus::NotScheduled,
        };
    } else {
        document.scheduling.next_review_at_unix_ms = None;
        document.scheduling.status = SchedulingStatus::Paused;
    }
    Ok(())
}

pub(crate) fn next_review_for_effective_policy(
    document: &super::contract::LearningDocument,
) -> Result<Option<u64>> {
    if document.sessions.is_empty() {
        let ready_at = match &document.note.readiness {
            ReadinessAssessment::Ready {
                assessed_at_unix_ms,
                ..
            } => *assessed_at_unix_ms,
            _ => return Ok(None),
        };
        return Ok(Some(
            ready_at
                .checked_add(
                    document
                        .effective_policy
                        .first_review_interval_days
                        .checked_mul(DAY_MS)
                        .context("O intervalo inicial de revisao excede o limite suportado.")?,
                )
                .context("A primeira data de revisao excede o limite suportado.")?,
        ));
    }

    Ok(document
        .units
        .iter()
        .filter_map(|unit| unit.fsrs.as_ref())
        .filter_map(|fsrs| {
            let interval_days = interval_days_for_retention(
                fsrs.stability_days,
                document.effective_policy.target_retention,
                document.effective_policy.min_interval_days,
                document.effective_policy.max_interval_days,
            );
            fsrs.last_reviewed_at_unix_ms
                .checked_add(interval_days.checked_mul(DAY_MS)?)
        })
        .min())
}
fn view_from_document(
    document: &super::contract::LearningDocument,
    now_unix_ms: u64,
) -> NoteReviewPolicyView {
    let policy = &document.effective_policy;
    NoteReviewPolicyView {
        first_review_interval_days: policy.first_review_interval_days,
        target_retention: policy.target_retention,
        priority_weight: policy.priority_weight,
        min_interval_days: policy.min_interval_days,
        max_interval_days: policy.max_interval_days,
        deadline_at_unix_ms: policy.deadline_at_unix_ms,
        preferred_mode: match document.note.enrollment.preferred_mode {
            ReviewMode::Exam => "exam",
            ReviewMode::Conversation => "conversation",
        },
        mode_manual: document.note.enrollment.mode_manual,
        sources: NoteReviewPolicySourcesView {
            first_review_interval_days: source_view(&policy.sources.first_review_interval_days),
            target_retention: source_view(&policy.sources.target_retention),
            priority_weight: source_view(&policy.sources.priority_weight),
            min_interval_days: source_view(&policy.sources.min_interval_days),
            max_interval_days: source_view(&policy.sources.max_interval_days),
            deadline_at_unix_ms: policy.sources.deadline_at_unix_ms.as_ref().map(source_view),
            active_deadline: policy.sources.active_deadline.as_ref().map(source_view),
        },
        first_review_at_unix_ms: document.scheduling.first_review_at_unix_ms,
        next_review_at_unix_ms: document.scheduling.next_review_at_unix_ms,
        completed_review_count: document.sessions.len(),
        enrolled: document.note.enrollment.is_enrolled(),
        due: document
            .scheduling
            .next_review_at_unix_ms
            .is_some_and(|next| next <= now_unix_ms),
    }
}

fn source_view(source: &PolicySource) -> PolicySourceView {
    PolicySourceView {
        kind: match source.kind {
            PolicySourceKind::VaultDefault => "vaultDefault",
            PolicySourceKind::ExpiredDeadlineTag => "expiredDeadlineTag",
            PolicySourceKind::Tag => "tag",
            PolicySourceKind::ActiveDeadlineTag => "activeDeadlineTag",
            PolicySourceKind::Note => "note",
        },
        source_id: source.source_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_note_review_policy, set_note_review_policy, NoteReviewPolicyField,
        NoteReviewPolicyInput, DAY_MS,
    };
    use crate::review::contract::{PolicySourceKind, ReviewMode, SchedulingStatus};
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::policy_config::{set_vault_review_defaults, VaultReviewDefaultsInput};
    use crate::review::state::{persist_readiness_assessment, set_manual_enrollment};
    use crate::review::storage::load_learning_document;
    use tempfile::tempdir;

    #[test]
    fn note_policy_can_recalculate_the_first_review() {
        let vault = tempdir().expect("vault");
        let path = "Biologia/ATP.md";
        let markdown = "# ATP\n\nATP armazena energia.\n\nATP transfere energia.\n\nATP participa do metabolismo.";
        let assessed_at = 1_720_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let state =
            persist_readiness_assessment(vault.path(), path, markdown, &report, assessed_at)
                .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");

        let view = set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 1,
                target_retention: 0.9,
                priority_weight: 3.0,
                min_interval_days: 1,
                max_interval_days: 90,
                preferred_mode: ReviewMode::Conversation,
                override_fields: vec![
                    NoteReviewPolicyField::FirstReviewIntervalDays,
                    NoteReviewPolicyField::TargetRetention,
                    NoteReviewPolicyField::PriorityWeight,
                    NoteReviewPolicyField::MinIntervalDays,
                    NoteReviewPolicyField::MaxIntervalDays,
                ],
                inherit_fields: Vec::new(),
            },
            assessed_at + (2 * DAY_MS),
        )
        .expect("set policy");

        assert_eq!(view.first_review_at_unix_ms, Some(assessed_at + DAY_MS));
        assert_eq!(view.next_review_at_unix_ms, Some(assessed_at + DAY_MS));
        assert!(view.due);
        assert_eq!(view.preferred_mode, "conversation");
        let loaded = load_learning_document(vault.path(), &state.note_id)
            .expect("load policy")
            .expect("document exists");
        assert!(matches!(
            loaded
                .document
                .effective_policy
                .sources
                .priority_weight
                .kind,
            PolicySourceKind::Note
        ));
        assert_eq!(loaded.document.scheduling.status, SchedulingStatus::Due);

        let reloaded =
            load_note_review_policy(vault.path(), path, markdown, assessed_at + (2 * DAY_MS))
                .expect("load view")
                .expect("policy exists");
        assert_eq!(reloaded.priority_weight, 3.0);
    }

    #[test]
    fn changing_retention_recalculates_a_reviewed_note_from_its_memory_state() {
        let vault = tempdir().expect("vault");
        let path = "Historia/Guerra-Fria.md";
        let markdown = "# Guerra Fria\n\nA disputa envolveu Estados Unidos e Uniao Sovietica.\n\nO conflito foi politico e economico.\n\nNao houve confronto direto amplo.";
        let assessed_at = 1_720_000_000_000;
        let last_reviewed_at = 1_720_500_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let state =
            persist_readiness_assessment(vault.path(), path, markdown, &report, assessed_at)
                .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");

        let loaded = load_learning_document(vault.path(), &state.note_id)
            .expect("load document")
            .expect("document exists");
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        document.units[0].fsrs = Some(crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 10.0,
            retrievability: 0.8,
            last_reviewed_at_unix_ms: last_reviewed_at,
        });
        let fixture = crate::review::contract::parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("session fixture");
        document.sessions = fixture.sessions;
        document.sessions[0].unit_results[0]
            .unit_snapshot
            .content_hash = document.units[0].content_hash.clone();
        document.sessions[0].unit_results[0].fsrs_after = Some(
            serde_json::from_value(
                serde_json::to_value(document.units[0].fsrs.as_ref().expect("memory state"))
                    .expect("serialize memory state"),
            )
            .expect("clone memory state"),
        );
        document.units[0].latest_evaluation = Some(
            serde_json::from_value(
                serde_json::to_value(&document.sessions[0].unit_results[0].evaluation)
                    .expect("serialize evaluation"),
            )
            .expect("clone evaluation"),
        );
        document.scheduling.last_review_at_unix_ms = Some(last_reviewed_at);
        document.scheduling.next_review_at_unix_ms = document.sessions[0].next_review_at_unix_ms;
        document.scheduling.status = SchedulingStatus::Scheduled;
        document.revision = expected_revision + 1;
        crate::review::storage::write_learning_document(
            vault.path(),
            &state.note_id,
            Some(expected_revision),
            &document,
        )
        .expect("persist reviewed state");
        set_manual_enrollment(vault.path(), path, markdown, false, last_reviewed_at)
            .expect("pause reviewed note");

        let view = set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 2,
                target_retention: 0.9,
                priority_weight: 2.0,
                min_interval_days: 1,
                max_interval_days: 365,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::TargetRetention],
                inherit_fields: Vec::new(),
            },
            last_reviewed_at,
        )
        .expect("update reviewed note policy");

        let interval = crate::review::session::interval_days_for_retention(10.0, 0.9, 1, 365);
        assert_eq!(view.next_review_at_unix_ms, None);
        assert_eq!(view.completed_review_count, 1);
        let reenabled = set_manual_enrollment(vault.path(), path, markdown, true, last_reviewed_at)
            .expect("reenable reviewed note");
        assert_eq!(
            reenabled.next_review_at_unix_ms,
            Some(last_reviewed_at + (interval * DAY_MS))
        );
    }
    #[test]
    fn policy_changed_while_paused_is_used_when_the_note_is_reenabled() {
        let vault = tempdir().expect("vault");
        let path = "Quimica/Atomos.md";
        let markdown = "# Atomos\n\nAtomos possuem nucleo.\n\nEletrons ocupam orbitais.\n\nProtons possuem carga positiva.";
        let assessed_at = 1_720_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), path, markdown, &report, assessed_at)
            .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");
        set_manual_enrollment(vault.path(), path, markdown, false, assessed_at + DAY_MS)
            .expect("pause note");

        let paused = set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 7,
                target_retention: 0.8,
                priority_weight: 2.0,
                min_interval_days: 1,
                max_interval_days: 365,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::FirstReviewIntervalDays],
                inherit_fields: Vec::new(),
            },
            assessed_at + DAY_MS,
        )
        .expect("update paused note policy");

        assert_eq!(
            paused.first_review_at_unix_ms,
            Some(assessed_at + (7 * DAY_MS))
        );
        assert_eq!(paused.next_review_at_unix_ms, None);
        assert!(!paused.enrolled);
        assert_eq!(paused.sources.first_review_interval_days.kind, "note");
        assert_eq!(paused.sources.target_retention.kind, "vaultDefault");

        let reenabled = set_manual_enrollment(
            vault.path(),
            path,
            markdown,
            true,
            assessed_at + (2 * DAY_MS),
        )
        .expect("reenable note");
        assert_eq!(
            reenabled.next_review_at_unix_ms,
            Some(assessed_at + (7 * DAY_MS))
        );
    }
    #[test]
    fn note_overrides_can_be_cleared_to_inherit_the_vault_defaults_again() {
        let vault = tempdir().expect("vault");
        let path = "Fisica/Cinematica.md";
        let markdown = "# Cinematica\n\nVelocidade relaciona deslocamento e tempo.\n\nAceleracao mede a variacao da velocidade.\n\nMovimento uniforme possui velocidade constante.";
        let assessed_at = 1_720_000_000_000;
        set_vault_review_defaults(
            vault.path(),
            0,
            VaultReviewDefaultsInput {
                first_review_interval_days: 5,
                target_retention: 0.9,
                priority_weight: 2.5,
                min_interval_days: 2,
                max_interval_days: 180,
            },
            assessed_at,
        )
        .expect("set Vault defaults");
        persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");
        let all_fields = vec![
            NoteReviewPolicyField::FirstReviewIntervalDays,
            NoteReviewPolicyField::TargetRetention,
            NoteReviewPolicyField::PriorityWeight,
            NoteReviewPolicyField::MinIntervalDays,
            NoteReviewPolicyField::MaxIntervalDays,
        ];
        set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 1,
                target_retention: 0.7,
                priority_weight: 1.0,
                min_interval_days: 1,
                max_interval_days: 90,
                preferred_mode: ReviewMode::Exam,
                override_fields: all_fields.clone(),
                inherit_fields: Vec::new(),
            },
            assessed_at,
        )
        .expect("override note policy");

        let inherited = set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 1,
                target_retention: 0.7,
                priority_weight: 1.0,
                min_interval_days: 1,
                max_interval_days: 90,
                preferred_mode: ReviewMode::Exam,
                override_fields: Vec::new(),
                inherit_fields: all_fields,
            },
            assessed_at,
        )
        .expect("restore inherited policy");

        assert_eq!(inherited.first_review_interval_days, 5);
        assert_eq!(inherited.target_retention, 0.9);
        assert_eq!(inherited.priority_weight, 2.5);
        assert_eq!(inherited.min_interval_days, 2);
        assert_eq!(inherited.max_interval_days, 180);
        assert_eq!(
            inherited.sources.first_review_interval_days.kind,
            "vaultDefault"
        );
        assert_eq!(
            inherited.next_review_at_unix_ms,
            Some(assessed_at + (5 * DAY_MS))
        );
    }

    #[test]
    fn a_priority_quick_action_overrides_only_priority_and_preserves_history() {
        let vault = tempdir().expect("vault");
        let path = "Biologia/ATP.md";
        let markdown = "# ATP\n\nATP armazena energia.\n\nATP transfere energia.\n\nATP participa do metabolismo.";
        let assessed_at = 1_720_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let state =
            persist_readiness_assessment(vault.path(), path, markdown, &report, assessed_at)
                .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");

        let view = super::set_note_review_priority(vault.path(), path, markdown, 4.5, assessed_at)
            .expect("set priority");
        assert_eq!(view.priority_weight, 4.5);
        assert_eq!(view.sources.priority_weight.kind, "note");
        // A data nao muda: prioridade so afeta a ordem da fila.
        assert_eq!(
            view.next_review_at_unix_ms,
            Some(assessed_at + (2 * DAY_MS))
        );
        assert_eq!(view.target_retention, 0.8);

        let reloaded = load_learning_document(vault.path(), &state.note_id)
            .expect("reload")
            .expect("document");
        assert_eq!(reloaded.document.revision, 3);
        assert!(matches!(
            reloaded
                .document
                .effective_policy
                .sources
                .priority_weight
                .kind,
            PolicySourceKind::Note
        ));
    }

    #[test]
    fn a_priority_quick_action_rejects_invalid_values_and_unknown_notes() {
        let vault = tempdir().expect("vault");
        assert!(super::set_note_review_priority(
            vault.path(),
            "Inexistente.md",
            "# Conteudo",
            2.0,
            1_720_000_000_000,
        )
        .is_err());
        assert!(super::set_note_review_priority(
            vault.path(),
            "Inexistente.md",
            "# Conteudo",
            0.0,
            1_720_000_000_000,
        )
        .is_err());
        assert!(super::set_note_review_priority(
            vault.path(),
            "Inexistente.md",
            "# Conteudo",
            101.0,
            1_720_000_000_000,
        )
        .is_err());
    }

    #[test]
    fn clearing_a_note_override_restores_the_matching_tag_policy() {
        let vault = tempdir().expect("vault");
        let path = "Quimica/Ligacoes.md";
        let markdown =
            "# Ligacoes\n\nLigacoes compartilham ou transferem eletrons.\n\n#revisao/prova";
        let assessed_at = 1_720_000_000_000;
        persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist readiness");

        set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 1,
                target_retention: 0.7,
                priority_weight: 3.0,
                min_interval_days: 1,
                max_interval_days: 90,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::TargetRetention],
                inherit_fields: Vec::new(),
            },
            assessed_at,
        )
        .expect("override target retention");

        let inherited = set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 1,
                target_retention: 0.7,
                priority_weight: 3.0,
                min_interval_days: 1,
                max_interval_days: 90,
                preferred_mode: ReviewMode::Exam,
                override_fields: Vec::new(),
                inherit_fields: vec![NoteReviewPolicyField::TargetRetention],
            },
            assessed_at,
        )
        .expect("restore tag inheritance");

        assert_eq!(inherited.target_retention, 0.9);
        assert_eq!(inherited.sources.target_retention.kind, "tag");
        assert_eq!(
            inherited.sources.target_retention.source_id.as_deref(),
            Some("revisao/prova")
        );
    }
}
