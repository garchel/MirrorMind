use crate::review::policy_config::{set_vault_review_tag_rules, VaultReviewPolicyConfigView};
use crate::review::tag_policy::TagReviewPolicyRule;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use unicode_normalization::char::is_combining_mark;

const MAX_TAG_MUTATION_NOTES: usize = 2_000;
const MAX_TAG_MUTATION_BYTES: u64 = 64 * 1024 * 1024;
static NEXT_TAG_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);
static TAG_MUTATION_ACCESS: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TagManagementChange {
    current_tag: Option<String>,
    next_tag: Option<String>,
    remove_from_notes: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagManagementPreview {
    affected_note_paths: Vec<String>,
    markdown_note_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagManagementResult {
    config: VaultReviewPolicyConfigView,
    affected_note_paths: Vec<String>,
    markdown_note_paths: Vec<String>,
}

#[derive(Debug)]
struct PlannedTagUpdate {
    path: PathBuf,
    original_content: Vec<u8>,
    updated_content: Vec<u8>,
}

#[derive(Debug)]
struct StagedTagUpdate {
    target_path: PathBuf,
    staged_path: PathBuf,
    backup_path: PathBuf,
    original_content: Vec<u8>,
    updated_content: Vec<u8>,
}

#[tauri::command]
pub(crate) async fn preview_tag_management_change(
    path: String,
    change: TagManagementChange,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<TagManagementPreview, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || preview_change_in_root(&root, &change))
        .await
        .map_err(|_| "Nao foi possivel calcular o impacto da alteracao da tag.".to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn apply_tag_management_change(
    path: String,
    expected_revision: u64,
    tag_rules: Vec<TagReviewPolicyRule>,
    change: TagManagementChange,
    expected_affected_note_paths: Vec<String>,
    authorized_paths: State<'_, crate::AuthorizedPaths>,
) -> Result<TagManagementResult, String> {
    let root =
        crate::canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        apply_change_in_root(
            &root,
            expected_revision,
            tag_rules,
            &change,
            &expected_affected_note_paths,
        )
    })
    .await
    .map_err(|_| "Nao foi possivel aplicar a alteracao da tag.".to_string())?
    .map_err(|error| error.to_string())
}

fn normalize_change(change: &TagManagementChange) -> Result<(Option<String>, Option<String>)> {
    let current = change.current_tag.as_deref().and_then(crate::normalize_tag);
    let next = change.next_tag.as_deref().and_then(crate::normalize_tag);
    if change.current_tag.is_some() && current.is_none() {
        bail!("A tag atual e invalida.");
    }
    if change.next_tag.is_some() && next.is_none() {
        bail!("A nova tag e invalida.");
    }
    if current.is_none() && next.is_none() {
        bail!("A alteracao precisa informar uma tag.");
    }
    Ok((current, next))
}

fn preview_change_in_root(
    root: &Path,
    change: &TagManagementChange,
) -> Result<TagManagementPreview> {
    let (current, next) = normalize_change(change)?;
    let index = crate::get_tag_index_in_root(root)?;
    let mut affected = BTreeSet::new();
    for summary in index {
        if current.as_ref().is_some_and(|tag| tag == &summary.tag)
            || next.as_ref().is_some_and(|tag| tag == &summary.tag)
        {
            affected.extend(summary.note_paths);
        }
    }
    if affected.len() > MAX_TAG_MUTATION_NOTES {
        bail!("A alteracao excede o limite seguro de notas por operacao.");
    }
    let markdown_note_paths =
        if should_rewrite_markdown(change, current.as_deref(), next.as_deref()) {
            affected.iter().cloned().collect()
        } else {
            Vec::new()
        };
    Ok(TagManagementPreview {
        affected_note_paths: affected.into_iter().collect(),
        markdown_note_paths,
    })
}

fn should_rewrite_markdown(
    change: &TagManagementChange,
    current: Option<&str>,
    next: Option<&str>,
) -> bool {
    current.is_some()
        && ((next.is_some() && current != next) || (next.is_none() && change.remove_from_notes))
}

fn validate_rule_transition(
    tag_rules: &[TagReviewPolicyRule],
    current: Option<&str>,
    next: Option<&str>,
) -> Result<()> {
    if let Some(next) = next {
        if !tag_rules.iter().any(|rule| rule.tag == next) {
            bail!("A configuracao final nao contem a nova tag.");
        }
    }
    if let Some(current) = current {
        if Some(current) != next && tag_rules.iter().any(|rule| rule.tag == current) {
            bail!("A configuracao final ainda contem a tag anterior.");
        }
    }
    Ok(())
}

fn apply_change_in_root(
    root: &Path,
    expected_revision: u64,
    tag_rules: Vec<TagReviewPolicyRule>,
    change: &TagManagementChange,
    expected_affected_note_paths: &[String],
) -> Result<TagManagementResult> {
    let _guard = TAG_MUTATION_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("As tags estao temporariamente indisponiveis."))?;
    let (current, next) = normalize_change(change)?;
    validate_rule_transition(&tag_rules, current.as_deref(), next.as_deref())?;
    let preview = preview_change_in_root(root, change)?;
    let mut expected = expected_affected_note_paths.to_vec();
    expected.sort();
    expected.dedup();
    if expected != preview.affected_note_paths {
        bail!("As notas associadas a esta tag mudaram. Revise o impacto antes de confirmar.");
    }

    let updates = if should_rewrite_markdown(change, current.as_deref(), next.as_deref()) {
        prepare_tag_updates(
            root,
            &preview.markdown_note_paths,
            current.as_deref().unwrap(),
            next.as_deref(),
        )?
    } else {
        Vec::new()
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| anyhow::anyhow!("O relogio do sistema e invalido."))?
        .as_millis()
        .try_into()
        .map_err(|_| anyhow::anyhow!("O relogio do sistema excedeu o limite suportado."))?;
    let config = commit_tag_updates(root, updates, || {
        set_vault_review_tag_rules(root, expected_revision, tag_rules, now)
    })?;
    Ok(TagManagementResult {
        config,
        affected_note_paths: preview.affected_note_paths,
        markdown_note_paths: preview.markdown_note_paths,
    })
}

