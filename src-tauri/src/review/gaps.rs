use super::contract::{GapClassification, LearningDocument, UnitEvaluation};
use anyhow::Result;
use serde::Serialize;

const MAX_RETURNED_GAPS: usize = 200;

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

#[cfg(test)]
mod tests {
    use super::latest_review_gaps;
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
