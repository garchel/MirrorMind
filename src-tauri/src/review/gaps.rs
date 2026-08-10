use super::contract::{GapClassification, LearningDocument, RecallOutcome, UnitEvaluation};
use anyhow::Result;
use serde::Serialize;

const MAX_RETURNED_GAPS: usize = 200;
const MAX_RETURNED_UNITS: usize = 2_000;

fn outcome_view(outcome: &RecallOutcome) -> &'static str {
    match outcome {
        RecallOutcome::Forgotten => "forgotten",
        RecallOutcome::Partial => "partial",
        RecallOutcome::Good => "good",
        RecallOutcome::Complete => "complete",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReviewGapView {
    pub classification: &'static str,
    pub source_quote: String,
    pub source_start_utf16: u64,
    pub source_end_utf16: u64,
}

/// Exposes the grounded gaps of the latest completed session, ordered by position.
/// Returns an empty list when the note has no session or its content changed.
pub fn latest_review_gaps(
    document: &LearningDocument,
    markdown: &str,
    content_hash: &str,
) -> Result<Vec<NoteReviewGapView>> {
    if document.note.content_hash != content_hash {
        return Ok(Vec::new());
    }
    let Some(session) = document.sessions.last() else {
        return Ok(Vec::new());
    };
    if session.note_content_hash != content_hash {
        return Ok(Vec::new());
    }
    let markdown_utf16 = markdown.encode_utf16().count();
    let mut gaps: Vec<NoteReviewGapView> = session
        .unit_results
        .iter()
        .filter_map(|result| match &result.evaluation {
            UnitEvaluation::Evaluated { gaps, .. } => Some(gaps.iter().filter_map(|gap| {
                if gap.source_end_utf16 as usize > markdown_utf16 {
                    return None;
                }
                Some(NoteReviewGapView {
                    classification: match gap.classification {
                        GapClassification::Forgotten => "forgotten",
                        GapClassification::Confused => "confused",
                    },
                    source_quote: gap.source_quote.clone(),
                    source_start_utf16: gap.source_start_utf16,
                    source_end_utf16: gap.source_end_utf16,
                })
            })),
            UnitEvaluation::Inconclusive { .. } => None,
        })
        .flatten()
        .collect();
    gaps.sort_by(|left, right| {
        left.source_start_utf16
            .cmp(&right.source_start_utf16)
            .then_with(|| left.source_end_utf16.cmp(&right.source_end_utf16))
    });
    gaps.truncate(MAX_RETURNED_GAPS);
    Ok(gaps)
}

/// Unidade da ultima sessao concluida, no formato do overlay do relatorio:
/// o modo Leitura do editor usa os mesmos intervalos para o badge de
/// pontuacao ao final de cada paragrafo avaliado.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReviewUnitView {
    pub source_start_utf16: u64,
    pub source_end_utf16: u64,
    /// A unidade foi efetivamente avaliada na sessao (alvo da cobertura
    /// adaptativa). Unidades fora do alvo nao pontuam nem evoluem estado.
    pub evaluated: bool,
    /// Unidade do alvo com evidencia insuficiente: nunca pontua zero, nao
    /// altera DSR/FSRS e nao entra na media.
    pub inconclusive: bool,
    pub score: u8,
    pub outcome: &'static str,
}

/// Expõe as unidades da ultima sessao concluida com a avaliacao por unidade,
/// na ordem em que aparecem no documento. Retorna lista vazia quando a nota
/// nao possui sessao ou seu conteudo mudou desde a sessao.
pub fn latest_review_units(
    document: &LearningDocument,
    markdown: &str,
    content_hash: &str,
) -> Result<Vec<NoteReviewUnitView>> {
    if document.note.content_hash != content_hash {
        return Ok(Vec::new());
    }
    let Some(session) = document.sessions.last() else {
        return Ok(Vec::new());
    };
    if session.note_content_hash != content_hash {
        return Ok(Vec::new());
    }
    let markdown_utf16 = markdown.encode_utf16().count();
    let mut units: Vec<NoteReviewUnitView> = session
        .unit_results
        .iter()
        .filter_map(|result| {
            let start = result.unit_snapshot.source_start_utf16;
            let end = result.unit_snapshot.source_end_utf16;
            if end as usize > markdown_utf16 || end <= start {
                return None;
            }
            match &result.evaluation {
                UnitEvaluation::Evaluated { score, outcome, .. } => Some(NoteReviewUnitView {
                    source_start_utf16: start,
                    source_end_utf16: end,
                    evaluated: true,
                    inconclusive: false,
                    score: *score,
                    outcome: outcome_view(outcome),
                }),
                UnitEvaluation::Inconclusive { .. } => Some(NoteReviewUnitView {
                    source_start_utf16: start,
                    source_end_utf16: end,
                    evaluated: false,
                    inconclusive: true,
                    score: 0,
                    outcome: "forgotten",
                }),
            }
        })
        .collect();
    units.truncate(MAX_RETURNED_UNITS);
    Ok(units)
}