fn prepare_tag_updates(
    root: &Path,
    note_paths: &[String],
    current: &str,
    next: Option<&str>,
) -> Result<Vec<PlannedTagUpdate>> {
    let mut total_bytes = 0_u64;
    let mut updates = Vec::new();
    for relative_path in note_paths {
        let path = crate::resolve_note_path(root, relative_path)?;
        verify_regular_note(root, &path)?;
        let original_content = fs::read(&path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", path.display()))?;
        total_bytes = total_bytes.saturating_add(original_content.len() as u64);
        if total_bytes > MAX_TAG_MUTATION_BYTES {
            bail!("A alteracao excede o limite seguro de dados por operacao.");
        }
        let markdown = std::str::from_utf8(&original_content).with_context(|| {
            format!(
                "A nota '{}' nao esta codificada como UTF-8.",
                path.display()
            )
        })?;
        let updated = rewrite_markdown_tag(markdown, current, next)?;
        if updated.as_bytes() != original_content {
            updates.push(PlannedTagUpdate {
                path,
                original_content,
                updated_content: updated.into_bytes(),
            });
        }
    }
    Ok(updates)
}

fn rewrite_markdown_tag(markdown: &str, current: &str, next: Option<&str>) -> Result<String> {
    let (prefix, frontmatter, closing, suffix) = split_frontmatter_ranges(markdown);
    let rewritten_frontmatter = match frontmatter {
        Some(frontmatter) => rewrite_frontmatter_tags(frontmatter, current, next)?,
        None => String::new(),
    };
    let body = match frontmatter {
        Some(_) => suffix,
        None => markdown,
    };
    let rewritten_body = rewrite_body_tags(body, current, next);
    if frontmatter.is_some() {
        Ok(format!(
            "{prefix}{rewritten_frontmatter}{closing}{rewritten_body}"
        ))
    } else {
        Ok(rewritten_body)
    }
}

fn split_frontmatter_ranges(markdown: &str) -> (&str, Option<&str>, &str, &str) {
    let bom_len = usize::from(markdown.starts_with('\u{feff}')) * '\u{feff}'.len_utf8();
    let source = &markdown[bom_len..];
    let (opening_len, newline) = if source.starts_with("---\r\n") {
        (5, "\r\n")
    } else if source.starts_with("---\n") {
        (4, "\n")
    } else {
        return ("", None, "", markdown);
    };
    let closing = format!("{newline}---");
    let Some(relative_end) = source[opening_len..].find(&closing) else {
        return ("", None, "", markdown);
    };
    let frontmatter_end = bom_len + opening_len + relative_end;
    let closing_end = frontmatter_end + closing.len();
    let suffix_start = if markdown[closing_end..].starts_with("\r\n") {
        closing_end + 2
    } else if markdown[closing_end..].starts_with('\n') {
        closing_end + 1
    } else {
        closing_end
    };
    (
        &markdown[..bom_len + opening_len],
        Some(&markdown[bom_len + opening_len..frontmatter_end]),
        &markdown[frontmatter_end..suffix_start],
        &markdown[suffix_start..],
    )
}

fn rewrite_frontmatter_tags(
    frontmatter: &str,
    current: &str,
    next: Option<&str>,
) -> Result<String> {
    let tags = crate::extract_frontmatter_tags(frontmatter);
    if !tags.iter().any(|tag| tag == current) {
        return Ok(frontmatter.to_string());
    }
    let mut next_tags = tags
        .into_iter()
        .filter(|tag| tag != current)
        .collect::<BTreeSet<_>>();
    if let Some(next) = next {
        next_tags.insert(next.to_string());
    }
    let newline = if frontmatter.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let Some((start, end)) = frontmatter_tags_property_range(frontmatter) else {
        bail!("A propriedade tags do frontmatter nao pode ser alterada com seguranca.");
    };
    let mut replacement = if next_tags.is_empty() {
        "tags: []".to_string()
    } else {
        format!(
            "tags:{newline}{}",
            next_tags
                .into_iter()
                .map(|tag| format!("  - {tag}"))
                .collect::<Vec<_>>()
                .join(newline)
        )
    };
    if end < frontmatter.len() {
        replacement.push_str(newline);
    }
    Ok(format!(
        "{}{}{}",
        &frontmatter[..start],
        replacement,
        &frontmatter[end..]
    ))
}

fn frontmatter_tags_property_range(frontmatter: &str) -> Option<(usize, usize)> {
    let mut offsets = Vec::new();
    let mut offset = 0;
    for line in frontmatter.split_inclusive('\n') {
        offsets.push((offset, line));
        offset += line.len();
    }
    if offset < frontmatter.len() {
        offsets.push((offset, &frontmatter[offset..]));
    }
    let (index, (start, _)) = offsets.iter().enumerate().find(|(_, (_, line))| {
        let line = line.trim_end_matches(['\r', '\n']);
        line.trim_start() == line && line.starts_with("tags:")
    })?;
    let end = offsets[index + 1..]
        .iter()
        .find(|(_, line)| {
            let line = line.trim_end_matches(['\r', '\n']);
            !line.is_empty() && line.trim_start() == line
        })
        .map(|(offset, _)| *offset)
        .unwrap_or(frontmatter.len());
    Some((*start, end))
}

fn rewrite_body_tags(body: &str, current: &str, next: Option<&str>) -> String {
    let mut result = String::with_capacity(body.len());
    let mut fence: Option<(u8, usize)> = None;
    let mut html_block: Option<(String, isize)> = None;
    let mut in_html_comment = false;
    let mut in_obsidian_comment = false;
    for line in body.split_inclusive('\n') {
        let (markdown_line, ending) = if let Some(line) = line.strip_suffix("\r\n") {
            (line, "\r\n")
        } else if let Some(line) = line.strip_suffix('\n') {
            (line, "\n")
        } else {
            (line, "")
        };
        let rewritten = if let Some((tag, depth)) = html_block.as_mut() {
            *depth += crate::markdown_html_tag_depth_delta(markdown_line, tag);
            if *depth <= 0 || markdown_line.trim().is_empty() {
                html_block = None;
            }
            markdown_line.to_string()
        } else if let Some((marker, minimum_length)) = fence {
            if crate::markdown_fence_closes(markdown_line, marker, minimum_length) {
                fence = None;
            }
            markdown_line.to_string()
        } else if let Some(marker) = crate::markdown_fence_marker(markdown_line) {
            fence = Some(marker);
            markdown_line.to_string()
        } else if markdown_line.starts_with("    ") || markdown_line.starts_with('\t') {
            markdown_line.to_string()
        } else if let Some(tag) = crate::markdown_html_block_tag(markdown_line) {
            let depth = crate::markdown_html_tag_depth_delta(markdown_line, &tag);
            if depth > 0 {
                html_block = Some((tag, depth));
            }
            markdown_line.to_string()
        } else {
            rewrite_tags_in_line(
                markdown_line,
                current,
                next,
                &mut in_html_comment,
                &mut in_obsidian_comment,
            )
        };
        result.push_str(&rewritten);
        result.push_str(ending);
    }
    result
}

fn rewrite_tags_in_line(
    line: &str,
    current: &str,
    next: Option<&str>,
    in_html_comment: &mut bool,
    in_obsidian_comment: &mut bool,
) -> String {
    let characters = line.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(line.len());
    let mut inline_code: Option<usize> = None;
    let mut index = 0;
    while index < characters.len() {
        if *in_html_comment {
            if characters[index..].starts_with(&['-', '-', '>']) {
                output.extend(['-', '-', '>']);
                *in_html_comment = false;
                index += 3;
            } else {
                output.push(characters[index]);
                index += 1;
            }
            continue;
        }
        if *in_obsidian_comment {
            if characters[index..].starts_with(&['%', '%']) {
                output.extend(['%', '%']);
                *in_obsidian_comment = false;
                index += 2;
            } else {
                output.push(characters[index]);
                index += 1;
            }
            continue;
        }
        if characters[index..].starts_with(&['<', '!', '-', '-']) {
            output.extend(['<', '!', '-', '-']);
            *in_html_comment = true;
            index += 4;
            continue;
        }
        if characters[index..].starts_with(&['%', '%']) {
            output.extend(['%', '%']);
            *in_obsidian_comment = true;
            index += 2;
            continue;
        }
        if characters[index] == '`' {
            let run_length = characters[index..]
                .iter()
                .take_while(|character| **character == '`')
                .count();
            match inline_code {
                Some(opening_length) if run_length == opening_length => inline_code = None,
                None => inline_code = Some(run_length),
                _ => {}
            }
            output.extend(&characters[index..index + run_length]);
            index += run_length;
            continue;
        }
        if inline_code.is_some() || characters[index] != '#' {
            output.push(characters[index]);
            index += 1;
            continue;
        }
        if index > 0 {
            let previous = characters[index - 1];
            if previous.is_alphanumeric()
                || is_combining_mark(previous)
                || matches!(previous, '_' | '#' | '/' | '\\')
            {
                output.push(characters[index]);
                index += 1;
                continue;
            }
        }
        let end = index
            + 1
            + characters[index + 1..]
                .iter()
                .take_while(|character| {
                    character.is_alphanumeric()
                        || is_combining_mark(**character)
                        || matches!(**character, '_' | '-' | '/')
                })
                .count();
        let raw = characters[index + 1..end].iter().collect::<String>();
        if crate::normalize_tag(&raw).as_deref() == Some(current) {
            if let Some(next) = next {
                output.push('#');
                output.push_str(next);
            }
        } else {
            output.extend(&characters[index..end]);
        }
        index = end.max(index + 1);
    }
    output
}

fn temporary_path(root: &Path, target: &Path, extension: &str) -> PathBuf {
    let id = NEXT_TAG_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    root.join(format!(".{name}.mirmind-tag-{id}.{extension}"))
}

fn verify_regular_note(root: &Path, path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Nao foi possivel verificar '{}'.", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!(
            "A nota '{}' nao e um arquivo regular seguro.",
            path.display()
        );
    }
    let canonical = path.canonicalize()?;
    if !canonical.starts_with(root) {
        bail!("A nota '{}' aponta para fora do Vault.", path.display());
    }
    Ok(())
}

