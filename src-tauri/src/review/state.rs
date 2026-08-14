use super::contract::{
    Enrollment, LearningDocument, LearningNote, ReadinessAssessment,
    ReadinessIssue as StoredReadinessIssue, ReadinessIssueCode as StoredReadinessIssueCode,
    ReviewMode, ReviewPolicy, SchedulingState, SchedulingStatus, LEARNING_SCHEMA_VERSION,
};
use super::evaluation::{
    semantic_fingerprint, source_hash, ReadinessAttempt, ReadinessIssueCode, ReadinessReport,
    ReadinessStatus,
};
use super::policy::next_review_for_effective_policy;
use super::policy_config::load_inherited_review_policy;
use super::segmentation::build_learning_units_with_limits;
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
    /// Meta de retencao em risco: a nota tem prazo ativo e a projecao na data
    /// da prova nao atinge a tolerancia configurada mesmo antecipando revisoes.
    pub deadline_retention_at_risk: bool,
    /// O documento de aprendizado foi restaurado de um backup depois de o
    /// principal ser encontrado corrompido ou ausente. A interface avisa o
    /// usuario de que houve recuperacao (possivelmente de uma versao anterior).
    pub recovered_from_backup: bool,
}

pub(crate) fn reconcile_inherited_review_policy(
    vault_root: &Path,
    markdown: &str,
    document: &mut LearningDocument,
    now_unix_ms: u64,
) -> Result<bool> {
    let inherited = load_inherited_review_policy(vault_root, markdown, now_unix_ms)?;
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
    let limits = super::policy_config::load_segmentation_limits(vault_root)?;
    let max_whole_note_words = usize::try_from(limits.max_whole_note_words)
        .map_err(|_| anyhow::anyhow!("O limite de palavras da segmentacao e invalido."))?;
    let loaded = load_learning_document_for_path(vault_root, relative_path)?;
    let note_id = loaded
        .as_ref()
        .map(|loaded| loaded.document.note.id.clone())
        .unwrap_or_else(|| note_id_for_path(relative_path));
    let expected_revision = loaded.as_ref().map(|loaded| loaded.document.revision);
    let mut document = match loaded {
        Some(loaded) => loaded.document,
        None => {
            let inherited =
                load_inherited_review_policy(vault_root, markdown, assessed_at_unix_ms)?;
            new_learning_document(
                note_id.clone(),
                relative_path,
                markdown,
                &content_hash,
                inherited.policy,
                inherited.auto_enrollment_tag_ids,
                max_whole_note_words,
            )
        }
    };

    let was_enrolled = document.note.enrollment.is_enrolled();
    reconcile_inherited_review_policy(vault_root, markdown, &mut document, assessed_at_unix_ms)?;

    let content_changed = document.note.content_hash != content_hash;
    if content_changed {
        document.units = build_learning_units_with_limits(
            markdown,
            &content_hash,
            &document.units,
            max_whole_note_words,
        );
    }
    let starts_new_cycle =
        content_changed || !matches!(document.note.readiness, ReadinessAssessment::Ready { .. });
    let is_enrolled = document.note.enrollment.is_enrolled();
    document.revision = expected_revision.map_or(1, |revision| revision.saturating_add(1));
    document.note.relative_path = relative_path.to_string();
    document.note.content_hash = content_hash.clone();
    document.note.readiness = stored_readiness(
        report,
        &content_hash,
        &semantic_fingerprint(markdown),
        assessed_at_unix_ms,
    );
    if report.status == ReadinessStatus::Ready && starts_new_cycle {
        if !document.sessions.is_empty() {
            // Nota ja revisada e agora reavaliada: as unidades foram reconciliadas
            // acima, preservando a memoria dos paragrafos inalterados. O contrato
            // exige que o agendamento continue ancorado na ultima sessao, entao
            // retomar a proxima revisao dela em vez de abrir um novo ciclo.
            if is_enrolled {
                match document
                    .sessions
                    .last()
                    .and_then(|session| session.next_review_at_unix_ms)
                {
                    Some(next_review_at) => {
                        document.scheduling.next_review_at_unix_ms = Some(next_review_at);
                        document.scheduling.status = if next_review_at <= assessed_at_unix_ms {
                            SchedulingStatus::Due
                        } else {
                            SchedulingStatus::Scheduled
                        };
                    }
                    None => {
                        // Sessao inconclusiva sem proxima revisao: pausar mantem
                        // o contrato (NotScheduled exige nenhuma data de revisao).
                        document.scheduling.status = SchedulingStatus::Paused;
                        document.scheduling.next_review_at_unix_ms = None;
                    }
                }
            } else {
                document.scheduling.status = SchedulingStatus::Paused;
                document.scheduling.next_review_at_unix_ms = None;
            }
        } else {
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
                let first_review_at =
                    assessed_at_unix_ms
                        .checked_add(interval_ms)
                        .ok_or_else(|| {
                            anyhow::anyhow!("A primeira data de revisao excede o limite.")
                        })?;
                document.scheduling.first_review_at_unix_ms = Some(first_review_at);
                document.scheduling.next_review_at_unix_ms = Some(first_review_at);
                document.scheduling.status = SchedulingStatus::Scheduled;
            }
        }
    } else if report.status != ReadinessStatus::Ready {
        document.scheduling.status = SchedulingStatus::Paused;
        document.scheduling.next_review_at_unix_ms = None;
    }

    write_learning_document(vault_root, &note_id, expected_revision, &document)?;
    Ok(state_from_document(&document, assessed_at_unix_ms, false))
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
    // O documento pode ter sido restaurado de um backup (principal corrompido
    // ou ausente): preservar essa informacao para a interface avisar o usuario.
    let recovered_from_backup = matches!(
        loaded.source,
        super::storage::LearningDocumentSource::Backup(_)
    );
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    let current_hash = source_hash(markdown);
    let mut changed = false;

    if document.note.content_hash != current_hash {
        let limits = super::policy_config::load_segmentation_limits(vault_root)?;
        let max_whole_note_words = usize::try_from(limits.max_whole_note_words)
            .map_err(|_| anyhow::anyhow!("O limite de palavras da segmentacao e invalido."))?;
        document.units = build_learning_units_with_limits(
            markdown,
            &current_hash,
            &document.units,
            max_whole_note_words,
        );
        document.note.content_hash = current_hash.clone();
        document.note.relative_path = relative_path.to_string();
        // Uma nota ja Modified nunca volta sozinha (reverter ao conteudo
        // avaliado exige reavaliacao explicita) e o contrato exige que ela
        // preserve o hash avaliado desatualizado: so estados ativos (Ready,
        // Ambiguous, Insufficient) podem preservar-se em mudancas cosmeticas.
        if !matches!(
            document.note.readiness,
            ReadinessAssessment::Modified { .. }
        ) && assessed_semantic_hash(&document.note.readiness)
            .is_some_and(|assessed| assessed == semantic_fingerprint(markdown))
        {
            // Mudanca apenas cosmetica (espacamento, pontuacao ou acentos): a
            // avaliacao continua valida e o agendamento nao pausa. O hash
            // avaliado acompanha o conteudo para o contrato continuar exigindo
            // assessed_content_hash == current_hash no estado pronto.
            set_assessed_content_hash(&mut document.note.readiness, &current_hash);
        } else {
            mark_readiness_modified(&mut document.note.readiness);
            document.scheduling.status = SchedulingStatus::Paused;
            document.scheduling.next_review_at_unix_ms = None;
        }
        changed = true;
    }

    if reconcile_inherited_review_policy(vault_root, markdown, &mut document, now_unix_ms)? {
        if matches!(document.note.readiness, ReadinessAssessment::Ready { .. }) {
            super::policy::reschedule(&mut document, now_unix_ms)?;
        }
        changed = true;
    }

    if changed {
        document.revision = document.revision.saturating_add(1);
        write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    }
    let mut state = state_from_document(&document, now_unix_ms, recovered_from_backup);
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
            assessed_semantic_hash: None,
            issues: Vec::new(),
            report: None,
        },
    );
    *readiness = match previous {
        ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            assessed_content_hash,
            assessed_semantic_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            assessed_content_hash,
            assessed_semantic_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            assessed_content_hash,
            assessed_semantic_hash,
            issues,
            report,
        }
        | ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            assessed_content_hash,
            assessed_semantic_hash,
            issues,
            report,
        } => ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            assessed_content_hash,
            assessed_semantic_hash,
            issues,
            report,
        },
        unassessed @ ReadinessAssessment::Unassessed { .. } => unassessed,
    };
}

