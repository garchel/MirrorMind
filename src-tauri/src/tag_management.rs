use crate::review::policy_config::{
    load_vault_review_policy_config, set_vault_review_tag_rules, validate_tag_rules,
    VaultReviewPolicyConfigView,
};
use crate::review::tag_policy::TagReviewPolicyRule;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
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
const TAG_TRANSACTION_SCHEMA_VERSION: u32 = 1;
const TAG_TRANSACTION_FILE: &str = ".tag-transaction.json";
const TAG_TRANSACTION_DIRECTORY_PREFIX: &str = "tag-transaction";
const MAX_TAG_TRANSACTION_BYTES: usize = 2 * 1024 * 1024;
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

/// Diario duravel gravado antes do primeiro commit da transacao de tags.
/// Registra os hashes dos originais e a configuracao-alvo para concluir ou
/// reverter a operacao na proxima abertura do Vault apos uma interrupcao
/// abrupta, seguindo o padrao da persistencia de aprendizado.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TagTransactionJournal {
    schema_version: u32,
    transaction_id: String,
    expected_config_revision: u64,
    tag_rules: Vec<TagReviewPolicyRule>,
    notes: Vec<TagTransactionNote>,
    created_at_unix_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TagTransactionNote {
    relative_path: String,
    original_hash: String,
    updated_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TagNoteRecoveryState {
    Original,
    Updated,
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
    tauri::async_runtime::spawn_blocking(move || {
        recover_pending_tag_operations(&root)?;
        preview_change_in_root(&root, &change)
    })
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
    recover_pending_tag_operations_unlocked(root)?;
    let (current, next) = normalize_change(change)?;
    validate_rule_transition(&tag_rules, current.as_deref(), next.as_deref())?;
    let mut rules = tag_rules;
    validate_tag_rules(&mut rules)?;
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
    let config = commit_tag_updates(root, updates, expected_revision, &rules, now, || {
        set_vault_review_tag_rules(root, expected_revision, rules.clone(), now)
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
    let Some((start, end)) = frontmatter_tags_property_range(frontmatter) else {
        bail!("A propriedade tags do frontmatter nao pode ser alterada com seguranca.");
    };
    let rewritten = rewrite_tags_property(&frontmatter[start..end], current, next)
        .context("A propriedade tags do frontmatter nao pode ser reescrita sem perda.")?;
    Ok(format!(
        "{}{}{}",
        &frontmatter[..start],
        rewritten,
        &frontmatter[end..]
    ))
}

fn line_without_ending(line: &str) -> &str {
    line.strip_suffix('\n')
        .unwrap_or(line)
        .strip_suffix('\r')
        .unwrap_or_else(|| line.strip_suffix('\n').unwrap_or(line))
}

/// Reescreve a propriedade `tags` do frontmatter por intervalos: renomeia ou
/// remove somente os escalares iguais a `current`, preservando comentarios,
/// aspas, recuo, ordem e as demais entradas. Estruturas que nao possam ser
/// reescritas sem perda (anchors, sequencias aninhadas, scalares literal ou
/// folded, flow multilinha) fazem a operacao ser rejeitada explicitamente.
fn rewrite_tags_property(property: &str, current: &str, next: Option<&str>) -> Result<String> {
    let newline = if property.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines = property.split_inclusive('\n').collect::<Vec<_>>();
    let first = lines.first().copied().unwrap_or(property);
    let first_text = line_without_ending(first);
    let after_key = first_text
        .strip_prefix("tags:")
        .context("A propriedade tags do frontmatter nao comeca com 'tags:'.")?;

    let mut found = 0;
    let mut unsupported = false;

    let inline = after_key.trim_start();
    if !inline.is_empty() && !inline.starts_with('#') {
        let rewritten_after_key =
            rewrite_inline_tags(after_key, current, next, &mut found, &mut unsupported)?;
        if unsupported || found == 0 {
            bail!("A propriedade tags do frontmatter nao pode ser reescrita sem perda.");
        }
        let mut result = match rewritten_after_key {
            Some(rewritten) => format!("tags:{rewritten}{}", ending_of(first, newline)),
            None => format!("tags: []{}", ending_of(first, newline)),
        };
        for line in &lines[1..] {
            result.push_str(line);
        }
        return Ok(result);
    }

    // Lista em bloco: a chave fica intacta e cada item e reescrito em seu
    // proprio intervalo.
    let mut result = String::new();
    result.push_str(first);
    let mut kept_items = 0;
    for line in &lines[1..] {
        let text = line_without_ending(line);
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            result.push_str(line);
            continue;
        }
        let leading = text.len() - text.trim_start().len();
        let after_dash = &text[leading..];
        let Some(rest) = after_dash.strip_prefix('-') else {
            // Linha de continuacao de um escalar multilinha: preservada.
            result.push_str(line);
            continue;
        };
        let item_offset = rest.len() - rest.trim_start().len();
        if item_offset == 0 {
            // `-texto` sem espaco nao e um item de lista YAML: preservado.
            result.push_str(line);
            continue;
        }
        let item_text = &rest[item_offset..];
        if item_text.trim_start().starts_with('-') {
            // Sequencia aninhada nao pode ser reescrita sem perda.
            unsupported = true;
            result.push_str(line);
            continue;
        }
        match simple_scalar_value_range(item_text) {
            Some((value_start, value_end)) => {
                let value = &item_text[value_start..value_end];
                if crate::normalize_tag(value).as_deref() == Some(current) {
                    found += 1;
                    if let Some(next) = next {
                        kept_items += 1;
                        result.push_str(&text[..leading]);
                        result.push('-');
                        result.push_str(&rest[..item_offset]);
                        result.push_str(&item_text[..value_start]);
                        result.push_str(next);
                        result.push_str(&item_text[value_end..]);
                        result.push_str(ending_of(line, newline));
                    }
                    // Remocao: a linha inteira (com seu comentario) sai.
                } else {
                    kept_items += 1;
                    result.push_str(line);
                }
            }
            None => {
                unsupported = true;
                result.push_str(line);
            }
        }
    }
    if unsupported || found == 0 {
        bail!("A propriedade tags do frontmatter nao pode ser reescrita sem perda.");
    }
    if kept_items == 0 {
        return Ok(format!("tags: []{}", ending_of(first, newline)));
    }
    Ok(result)
}

/// Final de linha da primeira linha, quando a propriedade termina com quebra.
fn ending_of<'a>(first: &str, newline: &'a str) -> &'a str {
    if first.ends_with('\n') {
        newline
    } else {
        ""
    }
}

