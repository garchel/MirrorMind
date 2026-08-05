use super::contract::{AiProvider, ReviewMode, UnitEvaluation};
use super::session::ReviewResultOutcome;
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::Result;
use serde::Serialize;
use std::path::Path;

/// Limite de linhas da pagina de relatorios: mesmo teto de sessoes do contrato.
pub const MAX_REVIEW_REPORT_ITEMS: usize = 5_000;

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
    use super::list_review_reports;
    use crate::review::contract::parse_learning_document;
    use crate::review::storage::write_learning_document;
    use tempfile::tempdir;

    #[test]
    fn lists_persisted_sessions_as_report_rows_sorted_newest_first() {
        let vault = tempdir().expect("vault");
        let fixture = include_str!("../../../tests/fixtures/review-learning-v1.json");
        let mut document = parse_learning_document(fixture).expect("valid fixture");
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
