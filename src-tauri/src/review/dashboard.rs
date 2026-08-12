use super::contract::{LearningUnitKind, ReadinessAssessment};
use super::session::{adjust_schedule_for_deadline, effective_retrievability};
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::Result;
use serde::Serialize;
use std::path::Path;

const DAY_MS: u64 = 86_400_000;
const MAX_UPCOMING_DEADLINES: usize = 20;
/// Limite da lista de prazos encerrados exibidos no dashboard.
const MAX_EXPIRED_DEADLINES: usize = 20;
const MAX_CALIBRATION_NOTES: usize = 20;
/// Limite de notas que precisam de atencao de qualidade listadas no dashboard.
const MAX_READINESS_ATTENTION: usize = 20;
/// Dias exibidos na carga prevista: hoje (incluindo vencidas) mais seis.
pub const FORECAST_DAYS: usize = 7;
/// Limite provisorio de "paragrafo fragil": recuperabilidade abaixo deste valor
/// marca uma unidade como candidata a revisao iminente. O valor exato deve ser
/// calibrado por simulacoes antes de ser fixado (roadmap de retencao).
pub use super::retention_calibration::fragile_threshold_for_target;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDeadlineItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub deadline_at_unix_ms: u64,
    pub priority_weight: f64,
    /// Meta de retencao em risco: a projecao na data da prova nao atinge a
    /// tolerancia configurada mesmo antecipando revisoes.
    pub retention_at_risk: bool,
    /// Tag que fornece o prazo ativo (origem da politica): permite alterar a
    /// data-limite pelo dashboard, recalculando todas as notas afetadas.
    pub source_tag: Option<String>,
    /// Nota vencida agora: pode iniciar uma revisao diretamente do dashboard.
    pub due: bool,
}

/// Nota cujo prazo de estudo ja encerrou: a tag perdeu a data-limite, mas a
/// nota continua inscrita e preserva historico e memoria. O dashboard sinaliza
/// a tag de origem e sugere remover a tag, trocar o perfil ou manter a
/// politica.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiredDeadlineItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub deadline_at_unix_ms: u64,
    /// Tag cujo prazo ja encerrou (origem da politica), permitindo alterar a
    /// data ou remover o prazo pelo dashboard.
    pub source_tag: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLoadItem {
    pub day_offset: u8,
    pub due_count: usize,
}

/// Nota segmentada em calibracao inicial: ainda faltam observacoes de
/// unidades, e o progresso e exibido como "X de Y secoes/paragrafos/unidades",
/// com a retencao geral como estimativa parcial ate a ultima observacao.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationNoteItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub observed_unit_count: usize,
    pub total_unit_count: usize,
    /// Rotulo do tipo dominante das unidades: ``section``, ``paragraph`` ou
    /// ``mixed`` quando a nota combina tipos (ex.: preambulo + secoes). A
    /// interface usa o substantivo correspondente nas contagens de progresso.
    pub unit_kind: String,
}

/// Tipo dominante das unidades de uma nota para os rotulos de contagem:
/// ``section`` quando todas sao secoes, ``paragraph`` quando todas sao
/// paragrafos, ``mixed`` em qualquer combinacao.
fn dominant_unit_kind(units: &[super::contract::LearningUnit]) -> &'static str {
    let mut all_sections = true;
    let mut all_paragraphs = true;
    for unit in units {
        match unit.kind {
            LearningUnitKind::Section => all_paragraphs = false,
            LearningUnitKind::Paragraph => all_sections = false,
            LearningUnitKind::WholeNote => {
                all_sections = false;
                all_paragraphs = false;
            }
        }
    }
    if all_sections {
        "section"
    } else if all_paragraphs {
        "paragraph"
    } else {
        "mixed"
    }
}

/// Estado de prontidao exposto no dashboard, com os mesmos valores que a
/// interface da nota utiliza para o indicador de qualidade.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadinessDashboardStatus {
    Unassessed,
    Ready,
    Ambiguous,
    Insufficient,
    Modified,
}

/// Nota cuja qualidade para revisao exige atencao: a avaliacao mais recente
/// concluiu que o conteudo e ambiguo, insuficiente, ou a nota foi editada
/// depois da avaliacao (modificada). O dashboard expoe o motivo para o usuario
/// decidir abrir a nota e corrigi-la ou reavalia-la.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessAttentionItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub status: ReadinessDashboardStatus,
    #[serde(rename = "assessedAtUnixMs")]
    pub assessed_at_unix_ms: Option<u64>,
    /// Explicacao objetiva do ultimo relatorio de prontidao.
    pub explanation: String,
    /// Quantidade de problemas apontados pelo relatorio (contradicoes,
    /// contexto ausente, insuficiencia).
    pub issue_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReviewDashboard {
    pub enrolled_note_count: usize,
    pub due_note_count: usize,
    pub due_within_week_count: usize,
    pub active_deadline_note_count: usize,
    pub upcoming_deadlines: Vec<UpcomingDeadlineItem>,
    /// Notas com prazo de estudo ja encerrado, com a tag de origem para o
    /// usuario decidir remover a tag, trocar o perfil ou manter a politica.
    pub expired_deadline_note_count: usize,
    pub expired_deadlines: Vec<ExpiredDeadlineItem>,
    pub tracked_unit_count: usize,
    pub average_retrievability: Option<f64>,
    pub average_stability_days: Option<f64>,
    pub completed_session_count: usize,
    /// Sessoes concluidas no dia local (0 = hoje), usadas pela meta diaria.
    pub completed_today_count: usize,
    /// Carga prevista por dia (0 = hoje, incluindo vencidas; 1..=6 = proximos
    /// dias), alinhada ao inicio do dia local informado pelo cliente.
    pub load_forecast: Vec<DailyLoadItem>,
    /// Notas prontas e habilitadas que ainda nao concluiram nenhuma sessao.
    pub awaiting_first_review_count: usize,
    /// Unidades com recuperabilidade efetiva abaixo do limiar de fragilidade.
    pub fragile_unit_count: usize,
    /// Notas segmentadas em calibracao inicial (faltam observacoes de
    /// unidades), com progresso "X de Y paragrafos" e retencao parcial.
    pub calibration_note_count: usize,
    pub calibration_notes: Vec<CalibrationNoteItem>,
    /// Qualidade da nota para revisao: contagens por estado de prontidao e a
    /// lista de notas que precisam de atencao (ambiguas, insuficientes ou
    /// modificadas), com a explicacao do ultimo relatorio.
    pub readiness_unassessed_note_count: usize,
    pub readiness_ready_note_count: usize,
    pub readiness_ambiguous_note_count: usize,
    pub readiness_insufficient_note_count: usize,
    pub readiness_modified_note_count: usize,
    pub readiness_attention_note_count: usize,
    pub readiness_attention_notes: Vec<ReadinessAttentionItem>,
}