/// Reescreve o texto depois de `tags:` (espacos, valor inline e comentario).
/// Devolve `None` quando a lista ficou vazia (todas as ocorrencias removidas).
fn rewrite_inline_tags(
    after_key: &str,
    current: &str,
    next: Option<&str>,
    found: &mut usize,
    unsupported: &mut bool,
) -> Result<Option<String>> {
    let leading = after_key.len() - after_key.trim_start().len();
    let body = &after_key[leading..];
    let comment_start = body
        .char_indices()
        .find(|(index, character)| {
            *character == '#' && (*index == 0 || body[..*index].ends_with(char::is_whitespace))
        })
        .map(|(index, _)| index);
    let (value_area, trailing) = match comment_start {
        Some(index) => {
            // Inclui o espaco antes do `#` no trecho preservado para nao
            // colar o comentario ao valor reescrito.
            let value_end = body[..index].trim_end().len();
            (&body[..value_end], &body[value_end..])
        }
        None => (body, ""),
    };
    let value_area = value_area.trim();
    let rewritten_value = if value_area.starts_with('[') {
        if !value_area.ends_with(']') {
            *unsupported = true;
            return Ok(None);
        }
        let inside = &value_area[1..value_area.len() - 1];
        let (new_inside, empty) = rewrite_comma_entries(inside, current, next, found, unsupported)?;
        if empty {
            return Ok(None);
        }
        format!("[{new_inside}]")
    } else {
        let (new_area, empty) =
            rewrite_comma_entries(value_area, current, next, found, unsupported)?;
        if empty {
            return Ok(None);
        }
        new_area
    };
    Ok(Some(format!(
        "{}{}{}",
        &after_key[..leading],
        rewritten_value,
        trailing
    )))
}

