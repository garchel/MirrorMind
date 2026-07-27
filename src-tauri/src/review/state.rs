use super::contract::{
    Enrollment, LearningDocument, LearningNote, LearningUnit, LearningUnitKind,
    ReadinessAssessment, ReadinessIssue as StoredReadinessIssue,
    ReadinessIssueCode as StoredReadinessIssueCode, ReviewMode, ReviewPolicy, SchedulingState,
    SchedulingStatus, UnitIdentity, LEARNING_SCHEMA_VERSION,
};
use super::evaluation::{
    source_hash, ReadinessAttempt, ReadinessIssueCode, ReadinessReport, ReadinessStatus,
};
use super::policy::next_review_for_effective_policy;
use super::policy_config::load_inherited_review_policy;
use super::storage::{load_learning_document_for_path, write_learning_document};
use super::tag_policy::apply_inherited_review_policy;
use anyhow::{bail, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

const FSRS_VERSION: &str = "fsrs-6";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSchedulingStatus {
    NotScheduled,
    Scheduled,
    Due,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreferredReviewMode {
    Exam,
    Conversation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteReadinessStatus {
    Unassessed,
    Ready,
    Ambiguous,
    Insufficient,
    Modified,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReviewState {
    pub note_id: String,
    pub relative_path: String,
    pub content_hash: String,
    pub readiness: NoteReadinessStatus,
    pub assessed_at_unix_ms: Option<u64>,
    pub report: Option<ReadinessReport>,
    pub enrolled: bool,
    pub preferred_mode: PreferredReviewMode,
    pub scheduling_status: NoteSchedulingStatus,
    pub first_review_at_unix_ms: Option<u64>,
    pub next_review_at_unix_ms: Option<u64>,
}

fn reconcile_inherited_review_policy(
    vault_root: &Path,
    markdown: &str,
    document: &mut LearningDocument,
) -> Result<bool> {
    let inherited = load_inherited_review_policy(vault_root, markdown)?;
    apply_inherited_review_policy(document, inherited)
}
pub fn persist_readiness_attempt(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    attempt: &ReadinessAttempt,
    assessed_at_unix_ms: u64,
) -> Result<Option<NoteReviewState>> {
    let ReadinessAttempt::Valid {
        source_hash: assessed_hash,
        report,
    } = attempt
    else {
        return Ok(None);
    };
    if assessed_hash != &source_hash(markdown) {
        bail!("A nota mudou antes de salvar a avaliacao.");
    }
    persist_readiness_assessment(
        vault_root,
        relative_path,
        markdown,
        report,
        assessed_at_unix_ms,
    )
    .map(Some)
}
pub fn persist_readiness_assessment(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    report: &ReadinessReport,
    assessed_at_unix_ms: u64,
) -> Result<NoteReviewState> {
    if relative_path.trim().is_empty() || markdown.trim().is_empty() {
        bail!("A nota precisa possuir caminho e conteudo para salvar a avaliacao.");
    }

    let content_hash = source_hash(markdown);
    let loaded = load_learning_document_for_path(vault_root, relative_path)?;
    let note_id = loaded
        .as_ref()
        .map(|loaded| loaded.document.note.id.clone())
        .unwrap_or_else(|| note_id_for_path(relative_path));
    let expected_revision = loaded.as_ref().map(|loaded| loaded.document.revision);
    let mut document = match loaded {
        Some(loaded) => loaded.document,
        None => {
            let inherited = load_inherited_review_policy(vault_root, markdown)?;
            new_learning_document(
                note_id.clone(),
                relative_path,
                markdown,
                &content_hash,
                inherited.policy,
                inherited.auto_enrollment_tag_ids,
            )
        }
    };

    let was_enrolled = document.note.enrollment.is_enrolled();
    reconcile_inherited_review_policy(vault_root, markdown, &mut document)?;

    if !document.sessions.is_empty() && document.note.content_hash != content_hash {
        bail!("A reconciliacao de uma nota revisada ainda nao esta disponivel.");
    }
    let content_changed = document.note.content_hash != content_hash;
    let starts_new_cycle =
        content_changed || !matches!(document.note.readiness, ReadinessAssessment::Ready { .. });
    let is_enrolled = document.note.enrollment.is_enrolled();
    document.revision = expected_revision.map_or(1, |revision| revision.saturating_add(1));
    document.note.relative_path = relative_path.to_string();
    document.note.content_hash = content_hash.clone();
    if document.sessions.is_empty() {
        document.units = whole_note_unit(markdown, &content_hash);
    }
    document.note.readiness = stored_readiness(report, &content_hash, assessed_at_unix_ms);
    if report.status == ReadinessStatus::Ready && starts_new_cycle {
        document.scheduling.first_review_at_unix_ms = None;
        document.scheduling.next_review_at_unix_ms = None;
        document.scheduling.status = if was_enrolled && !is_enrolled {
            SchedulingStatus::Paused
        } else {
            SchedulingStatus::NotScheduled
        };
        if is_enrolled {
            let interval_ms = document
                .effective_policy
                .first_review_interval_days
                .checked_mul(24 * 60 * 60 * 1_000)
                .ok_or_else(|| anyhow::anyhow!("O intervalo inicial de revisao e invalido."))?;
            let first_review_at = assessed_at_unix_ms
                .checked_add(interval_ms)
                .ok_or_else(|| anyhow::anyhow!("A primeira data de revisao excede o limite."))?;
            document.scheduling.first_review_at_unix_ms = Some(first_review_at);
            document.scheduling.next_review_at_unix_ms = Some(first_review_at);
            document.scheduling.status = SchedulingStatus::Scheduled;
        }
    } else if report.status != ReadinessStatus::Ready {
        document.scheduling.status = SchedulingStatus::Paused;
        document.scheduling.next_review_at_unix_ms = None;
    }

    write_learning_document(vault_root, &note_id, expected_revision, &document)?;
    Ok(state_from_document(&document))
}

pub fn load_note_review_state(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    now_unix_ms: u64,
) -> Result<Option<NoteReviewState>> {
    let Some(loaded) = load_learning_document_for_path(vault_root, relative_path)? else {
        return Ok(None);
    };
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    let current_hash = source_hash(markdown);
    let mut changed = false;

    if document.note.content_hash != current_hash {
        document.note.content_hash = current_hash.clone();
        document.note.relative_path = relative_path.to_string();
        if document.sessions.is_empty() {
            document.units = whole_note_unit(markdown, &current_hash);
        }
        mark_readiness_modified(&mut document.note.readiness);
        document.scheduling.status = SchedulingStatus::Paused;
        document.scheduling.next_review_at_unix_ms = None;
        changed = true;
    }

    if reconcile_inherited_review_policy(vault_root, markdown, &mut document)? {
        if matches!(document.note.readiness, ReadinessAssessment::Ready { .. }) {
            super::policy::reschedule(&mut document, now_unix_ms)?;
        }
        changed = true;
    }

    if changed {
        document.revision = document.revision.saturating_add(1);
        write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    }
    let mut state = state_from_document(&document);
    if state.scheduling_status == NoteSchedulingStatus::Scheduled
        && state
            .next_review_at_unix_ms
            .is_some_and(|next| next <= now_unix_ms)
    {
        state.scheduling_status = NoteSchedulingStatus::Due;
    }
    Ok(Some(state))
}

fn mark_readiness_modified(readiness: &mut ReadinessAssessment) {
    let previous = std::mem::replace(
        readiness,
        ReadinessAssessment::Unassessed {
            assessed_at_unix_ms: None,
            assessed_content_hash: None,
            issues: Vec::new(),
            report: None,
        },
    );
    *readiness = match previous {
        ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            assessed_content_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            assessed_content_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            assessed_content_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            assessed_content_hash,
            issues,
            report,
        } => ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            assessed_content_hash,
            issues,
            report,
        },
        unassessed @ ReadinessAssessment::Unassessed { .. } => unassessed,
    };
}
pub fn set_manual_enrollment(
    vault_root: &Path,
    relative_path: &str,
    markdown: &str,
    enabled: bool,
    now_unix_ms: u64,
) -> Result<NoteReviewState> {
    let loaded = load_learning_document_for_path(vault_root, relative_path)?
        .ok_or_else(|| anyhow::anyhow!("Avalie a prontidao da nota antes de ativar revisoes."))?;
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    if document.note.content_hash != source_hash(markdown) {
        bail!("A nota mudou desde a avaliacao. Avalie a prontidao novamente.");
    }
    let ready_at_unix_ms = match &document.note.readiness {
        ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            ..
        } => Some(*assessed_at_unix_ms),
        _ if enabled => bail!("Somente uma nota pronta pode participar das revisoes."),
        _ => None,
    };

    document.revision = document.revision.saturating_add(1);
    document.note.enrollment.manual = enabled;
    document.note.enrollment.manual_paused = !enabled;
    let is_enrolled = document.note.enrollment.is_enrolled();
    if is_enrolled {
        if document.scheduling.first_review_at_unix_ms.is_none() {
            let interval_ms = document
                .effective_policy
                .first_review_interval_days
                .checked_mul(24 * 60 * 60 * 1_000)
                .ok_or_else(|| anyhow::anyhow!("O intervalo inicial de revisao e invalido."))?;
            let first_review_at = ready_at_unix_ms
                .expect("an enrolled note must have a ready assessment")
                .checked_add(interval_ms)
                .ok_or_else(|| anyhow::anyhow!("A primeira data de revisao excede o limite."))?;
            document.scheduling.first_review_at_unix_ms = Some(first_review_at);
            document.scheduling.next_review_at_unix_ms = Some(first_review_at);
        } else if document.scheduling.next_review_at_unix_ms.is_none() {
            document.scheduling.next_review_at_unix_ms = if document.sessions.is_empty() {
                document.scheduling.first_review_at_unix_ms
            } else {
                next_review_for_effective_policy(&document)?
            };
        }
        document.scheduling.status = if document
            .scheduling
            .next_review_at_unix_ms
            .is_some_and(|next| next <= now_unix_ms)
        {
            SchedulingStatus::Due
        } else {
            SchedulingStatus::Scheduled
        };
    } else {
        document.scheduling.status = SchedulingStatus::Paused;
        document.scheduling.next_review_at_unix_ms = None;
    }

    write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    Ok(state_from_document(&document))
}
fn new_learning_document(
    note_id: String,
    relative_path: &str,
    markdown: &str,
    content_hash: &str,
    effective_policy: ReviewPolicy,
    inherited_from_tag_ids: Vec<String>,
) -> LearningDocument {
    LearningDocument {
        schema_version: LEARNING_SCHEMA_VERSION,
        revision: 1,
        note: LearningNote {
            id: note_id,
            relative_path: relative_path.to_string(),
            content_hash: content_hash.to_string(),
            readiness: ReadinessAssessment::Unassessed {
                assessed_at_unix_ms: None,
                assessed_content_hash: None,
                issues: Vec::new(),
                report: None,
            },
            enrollment: Enrollment {
                manual: false,
                manual_paused: false,
                inherited_from_tag_ids,
                preferred_mode: ReviewMode::Exam,
            },
        },
        units: whole_note_unit(markdown, content_hash),
        effective_policy,
        scheduling: SchedulingState {
            status: SchedulingStatus::NotScheduled,
            first_review_at_unix_ms: None,
            last_review_at_unix_ms: None,
            next_review_at_unix_ms: None,
            fsrs_version: FSRS_VERSION.to_string(),
        },
        sessions: Vec::new(),
    }
}

fn whole_note_unit(markdown: &str, content_hash: &str) -> Vec<LearningUnit> {
    let end = u64::try_from(markdown.encode_utf16().count()).unwrap_or(u64::MAX);
    vec![LearningUnit {
        id: "unit-1".to_string(),
        ordinal: 0,
        kind: LearningUnitKind::WholeNote,
        content_hash: content_hash.to_string(),
        section_path: Vec::new(),
        identity: UnitIdentity {
            signature_version: 1,
            normalized_content_hash: content_hash.to_string(),
            previous_context_hash: None,
            next_context_hash: None,
            approximate_start_utf16: 0,
        },
        source_start_utf16: 0,
        source_end_utf16: end,
        fsrs: None,
        latest_evaluation: None,
    }]
}

fn stored_readiness(
    report: &ReadinessReport,
    content_hash: &str,
    assessed_at_unix_ms: u64,
) -> ReadinessAssessment {
    let issues = report
        .issues
        .iter()
        .map(|issue| StoredReadinessIssue {
            unit_id: None,
            code: match issue.code {
                ReadinessIssueCode::Ambiguous => StoredReadinessIssueCode::Ambiguous,
                ReadinessIssueCode::Insufficient => StoredReadinessIssueCode::Insufficient,
                ReadinessIssueCode::Contradictory => StoredReadinessIssueCode::Contradictory,
                ReadinessIssueCode::MissingContext => StoredReadinessIssueCode::MissingContext,
            },
            message: issue.message.clone(),
        })
        .collect();
    match report.status {
        ReadinessStatus::Ready => ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            assessed_content_hash: content_hash.to_string(),
            issues,
            report: Some(report.clone()),
        },
        ReadinessStatus::Ambiguous => ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            assessed_content_hash: content_hash.to_string(),
            issues,
            report: Some(report.clone()),
        },
        ReadinessStatus::Insufficient => ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            assessed_content_hash: content_hash.to_string(),
            issues,
            report: Some(report.clone()),
        },
    }
}