fn abort_tag_updates(
    error: anyhow::Error,
    staged: &[StagedTagUpdate],
    committed: usize,
) -> anyhow::Error {
    let rollback = rollback_tag_updates(&staged[..committed]);
    cleanup_tag_updates(staged);
    match rollback {
        Ok(()) => error,
        Err(rollback_error) => anyhow::anyhow!("{error}. {rollback_error}"),
    }
}

fn commit_tag_updates<T, F>(root: &Path, updates: Vec<PlannedTagUpdate>, finalize: F) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    let mut staged = Vec::new();
    for update in updates {
        if let Err(error) = verify_regular_note(root, &update.path) {
            cleanup_tag_updates(&staged);
            return Err(error);
        }
        let current = match fs::read(&update.path) {
            Ok(current) => current,
            Err(error) => {
                cleanup_tag_updates(&staged);
                return Err(error.into());
            }
        };
        if current != update.original_content {
            cleanup_tag_updates(&staged);
            bail!("Uma nota foi alterada antes da confirmacao. Nenhum arquivo foi sobrescrito.");
        }
        let staged_path = temporary_path(root, &update.path, "tmp");
        let backup_path = temporary_path(root, &update.path, "bak");
        let stage_result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged_path)?;
            file.write_all(&update.updated_content)?;
            file.sync_all()?;
            fs::set_permissions(&staged_path, fs::metadata(&update.path)?.permissions())?;
            Ok(())
        })();
        if let Err(error) = stage_result {
            let _ = fs::remove_file(&staged_path);
            cleanup_tag_updates(&staged);
            return Err(error);
        }
        staged.push(StagedTagUpdate {
            target_path: update.path,
            staged_path,
            backup_path,
            original_content: update.original_content,
            updated_content: update.updated_content,
        });
    }

    for update in &staged {
        let current = match fs::read(&update.target_path) {
            Ok(current) => current,
            Err(error) => {
                cleanup_tag_updates(&staged);
                return Err(error.into());
            }
        };
        if current != update.original_content {
            cleanup_tag_updates(&staged);
            bail!("Uma nota foi alterada durante a preparacao. Nenhum arquivo foi sobrescrito.");
        }
    }

    let mut committed = 0;
    for update in &staged {
        if let Err(error) = verify_regular_note(root, &update.target_path) {
            return Err(abort_tag_updates(error, &staged, committed));
        }
        if let Err(error) = replace_with_backup(update) {
            return Err(abort_tag_updates(error, &staged, committed));
        }
        committed += 1;
    }

    let verification = staged.iter().try_for_each(|update| -> Result<()> {
        if fs::read(&update.target_path)? != update.updated_content
            || fs::read(&update.backup_path)? != update.original_content
        {
            bail!("Uma nota divergiu durante a substituicao.");
        }
        Ok(())
    });
    if let Err(error) = verification {
        return Err(abort_tag_updates(error, &staged, committed));
    }

    match finalize() {
        Ok(value) => {
            cleanup_tag_updates(&staged);
            Ok(value)
        }
        Err(error) => Err(abort_tag_updates(error, &staged, committed)),
    }
}
#[cfg(windows)]
fn replace_with_backup(update: &StagedTagUpdate) -> Result<()> {
    crate::replace_file_atomically(
        &update.target_path,
        &update.staged_path,
        Some(&update.backup_path),
    )
}