/// Reescreve uma lista de escalares separados por virgulas (flow ou plain
/// inline), renomeando ou removendo os iguais a `current` e unindo os demais
/// com o separador original. Devolve `true` quando a lista ficou vazia.
fn rewrite_comma_entries(
    entries: &str,
    current: &str,
    next: Option<&str>,
    found: &mut usize,
    unsupported: &mut bool,
) -> Result<(String, bool)> {
    let mut kept = Vec::new();
    let mut separator = ", ";
    let mut separated = false;
    let mut position = 0;
    while position < entries.len() {
        while position < entries.len()
            && entries[position..]
                .chars()
                .next()
                .is_some_and(char::is_whitespace)
        {
            position += 1;
        }
        if position >= entries.len() {
            break;
        }
        let entry_start = position;
        let first = entries[position..].chars().next().unwrap();
        if first == '"' || first == '\'' {
            let after_open = position + 1;
            let closing = entries[after_open..].find(first).ok_or_else(|| {
                anyhow::anyhow!("A lista de tags possui uma aspa sem fechamento.")
            })?;
            position = after_open + closing + 1;
        } else {
            while position < entries.len() {
                let character = entries[position..].chars().next().unwrap();
                if character == ',' {
                    break;
                }
                position += character.len_utf8();
            }
        }
        let entry_end = position;
        let entry_text = entries[entry_start..entry_end].trim();
        match simple_scalar_value_range(entry_text) {
            Some((value_start, value_end)) => {
                let value = &entry_text[value_start..value_end];
                if crate::normalize_tag(value).as_deref() == Some(current) {
                    *found += 1;
                    if let Some(next) = next {
                        kept.push(format!(
                            "{}{}{}",
                            &entry_text[..value_start],
                            next,
                            &entry_text[value_end..]
                        ));
                    }
                } else {
                    kept.push(entry_text.to_string());
                }
            }
            None => {
                *unsupported = true;
                kept.push(entry_text.to_string());
            }
        }
        if position < entries.len() {
            if entries[position..].starts_with(',') {
                if !separated {
                    separator = if entries[position + 1..].starts_with(char::is_whitespace) {
                        ", "
                    } else {
                        ","
                    };
                    separated = true;
                }
                position += 1;
            } else {
                *unsupported = true;
            }
        }
    }
    if kept.is_empty() {
        return Ok((String::new(), true));
    }
    Ok((kept.join(separator), false))
}

/// Intervalo do valor de um escalar YAML simples (plain ou entre aspas) dentro
/// de `raw`, devolvendo (inicio, fim) do valor sem as aspas. Devolve `None`
/// para estruturas que nao sao escalares simples (anchors, mapeamentos,
/// sequencias aninhadas, escalares literal ou folded).
fn simple_scalar_value_range(raw: &str) -> Option<(usize, usize)> {
    if raw.is_empty() {
        return Some((0, 0));
    }
    let first = raw.chars().next().unwrap();
    if first == '"' || first == '\'' {
        let closing = raw[1..].find(first)? + 1;
        let after = &raw[closing + 1..];
        if !after.trim().is_empty() && !after.trim_start().starts_with('#') {
            return None;
        }
        Some((1, closing))
    } else if matches!(first, '&' | '*' | '{' | '|' | '>') {
        None
    } else {
        let end = raw
            .char_indices()
            .find(|(_, character)| character.is_whitespace() || matches!(character, ',' | ']'))
            .map(|(index, _)| index)
            .unwrap_or(raw.len());
        if end == 0 {
            return None;
        }
        Some((0, end))
    }
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
    metadata_directory: &Path,
    transaction_directory: &Path,
) -> anyhow::Error {
    match rollback_tag_updates(&staged[..committed]) {
        Ok(()) => {
            // O diario so e removido quando o rollback conseguiu restaurar tudo;
            // caso contrario ele permanece para a recuperacao da proxima abertura.
            let _ = cleanup_tag_transaction_files(metadata_directory, transaction_directory);
            let _ = remove_tag_transaction_journal(metadata_directory);
            error
        }
        Err(rollback_error) => anyhow::anyhow!("{error}. {rollback_error}"),
    }
}