fn state_from_document(document: &LearningDocument) -> NoteReviewState {
    let (readiness, assessed_at_unix_ms) = match &document.note.readiness {
        ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            ..
        } => (NoteReadinessStatus::Ready, Some(*assessed_at_unix_ms)),
        ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            ..
        } => (NoteReadinessStatus::Ambiguous, Some(*assessed_at_unix_ms)),
        ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            ..
        } => (
            NoteReadinessStatus::Insufficient,
            Some(*assessed_at_unix_ms),
        ),
        ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            ..
        } => (NoteReadinessStatus::Modified, Some(*assessed_at_unix_ms)),
        ReadinessAssessment::Unassessed { .. } => (NoteReadinessStatus::Unassessed, None),
    };
    let report = match &document.note.readiness {
        ReadinessAssessment::Unassessed { report, .. }
        | ReadinessAssessment::Ready { report, .. }
        | ReadinessAssessment::Ambiguous { report, .. }
        | ReadinessAssessment::Insufficient { report, .. }
        | ReadinessAssessment::Modified { report, .. } => report.clone(),
    };
    NoteReviewState {
        note_id: document.note.id.clone(),
        relative_path: document.note.relative_path.clone(),
        content_hash: document.note.content_hash.clone(),
        readiness,
        assessed_at_unix_ms,
        report,
        enrolled: document.note.enrollment.is_enrolled()
            && matches!(
                document.note.readiness,
                ReadinessAssessment::Ready { .. } | ReadinessAssessment::Modified { .. }
            ),
        preferred_mode: match document.note.enrollment.preferred_mode {
            ReviewMode::Exam => PreferredReviewMode::Exam,
            ReviewMode::Conversation => PreferredReviewMode::Conversation,
        },
        scheduling_status: match document.scheduling.status {
            SchedulingStatus::NotScheduled => NoteSchedulingStatus::NotScheduled,
            SchedulingStatus::Scheduled => NoteSchedulingStatus::Scheduled,
            SchedulingStatus::Due => NoteSchedulingStatus::Due,
            SchedulingStatus::Paused => NoteSchedulingStatus::Paused,
        },
        first_review_at_unix_ms: document.scheduling.first_review_at_unix_ms,
        next_review_at_unix_ms: document.scheduling.next_review_at_unix_ms,
    }
}