#[cfg(test)]
mod tests {
    use super::{latest_review_gaps, latest_review_units};
    use crate::review::contract::{parse_learning_document, GapClassification, UnitEvaluation};

    #[test]
    fn exposes_only_gaps_of_the_latest_session_in_position_order() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let markdown = format!(
            "{}energia luminosa{}glicose e oxigênio",
            " ".repeat(24),
            " ".repeat(145 - 40)
        );
        let gaps =
            latest_review_gaps(&document, &markdown, "sha256:note-content").expect("list gaps");
        assert!(!gaps.is_empty());
        assert!(matches!(gaps[0].classification, "forgotten" | "confused"));
        assert!(gaps[0].source_start_utf16 < gaps[0].source_end_utf16);
        let positions: Vec<_> = gaps.iter().map(|gap| gap.source_start_utf16).collect();
        let mut sorted = positions.clone();
        sorted.sort();
        assert_eq!(positions, sorted);
    }

    #[test]
    fn exposes_the_latest_session_units_with_scores_and_outcomes() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let markdown = format!(
            "{}energia luminosa{}glicose e oxigênio{}",
            " ".repeat(24),
            " ".repeat(145 - 40),
            " ".repeat(200 - 163)
        );

        let units =
            latest_review_units(&document, &markdown, "sha256:note-content").expect("list units");

        assert_eq!(units.len(), 2);
        assert!(units.iter().all(|unit| unit.evaluated));
        assert!(units.iter().all(|unit| !unit.inconclusive));
        assert_eq!(units[0].score, 85);
        assert_eq!(units[0].outcome, "good");
        assert_eq!(units[1].score, 30);
        assert_eq!(units[1].outcome, "forgotten");
        assert!(units[0].source_start_utf16 < units[0].source_end_utf16);
        assert!(units[1].source_start_utf16 >= units[0].source_end_utf16);
    }

    #[test]
    fn hides_gaps_when_the_note_content_changed_after_the_session() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let markdown = "Conteudo novo que nao bate com a sessao.";
        let gaps = latest_review_gaps(&document, markdown, "sha256:stale-hash").expect("list gaps");
        assert!(gaps.is_empty());
    }

    #[test]
    fn hides_units_when_the_note_content_changed_after_the_session() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let markdown = "Conteudo novo que nao bate com a sessao.";
        let units =
            latest_review_units(&document, markdown, "sha256:stale-hash").expect("list units");
        assert!(units.is_empty());
    }

    #[test]
    fn drops_any_gap_that_escapes_the_current_markdown_bounds() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let mut document = document;
        if let Some(result) = document.sessions[0].unit_results.first_mut() {
            if let UnitEvaluation::Evaluated { gaps, .. } = &mut result.evaluation {
                gaps.push(crate::review::contract::EvaluationGap {
                    classification: GapClassification::Confused,
                    source_quote: "fora dos limites".to_string(),
                    source_start_utf16: u32::MAX as u64 - 10,
                    source_end_utf16: u32::MAX as u64,
                });
            }
        }
        let markdown = " ".repeat(200);
        let gaps =
            latest_review_gaps(&document, &markdown, "sha256:note-content").expect("list gaps");
        assert!(gaps
            .iter()
            .all(|gap| gap.source_end_utf16 as usize <= markdown.encode_utf16().count()));
    }

    #[test]
    fn a_note_without_sessions_has_no_gaps() {
        let document = parse_learning_document(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .expect("fixture document");
        let mut document = document;
        document.sessions.clear();
        let gaps =
            latest_review_gaps(&document, "Conteudo.", "sha256:note-content").expect("list gaps");
        assert!(gaps.is_empty());
    }
}
