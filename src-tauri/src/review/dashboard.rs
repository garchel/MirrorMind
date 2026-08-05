use super::contract::ReadinessAssessment;
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::Result;
use serde::Serialize;
use std::path::Path;

const DAY_MS: u64 = 86_400_000;
const MAX_UPCOMING_DEADLINES: usize = 20;
/// Dias exibidos na carga prevista: hoje (incluindo vencidas) mais seis.
pub const FORECAST_DAYS: usize = 7;
/// Limite provisorio de "paragrafo fragil": recuperabilidade abaixo deste valor
/// marca uma unidade como candidata a revisao iminente. O valor exato deve ser
/// calibrado por simulacoes antes de ser fixado (roadmap de retencao).
pub const FRAGILE_RETRIEVABILITY_THRESHOLD: f64 = 0.6;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDeadlineItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub deadline_at_unix_ms: u64,
    pub priority_weight: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLoadItem {
    pub day_offset: u8,
    pub due_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReviewDashboard {
    pub enrolled_note_count: usize,
    pub due_note_count: usize,
    pub due_within_week_count: usize,
    pub active_deadline_note_count: usize,
    pub upcoming_deadlines: Vec<UpcomingDeadlineItem>,
    pub tracked_unit_count: usize,
    pub average_retrievability: Option<f64>,
    pub average_stability_days: Option<f64>,
    pub completed_session_count: usize,
    /// Carga prevista por dia (0 = hoje, incluindo vencidas; 1..=6 = proximos
    /// dias), alinhada ao inicio do dia local informado pelo cliente.
    pub load_forecast: Vec<DailyLoadItem>,
    /// Notas prontas e habilitadas que ainda nao concluiram nenhuma sessao.
    pub awaiting_first_review_count: usize,
    /// Unidades com recuperabilidade abaixo do limiar de fragilidade.
    pub fragile_unit_count: usize,
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
    let mut tracked_unit_count = 0usize;
    let mut retrievability_sum = 0.0f64;
    let mut stability_sum = 0.0f64;
    let mut completed_session_count = 0usize;
    let mut awaiting_first_review_count = 0usize;
    let mut fragile_unit_count = 0usize;
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
                    let title = Path::new(&relative_path)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or(&relative_path)
                        .to_string();
                    upcoming_deadlines.push(UpcomingDeadlineItem {
                        note_id: document.note.id.clone(),
                        relative_path,
                        title,
                        deadline_at_unix_ms: deadline,
                        priority_weight: document.effective_policy.priority_weight,
                    });
                }
            }
        }
        for unit in &document.units {
            if let Some(fsrs) = &unit.fsrs {
                tracked_unit_count += 1;
                retrievability_sum += fsrs.retrievability;
                stability_sum += fsrs.stability_days;
                if fsrs.retrievability < FRAGILE_RETRIEVABILITY_THRESHOLD {
                    fragile_unit_count += 1;
                }
            }
        }
        completed_session_count += document.sessions.len();
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

    Ok(VaultReviewDashboard {
        enrolled_note_count,
        due_note_count,
        due_within_week_count,
        active_deadline_note_count,
        upcoming_deadlines,
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
        load_forecast,
        awaiting_first_review_count,
        fragile_unit_count,
    })
}

fn round_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
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
        assert_eq!(
            dashboard.upcoming_deadlines[0].deadline_at_unix_ms,
            now + 2 * DAY_MS
        );
        assert_eq!(dashboard.tracked_unit_count, 1);
        assert_eq!(dashboard.average_retrievability, Some(0.75));
        assert_eq!(dashboard.average_stability_days, Some(12.0));
        assert_eq!(dashboard.completed_session_count, 1);
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
    fn forecasts_due_reviews_bucketed_by_local_day() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let day_start = now - (now % DAY_MS);

        write_enrolled_document(vault.path(), "vencida.md", day_start - 5 * DAY_MS, 0.7, 0);
        write_enrolled_document(vault.path(), "hoje.md", now, 0.7, 0);
        // A nota fragil (0.55) precisa de uma sessao para carregar o estado FSRS.
        write_enrolled_document(vault.path(), "amanha.md", day_start + 1 * DAY_MS, 0.55, 1);
        write_enrolled_document(vault.path(), "dia3.md", day_start + 3 * DAY_MS, 0.75, 0);
        write_enrolled_document(vault.path(), "dia6.md", day_start + 6 * DAY_MS, 0.8, 1);
        write_enrolled_document(vault.path(), "alem.md", day_start + 9 * DAY_MS, 0.9, 0);

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
        // Uma unidade com recuperabilidade 0.55 abaixo do limiar 0.6.
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

    fn write_enrolled_document(
        vault: &std::path::Path,
        relative_path: &str,
        next_review_at_unix_ms: u64,
        retrievability: f64,
        session_count: usize,
    ) {
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
                first_review_at_unix_ms: Some(next_review_at_unix_ms.saturating_sub(86_400_000)),
                last_review_at_unix_ms: if session_count > 0 {
                    Some(next_review_at_unix_ms.saturating_sub(86_400_000))
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
            last_reviewed_at_unix_ms: next_review_at_unix_ms.saturating_sub(86_400_000),
        };
        let evaluation = UnitEvaluation::Evaluated {
            score: 80,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: next_review_at_unix_ms.saturating_sub(86_400_000),
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
                        completed_at_unix_ms: next_review_at_unix_ms.saturating_sub(86_400_000),
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
}
