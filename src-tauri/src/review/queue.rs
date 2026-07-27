use super::contract::{ReadinessAssessment, ReviewMode};
use super::evaluation::source_hash;
use super::state::{load_note_review_state, PreferredReviewMode};
use super::storage::{list_learning_storage_keys, load_learning_document};
use anyhow::Result;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueReviewItem {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub next_review_at_unix_ms: u64,
    pub priority_weight: f64,
    pub preferred_mode: PreferredReviewMode,
    pub is_first_review: bool,
}

pub const MAX_DUE_REVIEW_ITEMS: usize = 1_000;

pub fn list_due_reviews<F>(
    vault_root: &Path,
    now_unix_ms: u64,
    mut read_markdown: F,
) -> Result<Vec<DueReviewItem>>
where
    F: FnMut(&str) -> Result<Option<String>>,
{
    let mut queue = Vec::new();
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let enrolled = document.note.enrollment.is_enrolled();
        let next_review_at_unix_ms = document.scheduling.next_review_at_unix_ms;
        if !enrolled
            || !matches!(document.note.readiness, ReadinessAssessment::Ready { .. })
            || next_review_at_unix_ms.is_none_or(|next| next > now_unix_ms)
        {
            continue;
        }

        let Some(markdown) = read_markdown(&document.note.relative_path)? else {
            continue;
        };
        if source_hash(&markdown) != document.note.content_hash {
            load_note_review_state(
                vault_root,
                &document.note.relative_path,
                &markdown,
                now_unix_ms,
            )?;
            continue;
        }

        let relative_path = document.note.relative_path;
        let title = Path::new(&relative_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(&relative_path)
            .to_string();
        queue.push(DueReviewItem {
            note_id: document.note.id,
            relative_path,
            title,
            next_review_at_unix_ms: next_review_at_unix_ms.expect("due item has a date"),
            priority_weight: document.effective_policy.priority_weight,
            preferred_mode: match document.note.enrollment.preferred_mode {
                ReviewMode::Exam => PreferredReviewMode::Exam,
                ReviewMode::Conversation => PreferredReviewMode::Conversation,
            },
            is_first_review: document.scheduling.last_review_at_unix_ms.is_none(),
        });
    }

    queue.sort_by(|left, right| {
        right
            .priority_weight
            .total_cmp(&left.priority_weight)
            .then_with(|| {
                left.next_review_at_unix_ms
                    .cmp(&right.next_review_at_unix_ms)
            })
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    queue.truncate(MAX_DUE_REVIEW_ITEMS);
    Ok(queue)
}
#[cfg(test)]
mod tests {
    use super::list_due_reviews;
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::state::{
        load_note_review_state, persist_readiness_assessment, set_manual_enrollment,
        NoteReadinessStatus,
    };
    use crate::review::storage::{load_learning_document, write_learning_document};
    use tempfile::tempdir;

    const DAY_MS: u64 = 24 * 60 * 60 * 1_000;
    const MARKDOWN: &str = "# Memoria\n\nIdeia um.\n\nIdeia dois.\n\nIdeia tres.";

    fn create_ready_note(vault: &std::path::Path, path: &str, ready_at: u64, priority: f64) {
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
        let loaded = load_learning_document(vault, &state.note_id)
            .expect("load document")
            .expect("document exists");
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        document.revision += 1;
        document.effective_policy.priority_weight = priority;
        write_learning_document(vault, &state.note_id, Some(expected_revision), &document)
            .expect("persist priority");
    }

    #[test]
    fn due_notes_are_ordered_by_priority_then_oldest_deadline() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Baixa.md", now - 8 * DAY_MS, 1.0);
        create_ready_note(vault.path(), "Alta-recente.md", now - 3 * DAY_MS, 3.0);
        create_ready_note(vault.path(), "Alta-antiga.md", now - 5 * DAY_MS, 3.0);
        create_ready_note(vault.path(), "Futura.md", now, 10.0);

        let queue = list_due_reviews(vault.path(), now, |_| Ok(Some(MARKDOWN.to_string())))
            .expect("list queue");

        let paths: Vec<_> = queue
            .iter()
            .map(|item| item.relative_path.as_str())
            .collect();
        assert_eq!(paths, ["Alta-antiga.md", "Alta-recente.md", "Baixa.md"]);
        assert!(queue.iter().all(|item| item.is_first_review));
    }
    #[test]
    fn a_due_note_changed_on_disk_is_paused_and_excluded() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Atual.md", now - 4 * DAY_MS, 1.0);
        create_ready_note(vault.path(), "Alterada.md", now - 4 * DAY_MS, 2.0);
        let changed = "# Memoria\n\nO conteudo mudou depois da avaliacao.";

        let queue = list_due_reviews(vault.path(), now, |path| {
            Ok(Some(
                if path == "Alterada.md" {
                    changed
                } else {
                    MARKDOWN
                }
                .to_string(),
            ))
        })
        .expect("list queue");

        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].relative_path, "Atual.md");
        let state = load_note_review_state(vault.path(), "Alterada.md", changed, now)
            .expect("load changed state")
            .expect("state exists");
        assert_eq!(state.readiness, NoteReadinessStatus::Modified);
        assert!(state.next_review_at_unix_ms.is_none());
    }
}