pub(crate) fn note_id_for_path(relative_path: &str) -> String {
    let normalized = relative_path.replace('\\', "/");
    let digest = Sha256::digest(normalized.as_bytes());
    let mut id = String::from("note-");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(id, "{byte:02x}");
    }
    id
}

#[cfg(test)]
mod tests {
    use super::{
        load_note_review_state, persist_readiness_assessment, persist_readiness_attempt,
        set_manual_enrollment, NoteReadinessStatus, NoteSchedulingStatus,
    };
    use crate::review::contract::PolicySourceKind;
    use crate::review::evaluation::{
        GroundedReadinessSource, ReadinessAttempt, ReadinessReport, ReadinessStatus,
    };
    use crate::review::storage::load_learning_document;
    use tempfile::tempdir;

    #[test]
    fn the_default_exam_tag_auto_enrolls_a_ready_note_with_its_policy() {
        let vault = tempdir().expect("vault");
        let path = "Biologia/Fotossintese.md";
        let markdown = "# Fotossintese #revisao/prova\n\nPlantas convertem energia luminosa.\n\nA clorofila absorve luz.\n\nO processo produz materia organica.";
        let assessed_at = 1_720_000_000_000;

        let state = persist_readiness_assessment(
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
        .expect("persist tagged readiness");

        assert!(state.enrolled);
        assert_eq!(
            state.first_review_at_unix_ms,
            Some(assessed_at + 86_400_000)
        );
        let document = load_learning_document(vault.path(), &state.note_id)
            .expect("load document")
            .expect("document");
        assert_eq!(
            document.document.note.enrollment.inherited_from_tag_ids,
            vec!["revisao/prova"]
        );
        assert_eq!(document.document.effective_policy.target_retention, 0.9);
        assert_eq!(document.document.effective_policy.priority_weight, 3.0);
        assert!(matches!(
            document
                .document
                .effective_policy
                .sources
                .target_retention
                .kind,
            PolicySourceKind::Tag
        ));
        assert_eq!(
            document
                .document
                .effective_policy
                .sources
                .target_retention
                .source_id
                .as_deref(),
            Some("revisao/prova")
        );
    }

    #[test]
    fn removing_the_last_auto_enrollment_tag_pauses_the_note_without_losing_its_state() {
        let vault = tempdir().expect("vault");
        let path = "Historia/Revolucao.md";
        let tagged = "# Revolucao #revisao/prova\n\nA revolucao alterou instituicoes.\n\nNovos grupos disputaram poder.\n\nO processo teve fases distintas.";
        let untagged = "# Revolucao\n\nA revolucao alterou instituicoes.\n\nNovos grupos disputaram poder.\n\nO processo teve fases distintas.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };

        let first =
            persist_readiness_assessment(vault.path(), path, tagged, &report, 1_720_000_000_000)
                .expect("persist tagged note");
        assert!(first.enrolled);

        let updated =
            persist_readiness_assessment(vault.path(), path, untagged, &report, 1_720_100_000_000)
                .expect("reassess without tag");

        assert!(!updated.enrolled);
        assert_eq!(updated.scheduling_status, NoteSchedulingStatus::Paused);
        let document = load_learning_document(vault.path(), &updated.note_id)
            .expect("load document")
            .expect("document");
        assert!(document
            .document
            .note
            .enrollment
            .inherited_from_tag_ids
            .is_empty());
        assert_eq!(document.document.effective_policy.target_retention, 0.8);
        assert!(matches!(
            document
                .document
                .effective_policy
                .sources
                .target_retention
                .kind,
            PolicySourceKind::VaultDefault
        ));
    }

    #[test]
    fn a_valid_ready_assessment_is_persisted_and_can_be_loaded_again() {
        let vault = tempdir().expect("vault");
        let markdown = "# Fotossintese\n\nPlantas convertem luz em energia quimica.\n\nA clorofila absorve luz.\n\nO processo libera oxigenio.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "A nota possui uma ideia e tres pontos avaliaveis.".to_string(),
            central_idea: Some(GroundedReadinessSource {
                source_quote: "Plantas convertem luz em energia quimica.".to_string(),
                source_start_utf16: 17,
                source_end_utf16: 59,
            }),
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };

        let state = persist_readiness_assessment(
            vault.path(),
            "Biologia/Fotossintese.md",
            markdown,
            &report,
            1_720_000_000_000,
        )
        .expect("persist assessment");

        let loaded = load_learning_document(vault.path(), &state.note_id)
            .expect("load persisted document")
            .expect("document exists");
        assert_eq!(
            loaded.document.note.relative_path,
            "Biologia/Fotossintese.md"
        );
        assert_eq!(loaded.document.note.content_hash, state.content_hash);
        assert_eq!(state.readiness, NoteReadinessStatus::Ready);
        assert_eq!(state.report.as_ref(), Some(&report));
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::NotScheduled);
    }

    #[test]
    fn enabling_a_ready_note_schedules_its_first_review_from_when_it_became_ready() {
        let vault = tempdir().expect("vault");
        let markdown = "# ATP\n\nATP armazena energia.\n\nATP transfere energia.\n\nATP participa do metabolismo.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), "ATP.md", markdown, &report, 1_720_000_000_000)
            .expect("persist assessment");

        let state =
            set_manual_enrollment(vault.path(), "ATP.md", markdown, true, 1_720_100_000_000)
                .expect("enable review");

        let expected_review = 1_720_000_000_000 + 2 * 24 * 60 * 60 * 1_000;
        assert!(state.enrolled);
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::Scheduled);
        assert_eq!(state.first_review_at_unix_ms, Some(expected_review));
        assert_eq!(state.next_review_at_unix_ms, Some(expected_review));
    }
    #[test]
    fn loading_an_edited_ready_note_marks_it_modified_and_pauses_scheduling() {
        let vault = tempdir().expect("vault");
        let markdown = "# Mitose\n\nA celula duplica o DNA.\n\nOs cromossomos se separam.\n\nSurgem duas celulas.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(
            vault.path(),
            "Mitose.md",
            markdown,
            &report,
            1_720_000_000_000,
        )
        .expect("persist assessment");
        set_manual_enrollment(vault.path(), "Mitose.md", markdown, true, 1_720_100_000_000)
            .expect("enable review");

        let state = load_note_review_state(
            vault.path(),
            "Mitose.md",
            "# Mitose\n\nConteudo atualizado.",
            1_720_200_000_000,
        )
        .expect("load state")
        .expect("state exists");

        assert_eq!(state.readiness, NoteReadinessStatus::Modified);
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::Paused);
        assert_eq!(state.next_review_at_unix_ms, None);
    }
    #[test]
    fn an_invalid_ai_attempt_never_creates_learning_state() {
        let vault = tempdir().expect("vault");
        let markdown = "# Nota\n\nConteudo.";
        let attempt = ReadinessAttempt::Invalid {
            source_hash: crate::review::evaluation::source_hash(markdown),
            message: "Resposta invalida.".to_string(),
            raw_response: Some("{}".to_string()),
            validation_errors: vec!["status ausente".to_string()],
        };

        let persisted = persist_readiness_attempt(
            vault.path(),
            "Nota.md",
            markdown,
            &attempt,
            1_720_000_000_000,
        )
        .expect("ignore invalid attempt");

        assert!(persisted.is_none());
        assert!(
            load_note_review_state(vault.path(), "Nota.md", markdown, 1_720_000_000_000,)
                .expect("load state")
                .is_none()
        );
    }

    #[test]
    fn reapproving_an_enrolled_modified_note_starts_a_new_first_review_cycle() {
        let vault = tempdir().expect("vault");
        let original = "# Osmose\n\nAgua atravessa a membrana.\n\nO gradiente orienta o fluxo.\n\nA membrana e seletiva.";
        let updated = "# Osmose\n\nAgua atravessa a membrana semipermeavel.\n\nO gradiente orienta o fluxo.\n\nA membrana e seletiva.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(
            vault.path(),
            "Osmose.md",
            original,
            &report,
            1_720_000_000_000,
        )
        .expect("persist first assessment");
        set_manual_enrollment(vault.path(), "Osmose.md", original, true, 1_720_010_000_000)
            .expect("enable review");
        load_note_review_state(vault.path(), "Osmose.md", updated, 1_720_020_000_000)
            .expect("mark modified");

        let reassessed_at = 1_720_030_000_000;
        let state = persist_readiness_assessment(
            vault.path(),
            "Osmose.md",
            updated,
            &report,
            reassessed_at,
        )
        .expect("persist reassessment");

        assert!(state.enrolled);
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::Scheduled);
        assert_eq!(
            state.first_review_at_unix_ms,
            Some(reassessed_at + 2 * 24 * 60 * 60 * 1_000),
        );
        assert_eq!(state.next_review_at_unix_ms, state.first_review_at_unix_ms);
    }

    #[test]
    fn a_direct_ready_reassessment_with_a_new_hash_restarts_the_cycle() {
        let vault = tempdir().expect("vault");
        let original = "# Celula\n\nMembrana.\n\nCitoplasma.\n\nNucleo.";
        let updated = "# Celula\n\nMembrana plasmatica.\n\nCitoplasma.\n\nNucleo.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(
            vault.path(),
            "Celula.md",
            original,
            &report,
            1_720_000_000_000,
        )
        .expect("persist assessment");
        set_manual_enrollment(vault.path(), "Celula.md", original, true, 1_720_010_000_000)
            .expect("enable review");

        let reassessed_at = 1_720_050_000_000;
        let state = persist_readiness_assessment(
            vault.path(),
            "Celula.md",
            updated,
            &report,
            reassessed_at,
        )
        .expect("persist direct reassessment");

        assert_eq!(
            state.first_review_at_unix_ms,
            Some(reassessed_at + 2 * 24 * 60 * 60 * 1_000),
        );
    }
    #[test]
    fn a_modified_note_can_be_disabled_without_being_reenrolled_after_reapproval() {
        let vault = tempdir().expect("vault");
        let original = "# RNA\n\nRNA possui nucleotideos.\n\nRNA participa da sintese.\n\nRNA pode ser mensageiro.";
        let updated = "# RNA\n\nRNA possui nucleotideos.\n\nRNA participa da sintese proteica.\n\nRNA pode ser mensageiro.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), "RNA.md", original, &report, 1_720_000_000_000)
            .expect("persist assessment");
        set_manual_enrollment(vault.path(), "RNA.md", original, true, 1_720_010_000_000)
            .expect("enable review");
        load_note_review_state(vault.path(), "RNA.md", updated, 1_720_020_000_000)
            .expect("mark modified");

        let disabled =
            set_manual_enrollment(vault.path(), "RNA.md", updated, false, 1_720_030_000_000)
                .expect("disable modified note");
        assert!(!disabled.enrolled);

        let reapproved = persist_readiness_assessment(
            vault.path(),
            "RNA.md",
            updated,
            &report,
            1_720_040_000_000,
        )
        .expect("reapprove note");
        assert!(!reapproved.enrolled);
        assert_eq!(
            reapproved.scheduling_status,
            NoteSchedulingStatus::NotScheduled,
        );
    }

    #[test]
    fn a_stale_valid_attempt_is_not_persisted_for_changed_markdown() {
        let vault = tempdir().expect("vault");
        let original = "# Nota\n\nIdeia original.\n\nPonto dois.\n\nPonto tres.";
        let changed = "# Nota\n\nConteudo alterado enquanto a IA respondia.";
        let attempt = ReadinessAttempt::Valid {
            source_hash: crate::review::evaluation::source_hash(original),
            report: ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
        };

        let error = persist_readiness_attempt(
            vault.path(),
            "Nota.md",
            changed,
            &attempt,
            1_720_000_000_000,
        )
        .expect_err("stale report must fail");

        assert!(error.to_string().contains("mudou"));
        assert!(
            load_learning_document(vault.path(), &super::note_id_for_path("Nota.md"))
                .expect("load")
                .is_none()
        );
    }

    #[test]
    fn an_overdue_schedule_is_derived_without_rewriting_the_document() {
        let vault = tempdir().expect("vault");
        let markdown = "# Memoria\n\nIdeia um.\n\nIdeia dois.\n\nIdeia tres.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        let state =
            persist_readiness_assessment(vault.path(), "Memoria.md", markdown, &report, ready_at)
                .expect("persist");
        set_manual_enrollment(vault.path(), "Memoria.md", markdown, true, ready_at)
            .expect("enable");
        let before = load_learning_document(vault.path(), &state.note_id)
            .expect("load before")
            .expect("document");

        let loaded = load_note_review_state(
            vault.path(),
            "Memoria.md",
            markdown,
            ready_at + 3 * 24 * 60 * 60 * 1_000,
        )
        .expect("load state")
        .expect("state");
        let after = load_learning_document(vault.path(), &state.note_id)
            .expect("load after")
            .expect("document");

        assert_eq!(loaded.scheduling_status, NoteSchedulingStatus::Due);
        assert_eq!(before.document.revision, after.document.revision);
        assert!(matches!(
            after.document.scheduling.status,
            crate::review::contract::SchedulingStatus::Scheduled
        ));
    }

    #[test]
    fn note_identity_preserves_case_for_distinct_paths() {
        assert_ne!(
            super::note_id_for_path("ATP.md"),
            super::note_id_for_path("atp.md")
        );
    }

    #[test]
    fn a_manual_pause_overrides_automatic_tag_enrollment() {
        let vault = tempdir().expect("vault");
        let markdown = "# Prova\n\nPonto um.\n\nPonto dois.\n\nPonto tres.\n\n#revisao/prova";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        let enrolled =
            persist_readiness_assessment(vault.path(), "Prova.md", markdown, &report, ready_at)
                .expect("persist ready note");
        assert!(enrolled.enrolled);
        let paused = set_manual_enrollment(vault.path(), "Prova.md", markdown, false, ready_at)
            .expect("pause tagged note");
        assert!(!paused.enrolled);
        assert_eq!(paused.scheduling_status, NoteSchedulingStatus::Paused);
        let document = load_learning_document(vault.path(), &paused.note_id)
            .expect("load paused note")
            .expect("note");
        assert!(document.document.note.enrollment.manual_paused);
        assert_eq!(
            document.document.note.enrollment.inherited_from_tag_ids,
            vec!["revisao/prova"]
        );
    }

    #[test]
    fn an_unready_tagged_note_is_not_exposed_as_enrolled_and_can_be_paused_safely() {
        let vault = tempdir().expect("vault");
        let markdown = "# Rascunho\n\n#revisao/prova";
        let report = ReadinessReport {
            status: ReadinessStatus::Insufficient,
            explanation: "Insuficiente.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let assessed_at = 1_720_000_000_000;
        let state = persist_readiness_assessment(
            vault.path(),
            "Rascunho.md",
            markdown,
            &report,
            assessed_at,
        )
        .expect("persist insufficient note");
        assert!(!state.enrolled);
        let paused =
            set_manual_enrollment(vault.path(), "Rascunho.md", markdown, false, assessed_at)
                .expect("pause insufficient note without panic");
        assert!(!paused.enrolled);
        assert_eq!(paused.scheduling_status, NoteSchedulingStatus::Paused);
    }

    #[test]
    fn loading_an_edited_note_reconciles_removed_review_tags_without_reassessment() {
        let vault = tempdir().expect("vault");
        let original = "# Tema\n\nPonto um.\n\nPonto dois.\n\nPonto tres.\n\n#revisao/prova";
        let updated = "# Tema\n\nPonto um.\n\nPonto dois.\n\nPonto tres.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        persist_readiness_assessment(vault.path(), "Tema.md", original, &report, ready_at)
            .expect("persist tagged note");
        let state = load_note_review_state(vault.path(), "Tema.md", updated, ready_at)
            .expect("load edited note")
            .expect("state");
        assert_eq!(state.readiness, NoteReadinessStatus::Modified);
        assert!(!state.enrolled);
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::Paused);
        let document = load_learning_document(vault.path(), &state.note_id)
            .expect("load reconciled note")
            .expect("note");
        assert!(document
            .document
            .note
            .enrollment
            .inherited_from_tag_ids
            .is_empty());
        assert!(matches!(
            document
                .document
                .effective_policy
                .sources
                .priority_weight
                .kind,
            crate::review::contract::PolicySourceKind::VaultDefault
        ));
    }
}