pub fn build_vault_review_dashboard(
    vault_root: &Path,
    now_unix_ms: u64,
    local_day_start_unix_ms: u64,
) -> Result<VaultReviewDashboard> {
    // O inicio do dia local vem do cliente. Um valor ausente, obsoleto ou
    // corrompido nao pode produzir um forecast enganoso: fora de uma janela de
    // um dia em torno de agora, cai para o dia alinhado em UTC.
    let local_day_start_unix_ms = if local_day_start_unix_ms.saturating_sub(now_unix_ms) <= DAY_MS
        && now_unix_ms.saturating_sub(local_day_start_unix_ms) <= DAY_MS
    {
        local_day_start_unix_ms
    } else {
        now_unix_ms - (now_unix_ms % DAY_MS)
    };
    let mut enrolled_note_count = 0usize;
    let mut due_note_count = 0usize;
    let mut active_deadline_note_count = 0usize;
    let mut upcoming_deadlines: Vec<UpcomingDeadlineItem> = Vec::new();
    let mut expired_deadline_note_count = 0usize;
    let mut expired_deadlines: Vec<ExpiredDeadlineItem> = Vec::new();
    let mut tracked_unit_count = 0usize;
    let mut retrievability_sum = 0.0f64;
    let mut stability_sum = 0.0f64;
    let mut completed_session_count = 0usize;
    let mut completed_today_count = 0usize;
    let mut awaiting_first_review_count = 0usize;
    let mut fragile_unit_count = 0usize;
    let mut calibration_note_count = 0usize;
    let mut calibration_notes: Vec<CalibrationNoteItem> = Vec::new();
    let mut readiness_unassessed_note_count = 0usize;
    let mut readiness_ready_note_count = 0usize;
    let mut readiness_ambiguous_note_count = 0usize;
    let mut readiness_insufficient_note_count = 0usize;
    let mut readiness_modified_note_count = 0usize;
    let mut readiness_attention_notes: Vec<ReadinessAttentionItem> = Vec::new();
    let mut load_forecast = (0..FORECAST_DAYS as u8)
        .map(|day_offset| DailyLoadItem {
            day_offset,
            due_count: 0,
        })
        .collect::<Vec<_>>();

    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let enrolled = document.note.enrollment.is_enrolled()
            && matches!(document.note.readiness, ReadinessAssessment::Ready { .. });
        if enrolled {
            enrolled_note_count += 1;
            if document.sessions.is_empty() {
                awaiting_first_review_count += 1;
            }
        }
        if let Some(next) = document.scheduling.next_review_at_unix_ms {
            if enrolled && next <= now_unix_ms {
                due_note_count += 1;
            }
            if enrolled {
                // Vencidas saturando para o dia 0; os proximos dias sao
                // alinhados ao inicio do dia local informado pelo cliente.
                let day_offset = (next.saturating_sub(local_day_start_unix_ms) / DAY_MS) as usize;
                if let Some(bucket) = load_forecast.get_mut(day_offset) {
                    bucket.due_count += 1;
                }
            }
        }
        if let Some(deadline) = document.effective_policy.deadline_at_unix_ms {
            if enrolled && deadline > now_unix_ms {
                active_deadline_note_count += 1;
                if upcoming_deadlines.len() < MAX_UPCOMING_DEADLINES {
                    let relative_path = document.note.relative_path.clone();
                    let title = display_title(&relative_path);
                    let ready_at = super::session::note_ready_at(&document);
                    let retention_at_risk = adjust_schedule_for_deadline(
                        now_unix_ms,
                        &document.effective_policy,
                        &document.units,
                        ready_at,
                    )
                    .map(|(adjusted, at_risk)| adjusted.is_some() && at_risk)
                    .unwrap_or(false);
                    upcoming_deadlines.push(UpcomingDeadlineItem {
                        note_id: document.note.id.clone(),
                        relative_path,
                        title,
                        deadline_at_unix_ms: deadline,
                        priority_weight: document.effective_policy.priority_weight,
                        retention_at_risk,
                        source_tag: document
                            .effective_policy
                            .sources
                            .active_deadline
                            .as_ref()
                            .and_then(|source| source.source_id.clone()),
                        // Mesmo predicado de vencimento da fila (inscrita, pronta e
                        // com data passada) para que o botao Revisar so apareca
                        // quando a sessao pode realmente comecar.
                        due: document.note.enrollment.is_enrolled()
                            && matches!(document.note.readiness, ReadinessAssessment::Ready { .. })
                            && document
                                .scheduling
                                .next_review_at_unix_ms
                                .is_some_and(|next| next <= now_unix_ms),
                    });
                }
            } else if enrolled && deadline <= now_unix_ms {
                // Prazo encerrado: a tag perdeu a data-limite, mas a nota
                // continua em aprendizado com todo o historico preservado.
                expired_deadline_note_count += 1;
                if expired_deadlines.len() < MAX_EXPIRED_DEADLINES {
                    let relative_path = document.note.relative_path.clone();
                    let title = display_title(&relative_path);
                    expired_deadlines.push(ExpiredDeadlineItem {
                        note_id: document.note.id.clone(),
                        relative_path,
                        title,
                        deadline_at_unix_ms: deadline,
                        source_tag: document
                            .effective_policy
                            .sources
                            .deadline_at_unix_ms
                            .as_ref()
                            .and_then(|source| source.source_id.clone()),
                    });
                }
            }
        }
        // Retencao com a passagem do tempo: a recuperabilidade efetiva decai
        // desde a ultima revisao mesmo quando o paragrafo nao foi perguntado
        // em uma sessao de cobertura adaptativa. A fragilidade e calibrada por
        // simulacao deterministica como relativa ao alvo da politica efetiva
        // da nota (cerca de dois intervalos de revisao perdidos) — um limiar
        // absoluto de 0.6 flagia politicas leves cedo demais e intensivas tarde
        // demais (ver `retention_calibration`).
        let fragile_threshold =
            fragile_threshold_for_target(document.effective_policy.target_retention);
        let mut note_observed_units = 0usize;
        for unit in &document.units {
            if let Some(fsrs) = &unit.fsrs {
                tracked_unit_count += 1;
                note_observed_units += 1;
                let effective = effective_retrievability(fsrs, now_unix_ms);
                retrievability_sum += effective;
                stability_sum += fsrs.stability_days;
                if effective < fragile_threshold {
                    fragile_unit_count += 1;
                }
            }
        }
        // Calibracao inicial de notas longas: nota segmentada com unidades
        // ainda nao observadas aparece com progresso "X de Y paragrafos" e
        // retencao parcial ate a ultima observacao.
        if enrolled && document.units.len() > 1 && note_observed_units < document.units.len() {
            calibration_note_count += 1;
            if calibration_notes.len() < MAX_CALIBRATION_NOTES {
                let relative_path = document.note.relative_path.clone();
                let title = display_title(&relative_path);
                calibration_notes.push(CalibrationNoteItem {
                    note_id: document.note.id.clone(),
                    relative_path,
                    title,
                    observed_unit_count: note_observed_units,
                    total_unit_count: document.units.len(),
                    unit_kind: dominant_unit_kind(&document.units).to_string(),
                });
            }
        }
        completed_session_count += document.sessions.len();
        // Sessoes concluidas no dia local (usadas pela meta diaria opcional;
        // a contagem geral continua sendo o total historico).
        completed_today_count += document
            .sessions
            .iter()
            .filter(|session| session.completed_at_unix_ms >= local_day_start_unix_ms)
            .count();

        // Qualidade da nota para revisao: contagem por estado de prontidao e
        // coleta das notas que precisam de atencao (ambiguas, insuficientes ou
        // modificadas) com o motivo do ultimo relatorio.
        let (status, assessed_at_unix_ms, explanation, issue_count) =
            readiness_dashboard_meta(&document.note.readiness);
        match status {
            ReadinessDashboardStatus::Unassessed => readiness_unassessed_note_count += 1,
            ReadinessDashboardStatus::Ready => readiness_ready_note_count += 1,
            ReadinessDashboardStatus::Ambiguous => readiness_ambiguous_note_count += 1,
            ReadinessDashboardStatus::Insufficient => readiness_insufficient_note_count += 1,
            ReadinessDashboardStatus::Modified => readiness_modified_note_count += 1,
        }
        if matches!(
            status,
            ReadinessDashboardStatus::Ambiguous
                | ReadinessDashboardStatus::Insufficient
                | ReadinessDashboardStatus::Modified
        ) && readiness_attention_notes.len() < MAX_READINESS_ATTENTION
        {
            let relative_path = document.note.relative_path.clone();
            let title = display_title(&relative_path);
            readiness_attention_notes.push(ReadinessAttentionItem {
                note_id: document.note.id.clone(),
                relative_path,
                title,
                status,
                assessed_at_unix_ms,
                explanation,
                issue_count,
            });
        }
    }

    // O card "vencendo em sete dias" e o forecast compartilham a mesma
    // definicao por dia local, garantindo que a interface nunca divirja.
    let due_within_week_count = load_forecast.iter().map(|day| day.due_count).sum();

    upcoming_deadlines.sort_by(|left, right| {
        left.deadline_at_unix_ms
            .cmp(&right.deadline_at_unix_ms)
            .then_with(|| right.priority_weight.total_cmp(&left.priority_weight))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    upcoming_deadlines.truncate(MAX_UPCOMING_DEADLINES);
    // Prazos encerrados: o mais recentemente encerrado primeiro, para a nota
    // cuja prova acabou de passar receber a atencao imediata.
    expired_deadlines.sort_by(|left, right| {
        right
            .deadline_at_unix_ms
            .cmp(&left.deadline_at_unix_ms)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    expired_deadlines.truncate(MAX_EXPIRED_DEADLINES);
    // Calibracao primeiro por progresso (menos observado no topo) e depois
    // por caminho estavel, para as notas que mais precisam de atencao.
    calibration_notes.sort_by(|left, right| {
        let left_ratio = left.observed_unit_count as f64 / left.total_unit_count as f64;
        let right_ratio = right.observed_unit_count as f64 / right.total_unit_count as f64;
        left_ratio
            .total_cmp(&right_ratio)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    // Notas que precisam de atencao: as avaliadas ha mais tempo primeiro (a
    // mais antiga no topo) e depois por caminho estavel, para o usuario
    // revisar as pendencias de qualidade mais antigas primeiro.
    readiness_attention_notes.sort_by(|left, right| {
        let left_at = left.assessed_at_unix_ms.unwrap_or(u64::MAX);
        let right_at = right.assessed_at_unix_ms.unwrap_or(u64::MAX);
        left_at
            .cmp(&right_at)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    readiness_attention_notes.truncate(MAX_READINESS_ATTENTION);
    let readiness_attention_note_count = readiness_ambiguous_note_count
        + readiness_insufficient_note_count
        + readiness_modified_note_count;

    Ok(VaultReviewDashboard {
        enrolled_note_count,
        due_note_count,
        due_within_week_count,
        active_deadline_note_count,
        upcoming_deadlines,
        expired_deadline_note_count,
        expired_deadlines,
        tracked_unit_count,
        average_retrievability: if tracked_unit_count > 0 {
            Some(round_4(retrievability_sum / tracked_unit_count as f64))
        } else {
            None
        },
        average_stability_days: if tracked_unit_count > 0 {
            Some(round_4(stability_sum / tracked_unit_count as f64))
        } else {
            None
        },
        completed_session_count,
        completed_today_count,
        load_forecast,
        awaiting_first_review_count,
        fragile_unit_count,
        calibration_note_count,
        calibration_notes,
        readiness_unassessed_note_count,
        readiness_ready_note_count,
        readiness_ambiguous_note_count,
        readiness_insufficient_note_count,
        readiness_modified_note_count,
        readiness_attention_note_count,
        readiness_attention_notes,
    })
}

/// Extrai do estado de prontidao os metadados exibidos no dashboard: o estado
/// agregado, a data da avaliacao mais recente, a explicacao objetiva do ultimo
/// relatorio (quando existir) e a quantidade de problemas apontados.
fn readiness_dashboard_meta(
    readiness: &ReadinessAssessment,
) -> (ReadinessDashboardStatus, Option<u64>, String, usize) {
    let (status, assessed_at_unix_ms, report) = match readiness {
        ReadinessAssessment::Unassessed {
            assessed_at_unix_ms,
            report,
            ..
        } => (
            ReadinessDashboardStatus::Unassessed,
            *assessed_at_unix_ms,
            report.as_ref(),
        ),
        ReadinessAssessment::Ready {
            assessed_at_unix_ms,
            report,
            ..
        }
        | ReadinessAssessment::Ambiguous {
            assessed_at_unix_ms,
            report,
            ..
        }
        | ReadinessAssessment::Insufficient {
            assessed_at_unix_ms,
            report,
            ..
        }
        | ReadinessAssessment::Modified {
            assessed_at_unix_ms,
            report,
            ..
        } => (
            match readiness {
                ReadinessAssessment::Ready { .. } => ReadinessDashboardStatus::Ready,
                ReadinessAssessment::Ambiguous { .. } => ReadinessDashboardStatus::Ambiguous,
                ReadinessAssessment::Insufficient { .. } => ReadinessDashboardStatus::Insufficient,
                ReadinessAssessment::Modified { .. } => ReadinessDashboardStatus::Modified,
                ReadinessAssessment::Unassessed { .. } => unreachable!(),
            },
            Some(*assessed_at_unix_ms),
            report.as_ref(),
        ),
    };
    let explanation = report
        .map(|report| report.explanation.clone())
        .unwrap_or_default();
    let issue_count = report
        .map(|report| report.issues.len())
        .unwrap_or(readiness.issues().len());
    (status, assessed_at_unix_ms, explanation, issue_count)
}

fn round_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

/// Titulo de exibicao de uma nota a partir do caminho relativo: o nome do
/// arquivo sem a extensao, ou o proprio caminho quando nao ha nome utilizavel.
fn display_title(relative_path: &str) -> String {
    Path::new(relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(relative_path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::build_vault_review_dashboard;
    use crate::review::contract::SchedulingStatus;
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::state::{persist_readiness_assessment, set_manual_enrollment};
    use crate::review::storage::{load_learning_document, write_learning_document};
    use crate::review::tag_policy::TagReviewPolicyRule;
    use tempfile::tempdir;

    const DAY_MS: u64 = 24 * 60 * 60 * 1_000;
    const MARKDOWN: &str = "# Memoria\n\nIdeia um.\n\nIdeia dois.\n\nIdeia tres.";

    #[test]
    fn aggregates_enrollment_deadlines_and_memory_across_the_vault() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let first = persist_readiness_assessment(
            vault.path(),
            "Prova.md",
            MARKDOWN,
            &report,
            now - 3 * DAY_MS,
        )
        .expect("persist first note");
        set_manual_enrollment(vault.path(), "Prova.md", MARKDOWN, true, now - 3 * DAY_MS)
            .expect("enroll first note");
        let second =
            persist_readiness_assessment(vault.path(), "Manter.md", MARKDOWN, &report, now)
                .expect("persist second note");
        set_manual_enrollment(vault.path(), "Manter.md", MARKDOWN, true, now)
            .expect("enroll second note");

        let first_document = load_learning_document(vault.path(), &first.note_id)
            .expect("load first")
            .expect("first document");
        let mut first_document = first_document.document;
        first_document.effective_policy.deadline_at_unix_ms = Some(now + 2 * DAY_MS);
        first_document.effective_policy.sources.deadline_at_unix_ms =
            Some(crate::review::contract::PolicySource {
                kind: crate::review::contract::PolicySourceKind::ActiveDeadlineTag,
                source_id: Some("revisao/prova".to_string()),
            });
        first_document.effective_policy.sources.active_deadline =
            Some(crate::review::contract::PolicySource {
                kind: crate::review::contract::PolicySourceKind::ActiveDeadlineTag,
                source_id: Some("revisao/prova".to_string()),
            });
        first_document.revision += 1;
        write_learning_document(
            vault.path(),
            &first.note_id,
            Some(first_document.revision - 1),
            &first_document,
        )
        .expect("persist deadline");

        let loaded_second = load_learning_document(vault.path(), &second.note_id)
            .expect("load second")
            .expect("second document");
        let expected_revision = loaded_second.document.revision;
        let mut second_document = loaded_second.document;
        let fsrs_state = crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 12.0,
            retrievability: 0.75,
            last_reviewed_at_unix_ms: now,
        };
        let unit = second_document.units[0].clone();
        let snapshot = crate::review::contract::UnitSnapshot {
            id: unit.id.clone(),
            ordinal: unit.ordinal,
            kind: unit.kind,
            content_hash: unit.content_hash.clone(),
            section_path: unit.section_path.clone(),
            identity: unit.identity.clone(),
            source_start_utf16: unit.source_start_utf16,
            source_end_utf16: unit.source_end_utf16,
        };
        let evaluation = crate::review::contract::UnitEvaluation::Evaluated {
            score: 85,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: now,
            gaps: Vec::new(),
        };
        let session = crate::review::contract::ReviewSession {
            id: format!("dashboard-session-{}", second.note_id),
            note_content_hash: second_document.note.content_hash.clone(),
            mode: crate::review::contract::ReviewMode::Exam,
            provider: crate::review::contract::AiProvider::Ollama,
            completed_at_unix_ms: now,
            overall_score: Some(85),
            unit_results: vec![crate::review::contract::SessionUnitResult {
                unit_snapshot: snapshot,
                evaluation: evaluation.clone(),
                fsrs_before: Some(fsrs_state.clone()),
                fsrs_after: Some(fsrs_state.clone()),
            }],
            effective_policy: second_document.effective_policy.clone(),
            next_review_at_unix_ms: Some(now + 12 * DAY_MS),
        };
        second_document.sessions = vec![session];
        second_document.units[0].fsrs = Some(fsrs_state);
        second_document.units[0].latest_evaluation = Some(evaluation);
        second_document.scheduling.first_review_at_unix_ms = Some(now - 30 * DAY_MS);
        second_document.scheduling.last_review_at_unix_ms = Some(now);
        second_document.scheduling.next_review_at_unix_ms = Some(now + 12 * DAY_MS);
        second_document.scheduling.status = SchedulingStatus::Scheduled;
        second_document.revision = expected_revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &second.note_id,
            Some(expected_revision),
            &second_document,
        )
        .expect("persist memory state");

        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.enrolled_note_count, 2);
        assert_eq!(dashboard.due_note_count, 1);
        assert_eq!(dashboard.active_deadline_note_count, 1);
        assert_eq!(dashboard.upcoming_deadlines.len(), 1);
        assert_eq!(dashboard.upcoming_deadlines[0].relative_path, "Prova.md");
        // Nenhum prazo encerrado neste cenario.
        assert_eq!(dashboard.expired_deadline_note_count, 0);
        assert!(dashboard.expired_deadlines.is_empty());
        assert_eq!(
            dashboard.upcoming_deadlines[0].deadline_at_unix_ms,
            now + 2 * DAY_MS
        );
        assert_eq!(
            dashboard.upcoming_deadlines[0].source_tag.as_deref(),
            Some("revisao/prova")
        );
        assert_eq!(dashboard.tracked_unit_count, 1);
        // Revisada em `now`, a unidade tem retencao efetiva completa (o decay
        // so comeca apos a ultima revisao); o valor armazenado 0.75 vira apenas
        // a estimativa daquele instante.
        assert_eq!(dashboard.average_retrievability, Some(1.0));
        assert_eq!(dashboard.average_stability_days, Some(12.0));
        assert_eq!(dashboard.completed_session_count, 1);
        // A sessao da segunda nota foi concluida em `now`, dentro do dia local.
        assert_eq!(dashboard.completed_today_count, 1);
        // A primeira nota esta habilitada e sem sessoes: aguarda a primeira
        // revisao. A segunda ja concluiu uma sessao.
        assert_eq!(dashboard.awaiting_first_review_count, 1);
        // Nenhuma unidade com recuperabilidade abaixo do limiar de fragilidade.
        assert_eq!(dashboard.fragile_unit_count, 0);
        // A primeira nota esta vencida hoje; a segunda vence em 12 dias, fora
        // do forecast de sete dias.
        assert_eq!(dashboard.load_forecast.len(), 7);
        assert_eq!(dashboard.load_forecast[0].day_offset, 0);
        assert_eq!(dashboard.load_forecast[0].due_count, 1);
        assert!(dashboard.load_forecast[1..]
            .iter()
            .all(|day| day.due_count == 0));
    }

    #[test]
    fn counts_only_sessions_completed_in_the_local_day() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let persisted = persist_readiness_assessment(
            vault.path(),
            "Biologia.md",
            MARKDOWN,
            &report,
            now - 5 * DAY_MS,
        )
        .expect("persist note");
        set_manual_enrollment(
            vault.path(),
            "Biologia.md",
            MARKDOWN,
            true,
            now - 5 * DAY_MS,
        )
        .expect("enroll note");

        let mut document = load_learning_document(vault.path(), &persisted.note_id)
            .expect("load document")
            .expect("document")
            .document;
        let snapshot = crate::review::contract::UnitSnapshot {
            id: document.units[0].id.clone(),
            ordinal: document.units[0].ordinal,
            kind: document.units[0].kind.clone(),
            content_hash: document.units[0].content_hash.clone(),
            section_path: document.units[0].section_path.clone(),
            identity: document.units[0].identity.clone(),
            source_start_utf16: document.units[0].source_start_utf16,
            source_end_utf16: document.units[0].source_end_utf16,
        };
        let fsrs_state = crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 8.0,
            retrievability: 0.8,
            last_reviewed_at_unix_ms: now,
        };
        let evaluation = crate::review::contract::UnitEvaluation::Evaluated {
            score: 80,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: now,
            gaps: Vec::new(),
        };
        let session = |completed_at: u64| crate::review::contract::ReviewSession {
            id: format!("session-{completed_at}"),
            note_content_hash: document.note.content_hash.clone(),
            mode: crate::review::contract::ReviewMode::Exam,
            provider: crate::review::contract::AiProvider::Ollama,
            completed_at_unix_ms: completed_at,
            overall_score: Some(80),
            unit_results: vec![crate::review::contract::SessionUnitResult {
                unit_snapshot: snapshot.clone(),
                evaluation: evaluation.clone(),
                fsrs_before: Some(fsrs_state.clone()),
                fsrs_after: Some(fsrs_state.clone()),
            }],
            effective_policy: document.effective_policy.clone(),
            next_review_at_unix_ms: Some(completed_at + 12 * DAY_MS),
        };
        // Ordem cronologica exigida pelo contrato: a mais antiga primeiro.
        document.sessions = vec![session(now - 2 * DAY_MS), session(now)];
        document.scheduling.last_review_at_unix_ms = Some(now);
        document.scheduling.next_review_at_unix_ms = Some(now + 12 * DAY_MS);
        // A projecao da unidade precisa coincidir com o historico mais recente.
        document.units[0].fsrs = Some(fsrs_state);
        document.units[0].latest_evaluation = Some(evaluation);
        document.revision = document.revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &persisted.note_id,
            Some(document.revision - 1),
            &document,
        )
        .expect("persist sessions");

        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.completed_session_count, 2);
        // Somente a sessao concluida em `now` cai no dia local corrente.
        assert_eq!(dashboard.completed_today_count, 1);
    }

    #[test]
    fn forecasts_due_reviews_bucketed_by_local_day() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let day_start = now - (now % DAY_MS);

        write_enrolled_document(
            vault.path(),
            "vencida.md",
            day_start - 5 * DAY_MS,
            0.7,
            0,
            1,
        );
        write_enrolled_document(vault.path(), "hoje.md", now, 0.7, 0, 1);
        // A nota fragil precisa de uma sessao para carregar o estado FSRS, e a
        // unidade foi revisada ha ~61 dias: com a curva de esquecimento a
        // retencao efetiva no momento atual cai abaixo do limiar de fragilidade
        // (0.55 armazenado nao conta mais — o dashboard calcula pelo decay).
        write_enrolled_document(
            vault.path(),
            "amanha.md",
            day_start + 1 * DAY_MS,
            0.55,
            1,
            62,
        );
        write_enrolled_document(vault.path(), "dia3.md", day_start + 3 * DAY_MS, 0.75, 0, 1);
        write_enrolled_document(vault.path(), "dia6.md", day_start + 6 * DAY_MS, 0.8, 1, 1);
        write_enrolled_document(vault.path(), "alem.md", day_start + 9 * DAY_MS, 0.9, 0, 1);

        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build forecast");
        let buckets = dashboard
            .load_forecast
            .iter()
            .map(|day| day.due_count)
            .collect::<Vec<_>>();
        // Vencida + hoje caem no dia 0; amanha no dia 1; dia 3 e dia 6 nos
        // respectivos dias; a revisao do nono dia fica fora do forecast.
        assert_eq!(buckets, vec![2, 1, 0, 1, 0, 0, 1]);
        assert_eq!(dashboard.due_note_count, 2);
        assert_eq!(dashboard.due_within_week_count, 5);
        // Uma unidade com retencao efetiva decaida abaixo do limiar de
        // fragilidade (relativo ao alvo da nota, calibrado por simulacao).
        assert_eq!(dashboard.fragile_unit_count, 1);
        // Notas sem nenhuma sessao concluida: vencida, hoje, dia3 e alem.
        assert_eq!(dashboard.awaiting_first_review_count, 4);

        // Um inicio de dia local invalido (0) cai para o dia alinhado em UTC e
        // produz os mesmos buckets, em vez de um forecast enganoso.
        let fallback = build_vault_review_dashboard(vault.path(), now, 0).expect("fallback");
        assert_eq!(
            fallback
                .load_forecast
                .iter()
                .map(|day| day.due_count)
                .collect::<Vec<_>>(),
            buckets
        );
    }

    #[test]
    fn a_tag_rule_with_an_active_deadline_surfaces_in_the_dashboard() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let tagged = "# Prova\n\nIdeia um.\n\nIdeia dois.\n\nIdeia tres.\n\n#revisao/prova";
        crate::review::policy_config::set_vault_review_tag_rules(
            vault.path(),
            0,
            vec![TagReviewPolicyRule {
                tag: "revisao/prova".to_string(),
                auto_enroll: true,
                first_review_interval_days: 1,
                target_retention: 0.9,
                priority_weight: 3.0,
                min_interval_days: 1,
                max_interval_days: 90,
                deadline_at_unix_ms: Some(now + 5 * DAY_MS),
                preferred_mode: None,
            }],
            now,
        )
        .expect("save deadline tag rule");
        persist_readiness_assessment(vault.path(), "Prova.md", tagged, &report, now)
            .expect("persist tagged note");

        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.enrolled_note_count, 1);
        assert_eq!(dashboard.active_deadline_note_count, 1);
        assert_eq!(dashboard.upcoming_deadlines[0].title, "Prova");
    }

    #[test]
    fn expired_deadline_notes_are_signaled_with_their_source_tag() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        crate::review::policy_config::set_vault_review_tag_rules(
            vault.path(),
            0,
            vec![
                TagReviewPolicyRule {
                    tag: "revisao/prova".to_string(),
                    auto_enroll: true,
                    first_review_interval_days: 1,
                    target_retention: 0.9,
                    priority_weight: 3.0,
                    min_interval_days: 1,
                    max_interval_days: 90,
                    deadline_at_unix_ms: Some(now - 5 * DAY_MS),
                    preferred_mode: None,
                },
                TagReviewPolicyRule {
                    tag: "revisao/atual".to_string(),
                    auto_enroll: true,
                    first_review_interval_days: 1,
                    target_retention: 0.9,
                    priority_weight: 3.0,
                    min_interval_days: 1,
                    max_interval_days: 90,
                    deadline_at_unix_ms: Some(now + 2 * DAY_MS),
                    preferred_mode: None,
                },
            ],
            now,
        )
        .expect("save deadline tag rules");
        persist_readiness_assessment(
            vault.path(),
            "Encerrada.md",
            "# Encerrada\n\nIdeia um.\n\nIdeia dois.\n\n#revisao/prova",
            &report,
            now,
        )
        .expect("persist expired note");
        persist_readiness_assessment(
            vault.path(),
            "Ativa.md",
            "# Ativa\n\nIdeia um.\n\nIdeia dois.\n\n#revisao/atual",
            &report,
            now,
        )
        .expect("persist active note");

        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.enrolled_note_count, 2);
        // Somente a nota com prazo futuro aparece como prazo ativo.
        assert_eq!(dashboard.active_deadline_note_count, 1);
        assert_eq!(dashboard.upcoming_deadlines.len(), 1);
        assert_eq!(dashboard.upcoming_deadlines[0].title, "Ativa");
        // A nota com prazo ja encerrado e sinalizada separadamente, com a tag
        // de origem disponivel para alterar a data ou remover o prazo.
        assert_eq!(dashboard.expired_deadline_note_count, 1);
        assert_eq!(dashboard.expired_deadlines.len(), 1);
        let expired = &dashboard.expired_deadlines[0];
        assert_eq!(expired.title, "Encerrada");
        assert_eq!(expired.relative_path, "Encerrada.md");
        assert_eq!(expired.deadline_at_unix_ms, now - 5 * DAY_MS);
        assert_eq!(expired.source_tag.as_deref(), Some("revisao/prova"));
    }

    #[test]
    fn an_expired_deadline_outside_enrollment_is_not_signaled() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        // A regra da tag tem prazo encerrado mas nao ativa automaticamente: a
        // politica da tag aparece na nota, mas ela nao esta inscrita e nao deve
        // poluir a sinalizacao de prazos encerrados.
        crate::review::policy_config::set_vault_review_tag_rules(
            vault.path(),
            0,
            vec![TagReviewPolicyRule {
                tag: "revisao/prova".to_string(),
                auto_enroll: false,
                first_review_interval_days: 1,
                target_retention: 0.9,
                priority_weight: 3.0,
                min_interval_days: 1,
                max_interval_days: 90,
                deadline_at_unix_ms: Some(now - 5 * DAY_MS),
                preferred_mode: None,
            }],
            now,
        )
        .expect("save inactive deadline tag rule");
        persist_readiness_assessment(
            vault.path(),
            "Parada.md",
            "# Parada\n\nIdeia um.\n\nIdeia dois.\n\n#revisao/prova",
            &report,
            now,
        )
        .expect("persist note");
        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.enrolled_note_count, 0);
        assert_eq!(dashboard.expired_deadline_note_count, 0);
        assert!(dashboard.expired_deadlines.is_empty());
    }

    fn write_segmented_calibrating_document(
        vault: &std::path::Path,
        relative_path: &str,
        observed: usize,
        total: usize,
        reviewed_at_unix_ms: u64,
        now_unix_ms: u64,
    ) {
        use crate::review::contract::{
            Enrollment, FsrsState, LearningDocument, LearningNote, RecallOutcome, ReviewMode,
            SchedulingState, SchedulingStatus, SessionUnitResult, UnitEvaluation, UnitSnapshot,
        };
        use crate::review::evaluation::source_hash;
        use serde_json::json;

        let markdown = (1..=total)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let content_hash = source_hash(&markdown);
        let mut units =
            crate::review::segmentation::build_learning_units(&markdown, &content_hash, &[]);
        assert_eq!(units.len(), total);
        let mut readiness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap();
        readiness = readiness["note"]["readiness"].clone();
        readiness["assessedContentHash"] = json!(content_hash.clone());
        let readiness = serde_json::from_value(readiness).unwrap();
        let note_id = format!("note-cal-{}", relative_path.trim_end_matches(".md"));
        let effective_policy = crate::review::contract::parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap()
        .effective_policy;
        let mut sessions = Vec::new();
        for index in 0..observed {
            let unit = units[index].clone();
            let snapshot = UnitSnapshot {
                id: unit.id.clone(),
                ordinal: unit.ordinal,
                kind: unit.kind.clone(),
                content_hash: unit.content_hash.clone(),
                section_path: unit.section_path.clone(),
                identity: unit.identity.clone(),
                source_start_utf16: unit.source_start_utf16,
                source_end_utf16: unit.source_end_utf16,
            };
            let fsrs = FsrsState {
                difficulty: 5.0,
                stability_days: 8.0,
                retrievability: 1.0,
                last_reviewed_at_unix_ms: reviewed_at_unix_ms,
            };
            let evaluation = UnitEvaluation::Evaluated {
                score: 85,
                outcome: RecallOutcome::Good,
                evidence: crate::review::contract::EvidenceStrength::FreeRecall,
                evaluated_at_unix_ms: reviewed_at_unix_ms,
                gaps: Vec::new(),
            };
            units[index].fsrs = Some(fsrs.clone());
            units[index].latest_evaluation = Some(evaluation.clone());
            sessions.push(crate::review::contract::ReviewSession {
                id: format!("cal-session-{index}"),
                note_content_hash: content_hash.clone(),
                mode: ReviewMode::Exam,
                provider: crate::review::contract::AiProvider::Ollama,
                completed_at_unix_ms: reviewed_at_unix_ms + index as u64,
                overall_score: Some(85),
                unit_results: vec![SessionUnitResult {
                    unit_snapshot: snapshot,
                    evaluation,
                    fsrs_before: Some(fsrs.clone()),
                    fsrs_after: Some(fsrs),
                }],
                effective_policy: effective_policy.clone(),
                next_review_at_unix_ms: Some(now_unix_ms),
            });
        }
        let document = LearningDocument {
            schema_version: crate::review::contract::LEARNING_SCHEMA_VERSION,
            revision: 1,
            note: LearningNote {
                id: note_id.clone(),
                relative_path: relative_path.to_string(),
                content_hash: content_hash.clone(),
                readiness,
                enrollment: Enrollment {
                    manual: true,
                    manual_paused: false,
                    inherited_from_tag_ids: Vec::new(),
                    preferred_mode: ReviewMode::Exam,
                    mode_manual: false,
                },
            },
            units,
            effective_policy,
            scheduling: SchedulingState {
                status: SchedulingStatus::Scheduled,
                first_review_at_unix_ms: Some(reviewed_at_unix_ms),
                last_review_at_unix_ms: (observed > 0)
                    .then(|| reviewed_at_unix_ms + observed as u64 - 1),
                next_review_at_unix_ms: Some(now_unix_ms),
                fsrs_version: "fsrs-6".to_string(),
            },
            sessions,
        };
        write_learning_document(vault, &note_id, None, &document)
            .expect("persist calibration document");
    }

    #[test]
    fn reports_calibration_progress_and_decayed_partial_retention() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        // Tres das oito unidades observadas ha 90 dias: retencao efetiva
        // decaida (frageis) e calibracao ainda em andamento.
        write_segmented_calibrating_document(
            vault.path(),
            "Longa.md",
            3,
            8,
            now - 90 * DAY_MS,
            now,
        );
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, now - (now % DAY_MS)).unwrap();
        assert_eq!(dashboard.calibration_note_count, 1);
        let item = &dashboard.calibration_notes[0];
        assert_eq!(item.observed_unit_count, 3);
        assert_eq!(item.total_unit_count, 8);
        assert_eq!(item.relative_path, "Longa.md");
        // A retencao efetiva considera o decaimento desde a ultima revisao
        // (nao o 1.0 congelado): 90 dias com estabilidade 8 ficam frageis.
        assert_eq!(dashboard.fragile_unit_count, 3);
        assert_eq!(dashboard.tracked_unit_count, 3);
        let average = dashboard.average_retrievability.expect("retention average");
        assert!(
            (average - 0.524).abs() < 0.01,
            "expected decayed average, got {average}"
        );
    }

    #[test]
    fn a_fully_observed_segmented_note_is_not_in_calibration() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        write_segmented_calibrating_document(
            vault.path(),
            "Pronta.md",
            8,
            8,
            now - 1 * DAY_MS,
            now,
        );
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, now - (now % DAY_MS)).unwrap();
        assert_eq!(dashboard.calibration_note_count, 0);
        assert!(dashboard.calibration_notes.is_empty());
    }

    fn write_enrolled_document(
        vault: &std::path::Path,
        relative_path: &str,
        next_review_at_unix_ms: u64,
        retrievability: f64,
        session_count: usize,
        last_reviewed_days_before_next: u64,
    ) {
        let last_reviewed_at_unix_ms =
            next_review_at_unix_ms.saturating_sub(last_reviewed_days_before_next * DAY_MS);
        use crate::review::contract::{
            Enrollment, FsrsState, LearningDocument, LearningNote, ReviewMode, SchedulingState,
            SchedulingStatus, UnitEvaluation,
        };
        use crate::review::evaluation::source_hash;
        use crate::review::segmentation::build_learning_units;
        use serde_json::json;

        let markdown = format!("# {relative_path}\n\nIdeia um.\n\nIdeia dois.");
        let content_hash = source_hash(&markdown);
        let units = build_learning_units(&markdown, &content_hash, &[]);
        let mut readiness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap();
        readiness = readiness["note"]["readiness"].clone();
        readiness["assessedContentHash"] = json!(content_hash.clone());
        let readiness = serde_json::from_value(readiness).unwrap();
        let note_id = format!(
            "note-{}",
            relative_path.trim_end_matches(".md").replace('.', "_")
        );
        let mut document = LearningDocument {
            schema_version: crate::review::contract::LEARNING_SCHEMA_VERSION,
            revision: 1,
            note: LearningNote {
                id: note_id.clone(),
                relative_path: relative_path.to_string(),
                content_hash: content_hash.clone(),
                readiness,
                enrollment: Enrollment {
                    manual: true,
                    manual_paused: false,
                    inherited_from_tag_ids: Vec::new(),
                    preferred_mode: ReviewMode::Exam,
                    mode_manual: false,
                },
            },
            units,
            effective_policy: crate::review::contract::parse_learning_document(include_str!(
                "../../../tests/fixtures/review-learning-v1.json"
            ))
            .unwrap()
            .effective_policy,
            scheduling: SchedulingState {
                status: SchedulingStatus::Scheduled,
                first_review_at_unix_ms: Some(last_reviewed_at_unix_ms),
                last_review_at_unix_ms: if session_count > 0 {
                    Some(last_reviewed_at_unix_ms)
                } else {
                    None
                },
                next_review_at_unix_ms: Some(next_review_at_unix_ms),
                fsrs_version: "fsrs-6".to_string(),
            },
            sessions: Vec::new(),
        };
        let unit = &document.units[0];
        let fsrs = FsrsState {
            difficulty: 5.0,
            stability_days: 8.0,
            retrievability,
            last_reviewed_at_unix_ms: last_reviewed_at_unix_ms,
        };
        let evaluation = UnitEvaluation::Evaluated {
            score: 80,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: last_reviewed_at_unix_ms,
            gaps: Vec::new(),
        };
        let snapshot = crate::review::contract::UnitSnapshot {
            id: unit.id.clone(),
            ordinal: unit.ordinal,
            kind: unit.kind.clone(),
            content_hash: unit.content_hash.clone(),
            section_path: unit.section_path.clone(),
            identity: unit.identity.clone(),
            source_start_utf16: unit.source_start_utf16,
            source_end_utf16: unit.source_end_utf16,
        };
        // Sem sessao persistida a unidade nao pode carregar projecao de memoria:
        // o contrato exige que todo estado FSRS corresponda a um historico.
        if session_count > 0 {
            for index in 0..session_count {
                document
                    .sessions
                    .push(crate::review::contract::ReviewSession {
                        id: format!("session-{}-{index}", relative_path),
                        note_content_hash: content_hash.clone(),
                        mode: ReviewMode::Exam,
                        provider: crate::review::contract::AiProvider::Ollama,
                        completed_at_unix_ms: last_reviewed_at_unix_ms,
                        overall_score: Some(80),
                        unit_results: vec![crate::review::contract::SessionUnitResult {
                            unit_snapshot: snapshot.clone(),
                            evaluation: evaluation.clone(),
                            fsrs_before: Some(fsrs.clone()),
                            fsrs_after: Some(fsrs.clone()),
                        }],
                        effective_policy: document.effective_policy.clone(),
                        next_review_at_unix_ms: Some(next_review_at_unix_ms),
                    });
            }
            document.units[0].fsrs = Some(fsrs);
            document.units[0].latest_evaluation = Some(evaluation);
        }
        crate::review::storage::write_learning_document(vault, &note_id, None, &document)
            .expect("persist dashboard document");
    }

    #[test]
    fn aggregates_readiness_quality_and_lists_notes_needing_attention() {
        use crate::review::evaluation::{
            GroundedReadinessIssue, ReadinessIssueCode as ReportIssueCode,
        };

        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;

        // Pronta: conta como ready e nao entra na lista de atencao.
        let ready_report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        persist_readiness_assessment(
            vault.path(),
            "Pronta.md",
            MARKDOWN,
            &ready_report,
            now - 3 * DAY_MS,
        )
        .expect("persist ready note");

        // Ambigua: relatorio com um problema de contexto ausente fundamentado.
        let ambiguous_report = ReadinessReport {
            status: ReadinessStatus::Ambiguous,
            explanation: "Faltam contexto e referencias.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: vec![GroundedReadinessIssue {
                code: ReportIssueCode::MissingContext,
                message: "A segunda ideia carece de contexto.".to_string(),
                suggestion: "Detalhe o contexto da segunda ideia.".to_string(),
                source_quote: Some("Ideia dois.".to_string()),
                source_start_utf16: Some(0),
                source_end_utf16: Some(10),
            }],
        };
        persist_readiness_assessment(
            vault.path(),
            "Ambígua.md",
            MARKDOWN,
            &ambiguous_report,
            now - 2 * DAY_MS,
        )
        .expect("persist ambiguous note");

        // Insuficiente: relatorio com um problema de insuficiencia.
        let insufficient_report = ReadinessReport {
            status: ReadinessStatus::Insufficient,
            explanation: "Apenas titulo e esboco.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: vec![GroundedReadinessIssue {
                code: ReportIssueCode::Insufficient,
                message: "Nao ha pontos avaliaveis.".to_string(),
                suggestion: "Escreva o conteudo substantivo.".to_string(),
                source_quote: None,
                source_start_utf16: None,
                source_end_utf16: None,
            }],
        };
        persist_readiness_assessment(
            vault.path(),
            "Esboco.md",
            MARKDOWN,
            &insufficient_report,
            now - 1 * DAY_MS,
        )
        .expect("persist insufficient note");

        // Modificada: avaliada pronta e depois editada (hash desatualizado).
        let modified = persist_readiness_assessment(
            vault.path(),
            "Editada.md",
            MARKDOWN,
            &ready_report,
            now - 4 * DAY_MS,
        )
        .expect("persist modified note");
        {
            let mut document = load_learning_document(vault.path(), &modified.note_id)
                .expect("load modified")
                .expect("modified document")
                .document;
            document.note.content_hash = "sha256:conteudo-novo".to_string();
            document.note.readiness = crate::review::contract::ReadinessAssessment::Modified {
                assessed_at_unix_ms: now - 4 * DAY_MS,
                assessed_content_hash: "sha256:conteudo-antigo".to_string(),
                assessed_semantic_hash: None,
                issues: Vec::new(),
                report: None,
            };
            document.scheduling.status = SchedulingStatus::Paused;
            document.scheduling.next_review_at_unix_ms = None;
            document.revision = document.revision.saturating_add(1);
            write_learning_document(
                vault.path(),
                &modified.note_id,
                Some(document.revision - 1),
                &document,
            )
            .expect("persist modified state");
        }

        let day_start = now - (now % DAY_MS);
        let dashboard =
            build_vault_review_dashboard(vault.path(), now, day_start).expect("build dashboard");

        assert_eq!(dashboard.readiness_ready_note_count, 1);
        assert_eq!(dashboard.readiness_ambiguous_note_count, 1);
        assert_eq!(dashboard.readiness_insufficient_note_count, 1);
        assert_eq!(dashboard.readiness_modified_note_count, 1);
        assert_eq!(dashboard.readiness_unassessed_note_count, 0);
        // Pronta nao entra na lista de atencao: so ambigua, insuficiente e
        // modificada.
        assert_eq!(dashboard.readiness_attention_note_count, 3);
        assert_eq!(dashboard.readiness_attention_notes.len(), 3);
        // As mais antigas primeiro: Editada (avaliada ha 4 dias) vem antes de
        // Ambígua (2 dias) e Esboco (1 dia).
        let titles = dashboard
            .readiness_attention_notes
            .iter()
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(titles, vec!["Editada", "Ambígua", "Esboco"]);
        let ambiguous = dashboard
            .readiness_attention_notes
            .iter()
            .find(|item| item.title == "Ambígua")
            .expect("ambiguous item");
        assert_eq!(ambiguous.relative_path, "Ambígua.md");
        assert_eq!(ambiguous.explanation, "Faltam contexto e referencias.");
        assert_eq!(ambiguous.issue_count, 1);
        // A nota editada preserva a origem da avaliacao e o motivo vazio (sem
        // relatorio novo apos a edicao).
        let modified_item = dashboard
            .readiness_attention_notes
            .iter()
            .find(|item| item.title == "Editada")
            .expect("modified item");
        assert_eq!(modified_item.issue_count, 0);
    }
}
