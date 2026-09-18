use super::contract::{LearningDocument, ReadinessAssessment, ReviewMode};
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
    pub deadline_at_unix_ms: Option<u64>,
    pub preferred_mode: PreferredReviewMode,
    pub is_first_review: bool,
}

pub const MAX_DUE_REVIEW_ITEMS: usize = 1_000;
/// Teto do tamanho da página da fila de vencimento (rolagem infinita).
pub const MAX_UPCOMING_PAGE_LIMIT: usize = 50;

/// Página da fila de vencimento: itens ordenados + total para a UI saber
/// quando parar de pedir mais.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingReviewQueue {
    pub items: Vec<DueReviewItem>,
    pub total: usize,
}

fn queue_item_from_document(document: LearningDocument, now_unix_ms: u64) -> DueReviewItem {
    let relative_path = document.note.relative_path;
    let title = Path::new(&relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(&relative_path)
        .to_string();
    DueReviewItem {
        note_id: document.note.id,
        relative_path,
        title,
        next_review_at_unix_ms: document
            .scheduling
            .next_review_at_unix_ms
            .expect("queue item has a date"),
        priority_weight: document.effective_policy.priority_weight,
        deadline_at_unix_ms: document
            .effective_policy
            .deadline_at_unix_ms
            .filter(|deadline| *deadline > now_unix_ms),
        preferred_mode: match document.note.enrollment.preferred_mode {
            ReviewMode::Exam => PreferredReviewMode::Exam,
            ReviewMode::Conversation => PreferredReviewMode::Conversation,
        },
        is_first_review: document.scheduling.last_review_at_unix_ms.is_none(),
    }
}

fn compare_active_deadline(left: Option<u64>, right: Option<u64>) -> std::cmp::Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

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

        queue.push(queue_item_from_document(document, now_unix_ms));
    }

    queue.sort_by(|left, right| {
        right
            .priority_weight
            .total_cmp(&left.priority_weight)
            .then_with(|| {
                compare_active_deadline(left.deadline_at_unix_ms, right.deadline_at_unix_ms)
            })
            .then_with(|| {
                left.next_review_at_unix_ms
                    .cmp(&right.next_review_at_unix_ms)
            })
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    queue.truncate(MAX_DUE_REVIEW_ITEMS);
    Ok(queue)
}

/// Fila de vencimento: notas agendadas para o futuro, da mais próxima à mais
/// distante. Paginada (`limit`/`offset`) para rolagem infinita — como o
/// histórico que carrega mais ao subir a conversa, cada página seguinte
/// estende a lista sem recarregar o que já está na tela. Notas vencidas
/// pertencem à fila principal e ficam de fora daqui.
pub fn list_upcoming_reviews<F>(
    vault_root: &Path,
    now_unix_ms: u64,
    limit: usize,
    offset: usize,
    mut read_markdown: F,
) -> Result<UpcomingReviewQueue>
where
    F: FnMut(&str) -> Result<Option<String>>,
{
    let limit = limit.clamp(1, MAX_UPCOMING_PAGE_LIMIT);
    let mut upcoming = Vec::new();
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let document = loaded.document;
        let enrolled = document.note.enrollment.is_enrolled();
        let next_review_at_unix_ms = document.scheduling.next_review_at_unix_ms;
        let Some(next) = next_review_at_unix_ms else {
            continue;
        };
        if !enrolled
            || !matches!(document.note.readiness, ReadinessAssessment::Ready { .. })
            || next <= now_unix_ms
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

        upcoming.push(queue_item_from_document(document, now_unix_ms));
    }

    upcoming.sort_by(|left, right| {
        left.next_review_at_unix_ms
            .cmp(&right.next_review_at_unix_ms)
            .then_with(|| right.priority_weight.total_cmp(&left.priority_weight))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    let total = upcoming.len();
    let items = upcoming.into_iter().skip(offset).take(limit).collect();
    Ok(UpcomingReviewQueue { items, total })
}
#[cfg(test)]
mod tests {
    use super::{list_due_reviews, list_upcoming_reviews};
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
    fn a_due_note_with_an_active_deadline_is_prioritized_after_priority() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Sem-prazo.md", now - 8 * DAY_MS, 3.0);
        create_ready_note(vault.path(), "Prazo-curto.md", now - 4 * DAY_MS, 1.0);
        create_ready_note(vault.path(), "Prazo-longo.md", now - 4 * DAY_MS, 1.0);

        let with_deadline = |relative_path: &str, deadline: u64| {
            let loaded = load_learning_document(
                vault.path(),
                &crate::review::state::note_id_for_path(relative_path),
            )
            .expect("load document")
            .expect("document exists");
            let expected_revision = loaded.document.revision;
            let mut document = loaded.document;
            document.revision += 1;
            document.effective_policy.deadline_at_unix_ms = Some(deadline);
            document.effective_policy.sources.deadline_at_unix_ms =
                Some(crate::review::contract::PolicySource {
                    kind: crate::review::contract::PolicySourceKind::ActiveDeadlineTag,
                    source_id: Some("prova".to_string()),
                });
            write_learning_document(
                vault.path(),
                &crate::review::state::note_id_for_path(relative_path),
                Some(expected_revision),
                &document,
            )
            .expect("persist deadline");
        };
        with_deadline("Prazo-curto.md", now + DAY_MS);
        with_deadline("Prazo-longo.md", now + 4 * DAY_MS);

        let queue = list_due_reviews(vault.path(), now, |_| Ok(Some(MARKDOWN.to_string())))
            .expect("list queue");

        let paths: Vec<_> = queue
            .iter()
            .map(|item| item.relative_path.as_str())
            .collect();
        // Prioridade vence; entre mesma prioridade, o prazo mais proximo vem antes.
        assert_eq!(paths, ["Sem-prazo.md", "Prazo-curto.md", "Prazo-longo.md"]);
        assert_eq!(
            queue
                .iter()
                .find(|item| item.relative_path == "Prazo-curto.md")
                .unwrap()
                .deadline_at_unix_ms,
            Some(now + DAY_MS)
        );
        assert_eq!(
            queue
                .iter()
                .find(|item| item.relative_path == "Sem-prazo.md")
                .unwrap()
                .deadline_at_unix_ms,
            None
        );
    }

    #[test]
    fn an_expired_deadline_does_not_claim_queue_urgency() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Prazo-encerrado.md", now - 6 * DAY_MS, 1.0);
        let loaded = load_learning_document(
            vault.path(),
            &crate::review::state::note_id_for_path("Prazo-encerrado.md"),
        )
        .expect("load document")
        .expect("document exists");
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        document.revision += 1;
        document.effective_policy.deadline_at_unix_ms = Some(now - DAY_MS);
        document.effective_policy.sources.deadline_at_unix_ms =
            Some(crate::review::contract::PolicySource {
                kind: crate::review::contract::PolicySourceKind::ExpiredDeadlineTag,
                source_id: Some("prova".to_string()),
            });
        document.effective_policy.sources.active_deadline = None;
        write_learning_document(
            vault.path(),
            &crate::review::state::note_id_for_path("Prazo-encerrado.md"),
            Some(expected_revision),
            &document,
        )
        .expect("persist expired deadline");

        let queue = list_due_reviews(vault.path(), now, |_| Ok(Some(MARKDOWN.to_string())))
            .expect("list queue");

        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].deadline_at_unix_ms, None);
    }

    #[test]
    fn upcoming_lists_future_reviews_nearest_first_with_pagination() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Primeira.md", now - 8 * DAY_MS, 1.0);
        create_ready_note(vault.path(), "Segunda.md", now - 3 * DAY_MS, 3.0);
        create_ready_note(vault.path(), "Terceira.md", now - 5 * DAY_MS, 2.0);

        // Mesma política: a ordem de vencimento acompanha a criação.
        let dates: Vec<u64> = ["Primeira.md", "Segunda.md", "Terceira.md"]
            .iter()
            .map(|path| {
                load_learning_document(vault.path(), &crate::review::state::note_id_for_path(path))
                    .expect("load document")
                    .expect("document exists")
                    .document
                    .scheduling
                    .next_review_at_unix_ms
                    .expect("scheduled")
            })
            .collect();
        assert!(dates[0] < dates[2]);
        assert!(dates[2] < dates[1]);
        let now = dates[0] - 1;

        let page =
            list_upcoming_reviews(vault.path(), now, 2, 0, |_| Ok(Some(MARKDOWN.to_string())))
                .expect("list upcoming");
        assert_eq!(page.total, 3);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].relative_path, "Primeira.md");
        assert_eq!(page.items[1].relative_path, "Terceira.md");

        let page =
            list_upcoming_reviews(vault.path(), now, 2, 2, |_| Ok(Some(MARKDOWN.to_string())))
                .expect("second page");
        assert_eq!(page.total, 3);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].relative_path, "Segunda.md");
    }

    #[test]
    fn upcoming_excludes_already_due_notes() {
        let vault = tempdir().expect("vault");
        let now = 1_730_000_000_000;
        create_ready_note(vault.path(), "Vencida.md", now - 8 * DAY_MS, 1.0);
        create_ready_note(vault.path(), "Futura.md", now - 3 * DAY_MS, 1.0);

        let vencida = load_learning_document(
            vault.path(),
            &crate::review::state::note_id_for_path("Vencida.md"),
        )
        .expect("load document")
        .expect("document exists")
        .document
        .scheduling
        .next_review_at_unix_ms
        .expect("scheduled");
        let futura = load_learning_document(
            vault.path(),
            &crate::review::state::note_id_for_path("Futura.md"),
        )
        .expect("load document")
        .expect("document exists")
        .document
        .scheduling
        .next_review_at_unix_ms
        .expect("scheduled");
        assert!(vencida < futura);
        // Entre as duas datas: a vencida pertence à fila principal.
        let page = list_upcoming_reviews(vault.path(), futura - 1, 10, 0, |_| {
            Ok(Some(MARKDOWN.to_string()))
        })
        .expect("list upcoming");
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].relative_path, "Futura.md");
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