fn commit_tag_updates<T, F>(
    root: &Path,
    updates: Vec<PlannedTagUpdate>,
    expected_config_revision: u64,
    tag_rules: &[TagReviewPolicyRule],
    now_unix_ms: u64,
    finalize: F,
) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    if updates.is_empty() {
        return finalize();
    }
    let metadata_directory = tag_metadata_directory(root)?;
    let transaction_id = unique_tag_suffix();
    let transaction_directory = tag_transaction_directory(&metadata_directory, &transaction_id);
    fs::create_dir(&transaction_directory)
        .context("Nao foi possivel criar o diretorio da transacao de tags.")?;
    sync_tag_directory(&metadata_directory)?;

    let mut staged = Vec::new();
    for update in updates {
        if let Err(error) = verify_regular_note(root, &update.path) {
            let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
            return Err(error);
        }
        let current = match fs::read(&update.path) {
            Ok(current) => current,
            Err(error) => {
                let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
                return Err(error.into());
            }
        };
        if current != update.original_content {
            let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
            bail!("Uma nota foi alterada antes da confirmacao. Nenhum arquivo foi sobrescrito.");
        }
        let index = staged.len();
        let staged_path = transaction_directory.join(format!("stage-{index}.tmp"));
        let backup_path = transaction_directory.join(format!("backup-{index}.bak"));
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
            let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
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
                let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
                return Err(error.into());
            }
        };
        if current != update.original_content {
            let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
            bail!("Uma nota foi alterada durante a preparacao. Nenhum arquivo foi sobrescrito.");
        }
    }

    // Diario duravel gravado antes do primeiro commit: registra os hashes dos
    // originais e a configuracao-alvo, permitindo concluir ou reverter a
    // operacao na proxima abertura do Vault apos uma interrupcao abrupta.
    if let Err(error) = write_tag_transaction_journal(
        root,
        &metadata_directory,
        &transaction_id,
        expected_config_revision,
        tag_rules,
        &staged,
        now_unix_ms,
    ) {
        let _ = cleanup_tag_transaction_files(&metadata_directory, &transaction_directory);
        return Err(error);
    }

    let mut committed = 0;
    for update in &staged {
        if let Err(error) = verify_regular_note(root, &update.target_path) {
            return Err(abort_tag_updates(
                error,
                &staged,
                committed,
                &metadata_directory,
                &transaction_directory,
            ));
        }
        if let Err(error) = replace_with_backup(
            &update.target_path,
            &update.staged_path,
            &update.backup_path,
        ) {
            return Err(abort_tag_updates(
                error,
                &staged,
                committed,
                &metadata_directory,
                &transaction_directory,
            ));
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
        return Err(abort_tag_updates(
            error,
            &staged,
            committed,
            &metadata_directory,
            &transaction_directory,
        ));
    }

    match finalize() {
        Ok(value) => {
            cleanup_tag_transaction_files(&metadata_directory, &transaction_directory)?;
            remove_tag_transaction_journal(&metadata_directory)?;
            Ok(value)
        }
        Err(error) => Err(abort_tag_updates(
            error,
            &staged,
            committed,
            &metadata_directory,
            &transaction_directory,
        )),
    }
}
#[cfg(windows)]
fn replace_with_backup(target: &Path, staged: &Path, backup: &Path) -> Result<()> {
    crate::replace_file_atomically(target, staged, Some(backup))
}

#[cfg(not(windows))]
fn replace_with_backup(target: &Path, staged: &Path, backup: &Path) -> Result<()> {
    fs::hard_link(target, backup)?;
    fs::rename(staged, target)?;
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

fn cleanup_tag_transaction_files(
    metadata_directory: &Path,
    transaction_directory: &Path,
) -> Result<()> {
    if transaction_directory.exists() {
        fs::remove_dir_all(transaction_directory)?;
        sync_tag_directory(metadata_directory)?;
    }
    Ok(())
}

fn tag_metadata_directory(root: &Path) -> Result<PathBuf> {
    let directory = root.join(".mirmind");
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            bail!("O diretorio interno de configuracao e inseguro.");
        }
    } else {
        fs::create_dir(&directory)?;
    }
    Ok(directory)
}

fn tag_transaction_journal_path(directory: &Path) -> PathBuf {
    directory.join(TAG_TRANSACTION_FILE)
}

fn tag_transaction_directory(directory: &Path, transaction_id: &str) -> PathBuf {
    directory.join(format!(
        "{TAG_TRANSACTION_DIRECTORY_PREFIX}-{transaction_id}"
    ))
}

fn unique_tag_suffix() -> String {
    let id = NEXT_TAG_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{timestamp}-{id}", std::process::id())
}

fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

fn is_sha256_hash(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_bounded_bytes(path: &Path, maximum: usize) -> Result<Vec<u8>> {
    let bytes = fs::read(path)?;
    if bytes.len() > maximum {
        bail!(
            "O arquivo '{}' excede o limite seguro de leitura.",
            path.display()
        );
    }
    Ok(bytes)
}

fn ensure_regular_file_if_present(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            bail!(
                "O arquivo '{}' nao e um arquivo regular seguro.",
                path.display()
            );
        }
    }
    Ok(())
}

fn ensure_tag_transaction_directory(directory: &Path, metadata_directory: &Path) -> Result<()> {
    if !directory.exists() {
        bail!(
            "O diretorio da transacao de tags '{}' nao existe.",
            directory.display()
        );
    }
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        bail!("O diretorio da transacao de tags e inseguro.");
    }
    if !directory.starts_with(metadata_directory) {
        bail!("O diretorio da transacao de tags esta fora do diretorio interno.");
    }
    Ok(())
}