#[cfg(not(windows))]
fn replace_with_backup(update: &StagedTagUpdate) -> Result<()> {
    fs::hard_link(&update.target_path, &update.backup_path)?;
    fs::rename(&update.staged_path, &update.target_path)?;
    Ok(())
}

fn rollback_tag_updates(updates: &[StagedTagUpdate]) -> Result<()> {
    let mut failures = Vec::new();
    for update in updates.iter().rev() {
        if fs::read(&update.target_path).ok().as_deref() != Some(&update.updated_content) {
            failures.push(format!(
                "'{}' recebeu outra alteracao",
                update.target_path.display()
            ));
            continue;
        }
        if let Err(error) = fs::remove_file(&update.target_path)
            .and_then(|_| fs::rename(&update.backup_path, &update.target_path))
        {
            failures.push(format!("'{}': {error}", update.target_path.display()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        bail!("Rollback incompleto: {}", failures.join("; "))
    }
}

fn cleanup_tag_updates(updates: &[StagedTagUpdate]) {
    for update in updates {
        if update.staged_path.exists() {
            let _ = fs::remove_file(&update.staged_path);
        }
        if update.backup_path.exists() {
            let _ = fs::remove_file(&update.backup_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::policy_config::load_vault_review_policy_config;
    use tempfile::tempdir;

    fn balanced_rule(tag: &str) -> TagReviewPolicyRule {
        TagReviewPolicyRule {
            tag: tag.to_string(),
            auto_enroll: true,
            first_review_interval_days: 2,
            target_retention: 0.8,
            priority_weight: 2.0,
            min_interval_days: 1,
            max_interval_days: 365,
            deadline_at_unix_ms: None,
        }
    }

    #[test]
    fn preview_lists_notes_affected_by_policy_changes() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        fs::write(root.join("a.md"), "#prova").expect("note");
        fs::write(root.join("b.md"), "---\ntags: [prova]\n---\n").expect("note");
        let preview = preview_change_in_root(
            &root,
            &TagManagementChange {
                current_tag: Some("prova".into()),
                next_tag: Some("prova".into()),
                remove_from_notes: false,
            },
        )
        .expect("preview");
        assert_eq!(preview.affected_note_paths, vec!["a.md", "b.md"]);
        assert!(preview.markdown_note_paths.is_empty());
    }

    #[test]
    fn rewriting_a_tag_preserves_other_frontmatter_and_ignored_markdown_regions() {
        let markdown = "\u{feff}---\r\ntitle: Aula\r\ntags:\r\n  - Prova\r\n  - manter\r\n# manter comentario\r\naliases: [Teste]\r\n---\r\n#prova texto `#prova`\r\n<!-- #prova -->\r\n```\r\n#prova\r\n```\r\n";
        let rewritten =
            rewrite_markdown_tag(markdown, "prova", Some("revisao/prova")).expect("rewrite");
        assert!(rewritten.contains("title: Aula\r\n"));
        assert!(rewritten.contains("aliases: [Teste]\r\n"));
        assert!(rewritten.contains("tags:\r\n  - manter\r\n  - revisao/prova\r\n"));
        assert!(rewritten.contains("#revisao/prova texto `#prova`"));
        assert!(rewritten.contains("<!-- #prova -->"));
        assert!(rewritten.contains("```\r\n#prova\r\n```"));
    }

    #[test]
    fn apply_renames_tags_and_policy_in_one_operation() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        fs::write(root.join("a.md"), "#prova").expect("note");
        let current = load_vault_review_policy_config(&root).expect("config");
        let change = TagManagementChange {
            current_tag: Some("prova".into()),
            next_tag: Some("revisao/prova-final".into()),
            remove_from_notes: false,
        };
        let preview = preview_change_in_root(&root, &change).expect("preview");
        let mut rules = current.tag_rules;
        rules.push(balanced_rule("revisao/prova-final"));
        let result = apply_change_in_root(
            &root,
            current.revision,
            rules,
            &change,
            &preview.affected_note_paths,
        )
        .expect("apply");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read"),
            "#revisao/prova-final"
        );
        assert!(result
            .config
            .tag_rules
            .iter()
            .any(|rule| rule.tag == "revisao/prova-final"));
    }

    #[test]
    fn apply_rejects_stale_impact_without_touching_notes() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        fs::write(root.join("a.md"), "#prova").expect("note");
        let current = load_vault_review_policy_config(&root).expect("config");
        let change = TagManagementChange {
            current_tag: Some("prova".into()),
            next_tag: None,
            remove_from_notes: true,
        };
        let error = apply_change_in_root(&root, current.revision, current.tag_rules, &change, &[])
            .expect_err("stale preview");
        assert!(error.to_string().contains("mudaram"));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "#prova");
    }

    #[test]
    fn configuration_failure_rolls_back_markdown_changes() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        fs::write(root.join("a.md"), "#prova").expect("note");
        let current = load_vault_review_policy_config(&root).expect("config");
        let change = TagManagementChange {
            current_tag: Some("prova".into()),
            next_tag: Some("nova".into()),
            remove_from_notes: false,
        };
        let preview = preview_change_in_root(&root, &change).expect("preview");
        let error = apply_change_in_root(
            &root,
            current.revision + 1,
            vec![balanced_rule("nova")],
            &change,
            &preview.affected_note_paths,
        )
        .expect_err("revision conflict");
        assert!(error.to_string().contains("alterada por outra operacao"));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "#prova");
    }
}