/// Fingerprint semantico do conteudo avaliado, quando armazenado (documentos
/// avaliados antes desta feature nao o possuem e seguem exigindo reavaliacao
/// em qualquer mudanca).
fn assessed_semantic_hash(readiness: &ReadinessAssessment) -> Option<&str> {
    match readiness {
        ReadinessAssessment::Unassessed {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Ready {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Ambiguous {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Insufficient {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Modified {
            assessed_semantic_hash,
            ..
        } => assessed_semantic_hash.as_deref(),
    }
}

/// Atualiza o hash avaliado sem tocar no restante da avaliacao: usado quando
/// uma mudanca cosmetica mantem a prontidao (Ready exige que o hash avaliado
/// corresponda ao conteudo atual).
pub(crate) fn set_assessed_content_hash(readiness: &mut ReadinessAssessment, content_hash: &str) {
    match readiness {
        ReadinessAssessment::Unassessed {
            assessed_content_hash,
            ..
        } => *assessed_content_hash = Some(content_hash.to_string()),
        ReadinessAssessment::Ready {
            assessed_content_hash,
            ..
        }
        | ReadinessAssessment::Ambiguous {
            assessed_content_hash,
            ..
        }
        | ReadinessAssessment::Insufficient {
            assessed_content_hash,
            ..
        }
        | ReadinessAssessment::Modified {
            assessed_content_hash,
            ..
        } => *assessed_content_hash = content_hash.to_string(),
    }
}
/// Atualiza o fingerprint semantico avaliado sem tocar no restante da
/// avaliacao: usado quando o conteudo avaliado permanece o mesmo e apenas o
/// frontmatter mudou, mantendo a prontidao e o contrato consistentes.
pub(crate) fn set_assessed_semantic_hash(readiness: &mut ReadinessAssessment, semantic_hash: &str) {
    match readiness {
        ReadinessAssessment::Unassessed {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Ready {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Ambiguous {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Insufficient {
            assessed_semantic_hash,
            ..
        }
        | ReadinessAssessment::Modified {
            assessed_semantic_hash,
            ..
        } => *assessed_semantic_hash = Some(semantic_hash.to_string()),
    }
}

/// Agenda a primeira revisao de uma nota inscrita: novo ciclo ancorado em
/// `anchor_unix_ms` (a data em que ficou pronta ou o momento do reset), usando
/// o primeiro intervalo da politica efetiva.
fn schedule_first_review(
    document: &mut LearningDocument,
    anchor_unix_ms: u64,
    now_unix_ms: u64,
) -> Result<()> {
    let interval_ms = document
        .effective_policy
        .first_review_interval_days
        .checked_mul(24 * 60 * 60 * 1_000)
        .ok_or_else(|| anyhow::anyhow!("O intervalo inicial de revisao e invalido."))?;
    let first_review_at = anchor_unix_ms
        .checked_add(interval_ms)
        .ok_or_else(|| anyhow::anyhow!("A primeira data de revisao excede o limite."))?;
    document.scheduling.first_review_at_unix_ms = Some(first_review_at);
    document.scheduling.next_review_at_unix_ms = Some(first_review_at);
    document.scheduling.status = if first_review_at <= now_unix_ms {
        SchedulingStatus::Due
    } else {
        SchedulingStatus::Scheduled
    };
    Ok(())
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
            schedule_first_review(
                &mut document,
                ready_at_unix_ms.expect("an enrolled note must have a ready assessment"),
                now_unix_ms,
            )?;
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
    Ok(state_from_document(&document, now_unix_ms, false))
}
/// Reinicia o aprendizado da nota: remove o historico de sessoes, o estado
/// DSR/FSRS das unidades e as datas de revisao, preservando Markdown, tags,
/// avaliacao de prontidao, adesao e politica explicita. Se a nota continuar
/// pronta e inscrita, o novo ciclo comeca no momento do reset usando o
/// primeiro intervalo da politica efetiva; caso contrario, volta a aguardar.
pub fn reset_note_learning(
    vault_root: &Path,
    relative_path: &str,
    now_unix_ms: u64,
) -> Result<NoteReviewState> {
    let loaded = load_learning_document_for_path(vault_root, relative_path)?
        .ok_or_else(|| anyhow::anyhow!("Nao ha aprendizado para reiniciar nesta nota."))?;
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;

    document.sessions.clear();
    for unit in &mut document.units {
        unit.fsrs = None;
        unit.latest_evaluation = None;
    }
    document.scheduling.first_review_at_unix_ms = None;
    document.scheduling.last_review_at_unix_ms = None;
    document.scheduling.next_review_at_unix_ms = None;

    let is_ready = matches!(&document.note.readiness, ReadinessAssessment::Ready { .. });
    let is_enrolled = document.note.enrollment.is_enrolled();
    if is_ready && is_enrolled {
        // Novo ciclo ancorado no momento do reset, nao na avaliacao original.
        schedule_first_review(&mut document, now_unix_ms, now_unix_ms)?;
    } else {
        document.scheduling.status = SchedulingStatus::NotScheduled;
    }

    document.revision = document.revision.saturating_add(1);
    write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    Ok(state_from_document(&document, now_unix_ms, false))
}

/// Altera manualmente a classificacao de uma unidade (score 0-100) apos uma
/// sessao, quando o usuario discorda da avaliacao da IA. Recalcula o DSR/FSRS
/// da unidade pela mesma curva do reagendamento, reavalia a proxima data como
/// o minimo entre as unidades e persiste atomicamente. A correcao usa a
/// evidencia mais fraca (recall livre) por ser uma reavaliacao humana, e nunca
/// apaga o historico de sessoes.
pub fn set_unit_classification(
    vault_root: &Path,
    relative_path: &str,
    unit_id: &str,
    score: u8,
    now_unix_ms: u64,
) -> Result<NoteReviewState> {
    if score > 100 {
        bail!("A pontuacao deve ficar entre 0 e 100.");
    }
    let loaded = load_learning_document_for_path(vault_root, relative_path)?
        .ok_or_else(|| anyhow::anyhow!("Nao ha aprendizado para corrigir nesta nota."))?;
    let note_id = loaded.document.note.id.clone();
    let expected_revision = loaded.document.revision;
    let mut document = loaded.document;
    // Captura os dados da unidade antes de mutar as sessoes (o borrow checker
    // nao permite manter a unidade emprestada enquanto as sessoes mudam).
    let unit_fsrs = document
        .units
        .iter()
        .find(|unit| unit.id == unit_id)
        .ok_or_else(|| anyhow::anyhow!("A unidade informada nao existe nesta nota."))?
        .fsrs
        .clone();
    let unit_content_hash = document
        .units
        .iter()
        .find(|unit| unit.id == unit_id)
        .ok_or_else(|| anyhow::anyhow!("A unidade informada nao existe nesta nota."))?
        .content_hash
        .clone();
    // A correcao manual atualiza a projecao da unidade e o registro mais
    // recente da sessao correspondente, mantendo o contrato de que a projecao
    // atual deriva do historico mais recente.
    let outcome = super::session::outcome_for_score(score)?;
    // Reclassificacao humana: a evidencia registrada e recall livre (peso 1.0),
    // como uma resposta aberta sem contexto, pois o usuario esta afirmando o
    // que realmente lembra.
    let fsrs_after = super::session::update_fsrs(
        unit_fsrs.as_ref(),
        outcome,
        score,
        crate::review::contract::EvidenceStrength::FreeRecall,
        now_unix_ms,
    );
    let recall_outcome = match outcome {
        super::session::ReviewResultOutcome::Forgotten => {
            crate::review::contract::RecallOutcome::Forgotten
        }
        super::session::ReviewResultOutcome::Partial => {
            crate::review::contract::RecallOutcome::Partial
        }
        super::session::ReviewResultOutcome::Good => crate::review::contract::RecallOutcome::Good,
        super::session::ReviewResultOutcome::Complete => {
            crate::review::contract::RecallOutcome::Complete
        }
    };
    let corrected_evaluation = crate::review::contract::UnitEvaluation::Evaluated {
        score,
        outcome: recall_outcome,
        evidence: crate::review::contract::EvidenceStrength::FreeRecall,
        evaluated_at_unix_ms: now_unix_ms,
        gaps: Vec::new(),
        assertions: Vec::new(),
    };
    // Atualiza o registro mais recente da unidade no historico de sessoes,
    // preservando o snapshot: a projecao da unidade e o historico permanecem
    // identicos, como o contrato exige.
    let mut session_updated = false;
    for session in document.sessions.iter_mut().rev() {
        if let Some(result) = session.unit_results.iter_mut().find(|result| {
            result.unit_snapshot.id == unit_id
                && result.unit_snapshot.content_hash == unit_content_hash
                && result.evaluation.is_evaluated()
        }) {
            result.evaluation = corrected_evaluation.clone();
            result.fsrs_after = Some(fsrs_after.clone());
            session_updated = true;
            // Recalcula a media geral da sessao apos a correcao.
            let (count, total) = session
                .unit_results
                .iter()
                .filter_map(|result| match &result.evaluation {
                    crate::review::contract::UnitEvaluation::Evaluated { score, .. } => {
                        Some((1u32, u32::from(*score)))
                    }
                    _ => None,
                })
                .fold((0u32, 0u32), |(count, total), (one, score)| {
                    (count + one, total + score)
                });
            session.overall_score = if count == 0 {
                None
            } else {
                Some(((f64::from(total) / f64::from(count)).round()) as u8)
            };
            break;
        }
    }
    if !session_updated {
        bail!(
            "A unidade ainda nao foi avaliada em nenhuma sessao; corrija apos a primeira revisao."
        );
    }
    // A projecao da unidade recebe a correcao depois que as sessoes foram
    // atualizadas, para nao dividir o emprestimo mutavel do documento.
    let unit = document
        .units
        .iter_mut()
        .find(|unit| unit.id == unit_id)
        .ok_or_else(|| anyhow::anyhow!("A unidade informada nao existe nesta nota."))?;
    unit.fsrs = Some(fsrs_after);
    unit.latest_evaluation = Some(corrected_evaluation);
    // Recalcula o agendamento como o minimo entre as unidades, exatamente como
    // a conclusao de sessao faz. A primeira revisao nao muda: so a data futura.
    // A sessao mais recente tambem recebe a nova data, para o contrato nao
    // divergir entre o agendamento e a ultima sessao.
    if let Some(next_review_at) = next_review_for_effective_policy(&document)? {
        if let Some(latest) = document.sessions.last_mut() {
            latest.next_review_at_unix_ms = Some(next_review_at);
        }
        document.scheduling.next_review_at_unix_ms = Some(next_review_at);
        document.scheduling.status = if next_review_at <= now_unix_ms {
            SchedulingStatus::Due
        } else {
            SchedulingStatus::Scheduled
        };
    }

    document.revision = document.revision.saturating_add(1);
    write_learning_document(vault_root, &note_id, Some(expected_revision), &document)?;
    Ok(state_from_document(&document, now_unix_ms, false))
}

fn new_learning_document(
    note_id: String,
    relative_path: &str,
    markdown: &str,
    content_hash: &str,
    effective_policy: ReviewPolicy,
    inherited_from_tag_ids: Vec<String>,
    max_whole_note_words: usize,
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
                assessed_semantic_hash: None,
                issues: Vec::new(),
                report: None,
            },
            enrollment: Enrollment {
                manual: false,
                manual_paused: false,
                inherited_from_tag_ids,
                preferred_mode: ReviewMode::Exam,
                mode_manual: false,
            },
        },
        units: build_learning_units_with_limits(markdown, content_hash, &[], max_whole_note_words),
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

fn stored_readiness(
    report: &ReadinessReport,
    content_hash: &str,
    assessed_semantic_hash: &str,
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
            assessed_semantic_hash: Some(assessed_semantic_hash.to_string()),
            issues,
            report: Some(report.clone()),
        },
        ReadinessStatus::Ambiguous => ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            assessed_content_hash: content_hash.to_string(),
            assessed_semantic_hash: Some(assessed_semantic_hash.to_string()),
            issues,
            report: Some(report.clone()),
        },
        ReadinessStatus::Insufficient => ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            assessed_content_hash: content_hash.to_string(),
            assessed_semantic_hash: Some(assessed_semantic_hash.to_string()),
            issues,
            report: Some(report.clone()),
        },
    }
}

fn state_from_document(
    document: &LearningDocument,
    now_unix_ms: u64,
    recovered_from_backup: bool,
) -> NoteReviewState {
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
        deadline_retention_at_risk: deadline_retention_at_risk(document, now_unix_ms),
        recovered_from_backup,
    }
}

/// Meta de retencao em risco: ha prazo ativo e a projecao na data da prova nao
/// atinge a tolerancia mesmo antecipando revisoes. Derivada a cada leitura, a
/// partir do estado atual (nunca persistida), usando o mesmo ajuste do
/// agendamento: risco verdadeiro somente quando o ajuste antecipa e ainda
/// sinaliza que a meta nao cabe antes do prazo.
fn deadline_retention_at_risk(document: &LearningDocument, now_unix_ms: u64) -> bool {
    if document.effective_policy.deadline_at_unix_ms.is_none() {
        return false;
    }
    let ready_at = super::session::note_ready_at(document);
    super::session::adjust_schedule_for_deadline(
        now_unix_ms,
        &document.effective_policy,
        &document.units,
        ready_at,
    )
    .map(|(adjusted, at_risk)| adjusted.is_some() && at_risk)
    .unwrap_or(false)
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
        reset_note_learning, set_manual_enrollment, set_unit_classification, NoteReadinessStatus,
        NoteSchedulingStatus,
    };
    use crate::review::contract::{LearningUnitKind, PolicySourceKind, ReadinessAssessment};
    use crate::review::evaluation::{
        source_hash, GroundedReadinessSource, ReadinessAttempt, ReadinessReport, ReadinessStatus,
    };
    use crate::review::storage::{
        load_learning_document, load_learning_document_for_path, write_learning_document,
    };
    use tempfile::tempdir;

    #[test]
    fn a_long_note_is_segmented_into_paragraph_units_when_persisted() {
        let vault = tempdir().expect("vault");
        let markdown = (1..=7)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };

        let state = persist_readiness_assessment(
            vault.path(),
            "Nota-longa.md",
            &markdown,
            &report,
            1_720_000_000_000,
        )
        .expect("persist segmented note");
        let document = load_learning_document(vault.path(), &state.note_id)
            .expect("load document")
            .expect("document");

        assert_eq!(document.document.units.len(), 7);
        assert!(document
            .document
            .units
            .iter()
            .all(|unit| unit.kind == LearningUnitKind::Paragraph));
        assert_eq!(document.document.units[0].ordinal, 0);
        assert_eq!(document.document.units[6].ordinal, 6);
        assert!(
            document.document.units[0]
                .identity
                .next_context_hash
                .is_some(),
            "paragraphs carry context links"
        );
    }

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
    fn resetting_note_learning_clears_history_and_starts_a_fresh_cycle_from_the_reset() {
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
        set_manual_enrollment(vault.path(), "ATP.md", markdown, true, 1_720_100_000_000)
            .expect("enable review");

        // Acumula historico: uma sessao concluida com estado DSR/FSRS na unidade.
        let mut loaded = load_learning_document_for_path(vault.path(), "ATP.md")
            .expect("load")
            .expect("document");
        let note_id = loaded.document.note.id.clone();
        let expected_revision = loaded.document.revision;
        let session_at = 1_720_200_000_000;
        let snapshot = crate::review::contract::UnitSnapshot {
            id: loaded.document.units[0].id.clone(),
            ordinal: loaded.document.units[0].ordinal,
            kind: loaded.document.units[0].kind.clone(),
            content_hash: loaded.document.units[0].content_hash.clone(),
            section_path: loaded.document.units[0].section_path.clone(),
            identity: loaded.document.units[0].identity.clone(),
            source_start_utf16: loaded.document.units[0].source_start_utf16,
            source_end_utf16: loaded.document.units[0].source_end_utf16,
        };
        let fsrs_state = crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 12.0,
            retrievability: 0.55,
            last_reviewed_at_unix_ms: session_at,
        };
        let evaluation = crate::review::contract::UnitEvaluation::Evaluated {
            score: 45,
            outcome: crate::review::contract::RecallOutcome::Partial,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: session_at,
            gaps: Vec::new(),
            assertions: Vec::new(),
        };
        loaded.document.sessions = vec![crate::review::contract::ReviewSession {
            id: "session-reset".to_string(),
            note_content_hash: loaded.document.note.content_hash.clone(),
            mode: crate::review::contract::ReviewMode::Exam,
            provider: crate::review::contract::AiProvider::Ollama,
            completed_at_unix_ms: session_at,
            overall_score: Some(45),
            unit_results: vec![crate::review::contract::SessionUnitResult {
                unit_snapshot: snapshot,
                evaluation: evaluation.clone(),
                fsrs_before: Some(fsrs_state.clone()),
                fsrs_after: Some(fsrs_state.clone()),
            }],
            effective_policy: loaded.document.effective_policy.clone(),
            next_review_at_unix_ms: Some(session_at + 3 * 24 * 60 * 60 * 1_000),
        }];
        loaded.document.units[0].fsrs = Some(fsrs_state);
        loaded.document.units[0].latest_evaluation = Some(evaluation);
        loaded.document.scheduling.last_review_at_unix_ms = Some(session_at);
        loaded.document.scheduling.next_review_at_unix_ms =
            Some(session_at + 3 * 24 * 60 * 60 * 1_000);
        loaded.document.revision = loaded.document.revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &note_id,
            Some(expected_revision),
            &loaded.document,
        )
        .expect("persist session");

        let reset_at = 1_720_300_000_000;
        let state = reset_note_learning(vault.path(), "ATP.md", reset_at).expect("reset");

        let reloaded = load_learning_document_for_path(vault.path(), "ATP.md")
            .expect("reload")
            .expect("document")
            .document;
        // Historico e estado de memoria foram removidos; a data antiga de
        // revisao (o `last_review_at` da sessao anterior) nao existe mais.
        assert!(reloaded.sessions.is_empty());
        assert!(reloaded.units[0].fsrs.is_none());
        assert!(reloaded.units[0].latest_evaluation.is_none());
        assert_eq!(reloaded.scheduling.last_review_at_unix_ms, None);
        // Avaliacao e adesao sao preservadas; o novo ciclo comeca no reset.
        assert!(
            matches!(&reloaded.note.readiness, ReadinessAssessment::Ready { .. }),
            "readiness preserved"
        );
        assert!(reloaded.note.enrollment.is_enrolled());
        assert!(state.enrolled);
        let expected_first = reset_at + 2 * 24 * 60 * 60 * 1_000;
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::Scheduled);
        assert_eq!(state.first_review_at_unix_ms, Some(expected_first));
        assert_eq!(state.next_review_at_unix_ms, Some(expected_first));
    }

    #[test]
    fn resetting_an_unenrolled_note_returns_to_not_scheduled() {
        let vault = tempdir().expect("vault");
        let markdown = "# RNA\n\nRNA transcreve o DNA.\n\nRNA traduz proteinas.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), "RNA.md", markdown, &report, 1_720_000_000_000)
            .expect("persist assessment");

        let state = reset_note_learning(vault.path(), "RNA.md", 1_720_100_000_000).expect("reset");

        assert!(!state.enrolled);
        assert_eq!(state.scheduling_status, NoteSchedulingStatus::NotScheduled);
        assert_eq!(state.first_review_at_unix_ms, None);
        assert_eq!(state.next_review_at_unix_ms, None);
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

    #[test]
    fn a_cosmetic_change_keeps_readiness_and_scheduling() {
        let vault = tempdir().expect("vault");
        let path = "Fotossintese.md";
        let original =
            "# Fotossintese #revisao/prova\n\nA planta absorve luz.\n\nA clorofila captura energia.\n\nO processo produz glicose.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        let assessed =
            persist_readiness_assessment(vault.path(), path, original, &report, ready_at)
                .expect("persist ready note");
        assert_eq!(assessed.readiness, NoteReadinessStatus::Ready);
        assert_eq!(assessed.scheduling_status, NoteSchedulingStatus::Scheduled);

        // Mudanca apenas de espacamento, pontuacao e acentos (a tag permanece):
        // a prontidao e o agendamento sao preservados e o hash de conteudo
        // acompanha o texto atualizado.
        let cosmetic = "# Fotossíntese #revisao/prova\n\nA planta absorve  luz...\n\nA clorofila captura energia!\n\nO processo produz glicose.";
        let after = load_note_review_state(vault.path(), path, cosmetic, ready_at + 60_000)
            .expect("sync cosmetic change")
            .expect("state");
        assert_eq!(after.readiness, NoteReadinessStatus::Ready);
        assert_eq!(after.scheduling_status, NoteSchedulingStatus::Scheduled);
        assert_eq!(
            after.next_review_at_unix_ms,
            assessed.next_review_at_unix_ms
        );
        assert_eq!(after.content_hash, source_hash(cosmetic));
        let document = load_learning_document(vault.path(), &after.note_id)
            .expect("load document")
            .expect("document");
        assert!(matches!(
            document.document.note.readiness,
            ReadinessAssessment::Ready { .. }
        ));
    }

    #[test]
    fn a_semantic_change_marks_the_note_modified_and_pauses() {
        let vault = tempdir().expect("vault");
        let path = "Fotossintese.md";
        let original =
            "# Fotossintese #revisao/prova\n\nA planta absorve luz.\n\nA clorofila captura energia.\n\nO processo produz glicose.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        persist_readiness_assessment(vault.path(), path, original, &report, ready_at)
            .expect("persist ready note");

        // Conteudo mudou de verdade: nova avaliacao e exigida e o agendamento
        // pausa ate a nota ser reavaliada.
        let semantic = "# Fotossintese #revisao/prova\n\nA planta absorve luz.\n\nA mitocondria produz energia.\n\nO processo produz glicose.";
        let after = load_note_review_state(vault.path(), path, semantic, ready_at + 60_000)
            .expect("sync semantic change")
            .expect("state");
        assert_eq!(after.readiness, NoteReadinessStatus::Modified);
        assert_eq!(after.scheduling_status, NoteSchedulingStatus::Paused);
    }

    #[test]
    fn a_legacy_document_without_semantic_hash_requires_reassessment_on_any_change() {
        let vault = tempdir().expect("vault");
        let path = "Nota.md";
        let markdown = "# Tema\n\nPonto um.\n\nPonto dois.\n\nPonto tres.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        let state = persist_readiness_assessment(vault.path(), path, markdown, &report, ready_at)
            .expect("persist ready note");

        // Simula um documento avaliado antes desta feature: sem o fingerprint
        // semantico armazenado, qualquer mudanca exige nova avaliacao.
        let loaded = load_learning_document(vault.path(), &state.note_id)
            .expect("load document")
            .expect("document");
        let mut document = loaded.document;
        match &mut document.note.readiness {
            ReadinessAssessment::Ready {
                assessed_semantic_hash,
                ..
            } => *assessed_semantic_hash = None,
            _ => panic!("expected ready assessment"),
        }
        document.revision = document.revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &state.note_id,
            Some(document.revision - 1),
            &document,
        )
        .expect("rewrite legacy document");

        let cosmetic = "# Tema\n\nPonto  um.\n\nPonto dois.\n\nPonto tres.";
        let after = load_note_review_state(vault.path(), path, cosmetic, ready_at + 60_000)
            .expect("sync legacy document")
            .expect("state");
        assert_eq!(after.readiness, NoteReadinessStatus::Modified);
        assert_eq!(after.scheduling_status, NoteSchedulingStatus::Paused);
    }

    #[test]
    fn reverting_a_modified_note_to_the_assessed_content_keeps_it_modified() {
        let vault = tempdir().expect("vault");
        let path = "Nota.md";
        let original = "# Tema\n\nPonto um.\n\nPonto dois.\n\nPonto tres.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let ready_at = 1_720_000_000_000;
        let state = persist_readiness_assessment(vault.path(), path, original, &report, ready_at)
            .expect("persist ready note");

        // Mudanca real -> Modified + Paused.
        let changed = "# Tema\n\nPonto um.\n\nPonto alterado.\n\nPonto tres.";
        let modified = load_note_review_state(vault.path(), path, changed, ready_at + 60_000)
            .expect("sync real change")
            .expect("state");
        assert_eq!(modified.readiness, NoteReadinessStatus::Modified);

        // Reverter ao conteudo avaliado (mesmo fingerprint, texto cru diferente)
        // nao restaura a prontidao sozinha: a nota permanece Modified e o
        // contrato continua exigindo hash avaliado desatualizado.
        let reverted = "# Tema\n\nPonto um.\n\nPonto  dois.\n\nPonto tres.";
        let after = load_note_review_state(vault.path(), path, reverted, ready_at + 120_000)
            .expect("sync revert")
            .expect("state");
        assert_eq!(after.readiness, NoteReadinessStatus::Modified);
        assert_eq!(after.scheduling_status, NoteSchedulingStatus::Paused);
        // Recarregar valida o contrato do documento persistido (nao pode
        // terminar com assessed_content_hash == content_hash em Modified).
        load_learning_document(vault.path(), &state.note_id)
            .expect("reload persisted document")
            .expect("document");
    }

    #[test]
    fn a_document_restored_from_backup_signals_recovery_in_the_state() {
        let vault = tempdir().expect("vault");
        let markdown = "# ATP\n\nA energia e armazenada em ATP.\n\nA hidrolise libera energia.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), "ATP.md", markdown, &report, 1_720_000_000_000)
            .expect("persist assessment");
        set_manual_enrollment(vault.path(), "ATP.md", markdown, true, 1_720_100_000_000)
            .expect("enable review");
        let state = load_note_review_state(vault.path(), "ATP.md", markdown, 1_720_100_000_000)
            .expect("initial load")
            .expect("state exists");
        assert!(!state.recovered_from_backup);

        // Corrompe o principal mantendo o backup: o proximo load restaura o
        // backup e o estado deve sinalizar a recuperacao. O backup fica em
        // `<vault>/.mirmind/learning/<note-id>.json.bak.1`.
        let directory = vault.path().join(".mirmind").join("learning");
        let target = directory.join(format!("{}.json", state.note_id));
        std::fs::write(&target, b"{invalid").expect("corrupt primary");

        let recovered = load_note_review_state(vault.path(), "ATP.md", markdown, 1_720_200_000_000)
            .expect("recovered load")
            .expect("state exists");
        assert!(recovered.recovered_from_backup);
        assert_eq!(recovered.readiness, NoteReadinessStatus::Ready);
    }

    #[test]
    fn reclassifying_a_unit_overrides_the_evaluation_and_reschedules() {
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
        set_manual_enrollment(vault.path(), "ATP.md", markdown, true, 1_720_100_000_000)
            .expect("enable review");
        // Acumula historico: uma sessao concluida com a unidade avaliada, para
        // que a correcao manual tenha uma projecao anterior para sobrescrever.
        let mut loaded = load_learning_document_for_path(vault.path(), "ATP.md")
            .expect("load")
            .expect("document");
        let note_id = loaded.document.note.id.clone();
        let expected_revision = loaded.document.revision;
        let session_at = 1_720_200_000_000;
        let snapshot = crate::review::contract::UnitSnapshot {
            id: loaded.document.units[0].id.clone(),
            ordinal: loaded.document.units[0].ordinal,
            kind: loaded.document.units[0].kind.clone(),
            content_hash: loaded.document.units[0].content_hash.clone(),
            section_path: loaded.document.units[0].section_path.clone(),
            identity: loaded.document.units[0].identity.clone(),
            source_start_utf16: loaded.document.units[0].source_start_utf16,
            source_end_utf16: loaded.document.units[0].source_end_utf16,
        };
        let evaluation = crate::review::contract::UnitEvaluation::Evaluated {
            score: 45,
            outcome: crate::review::contract::RecallOutcome::Partial,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: session_at,
            gaps: Vec::new(),
            assertions: Vec::new(),
        };
        let fsrs_at = crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 2.0,
            retrievability: 0.55,
            last_reviewed_at_unix_ms: session_at,
        };
        loaded.document.sessions = vec![crate::review::contract::ReviewSession {
            id: "session-reclassify".to_string(),
            note_content_hash: loaded.document.note.content_hash.clone(),
            mode: crate::review::contract::ReviewMode::Exam,
            provider: crate::review::contract::AiProvider::Ollama,
            completed_at_unix_ms: session_at,
            overall_score: Some(45),
            unit_results: vec![crate::review::contract::SessionUnitResult {
                unit_snapshot: snapshot,
                evaluation: evaluation.clone(),
                fsrs_before: Some(fsrs_at.clone()),
                fsrs_after: Some(fsrs_at.clone()),
            }],
            effective_policy: loaded.document.effective_policy.clone(),
            next_review_at_unix_ms: Some(session_at + 3 * 24 * 60 * 60 * 1_000),
        }];
        loaded.document.units[0].fsrs = Some(fsrs_at);
        loaded.document.units[0].latest_evaluation = Some(evaluation);
        loaded.document.scheduling.last_review_at_unix_ms = Some(session_at);
        loaded.document.scheduling.next_review_at_unix_ms =
            Some(session_at + 3 * 24 * 60 * 60 * 1_000);
        loaded.document.revision = loaded.document.revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &note_id,
            Some(expected_revision),
            &loaded.document,
        )
        .expect("persist session");
        let unit_id = loaded.document.units[0].id.clone();
        let unit_count = loaded.document.units.len();

        // A unidade tinha estabilidade 2 dias; a reclassificacao para 100 deve
        // elevar a estabilidade pela formula FSRS-5 de acerto completo (grade 4,
        // evidencia livre) e reagendar para mais longe.
        let corrected_at = 1_720_300_000_000;
        let state = set_unit_classification(vault.path(), "ATP.md", &unit_id, 100, corrected_at)
            .expect("reclassify");

        let reloaded = load_learning_document_for_path(vault.path(), "ATP.md")
            .expect("reload")
            .expect("document")
            .document;
        let unit = reloaded
            .units
            .iter()
            .find(|unit| unit.id == unit_id)
            .expect("unit exists");
        assert!(matches!(
            &unit.latest_evaluation,
            Some(crate::review::contract::UnitEvaluation::Evaluated {
                score: 100,
                outcome: crate::review::contract::RecallOutcome::Complete,
                evidence: crate::review::contract::EvidenceStrength::FreeRecall,
                ..
            })
        ));
        let stability = unit.fsrs.as_ref().expect("fsrs").stability_days;
        // FSRS-5: acerto completo (grade 4) a partir de S=2, D=5, R efetivo no
        // instante da correcao.
        assert!((stability - 12.05229333579815).abs() < 1e-9);
        // O historico de sessoes permanece intacto (a sessao injetada segue la).
        assert_eq!(reloaded.sessions.len(), 1);
        // A proxima revisao veio do reagendamento pelo estado da unidade.
        assert!(reloaded.scheduling.next_review_at_unix_ms.is_some());
        assert!(reloaded.scheduling.next_review_at_unix_ms.unwrap() > corrected_at);
        assert!(state.enrolled);
        assert_eq!(reloaded.units.len(), unit_count);
    }

    #[test]
    fn reclassifying_an_unknown_unit_or_an_invalid_score_is_rejected() {
        let vault = tempdir().expect("vault");
        let markdown = "# RNA\n\nRNA transcreve o DNA.\n\nRNA traduz proteinas.";
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(vault.path(), "RNA.md", markdown, &report, 1_720_000_000_000)
            .expect("persist assessment");
        set_manual_enrollment(vault.path(), "RNA.md", markdown, true, 1_720_100_000_000)
            .expect("enable review");

        let error = set_unit_classification(
            vault.path(),
            "RNA.md",
            "unit-unknown",
            80,
            1_720_200_000_000,
        )
        .expect_err("unknown unit must fail");
        assert!(error.to_string().contains("nao existe"));
        let error =
            set_unit_classification(vault.path(), "RNA.md", "unit-1", 101, 1_720_200_000_000)
                .expect_err("score above 100 must fail");
        assert!(error.to_string().contains("0 e 100"));
    }
}