#[cfg(unix)]
fn sync_tag_directory(directory: &Path) -> Result<()> {
    fs::File::open(directory)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_tag_directory(_directory: &Path) -> Result<()> {
    Ok(())
}

fn write_tag_transaction_journal(
    root: &Path,
    metadata_directory: &Path,
    transaction_id: &str,
    expected_config_revision: u64,
    tag_rules: &[TagReviewPolicyRule],
    staged: &[StagedTagUpdate],
    now_unix_ms: u64,
) -> Result<()> {
    let journal_path = tag_transaction_journal_path(metadata_directory);
    ensure_regular_file_if_present(&journal_path)?;
    if journal_path.exists() {
        bail!("Existe uma transacao de tags pendente.");
    }
    let journal = TagTransactionJournal {
        schema_version: TAG_TRANSACTION_SCHEMA_VERSION,
        transaction_id: transaction_id.to_string(),
        expected_config_revision,
        tag_rules: tag_rules.to_vec(),
        notes: staged
            .iter()
            .map(|update| {
                let relative_path = crate::to_relative_display(root, &update.target_path);
                TagTransactionNote {
                    relative_path,
                    original_hash: content_hash(&update.original_content),
                    updated_hash: content_hash(&update.updated_content),
                }
            })
            .collect(),
        created_at_unix_ms: now_unix_ms,
    };
    let bytes = serde_json::to_vec_pretty(&journal)?;
    if bytes.len() > MAX_TAG_TRANSACTION_BYTES {
        bail!("A transacao de tags excede o limite seguro do diario.");
    }
    let stage = metadata_directory.join(format!(
        "{TAG_TRANSACTION_FILE}.stage-{}",
        unique_tag_suffix()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    let publish_result = (|| -> Result<()> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&stage, &journal_path)?;
        sync_tag_directory(metadata_directory)
    })();
    if publish_result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    publish_result.context("Nao foi possivel registrar a transacao de tags.")
}

fn remove_tag_transaction_journal(metadata_directory: &Path) -> Result<()> {
    let journal_path = tag_transaction_journal_path(metadata_directory);
    if journal_path.exists() {
        fs::remove_file(&journal_path)?;
        sync_tag_directory(metadata_directory)?;
    }
    Ok(())
}

fn validate_tag_transaction_journal(journal: &TagTransactionJournal) -> Result<()> {
    if journal.schema_version != TAG_TRANSACTION_SCHEMA_VERSION {
        bail!("O diario da transacao de tags possui versao incompativel.");
    }
    if journal.notes.is_empty() || journal.notes.len() > MAX_TAG_MUTATION_NOTES {
        bail!("O diario da transacao de tags possui um numero invalido de notas.");
    }
    let mut seen = HashSet::new();
    for note in &journal.notes {
        if note.relative_path.trim().is_empty()
            || !note.relative_path.ends_with(".md")
            || !seen.insert(note.relative_path.clone())
        {
            bail!("O diario da transacao de tags possui um caminho de nota invalido.");
        }
        if !is_sha256_hash(&note.original_hash) || !is_sha256_hash(&note.updated_hash) {
            bail!("O diario da transacao de tags possui hashes invalidos.");
        }
        if note.original_hash == note.updated_hash {
            bail!("O diario da transacao de tags registra uma alteracao vazia.");
        }
    }
    Ok(())
}

fn tag_transaction_config_published(root: &Path, journal: &TagTransactionJournal) -> Result<bool> {
    let current = load_vault_review_policy_config(root)?;
    if current.revision != journal.expected_config_revision.saturating_add(1) {
        return Ok(false);
    }
    let journal_rules = serde_json::to_vec(&journal.tag_rules)?;
    let current_rules = serde_json::to_vec(&current.tag_rules)?;
    Ok(journal_rules == current_rules)
}

pub(crate) fn recover_pending_tag_operations(root: &Path) -> Result<()> {
    let _guard = TAG_MUTATION_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("As tags estao temporariamente indisponiveis."))?;
    recover_pending_tag_operations_unlocked(root)
}

