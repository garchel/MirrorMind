use super::contract::{AiProvider, ReviewMode, UnitEvaluation};
use super::retention_calibration::fragile_threshold_for_target;
use super::session::{effective_retrievability, ReviewResultOutcome};
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Limite de linhas da pagina de relatorios: mesmo teto de sessoes do contrato.
pub const MAX_REVIEW_REPORT_ITEMS: usize = 5_000;
/// Dias da evolucao do desempenho exibidos no relatorio de retencao (inclui
/// dias sem sessao, que aparecem como lacunas no grafico).
pub const RETENTION_EVOLUTION_DAYS: usize = 30;
/// Teto de bytes de uma nota lida apenas para extrair tags no relatorio de
/// retencao; notas maiores ou ilegiveis contribuem sem tags.
const MAX_RETENTION_TAG_NOTE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionOverall {
    pub enrolled_note_count: usize,
    pub tracked_unit_count: usize,
    pub average_retrievability: Option<f64>,
    pub average_stability_days: Option<f64>,
    pub fragile_unit_count: usize,
    pub completed_session_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRetentionItem {
    pub tag: String,
    pub note_count: usize,
    pub unit_count: usize,
    pub average_retrievability: Option<f64>,
    pub fragile_unit_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePoint {
    pub day_start_unix_ms: u64,
    pub session_count: usize,
    pub average_score: Option<f64>,
}

/// Relatorio de retencao: retencao estimada geral e por tag, alem da evolucao
/// do desempenho (media das notas das sessoes) ao longo dos ultimos dias.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionReport {
    pub generated_at_unix_ms: u64,
    pub overall: RetentionOverall,
    pub per_tag: Vec<TagRetentionItem>,
    pub evolution: Vec<PerformancePoint>,
}

#[derive(Default)]
struct TagAccumulator {
    note_ids: std::collections::BTreeSet<String>,
    unit_count: usize,
    retrievability_sum: f64,
    fragile_unit_count: usize,
}

/// Extrai as tags de uma nota sem interromper o relatorio: nota removida,
/// ilegivel ou maior que o teto contribui apenas sem tags.
fn read_note_tags(root: &Path, relative_path: &str) -> Vec<String> {
    let Ok(note_path) = crate::resolve_note_path(root, relative_path) else {
        return Vec::new();
    };
    // Checa o tamanho via metadata antes de ler, para nao carregar em memoria
    // uma nota patologicamente grande so para descartar as tags.
    let Ok(metadata) = std::fs::metadata(&note_path) else {
        return Vec::new();
    };
    if metadata.len() > MAX_RETENTION_TAG_NOTE_BYTES {
        return Vec::new();
    }
    let Ok(bytes) = std::fs::read(&note_path) else {
        return Vec::new();
    };
    let Ok(content) = String::from_utf8(bytes) else {
        return Vec::new();
    };
    crate::extract_tags(&content).unwrap_or_default()
}

/// Agrega a retencao estimada do vault. A retencao geral e por tag usa a
/// recuperabilidade efetiva (decai com a passagem do tempo desde a ultima
/// revisao), como no dashboard; a evolucao agrupa as sessoes por dia local
/// (incluindo dias sem sessao) para o grafico de desempenho.
pub fn build_retention_report(
    vault_root: &Path,
    now_unix_ms: u64,
    local_day_start_unix_ms: u64,
) -> Result<RetentionReport> {
    // O root canonicizado garante que resolve_note_path aceite os caminhos
    // relativos das notas; o IPC ja canoniciza, entao e idempotente.
    let vault_root = crate::canonicalize_directory(vault_root)?;
    const DAY_MS: u64 = 86_400_000;
    // O inicio do dia local vem do cliente; fora de uma janela de um dia em
    // torno de agora, cai para o dia alinhado em UTC (mesma regra do dashboard).
    let local_day_start_unix_ms = if local_day_start_unix_ms.saturating_sub(now_unix_ms) <= DAY_MS
        && now_unix_ms.saturating_sub(local_day_start_unix_ms) <= DAY_MS
    {
        local_day_start_unix_ms
    } else {
        now_unix_ms - (now_unix_ms % DAY_MS)
    };

    let mut enrolled_note_count = 0usize;
    let mut completed_session_count = 0usize;
    let mut tracked_unit_count = 0usize;
    let mut retrievability_sum = 0.0f64;
    let mut stability_sum = 0.0f64;
    let mut fragile_unit_count = 0usize;
    let mut per_tag: HashMap<String, TagAccumulator> = HashMap::new();
    // Buckets da evolucao: indice = offset em dias (0 = hoje); valor =
    // (contagem de sessoes, soma das notas, quantidade de sessoes com nota).
    let mut evolution = vec![(0usize, 0.0f64, 0usize); RETENTION_EVOLUTION_DAYS];

    for storage_key in list_learning_storage_keys(&vault_root)? {
        let Some(loaded) = load_learning_document(&vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let enrolled = document.note.enrollment.is_enrolled()
            && matches!(
                document.note.readiness,
                super::contract::ReadinessAssessment::Ready { .. }
            );
        if enrolled {
            enrolled_note_count += 1;
        }
        completed_session_count += document.sessions.len();
        // Tags somente de notas inscritas: o relatorio de retencao descreve o
        // aprendizado, nao o indice geral do vault. A retencao geral acima
        // conta todas as unidades com FSRS (mesma definicao do dashboard), de
        // modo que overall e perTag usam populacoes distintas de proposito.
        let mut note_tags = Vec::new();
        if enrolled {
            note_tags = read_note_tags(&vault_root, &document.note.relative_path);
        }
        // Fragilidade calibrada por simulacao deterministica: relativa ao alvo
        // da politica efetiva da nota (cerca de dois intervalos de revisao
        // perdidos), em vez do limiar absoluto provisorio de 0.6.
        let fragile_threshold =
            fragile_threshold_for_target(document.effective_policy.target_retention);
        let mut note_unit_count = 0usize;
        for unit in &document.units {
            if let Some(fsrs) = &unit.fsrs {
                tracked_unit_count += 1;
                note_unit_count += 1;
                let effective = effective_retrievability(fsrs, now_unix_ms);
                retrievability_sum += effective;
                stability_sum += fsrs.stability_days;
                if effective < fragile_threshold {
                    fragile_unit_count += 1;
                }
            }
        }
        // Uma nota com varias tags aparece em cada tag (como no indice de
        // tags); as medias sao por tag, entao unidades compartilhadas contam
        // na retencao de cada tag que as carrega.
        for tag in &note_tags {
            let accumulator = per_tag.entry(tag.clone()).or_default();
            accumulator.note_ids.insert(document.note.id.clone());
            accumulator.unit_count += note_unit_count;
            for unit in &document.units {
                if let Some(fsrs) = &unit.fsrs {
                    let effective = effective_retrievability(fsrs, now_unix_ms);
                    accumulator.retrievability_sum += effective;
                    if effective < fragile_threshold {
                        accumulator.fragile_unit_count += 1;
                    }
                }
            }
        }
        // Evolucao do desempenho: media das notas das sessoes por dia local,
        // incluindo dias sem sessao como lacunas (contagem zero).
        for session in &document.sessions {
            let day_offset =
                local_day_start_unix_ms.saturating_sub(session.completed_at_unix_ms) / DAY_MS;
            if let Some(bucket) = evolution.get_mut(day_offset as usize) {
                bucket.0 += 1;
                if let Some(score) = session.overall_score {
                    bucket.1 += f64::from(score);
                    bucket.2 += 1;
                }
            }
        }
    }

    let mut per_tag = per_tag
        .into_iter()
        .map(|(tag, accumulator)| TagRetentionItem {
            average_retrievability: if accumulator.unit_count > 0 {
                Some(
                    (accumulator.retrievability_sum / accumulator.unit_count as f64 * 10_000.0)
                        .round()
                        / 10_000.0,
                )
            } else {
                None
            },
            tag,
            note_count: accumulator.note_ids.len(),
            unit_count: accumulator.unit_count,
            fragile_unit_count: accumulator.fragile_unit_count,
        })
        .collect::<Vec<_>>();
    // As tags mais fracas primeiro (retencao menor no topo); tags sem dados
    // ficam no fim, em ordem alfabetica.
    per_tag.sort_by(|left, right| {
        match (left.average_retrievability, right.average_retrievability) {
            (Some(left_value), Some(right_value)) => left_value
                .total_cmp(&right_value)
                .then_with(|| left.tag.cmp(&right.tag)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => left.tag.cmp(&right.tag),
        }
    });

    // Evolucao do dia mais antigo para hoje, com inicio do dia local real de
    // cada bucket (indice 0 = hoje).
    let evolution = evolution
        .iter()
        .enumerate()
        .rev()
        .map(
            |(offset, (session_count, score_sum, scored_count))| PerformancePoint {
                day_start_unix_ms: local_day_start_unix_ms.saturating_sub(offset as u64 * DAY_MS),
                session_count: *session_count,
                average_score: if *scored_count > 0 {
                    Some(round_2(*score_sum / *scored_count as f64))
                } else {
                    None
                },
            },
        )
        .collect::<Vec<_>>();

    Ok(RetentionReport {
        generated_at_unix_ms: now_unix_ms,
        overall: RetentionOverall {
            enrolled_note_count,
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
            fragile_unit_count,
            completed_session_count,
        },
        per_tag,
        evolution,
    })
}

fn round_2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round_4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReportItem {
    pub session_id: String,
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub mode: ReviewMode,
    pub provider: AiProvider,
    pub completed_at_unix_ms: u64,
    pub overall_score: Option<u8>,
    pub outcome: Option<ReviewResultOutcome>,
    pub gap_count: usize,
    pub unit_count: usize,
    pub next_review_at_unix_ms: Option<u64>,
}

/// Extrai o resultado por faixa de pontuacao, como no relatorio da sessao.
fn outcome_for_score(score: u8) -> ReviewResultOutcome {
    match score {
        0..=39 => ReviewResultOutcome::Forgotten,
        40..=69 => ReviewResultOutcome::Partial,
        70..=89 => ReviewResultOutcome::Good,
        _ => ReviewResultOutcome::Complete,
    }
}

/// Lista todas as sessoes concluidas do vault como linhas de relatorio, da mais
/// recente para a mais antiga. Nao le o Markdown das notas: usa apenas o estado
/// persistido, entao a pagina funciona mesmo para notas removidas ou alteradas.
pub fn list_review_reports(vault_root: &Path) -> Result<Vec<ReviewReportItem>> {
    let mut reports = Vec::new();
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let relative_path = document.note.relative_path;
        let title = Path::new(&relative_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(&relative_path)
            .to_string();
        for session in &document.sessions {
            let mut gap_count = 0usize;
            let mut unit_count = 0usize;
            for result in &session.unit_results {
                unit_count += 1;
                if let UnitEvaluation::Evaluated { gaps, .. } = &result.evaluation {
                    gap_count += gaps.len();
                }
            }
            reports.push(ReviewReportItem {
                session_id: session.id.clone(),
                note_id: document.note.id.clone(),
                relative_path: relative_path.clone(),
                title: title.clone(),
                mode: session.mode.clone(),
                provider: session.provider.clone(),
                completed_at_unix_ms: session.completed_at_unix_ms,
                overall_score: session.overall_score,
                outcome: session.overall_score.map(outcome_for_score),
                gap_count,
                unit_count,
                next_review_at_unix_ms: session.next_review_at_unix_ms,
            });
        }
    }

    reports.sort_by(|left, right| {
        right
            .completed_at_unix_ms
            .cmp(&left.completed_at_unix_ms)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    reports.truncate(MAX_REVIEW_REPORT_ITEMS);
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::{build_retention_report, list_review_reports, RETENTION_EVOLUTION_DAYS};
    use crate::review::contract::parse_learning_document;
    use crate::review::evaluation::source_hash;
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::segmentation::build_learning_units;
    use crate::review::state::{persist_readiness_assessment, set_manual_enrollment};
    use crate::review::storage::write_learning_document;
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    const DAY_MS: u64 = 24 * 60 * 60 * 1_000;

    /// Grava o arquivo da nota e um documento de aprendizado inscrito com uma
    /// unica unidade e o estado FSRS informado, para testar a retencao por tag.
    fn write_tagged_document(
        vault: &std::path::Path,
        relative_path: &str,
        tag: &str,
        stability_days: f64,
        reviewed_days_ago: u64,
        now_unix_ms: u64,
        score: u8,
    ) {
        use crate::review::contract::{
            Enrollment, FsrsState, LearningDocument, LearningNote, ReviewMode, SchedulingState,
            SchedulingStatus, SessionUnitResult, UnitEvaluation, UnitSnapshot,
        };

        let markdown = format!(
            "# {}\n\nIdeia um.\n\nIdeia dois.\n\n#{tag}",
            relative_path.trim_end_matches(".md")
        );
        let content_hash = source_hash(&markdown);
        // A tag so e lida do arquivo real, como na pagina de relatorios.
        let note_path = vault.join(relative_path);
        fs::create_dir_all(note_path.parent().expect("folder")).expect("create folder");
        fs::write(&note_path, &markdown).expect("write note file");
        let mut units = build_learning_units(&markdown, &content_hash, &[]);
        let mut readiness: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap();
        readiness = readiness["note"]["readiness"].clone();
        readiness["assessedContentHash"] = json!(content_hash.clone());
        let readiness = serde_json::from_value(readiness).unwrap();
        let note_id = crate::review::state::note_id_for_path(relative_path);
        let effective_policy = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap()
        .effective_policy;
        let unit = &units[0];
        let reviewed_at = now_unix_ms.saturating_sub(reviewed_days_ago * DAY_MS);
        let fsrs = FsrsState {
            difficulty: 5.0,
            stability_days,
            retrievability: 1.0,
            last_reviewed_at_unix_ms: reviewed_at,
        };
        let outcome = match score {
            0..=39 => crate::review::contract::RecallOutcome::Forgotten,
            40..=69 => crate::review::contract::RecallOutcome::Partial,
            70..=89 => crate::review::contract::RecallOutcome::Good,
            _ => crate::review::contract::RecallOutcome::Complete,
        };
        let evaluation = UnitEvaluation::Evaluated {
            score,
            outcome,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: reviewed_at,
            gaps: Vec::new(),
        };
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
        units[0].fsrs = Some(fsrs.clone());
        units[0].latest_evaluation = Some(evaluation.clone());
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
                    inherited_from_tag_ids: vec![tag.to_string()],
                    preferred_mode: ReviewMode::Exam,
                    mode_manual: false,
                },
            },
            units,
            effective_policy,
            scheduling: SchedulingState {
                status: SchedulingStatus::Scheduled,
                first_review_at_unix_ms: Some(reviewed_at),
                last_review_at_unix_ms: Some(reviewed_at),
                next_review_at_unix_ms: Some(reviewed_at + 7 * DAY_MS),
                fsrs_version: "fsrs-6".to_string(),
            },
            sessions: vec![crate::review::contract::ReviewSession {
                id: format!("session-{}", note_id),
                note_content_hash: content_hash.clone(),
                mode: ReviewMode::Exam,
                provider: crate::review::contract::AiProvider::Ollama,
                completed_at_unix_ms: reviewed_at,
                overall_score: Some(score),
                unit_results: vec![SessionUnitResult {
                    unit_snapshot: snapshot,
                    evaluation,
                    fsrs_before: Some(fsrs.clone()),
                    fsrs_after: Some(fsrs.clone()),
                }],
                effective_policy: parse_learning_document(include_str!(
                    "../../../tests/fixtures/review-learning-v1.json"
                ))
                .unwrap()
                .effective_policy,
                next_review_at_unix_ms: Some(reviewed_at + 7 * DAY_MS),
            }],
        };
        write_learning_document(vault, &note_id, None, &document).expect("persist tagged document");
    }

    #[test]
    fn retention_report_aggregates_overall_memory_and_evolution() {
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
            "# Biologia\n\nIdeia um.\n\nIdeia dois.",
            &report,
            now - 5 * DAY_MS,
        )
        .expect("persist note");
        set_manual_enrollment(
            vault.path(),
            "Biologia.md",
            "# Biologia\n\nIdeia um.\n\nIdeia dois.",
            true,
            now - 5 * DAY_MS,
        )
        .expect("enroll note");
        let mut document =
            crate::review::storage::load_learning_document(vault.path(), &persisted.note_id)
                .expect("load")
                .expect("document")
                .document;
        let reviewed_at = now - 3 * DAY_MS;
        let fsrs = crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 12.0,
            retrievability: 0.9,
            last_reviewed_at_unix_ms: reviewed_at,
        };
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
        let evaluation = crate::review::contract::UnitEvaluation::Evaluated {
            score: 80,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: reviewed_at,
            gaps: Vec::new(),
        };
        document.sessions = vec![crate::review::contract::ReviewSession {
            id: "retention-session".to_string(),
            note_content_hash: document.note.content_hash.clone(),
            mode: crate::review::contract::ReviewMode::Exam,
            provider: crate::review::contract::AiProvider::Ollama,
            completed_at_unix_ms: reviewed_at,
            overall_score: Some(80),
            unit_results: vec![crate::review::contract::SessionUnitResult {
                unit_snapshot: snapshot,
                evaluation: evaluation.clone(),
                fsrs_before: Some(fsrs.clone()),
                fsrs_after: Some(fsrs.clone()),
            }],
            effective_policy: document.effective_policy.clone(),
            next_review_at_unix_ms: Some(now + 12 * DAY_MS),
        }];
        document.units[0].fsrs = Some(fsrs);
        document.units[0].latest_evaluation = Some(evaluation);
        document.scheduling.last_review_at_unix_ms = Some(reviewed_at);
        document.scheduling.next_review_at_unix_ms = Some(now + 12 * DAY_MS);
        document.revision = document.revision.saturating_add(1);
        write_learning_document(
            vault.path(),
            &persisted.note_id,
            Some(document.revision - 1),
            &document,
        )
        .expect("persist sessions");

        let day_start = now - (now % DAY_MS);
        let retention =
            build_retention_report(vault.path(), now, day_start).expect("build retention");

        assert_eq!(retention.overall.enrolled_note_count, 1);
        assert_eq!(retention.overall.tracked_unit_count, 1);
        assert_eq!(retention.overall.completed_session_count, 1);
        assert_eq!(retention.overall.average_stability_days, Some(12.0));
        // Revisada ha 3 dias com estabilidade 12: retencao efetiva decaida,
        // ainda saudavel (acima do limiar de fragilidade).
        let average = retention.overall.average_retrievability.expect("average");
        assert!(
            (average - 0.972).abs() < 0.01,
            "expected decayed average, got {average}"
        );
        assert_eq!(retention.overall.fragile_unit_count, 0);
        // A nota nao possui tag e o arquivo nao existe: nada entra em per_tag.
        assert!(retention.per_tag.is_empty());
        // A evolucao cobre os ultimos dias, do mais antigo para hoje, e o dia
        // da sessao carrega a nota 80.
        assert_eq!(retention.evolution.len(), RETENTION_EVOLUTION_DAYS);
        let session_day = retention
            .evolution
            .iter()
            .find(|point| point.session_count > 0)
            .expect("session day");
        assert_eq!(session_day.average_score, Some(80.0));
        assert_eq!(session_day.session_count, 1);
        assert_eq!(
            retention.evolution[0].day_start_unix_ms + DAY_MS,
            retention.evolution[1].day_start_unix_ms
        );
    }

    #[test]
    fn retention_report_groups_by_tag_with_weakest_first() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let day_start = now - (now % DAY_MS);
        // Tag de prova com estabilidade curta revisada ha 20 dias: fragil.
        write_tagged_document(
            vault.path(),
            "Biologia/Prova.md",
            "revisao/prova",
            2.0,
            20,
            now,
            58,
        );
        // Tag leve com estabilidade longa revisada ontem: saudavel.
        write_tagged_document(
            vault.path(),
            "Quimica/Manter.md",
            "revisao/manter",
            60.0,
            1,
            now,
            90,
        );

        let retention =
            build_retention_report(vault.path(), now, day_start).expect("build retention");

        assert_eq!(retention.per_tag.len(), 2);
        // Ordenacao: a tag mais fraca primeiro.
        assert_eq!(retention.per_tag[0].tag, "revisao/prova");
        assert_eq!(retention.per_tag[1].tag, "revisao/manter");
        assert_eq!(retention.per_tag[0].note_count, 1);
        assert_eq!(retention.per_tag[0].unit_count, 1);
        assert_eq!(retention.per_tag[0].fragile_unit_count, 1);
        let prova = retention.per_tag[0].average_retrievability.expect("prova");
        let manter = retention.per_tag[1].average_retrievability.expect("manter");
        assert!(
            prova < manter,
            "prova should be weaker than manter: {prova} vs {manter}"
        );
        // Os documentos de teste usam a politica da fixture (tag de prazo com
        // retencao-alvo 93%): o limiar de fragilidade calibrado e relativo ao
        // alvo, e a prova (retencao efetiva ~0.55) fica abaixo dele enquanto a
        // de manutencao (~0.998) fica acima.
        let threshold = super::fragile_threshold_for_target(0.93);
        assert!(prova < threshold);
        assert!(manter > threshold);
        // Ambas as sessoes aparecem na evolucao, cada uma no seu dia.
        let total_sessions = retention
            .evolution
            .iter()
            .map(|point| point.session_count)
            .sum::<usize>();
        assert_eq!(total_sessions, 2);
        assert_eq!(
            retention
                .evolution
                .iter()
                .filter(|point| point.session_count > 0)
                .count(),
            2
        );
    }

    #[test]
    fn a_note_without_tag_file_contributes_without_tags() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        let day_start = now - (now % DAY_MS);
        // Sem tag no markdown: unidade entra na retencao geral, sem grupo.
        write_tagged_document(vault.path(), "Solto.md", "revisao/manter", 8.0, 5, now, 70);
        let solto_id = crate::review::state::note_id_for_path("Solto.md");
        let moved_id = crate::review::state::note_id_for_path("Pasta/Destino.md");
        let mut document = crate::review::storage::load_learning_document(vault.path(), &solto_id)
            .expect("load")
            .expect("document")
            .document;
        // Remove o arquivo: a leitura de tags falha sem quebrar o relatorio.
        fs::remove_file(vault.path().join("Solto.md")).expect("remove file");
        document.note.relative_path = "Pasta/Destino.md".to_string();
        document.note.id = moved_id.clone();
        document.revision = 1;
        write_learning_document(vault.path(), &moved_id, None, &document).expect("persist moved");
        // Remove tambem o registro antigo para nao duplicar a unidade.
        std::fs::remove_file(
            vault
                .path()
                .join(".mirmind")
                .join("learning")
                .join(format!("{solto_id}.json")),
        )
        .ok();

        let retention =
            build_retention_report(vault.path(), now, day_start).expect("build retention");

        // A unidade persiste sem tag (arquivo removido), mas nao quebra nada.
        assert_eq!(retention.overall.tracked_unit_count, 1);
        assert!(retention.per_tag.is_empty());
    }

    #[test]
    fn lists_persisted_sessions_as_report_rows_sorted_newest_first() {
        let vault = tempdir().expect("vault");
        let fixture = include_str!("../../../tests/fixtures/review-learning-v1.json");
        let document = parse_learning_document(fixture).expect("valid fixture");
        write_learning_document(vault.path(), &document.note.id, None, &document)
            .expect("persist document");

        let reports = list_review_reports(vault.path()).expect("list reports");

        assert_eq!(reports.len(), 1);
        let report = &reports[0];
        assert_eq!(report.session_id, "session-1");
        assert_eq!(report.note_id, "note-1");
        assert_eq!(report.relative_path, "Biologia/Fotossintese.md");
        assert_eq!(report.title, "Fotossintese");
        assert!(matches!(
            report.mode,
            crate::review::contract::ReviewMode::Exam
        ));
        assert!(matches!(
            report.provider,
            crate::review::contract::AiProvider::Ollama
        ));
        assert_eq!(report.overall_score, Some(58));
        assert_eq!(
            report.outcome,
            Some(crate::review::session::ReviewResultOutcome::Partial)
        );
        assert_eq!(report.gap_count, 2);
        assert_eq!(report.unit_count, 2);
        assert_eq!(report.next_review_at_unix_ms, Some(1_720_672_800_000));
    }

    #[test]
    fn orders_reports_by_completed_at_descending() {
        let vault = tempdir().expect("vault");
        let fixture = include_str!("../../../tests/fixtures/review-learning-v1.json");
        let first = parse_learning_document(fixture).expect("valid fixture");
        write_learning_document(vault.path(), &first.note.id, None, &first)
            .expect("persist first document");

        // Segunda nota com sessao mais recente (o agendamento precisa apontar
        // para a sessao mais recente, como exige o contrato do documento).
        let completed_at = first.sessions[0].completed_at_unix_ms;
        let mut second = parse_learning_document(fixture).expect("valid fixture");
        second.note.id = "note-2".to_string();
        second.note.relative_path = "Quimica/Reacoes.md".to_string();
        second.sessions[0].id = "session-2".to_string();
        second.sessions[0].completed_at_unix_ms = completed_at + 1;
        second.scheduling.last_review_at_unix_ms = Some(completed_at + 1);
        write_learning_document(vault.path(), &second.note.id, None, &second)
            .expect("persist second document");

        let reports = list_review_reports(vault.path()).expect("list reports");

        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].session_id, "session-2");
        assert_eq!(reports[1].session_id, "session-1");
    }
}