fn recover_pending_tag_operations_unlocked(root: &Path) -> Result<()> {
    let metadata_directory = tag_metadata_directory(root)?;
    let journal_path = tag_transaction_journal_path(&metadata_directory);
    if !journal_path.exists() {
        return Ok(());
    }
    ensure_regular_file_if_present(&journal_path)?;
    let bytes = read_bounded_bytes(&journal_path, MAX_TAG_TRANSACTION_BYTES)?;
    let journal: TagTransactionJournal =
        serde_json::from_slice(&bytes).context("O diario da transacao de tags e invalido.")?;
    validate_tag_transaction_journal(&journal)?;
    let transaction_directory =
        tag_transaction_directory(&metadata_directory, &journal.transaction_id);
    ensure_tag_transaction_directory(&transaction_directory, &metadata_directory)?;

    let mut states = Vec::with_capacity(journal.notes.len());
    for note in &journal.notes {
        let path = crate::resolve_note_path(root, &note.relative_path)?;
        verify_regular_note(root, &path)?;
        let bytes = fs::read(&path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", path.display()))?;
        let hash = content_hash(&bytes);
        if hash == note.original_hash {
            states.push(TagNoteRecoveryState::Original);
        } else if hash == note.updated_hash {
            states.push(TagNoteRecoveryState::Updated);
        } else {
            bail!(
                "A nota '{}' foi alterada durante a interrupcao da transacao de tags. Resolva a divergencia antes de continuar.",
                note.relative_path
            );
        }
    }

    if tag_transaction_config_published(root, &journal)? {
        complete_tag_transaction(root, &journal, &transaction_directory, &states)?;
    } else {
        rollback_tag_transaction(root, &journal, &transaction_directory, &states)?;
    }

    cleanup_tag_transaction_files(&metadata_directory, &transaction_directory)?;
    remove_tag_transaction_journal(&metadata_directory)?;
    Ok(())
}

fn complete_tag_transaction(
    root: &Path,
    journal: &TagTransactionJournal,
    transaction_directory: &Path,
    states: &[TagNoteRecoveryState],
) -> Result<()> {
    for (index, (note, state)) in journal.notes.iter().zip(states).enumerate() {
        if *state == TagNoteRecoveryState::Updated {
            continue;
        }
        // Uma nota ainda original com a configuracao publicada converge para o
        // estado confirmado, aplicando o arquivo preparado da transacao.
        let target = crate::resolve_note_path(root, &note.relative_path)?;
        verify_regular_note(root, &target)?;
        let staged = transaction_directory.join(format!("stage-{index}.tmp"));
        let backup = transaction_directory.join(format!("backup-{index}.bak"));
        if !staged.is_file() {
            bail!(
                "O arquivo preparado '{}' da transacao de tags nao existe.",
                staged.display()
            );
        }
        if backup.exists() {
            let backup_bytes = fs::read(&backup)?;
            if content_hash(&backup_bytes) != note.original_hash {
                bail!("O backup '{}' divergiu do original.", backup.display());
            }
            fs::remove_file(&backup)?;
        }
        replace_with_backup(&target, &staged, &backup)?;
    }
    Ok(())
}

fn rollback_tag_transaction(
    root: &Path,
    journal: &TagTransactionJournal,
    transaction_directory: &Path,
    states: &[TagNoteRecoveryState],
) -> Result<()> {
    for (index, (note, state)) in journal.notes.iter().zip(states).enumerate().rev() {
        let target = crate::resolve_note_path(root, &note.relative_path)?;
        let backup = transaction_directory.join(format!("backup-{index}.bak"));
        match state {
            TagNoteRecoveryState::Updated => {
                if !backup.is_file() {
                    bail!(
                        "O backup '{}' da nota '{}' nao existe.",
                        backup.display(),
                        note.relative_path
                    );
                }
                let backup_bytes = fs::read(&backup)?;
                if content_hash(&backup_bytes) != note.original_hash {
                    bail!("O backup '{}' divergiu do original.", backup.display());
                }
                verify_regular_note(root, &target)?;
                fs::remove_file(&target)?;
                fs::rename(&backup, &target)?;
            }
            TagNoteRecoveryState::Original => {
                // Interrupcao entre o hard link do backup e a substituicao deixa
                // um backup orfao com o conteudo original: apenas remove.
                if backup.exists() {
                    let backup_bytes = fs::read(&backup)?;
                    if content_hash(&backup_bytes) != note.original_hash {
                        bail!("O backup '{}' divergiu do original.", backup.display());
                    }
                    fs::remove_file(&backup)?;
                }
            }
        }
    }
    Ok(())
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
            preferred_mode: None,
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
        // A ordem e a grafia originais sao preservadas: somente o escalar
        // `Prova` foi renomeado, `manter` ficou intacto.
        assert!(rewritten.contains("tags:\r\n  - revisao/prova\r\n  - manter\r\n"));
        assert!(rewritten.contains("#revisao/prova texto `#prova`"));
        assert!(rewritten.contains("<!-- #prova -->"));
        assert!(rewritten.contains("```\r\n#prova\r\n```"));
    }

    #[test]
    fn rewriting_tags_preserves_comments_quotes_and_formatting() {
        let frontmatter =
            "title: Aula\r\ntags:\r\n  - \"Prova\"  # principal\r\n  - 'manter'\r\n  - estudo\r\naliases: [T]\r\n";
        let rewritten =
            rewrite_frontmatter_tags(frontmatter, "prova", Some("revisao/prova")).expect("rewrite");
        assert_eq!(
            rewritten,
            "title: Aula\r\ntags:\r\n  - \"revisao/prova\"  # principal\r\n  - 'manter'\r\n  - estudo\r\naliases: [T]\r\n"
        );
    }

    #[test]
    fn rewriting_inline_tags_preserves_comments_and_flow_style() {
        let rewritten = rewrite_frontmatter_tags(
            "tags: prova # principal\r\n",
            "prova",
            Some("revisao/prova"),
        )
        .expect("rewrite");
        assert_eq!(rewritten, "tags: revisao/prova # principal\r\n");
        let rewritten = rewrite_frontmatter_tags(
            "tags: [prova, \"manter\", 'estudo']\r\n",
            "prova",
            Some("revisao/prova"),
        )
        .expect("rewrite");
        assert_eq!(rewritten, "tags: [revisao/prova, \"manter\", 'estudo']\r\n");
        let rewritten =
            rewrite_frontmatter_tags("tags: prova, manter\r\n", "prova", Some("revisao/prova"))
                .expect("rewrite");
        assert_eq!(rewritten, "tags: revisao/prova, manter\r\n");
        let rewritten = rewrite_frontmatter_tags(
            "tags: [prova, manter] # lista\r\n",
            "prova",
            Some("revisao/prova"),
        )
        .expect("rewrite");
        assert_eq!(rewritten, "tags: [revisao/prova, manter] # lista\r\n");
    }

    #[test]
    fn removing_tags_keeps_other_entries_and_their_comments() {
        let rewritten = rewrite_frontmatter_tags(
            "tags:\n  - prova\n  - manter  # manutencao\n",
            "prova",
            None,
        )
        .expect("rewrite");
        assert_eq!(rewritten, "tags:\n  - manter  # manutencao\n");
        let rewritten =
            rewrite_frontmatter_tags("tags: [prova, manter]\n", "prova", None).expect("rewrite");
        assert_eq!(rewritten, "tags: [manter]\n");
        let rewritten =
            rewrite_frontmatter_tags("tags: [prova]\n", "prova", None).expect("rewrite");
        assert_eq!(rewritten, "tags: []\n");
        let rewritten =
            rewrite_frontmatter_tags("tags:\n  - prova\n", "prova", None).expect("rewrite");
        assert_eq!(rewritten, "tags: []\n");
    }

    #[test]
    fn rewriting_tags_rejects_structures_that_cannot_be_rewritten_without_loss() {
        let error = rewrite_frontmatter_tags(
            "tags:\n  - prova\n  - - aninhada\n",
            "prova",
            Some("revisao/prova"),
        )
        .expect_err("nested sequence");
        assert!(error.to_string().contains("sem perda"));
        // Um unico escalar entre aspas com virgula interna nao permite
        // reescrever as tags individuais sem perda.
        let error = rewrite_frontmatter_tags(
            "tags: \"prova, manter\"\n",
            "manter",
            Some("revisao/manter"),
        )
        .expect_err("quoted comma scalar");
        assert!(error.to_string().contains("sem perda"));
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
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
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
        // O diario e o diretorio da transacao nao sobram apos o rollback.
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
        let internal = root.join(".mirmind");
        let leftovers = fs::read_dir(&internal)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(TAG_TRANSACTION_DIRECTORY_PREFIX)
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    fn simulate_interrupted_tag_transaction(
        root: &Path,
        entries: &[(&str, &str, &str)],
        disk_state: &[(&str, &str)],
        expected_config_revision: u64,
        tag_rules: Vec<TagReviewPolicyRule>,
        published: bool,
    ) {
        for (relative, content) in disk_state {
            fs::write(root.join(relative), content).expect("disk state note");
        }
        let metadata = tag_metadata_directory(root).expect("metadata dir");
        let transaction_id = unique_tag_suffix();
        let transaction_directory = tag_transaction_directory(&metadata, &transaction_id);
        fs::create_dir(&transaction_directory).expect("transaction dir");
        let mut staged = Vec::new();
        for (index, (relative, original, updated)) in entries.iter().enumerate() {
            let target = root.join(relative);
            let staged_path = transaction_directory.join(format!("stage-{index}.tmp"));
            let backup_path = transaction_directory.join(format!("backup-{index}.bak"));
            fs::write(&staged_path, updated).expect("staged note");
            fs::write(&backup_path, original).expect("backup note");
            staged.push(StagedTagUpdate {
                target_path: target,
                staged_path,
                backup_path,
                original_content: original.as_bytes().to_vec(),
                updated_content: updated.as_bytes().to_vec(),
            });
        }
        write_tag_transaction_journal(
            root,
            &metadata,
            &transaction_id,
            expected_config_revision,
            &tag_rules,
            &staged,
            1_730_000_000_000,
        )
        .expect("journal");
        if published {
            set_vault_review_tag_rules(
                root,
                expected_config_revision,
                tag_rules,
                1_730_000_000_000,
            )
            .expect("publish config");
        }
    }

    #[test]
    fn interrupted_tag_transaction_with_no_committed_note_is_cleaned_up_on_next_open() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        simulate_interrupted_tag_transaction(
            &root,
            &[("a.md", "#prova", "#revisao/prova")],
            &[("a.md", "#prova")],
            0,
            vec![balanced_rule("revisao/prova")],
            false,
        );
        recover_pending_tag_operations(&root).expect("recover");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "#prova");
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
        // O backup orfao (interrupcao entre hard link e substituicao) e removido.
        let internal = root.join(".mirmind");
        let leftovers = fs::read_dir(&internal)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(TAG_TRANSACTION_DIRECTORY_PREFIX)
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn interrupted_tag_transaction_is_rolled_back_on_next_open() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        simulate_interrupted_tag_transaction(
            &root,
            &[
                ("a.md", "#prova", "#revisao/prova"),
                ("b.md", "#prova\n", "#revisao/prova\n"),
            ],
            &[("a.md", "#revisao/prova"), ("b.md", "#prova\n")],
            0,
            vec![balanced_rule("revisao/prova")],
            false,
        );
        recover_pending_tag_operations(&root).expect("recover");
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "#prova");
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "#prova\n");
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
    }

    #[test]
    fn interrupted_tag_transaction_after_config_publish_is_completed_on_next_open() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        simulate_interrupted_tag_transaction(
            &root,
            &[("a.md", "#prova", "#revisao/prova")],
            &[("a.md", "#revisao/prova")],
            0,
            vec![balanced_rule("revisao/prova")],
            true,
        );
        recover_pending_tag_operations(&root).expect("recover");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).unwrap(),
            "#revisao/prova"
        );
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
    }

    #[test]
    fn interrupted_tag_transaction_with_config_published_converges_remaining_notes() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        simulate_interrupted_tag_transaction(
            &root,
            &[
                ("a.md", "#prova", "#revisao/prova"),
                ("b.md", "#prova\n", "#revisao/prova\n"),
            ],
            &[("a.md", "#revisao/prova"), ("b.md", "#prova\n")],
            0,
            vec![balanced_rule("revisao/prova")],
            true,
        );
        recover_pending_tag_operations(&root).expect("recover");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).unwrap(),
            "#revisao/prova"
        );
        assert_eq!(
            fs::read_to_string(root.join("b.md")).unwrap(),
            "#revisao/prova\n"
        );
        assert!(!tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
    }

    #[test]
    fn interrupted_tag_transaction_with_conflicting_edit_fails_without_changes() {
        let vault = tempdir().expect("vault");
        let root = vault.path().canonicalize().expect("canonical vault");
        simulate_interrupted_tag_transaction(
            &root,
            &[("a.md", "#prova", "#revisao/prova")],
            &[("a.md", "#conflito-externo")],
            0,
            vec![balanced_rule("revisao/prova")],
            false,
        );
        let error = recover_pending_tag_operations(&root).expect_err("conflict");
        assert!(error.to_string().contains("alterada durante a interrupcao"));
        assert_eq!(
            fs::read_to_string(root.join("a.md")).unwrap(),
            "#conflito-externo"
        );
        // O diario permanece para nova tentativa apos resolver a divergencia.
        assert!(tag_transaction_journal_path(&tag_metadata_directory(&root).unwrap()).exists());
    }
}
