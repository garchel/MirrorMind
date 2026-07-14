use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
  collections::{HashMap, HashSet},
  fs,
  path::{Path, PathBuf},
  sync::Mutex,
  time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const METADATA_DIR: &str = ".mirmind";
const CONFIG_FILE: &str = "config.json";
const ASSESSMENTS_DIR: &str = "assessments";
const SESSIONS_DIR: &str = "sessions";
const REVIEW_PLANS_DIR: &str = "review-plans";
const NOTE_PREVIEW_LIMIT: usize = 8;
const RECENT_VAULT_FILE: &str = "recent-vault.json";
const HISTORY_FILE: &str = "history.json";
const HISTORY_LIMIT: usize = 100;
const TRASH_DIR: &str = "trash";
const TRASH_FILE: &str = "trash.json";
const TRASH_RETENTION_DAYS: u64 = 30;
const ATTACHMENTS_DIR: &str = "attachments";
const TEMPLATES_FILE: &str = "templates.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HistoryCommand {
  CreateNote { relative_path: String, content: String },
  SaveNote { relative_path: String, before_content: String, after_content: String },
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryState {
  undo: Vec<HistoryCommand>,
  redo: Vec<HistoryCommand>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryStatus {
  can_undo: bool,
  can_redo: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashEntry {
  id: String,
  original_relative_path: String,
  trashed_name: String,
  item_type: String,
  #[serde(default = "today_day")]
  deleted_at_day: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
  name: String,
  relative_path: String,
  is_image: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentVaultPreference {
  last_vault_path: Option<String>,
  ask_before_reopen: bool,
}

impl Default for RecentVaultPreference {
  fn default() -> Self {
    Self {
      last_vault_path: None,
      ask_before_reopen: true,
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultSummary {
  name: String,
  path: String,
  note_count: usize,
  note_previews: Vec<NotePreview>,
  is_obsidian_vault: bool,
  metadata: VaultMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotePreview {
  name: String,
  relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDocument {
  name: String,
  relative_path: String,
  content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Backlink {
  name: String,
  relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokenLink {
  target: String,
  source_name: String,
  source_relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagSummary {
  tag: String,
  note_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchResult { name: String, relative_path: String, excerpt: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteTemplate { id: String, name: String, content: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewPlan { relative_path: String, interval_days: u32, repetitions: u32, due_day: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultMetadata {
  is_initialized: bool,
  root_path: String,
  missing: Vec<String>,
}

#[tauri::command]
fn select_existing_vault(
  app: AppHandle,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<Option<VaultSummary>, String> {
  let selected = app.dialog().file().set_title("Abrir vault existente").blocking_pick_folder();
  let Some(selected) = selected else {
    return Ok(None);
  };
  let Some(selected_path) = selected.as_path() else {
    return Err("O seletor retornou um caminho nao suportado nesta plataforma.".to_string());
  };

  let canonical_root = canonicalize_directory(selected_path).map_err(|error| error.to_string())?;
  authorized_paths
    .authorize_vault_root(&canonical_root)
    .map_err(|error| error.to_string())?;

  let vault = inspect_vault_path(&canonical_root).map_err(|error| error.to_string())?;
  let _ = persist_recent_vault(&app, &canonical_root);
  Ok(Some(vault))
}

#[tauri::command]
fn get_recent_vault_preference(app: AppHandle) -> Result<RecentVaultPreference, String> {
  read_recent_vault_preference(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn reopen_recent_vault(
  app: AppHandle,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<Option<VaultSummary>, String> {
  let preference = read_recent_vault_preference(&app).map_err(|error| error.to_string())?;
  let Some(path) = preference.last_vault_path else {
    return Ok(None);
  };

  let root = match canonicalize_directory(Path::new(&path)) {
    Ok(root) => root,
    Err(_) => {
      let _ = write_recent_vault_preference(
        &app,
        &RecentVaultPreference {
          last_vault_path: None,
          ..preference
        },
      );
      return Ok(None);
    }
  };

  authorized_paths
    .authorize_vault_root(&root)
    .map_err(|error| error.to_string())?;
  inspect_vault_path(&root).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_recent_vault_prompt_preference(app: AppHandle, ask_before_reopen: bool) -> Result<(), String> {
  let mut preference = read_recent_vault_preference(&app).map_err(|error| error.to_string())?;
  preference.ask_before_reopen = ask_before_reopen;
  write_recent_vault_preference(&app, &preference).map_err(|error| error.to_string())
}

#[tauri::command]
fn select_vault_parent(
  app: AppHandle,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<Option<String>, String> {
  let selected = app
    .dialog()
    .file()
    .set_title("Escolher pasta pai do novo vault")
    .blocking_pick_folder();
  let Some(selected) = selected else {
    return Ok(None);
  };
  let Some(selected_path) = selected.as_path() else {
    return Err("O seletor retornou um caminho nao suportado nesta plataforma.".to_string());
  };

  let canonical_parent =
    canonicalize_directory(selected_path).map_err(|error| error.to_string())?;
  authorized_paths
    .authorize_parent_directory(&canonical_parent)
    .map_err(|error| error.to_string())?;

  Ok(Some(canonical_parent.display().to_string()))
}

#[tauri::command]
fn initialize_vault_metadata(
  path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<VaultSummary, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  ensure_metadata_layout(&root).map_err(|error| error.to_string())?;
  inspect_vault_path(&root).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_notes(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<NotePreview>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  collect_markdown_files(&root)
    .map(|paths| build_note_previews(&root, &paths))
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_templates(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<NoteTemplate>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  read_templates(&root).map_err(|error| error.to_string())
}

fn read_templates(root: &Path) -> Result<Vec<NoteTemplate>> {
  ensure_metadata_layout(root)?;
  Ok(serde_json::from_str(&fs::read_to_string(root.join(METADATA_DIR).join(TEMPLATES_FILE))?).unwrap_or_default())
}

fn review_plan_path(root: &Path, relative_path: &str) -> PathBuf { root.join(METADATA_DIR).join(REVIEW_PLANS_DIR).join(format!("{}.json", relative_path.replace(['/', '\\', '.'], "_"))) }
fn today_day() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() / 86_400 }

#[tauri::command]
fn review_note(path: String, relative_path: String, quality: u8, authorized_paths: State<AuthorizedPaths>) -> Result<ReviewPlan, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  let note = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
  if !note.exists() { return Err("A nota nao existe mais.".to_string()); }
  ensure_metadata_layout(&root).map_err(|error| error.to_string())?;
  let plan_path = review_plan_path(&root, &relative_path);
  let old: ReviewPlan = fs::read_to_string(&plan_path).ok().and_then(|data| serde_json::from_str(&data).ok()).unwrap_or(ReviewPlan { relative_path: relative_path.clone(), interval_days: 1, repetitions: 0, due_day: today_day() });
  let interval_days = if quality <= 1 { 1 } else if quality == 2 { old.interval_days.max(1) * 2 } else { old.interval_days.max(1) * 3 };
  let plan = ReviewPlan { relative_path, interval_days, repetitions: old.repetitions + 1, due_day: today_day() + interval_days as u64 };
  let serialized = serde_json::to_string_pretty(&plan).map_err(|error| error.to_string())?;
  fs::write(plan_path, serialized).map_err(|error| error.to_string())?;
  Ok(plan)
}

#[tauri::command]
fn search_notes(path: String, query: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<NoteSearchResult>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  search_notes_in_root(&root, &query).map_err(|error| error.to_string())
}

fn search_notes_in_root(root: &Path, query: &str) -> Result<Vec<NoteSearchResult>> {
  let normalized = query.trim().to_ascii_lowercase();
  if normalized.is_empty() { return Ok(Vec::new()); }
  let mut results = Vec::new();
  for note_path in collect_markdown_files(root)? {
    let relative_path = to_relative_display(root, &note_path);
    let content = fs::read_to_string(&note_path)?;
    let haystack = format!("{relative_path}\n{content}").to_ascii_lowercase();
    if !haystack.contains(&normalized) { continue; }
    let excerpt = content.lines().find(|line| line.to_ascii_lowercase().contains(&normalized)).unwrap_or("Correspondencia no titulo ou caminho.").trim();
    results.push(NoteSearchResult { name: note_path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string(), relative_path, excerpt: excerpt.chars().take(140).collect() });
  }
  results.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
  Ok(results)
}

#[tauri::command]
fn list_favorites(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<String>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  read_favorites(&root).map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_favorite(path: String, relative_path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<String>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  let note = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
  if !note.exists() { return Err("A nota nao existe mais.".to_string()); }
  let mut favorites = read_favorites(&root).map_err(|error| error.to_string())?;
  let path = to_relative_display(&root, &note);
  if favorites.contains(&path) { favorites.retain(|item| item != &path); } else { favorites.push(path); favorites.sort(); }
  write_favorites(&root, &favorites).map_err(|error| error.to_string())?;
  Ok(favorites)
}

fn read_favorites(root: &Path) -> Result<Vec<String>> {
  ensure_metadata_layout(root)?;
  let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join(METADATA_DIR).join(CONFIG_FILE))?).unwrap_or_else(|_| json!({}));
  Ok(value.get("favorites").and_then(|entry| entry.as_array()).map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect()).unwrap_or_default())
}

fn write_favorites(root: &Path, favorites: &[String]) -> Result<()> {
  ensure_metadata_layout(root)?;
  let path = root.join(METADATA_DIR).join(CONFIG_FILE);
  let mut value: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path)?).unwrap_or_else(|_| json!({}));
  value["favorites"] = json!(favorites);
  fs::write(path, serde_json::to_string_pretty(&value)?)?;
  Ok(())
}

#[tauri::command]
fn list_folders(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<String>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  collect_folders(&root)
    .map(|folders| folders.iter().map(|folder| to_relative_display(&root, folder)).collect())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_attachments(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<String>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  collect_attachment_files(&root)
    .map(|attachments| attachments.iter().map(|attachment| to_relative_display(&root, attachment)).collect())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_note(
  path: String,
  relative_path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  let note_path = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
  let content = fs::read_to_string(&note_path)
    .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))
    .map_err(|error| error.to_string())?;

  Ok(NoteDocument {
    name: note_path
      .file_name()
      .and_then(|segment| segment.to_str())
      .unwrap_or_default()
      .to_string(),
    relative_path: to_relative_display(&root, &note_path),
    content,
  })
}

#[tauri::command]
fn get_backlinks(
  path: String,
  relative_path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<Backlink>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  get_backlinks_in_root(&root, &relative_path).map_err(|error| error.to_string())
}

fn get_backlinks_in_root(root: &Path, relative_path: &str) -> Result<Vec<Backlink>> {
  let target = resolve_note_path(root, relative_path)?;
  let target_relative_path = to_relative_display(root, &target);
  let mut backlinks = Vec::new();
  for note_path in collect_markdown_files(root)? {
    let note_relative_path = to_relative_display(root, &note_path);
    if note_relative_path == target_relative_path {
      continue;
    }
    let content = fs::read_to_string(&note_path)
      .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    if extract_wiki_links(&content).iter().any(|link| link == &target_relative_path) {
      backlinks.push(Backlink {
        name: note_path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string(),
        relative_path: note_relative_path,
      });
    }
  }
  backlinks.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
  Ok(backlinks)
}

#[tauri::command]
fn get_broken_links(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<BrokenLink>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  get_broken_links_in_root(&root).map_err(|error| error.to_string())
}

fn get_broken_links_in_root(root: &Path) -> Result<Vec<BrokenLink>> {
  let mut broken_links = Vec::new();
  for note_path in collect_markdown_files(root)? {
    let content = fs::read_to_string(&note_path)
      .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    for target in extract_wiki_links(&content) {
      if !root.join(&target).is_file() {
        broken_links.push(BrokenLink {
          target,
          source_name: note_path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string(),
          source_relative_path: to_relative_display(root, &note_path),
        });
      }
    }
  }
  broken_links.sort_by(|left, right| {
    left.source_relative_path.cmp(&right.source_relative_path).then(left.target.cmp(&right.target))
  });
  Ok(broken_links)
}

#[tauri::command]
fn get_tag_index(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<TagSummary>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  get_tag_index_in_root(&root).map_err(|error| error.to_string())
}

fn get_tag_index_in_root(root: &Path) -> Result<Vec<TagSummary>> {
  let mut tags: HashMap<String, Vec<String>> = HashMap::new();
  for note_path in collect_markdown_files(root)? {
    let content = fs::read_to_string(&note_path)
      .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    let relative_path = to_relative_display(root, &note_path);
    for tag in extract_tags(&content) {
      tags.entry(tag).or_default().push(relative_path.clone());
    }
  }
  let mut summaries = tags
    .into_iter()
    .map(|(tag, mut note_paths)| {
      note_paths.sort();
      TagSummary { tag, note_paths }
    })
    .collect::<Vec<_>>();
  summaries.sort_by(|left, right| left.tag.cmp(&right.tag));
  Ok(summaries)
}

fn extract_tags(content: &str) -> Vec<String> {
  let characters = content.chars().collect::<Vec<_>>();
  let mut tags = HashSet::new();
  for (index, character) in characters.iter().enumerate() {
    if *character != '#' || index > 0 && (characters[index - 1].is_alphanumeric() || characters[index - 1] == '_') {
      continue;
    }
    let tag = characters[index + 1..]
      .iter()
      .take_while(|value| value.is_alphanumeric() || **value == '_' || **value == '-')
      .collect::<String>();
    if !tag.is_empty() {
      tags.insert(tag.to_ascii_lowercase());
    }
  }
  let mut result = tags.into_iter().collect::<Vec<_>>();
  result.sort();
  result
}

fn normalize_wiki_link_target(target: &str) -> Option<String> {
  let normalized = target.trim().replace('\\', "/");
  if normalized.is_empty() || normalized.contains("..") || normalized.starts_with('/') || Path::new(&normalized).is_absolute() {
    return None;
  }
  Some(if normalized.to_ascii_lowercase().ends_with(".md") { normalized } else { format!("{normalized}.md") })
}

fn extract_wiki_links(content: &str) -> Vec<String> {
  let mut links = Vec::new();
  let mut remaining = content;
  while let Some(start) = remaining.find("[[") {
    let after_start = &remaining[start + 2..];
    let Some(end) = after_start.find("]]" ) else { break };
    let raw_target = &after_start[..end];
    let target = raw_target.split('|').next().unwrap_or_default().split('#').next().unwrap_or_default();
    if let Some(target) = normalize_wiki_link_target(target) {
      links.push(target);
    }
    remaining = &after_start[end + 2..];
  }
  links
}

fn rewrite_wiki_links(content: &str, source_relative_path: &str, target_relative_path: &str) -> String {
  let source = source_relative_path.replace('\\', "/");
  let target = target_relative_path.replace('\\', "/");
  let mut rewritten = String::with_capacity(content.len());
  let mut remaining = content;

  while let Some(start) = remaining.find("[[") {
    rewritten.push_str(&remaining[..start + 2]);
    let after_start = &remaining[start + 2..];
    let Some(end) = after_start.find("]]" ) else {
      rewritten.push_str(after_start);
      return rewritten;
    };
    let raw_link = &after_start[..end];
    let (target_and_heading, alias) = raw_link.split_once('|').unwrap_or((raw_link, ""));
    let (raw_target, heading) = target_and_heading.split_once('#').unwrap_or((target_and_heading, ""));

    if normalize_wiki_link_target(raw_target).as_deref() == Some(source.as_str()) {
      let replacement = if raw_target.trim().to_ascii_lowercase().ends_with(".md") {
        target.clone()
      } else {
        target.trim_end_matches(".md").to_string()
      };
      rewritten.push_str(&replacement);
      if !heading.is_empty() {
        rewritten.push('#');
        rewritten.push_str(heading);
      }
      if !alias.is_empty() {
        rewritten.push('|');
        rewritten.push_str(alias);
      }
    } else {
      rewritten.push_str(raw_link);
    }
    rewritten.push_str("]]" );
    remaining = &after_start[end + 2..];
  }

  rewritten.push_str(remaining);
  rewritten
}

fn update_wiki_links_for_note_path_change(root: &Path, source_relative_path: &str, target_relative_path: &str) -> Result<()> {
  for note_path in collect_markdown_files(root)? {
    let content = fs::read_to_string(&note_path)
      .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    let updated_content = rewrite_wiki_links(&content, source_relative_path, target_relative_path);
    if updated_content != content {
      fs::write(&note_path, updated_content)
        .with_context(|| format!("Nao foi possivel atualizar links em '{}'.", note_path.display()))?;
    }
  }
  Ok(())
}

#[tauri::command]
fn save_note(
  path: String,
  relative_path: String,
  content: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  let note_path = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
  let before_content = fs::read_to_string(&note_path)
    .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))
    .map_err(|error| error.to_string())?;
  fs::write(&note_path, content.as_bytes())
    .with_context(|| format!("Nao foi possivel salvar '{}'.", note_path.display()))
    .map_err(|error| error.to_string())?;

  if before_content != content {
    record_history(&root, HistoryCommand::SaveNote {
      relative_path: relative_path.clone(),
      before_content,
      after_content: content.clone(),
    })
    .map_err(|error| error.to_string())?;
  }

  Ok(NoteDocument {
    name: note_path
      .file_name()
      .and_then(|segment| segment.to_str())
      .unwrap_or_default()
      .to_string(),
    relative_path: to_relative_display(&root, &note_path),
    content,
  })
}

#[tauri::command]
fn create_note(
  path: String,
  relative_path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  let note_path = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
  if note_path.exists() {
    return Err(format!("A nota '{}' ja existe.", note_path.display()));
  }

  if let Some(parent) = note_path.parent() {
    fs::create_dir_all(parent)
      .with_context(|| format!("Nao foi possivel criar '{}'.", parent.display()))
      .map_err(|error| error.to_string())?;
  }

  let initial_content = format!("# {}\n\n", display_note_title(&note_path));
  fs::write(&note_path, initial_content.as_bytes())
    .with_context(|| format!("Nao foi possivel criar '{}'.", note_path.display()))
    .map_err(|error| error.to_string())?;

  record_history(&root, HistoryCommand::CreateNote {
    relative_path: relative_path.clone(),
    content: initial_content.clone(),
  })
  .map_err(|error| error.to_string())?;

  Ok(NoteDocument {
    name: note_path
      .file_name()
      .and_then(|segment| segment.to_str())
      .unwrap_or_default()
      .to_string(),
    relative_path: to_relative_display(&root, &note_path),
    content: initial_content,
  })
}

#[tauri::command]
fn create_folder(
  path: String,
  relative_path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  let folder_path = resolve_folder_path(&root, &relative_path).map_err(|error| error.to_string())?;
  if folder_path.exists() {
    return Err(format!("A pasta '{}' ja existe.", folder_path.display()));
  }
  fs::create_dir_all(&folder_path)
    .with_context(|| format!("Nao foi possivel criar '{}'.", folder_path.display()))
    .map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
fn rename_vault_item(
  path: String,
  relative_path: String,
  new_name: String,
  item_type: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  rename_vault_item_in_root(&root, &relative_path, &new_name, &item_type)
    .map_err(|error| error.to_string())
}

fn rename_vault_item_in_root(root: &Path, relative_path: &str, new_name: &str, item_type: &str) -> Result<()> {
  let is_note = match item_type {
    "note" => true,
    "folder" => false,
    _ => bail!("Tipo de item invalido."),
  };
  let source = if is_note {
    resolve_note_path(&root, &relative_path)
  } else {
    resolve_folder_path(&root, &relative_path)
  }?;
  if !source.exists() {
    bail!("O item que voce deseja renomear nao existe mais.");
  }

  let destination_name = validate_item_name(new_name, is_note)?;
  let parent = source.parent().ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta do item."))?;
  let destination = parent.join(destination_name);
  if destination.exists() {
    bail!("Ja existe um item com esse nome nessa pasta.");
  }

  let source_relative_path = is_note.then(|| to_relative_display(root, &source));

  fs::rename(&source, &destination)
    .with_context(|| format!("Nao foi possivel renomear '{}'.", source.display()))
    ?;
  if let Some(source_relative_path) = source_relative_path {
    update_wiki_links_for_note_path_change(root, &source_relative_path, &to_relative_display(root, &destination))?;
  }
  Ok(())
}

#[tauri::command]
fn move_vault_item(
  path: String,
  relative_path: String,
  destination_folder: String,
  item_type: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  move_vault_item_in_root(&root, &relative_path, &destination_folder, &item_type)
    .map_err(|error| error.to_string())
}

fn move_vault_item_in_root(root: &Path, relative_path: &str, destination_folder: &str, item_type: &str) -> Result<()> {
  let is_note = match item_type {
    "note" => true,
    "folder" => false,
    _ => bail!("Tipo de item invalido."),
  };
  let source = if is_note {
    resolve_note_path(root, relative_path)
  } else {
    resolve_folder_path(root, relative_path)
  }?;
  if !source.exists() {
    bail!("O item que voce deseja mover nao existe mais.");
  }

  let destination = if destination_folder.trim().is_empty() {
    root.to_path_buf()
  } else {
    resolve_folder_path(root, destination_folder)?
  };
  if !destination.is_dir() {
    bail!("A pasta de destino nao existe.");
  }
  if !is_note && destination.canonicalize()?.starts_with(source.canonicalize()?) {
    bail!("Uma pasta nao pode ser movida para dentro dela mesma.");
  }

  let source_name = source.file_name().ok_or_else(|| anyhow::anyhow!("O item nao possui um nome valido."))?;
  let target = destination.join(source_name);
  if target.exists() {
    bail!("Ja existe um item com esse nome na pasta de destino.");
  }
  let source_relative_path = is_note.then(|| to_relative_display(root, &source));
  fs::rename(&source, &target)
    .with_context(|| format!("Nao foi possivel mover '{}'.", source.display()))?;
  if let Some(source_relative_path) = source_relative_path {
    update_wiki_links_for_note_path_change(root, &source_relative_path, &to_relative_display(root, &target))?;
  }
  Ok(())
}

#[tauri::command]
fn delete_vault_item(
  path: String,
  relative_path: String,
  item_type: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;

  delete_vault_item_in_root(&root, &relative_path, &item_type).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_trash(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<Vec<TrashEntry>, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  list_trash_in_root(&root).map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_trash_item(
  path: String,
  id: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  restore_trash_item_in_root(&root, &id).map_err(|error| error.to_string())
}

#[tauri::command]
fn permanently_delete_trash_item(
  path: String,
  id: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  permanently_delete_trash_item_in_root(&root, &id).map_err(|error| error.to_string())
}

fn delete_vault_item_in_root(root: &Path, relative_path: &str, item_type: &str) -> Result<()> {
  let is_note = match item_type {
    "note" => true,
    "folder" => false,
    _ => bail!("Tipo de item invalido."),
  };
  let source = if is_note {
    resolve_note_path(root, relative_path)
  } else {
    resolve_folder_path(root, relative_path)
  }?;
  if !source.exists() {
    bail!("O item que voce deseja excluir nao existe mais.");
  }

  let id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis().to_string();
  let source_name = source.file_name().ok_or_else(|| anyhow::anyhow!("O item nao possui um nome valido."))?.to_string_lossy();
  let trashed_name = format!("{id}-{source_name}");
  let trash_root = trash_root(root);
  fs::create_dir_all(&trash_root)?;
  let trash_path = trash_root.join(&trashed_name);
  fs::rename(&source, &trash_path)
    .with_context(|| format!("Nao foi possivel mover '{}' para a lixeira.", source.display()))?;

  let entry = TrashEntry {
    id,
    original_relative_path: relative_path.to_string(),
    trashed_name,
    item_type: item_type.to_string(),
    deleted_at_day: today_day(),
  };
  let mut entries = read_trash_entries(root)?;
  entries.push(entry);
  if let Err(error) = write_trash_entries(root, &entries) {
    let _ = fs::rename(&trash_path, &source);
    return Err(error);
  }
  Ok(())
}

fn restore_trash_item_in_root(root: &Path, id: &str) -> Result<()> {
  let mut entries = read_trash_entries(root)?;
  let index = entries.iter().position(|entry| entry.id == id).ok_or_else(|| anyhow::anyhow!("Item nao encontrado na lixeira."))?;
  let entry = entries[index].clone();
  let source = trash_item_path(root, &entry.trashed_name)?;
  if !source.exists() {
    bail!("O arquivo da lixeira nao existe mais.");
  }
  let destination = match entry.item_type.as_str() {
    "note" => resolve_note_path(root, &entry.original_relative_path)?,
    "folder" => resolve_folder_path(root, &entry.original_relative_path)?,
    _ => bail!("Tipo de item invalido na lixeira."),
  };
  if destination.exists() {
    bail!("Ja existe um item no local original. Renomeie ou mova esse item antes de restaurar.");
  }
  if let Some(parent) = destination.parent() {
    fs::create_dir_all(parent)?;
  }
  fs::rename(&source, &destination)
    .with_context(|| format!("Nao foi possivel restaurar '{}'.", entry.original_relative_path))?;
  entries.remove(index);
  if let Err(error) = write_trash_entries(root, &entries) {
    let _ = fs::rename(&destination, &source);
    return Err(error);
  }
  Ok(())
}

fn permanently_delete_trash_item_in_root(root: &Path, id: &str) -> Result<()> {
  let mut entries = read_trash_entries(root)?;
  let index = entries
    .iter()
    .position(|entry| entry.id == id)
    .ok_or_else(|| anyhow::anyhow!("Item nao encontrado na lixeira."))?;
  let entry = entries[index].clone();
  let source = trash_item_path(root, &entry.trashed_name)?;

  if source.is_dir() {
    fs::remove_dir_all(&source)
      .with_context(|| format!("Nao foi possivel excluir '{}' permanentemente.", entry.original_relative_path))?;
  } else if source.exists() {
    fs::remove_file(&source)
      .with_context(|| format!("Nao foi possivel excluir '{}' permanentemente.", entry.original_relative_path))?;
  }

  entries.remove(index);
  write_trash_entries(root, &entries)
}

#[tauri::command]
fn import_attachment(
  path: String,
  source_path: String,
  note_relative_path: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<Attachment, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_vault_root(&root)
    .map_err(|error| error.to_string())?;
  import_attachment_in_root(&root, Path::new(&source_path), &note_relative_path).map_err(|error| error.to_string())
}

fn import_attachment_in_root(root: &Path, source_path: &Path, note_relative_path: &str) -> Result<Attachment> {
  if !source_path.is_file() {
    bail!("Selecione um arquivo valido para anexar.");
  }
  let source_name = source_path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| anyhow::anyhow!("O arquivo nao possui um nome valido."))?;
  let attachments_root = attachment_directory_for_note(root, note_relative_path)?;
  fs::create_dir_all(&attachments_root)?;
  let destination = unique_attachment_path(&attachments_root, source_name)?;
  fs::copy(source_path, &destination)
    .with_context(|| format!("Nao foi possivel copiar '{}'.", source_path.display()))?;

  Ok(Attachment {
    name: destination.file_name().and_then(|name| name.to_str()).unwrap_or(source_name).to_string(),
    relative_path: to_relative_display(root, &destination),
    is_image: is_image_path(&destination),
  })
}

fn attachment_directory_for_note(root: &Path, note_relative_path: &str) -> Result<PathBuf> {
  if note_relative_path.trim().is_empty() {
    return Ok(root.join(ATTACHMENTS_DIR));
  }
  let note_path = resolve_note_path(root, note_relative_path)?;
  let note_parent = note_path.parent().ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta da nota."))?;
  let relative_parent = note_parent.strip_prefix(root).map_err(|_| anyhow::anyhow!("A nota precisa ficar dentro do vault atual."))?;
  Ok(root.join(ATTACHMENTS_DIR).join(relative_parent))
}

fn unique_attachment_path(attachments_root: &Path, source_name: &str) -> Result<PathBuf> {
  let initial = attachments_root.join(source_name);
  if !initial.exists() {
    return Ok(initial);
  }
  let stem = Path::new(source_name).file_stem().and_then(|name| name.to_str()).unwrap_or("anexo");
  let extension = Path::new(source_name).extension().and_then(|value| value.to_str());
  let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
  let name = extension.map(|extension| format!("{stem}-{timestamp}.{extension}")).unwrap_or_else(|| format!("{stem}-{timestamp}"));
  Ok(attachments_root.join(name))
}

fn is_image_path(path: &Path) -> bool {
  matches!(
    path.extension().and_then(|extension| extension.to_str()).map(|extension| extension.to_ascii_lowercase()).as_deref(),
    Some("avif" | "bmp" | "gif" | "jpeg" | "jpg" | "png" | "svg" | "webp")
  )
}

#[tauri::command]
fn undo_last_command(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<HistoryStatus, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  let mut history = read_history(&root).map_err(|error| error.to_string())?;
  if let Some(command) = history.undo.pop() {
    apply_history_command(&root, &command, true).map_err(|error| error.to_string())?;
    history.redo.push(command);
    write_history(&root, &history).map_err(|error| error.to_string())?;
  }
  Ok(history_status(&history))
}

#[tauri::command]
fn redo_last_command(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<HistoryStatus, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  let mut history = read_history(&root).map_err(|error| error.to_string())?;
  if let Some(command) = history.redo.pop() {
    apply_history_command(&root, &command, false).map_err(|error| error.to_string())?;
    history.undo.push(command);
    write_history(&root, &history).map_err(|error| error.to_string())?;
  }
  Ok(history_status(&history))
}

#[tauri::command]
fn get_history_status(path: String, authorized_paths: State<AuthorizedPaths>) -> Result<HistoryStatus, String> {
  let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
  authorized_paths.ensure_authorized_vault_root(&root).map_err(|error| error.to_string())?;
  read_history(&root).map(|history| history_status(&history)).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_vault(
  app: AppHandle,
  parent_path: String,
  name: String,
  authorized_paths: State<AuthorizedPaths>,
) -> Result<VaultSummary, String> {
  validate_vault_name(&name).map_err(|error| error.to_string())?;

  let parent = canonicalize_directory(Path::new(&parent_path)).map_err(|error| error.to_string())?;
  authorized_paths
    .ensure_authorized_parent_directory(&parent)
    .map_err(|error| error.to_string())?;

  let vault_root = parent.join(name.trim());
  if vault_root.exists() {
    return Err(format!("A pasta '{}' ja existe.", vault_root.display()));
  }

  fs::create_dir_all(&vault_root)
    .with_context(|| format!("Nao foi possivel criar '{}'.", vault_root.display()))
    .map_err(|error| error.to_string())?;

  if let Err(error) = ensure_metadata_layout(&vault_root) {
    let _ = fs::remove_dir_all(&vault_root);
    return Err(error.to_string());
  }

  let canonical_root = canonicalize_directory(&vault_root).map_err(|error| error.to_string())?;
  authorized_paths
    .authorize_vault_root(&canonical_root)
    .map_err(|error| error.to_string())?;

  let vault = inspect_vault_path(&canonical_root).map_err(|error| error.to_string())?;
  let _ = persist_recent_vault(&app, &canonical_root);
  Ok(vault)
}

fn recent_vault_preference_path(app: &AppHandle) -> Result<PathBuf> {
  Ok(app.path().app_config_dir()?.join(RECENT_VAULT_FILE))
}

fn read_recent_vault_preference(app: &AppHandle) -> Result<RecentVaultPreference> {
  let path = recent_vault_preference_path(app)?;
  if !path.exists() {
    return Ok(RecentVaultPreference::default());
  }

  let content = fs::read_to_string(&path)
    .with_context(|| format!("Nao foi possivel ler '{}'.", path.display()))?;
  Ok(serde_json::from_str::<RecentVaultPreference>(&content).unwrap_or_default())
}

fn write_recent_vault_preference(app: &AppHandle, preference: &RecentVaultPreference) -> Result<()> {
  let path = recent_vault_preference_path(app)?;
  let parent = path
    .parent()
    .context("Nao foi possivel encontrar a pasta de configuracao da aplicacao.")?;
  fs::create_dir_all(parent)
    .with_context(|| format!("Nao foi possivel criar '{}'.", parent.display()))?;
  fs::write(&path, serde_json::to_string_pretty(preference)?)
    .with_context(|| format!("Nao foi possivel escrever '{}'.", path.display()))
}

fn persist_recent_vault(app: &AppHandle, root: &Path) -> Result<()> {
  let mut preference = read_recent_vault_preference(app)?;
  preference.last_vault_path = Some(root.display().to_string());
  write_recent_vault_preference(app, &preference)
}

fn inspect_vault_path(root: &Path) -> Result<VaultSummary> {
  let canonical_root = canonicalize_directory(root)?;
  let note_paths = collect_markdown_files(&canonical_root)?;
  let name = root
    .file_name()
    .and_then(|segment| segment.to_str())
    .map(ToOwned::to_owned)
    .unwrap_or_else(|| root.display().to_string());

  let previews = build_note_previews(root, &note_paths);

  Ok(VaultSummary {
    name,
    path: canonical_root.display().to_string(),
    note_count: note_paths.len(),
    note_previews: previews,
    is_obsidian_vault: canonical_root.join(".obsidian").is_dir(),
    metadata: inspect_metadata(&canonical_root),
  })
}

fn build_note_previews(root: &Path, note_paths: &[PathBuf]) -> Vec<NotePreview> {
  note_paths
    .iter()
    .take(NOTE_PREVIEW_LIMIT.max(note_paths.len()))
    .map(|path| NotePreview {
      name: path
        .file_name()
        .and_then(|segment| segment.to_str())
        .unwrap_or_default()
        .to_string(),
      relative_path: to_relative_display(root, path),
    })
    .collect::<Vec<_>>()
}

fn validate_existing_directory(path: &Path) -> Result<()> {
  if !path.exists() {
    bail!("A pasta '{}' nao existe.", path.display());
  }

  if !path.is_dir() {
    bail!("'{}' nao e uma pasta valida.", path.display());
  }

  Ok(())
}

fn canonicalize_directory(path: &Path) -> Result<PathBuf> {
  validate_existing_directory(path)?;
  path
    .canonicalize()
    .with_context(|| format!("Nao foi possivel resolver '{}'.", path.display()))
}

fn validate_vault_name(name: &str) -> Result<()> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    bail!("O nome do vault nao pode ficar vazio.");
  }

  let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
  if trimmed.chars().any(|character| invalid.contains(&character)) {
    bail!("O nome do vault possui caracteres invalidos para uma pasta.");
  }

  if trimmed.ends_with('.') || trimmed.ends_with(' ') {
    bail!("O nome do vault nao pode terminar com ponto ou espaco.");
  }

  let reserved = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9",
  ];
  if reserved.contains(&trimmed.to_ascii_uppercase().as_str()) {
    bail!("Esse nome e reservado pelo sistema operacional.");
  }

  Ok(())
}

fn collect_markdown_files(root: &Path) -> Result<Vec<PathBuf>> {
  let canonical_root = canonicalize_directory(root)?;
  let mut notes = Vec::new();
  let mut visited_directories = HashSet::new();
  visit_directory(&canonical_root, &canonical_root, &mut visited_directories, &mut notes);
  notes.sort();
  Ok(notes)
}

fn collect_attachment_files(root: &Path) -> Result<Vec<PathBuf>> {
  let canonical_root = canonicalize_directory(root)?;
  let attachments_root = canonical_root.join(ATTACHMENTS_DIR);
  if !attachments_root.is_dir() {
    return Ok(Vec::new());
  }

  let mut attachments = Vec::new();
  let mut visited_directories = HashSet::new();
  visit_attachment_directory(&attachments_root, &canonical_root, &mut visited_directories, &mut attachments);
  attachments.sort();
  Ok(attachments)
}

fn collect_folders(root: &Path) -> Result<Vec<PathBuf>> {
  let canonical_root = canonicalize_directory(root)?;
  let mut folders = Vec::new();
  let mut visited_directories = HashSet::new();
  visit_folders(&canonical_root, &canonical_root, &mut visited_directories, &mut folders);
  folders.sort();
  Ok(folders)
}

fn visit_folders(
  directory: &Path,
  canonical_root: &Path,
  visited_directories: &mut HashSet<PathBuf>,
  folders: &mut Vec<PathBuf>,
) {
  let canonical_directory = match directory.canonicalize() {
    Ok(path) => path,
    Err(error) => {
      log::warn!("skipping unreadable directory '{}': {error}", directory.display());
      return;
    }
  };
  if !canonical_directory.starts_with(canonical_root) || !visited_directories.insert(canonical_directory) {
    return;
  }

  let entries = match fs::read_dir(directory) {
    Ok(entries) => entries,
    Err(error) => {
      log::warn!("skipping directory '{}': {error}", directory.display());
      return;
    }
  };
  for entry in entries.flatten() {
    let path = entry.path();
    let Ok(file_type) = entry.file_type() else { continue };
    if file_type.is_symlink() || !file_type.is_dir() {
      continue;
    }
    let Some(name) = path.file_name().and_then(|segment| segment.to_str()) else { continue };
    if name == METADATA_DIR || name.starts_with('.') {
      continue;
    }
    folders.push(path.clone());
    visit_folders(&path, canonical_root, visited_directories, folders);
  }
}

fn visit_directory(
  directory: &Path,
  canonical_root: &Path,
  visited_directories: &mut HashSet<PathBuf>,
  notes: &mut Vec<PathBuf>,
) {
  let canonical_directory = match directory.canonicalize() {
    Ok(path) => path,
    Err(error) => {
      log::warn!("skipping unreadable directory '{}': {error}", directory.display());
      return;
    }
  };

  if !canonical_directory.starts_with(canonical_root) || !visited_directories.insert(canonical_directory) {
    return;
  }

  let entries = match fs::read_dir(directory) {
    Ok(entries) => entries,
    Err(error) => {
      log::warn!("skipping directory '{}': {error}", directory.display());
      return;
    }
  };

  for entry in entries {
    let entry = match entry {
      Ok(entry) => entry,
      Err(error) => {
        log::warn!("skipping unreadable entry in '{}': {error}", directory.display());
        continue;
      }
    };
    let path = entry.path();
    let file_type = match entry.file_type() {
      Ok(file_type) => file_type,
      Err(error) => {
        log::warn!("skipping entry with unreadable file type '{}': {error}", path.display());
        continue;
      }
    };

    if file_type.is_symlink() {
      continue;
    }

    if file_type.is_dir() {
      if path.file_name().and_then(|segment| segment.to_str()) == Some(METADATA_DIR) {
        continue;
      }

      visit_directory(&path, canonical_root, visited_directories, notes);
      continue;
    }

    if file_type.is_file()
      && path
      .extension()
      .and_then(|extension| extension.to_str())
      .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
      notes.push(path);
    }
  }
}

fn visit_attachment_directory(
  directory: &Path,
  canonical_root: &Path,
  visited_directories: &mut HashSet<PathBuf>,
  attachments: &mut Vec<PathBuf>,
) {
  let canonical_directory = match directory.canonicalize() {
    Ok(path) => path,
    Err(error) => {
      log::warn!("skipping unreadable attachment directory '{}': {error}", directory.display());
      return;
    }
  };
  if !canonical_directory.starts_with(canonical_root) || !visited_directories.insert(canonical_directory) {
    return;
  }

  let entries = match fs::read_dir(directory) {
    Ok(entries) => entries,
    Err(error) => {
      log::warn!("skipping attachment directory '{}': {error}", directory.display());
      return;
    }
  };
  for entry in entries.flatten() {
    let path = entry.path();
    let Ok(file_type) = entry.file_type() else { continue };
    if file_type.is_symlink() {
      continue;
    }
    if file_type.is_dir() {
      visit_attachment_directory(&path, canonical_root, visited_directories, attachments);
    } else if file_type.is_file() {
      attachments.push(path);
    }
  }
}

fn inspect_metadata(root: &Path) -> VaultMetadata {
  let metadata_root = root.join(METADATA_DIR);
  let mut missing = Vec::new();

  if !metadata_root.is_dir() {
    missing.push(to_relative_display(root, &metadata_root));
  } else {
    let config_path = metadata_root.join(CONFIG_FILE);
    match fs::read_to_string(&config_path) {
      Ok(content) => {
        if serde_json::from_str::<serde_json::Value>(&content).is_err() {
          missing.push(format!("{} (invalido)", to_relative_display(root, &config_path)));
        }
      }
      Err(_) => missing.push(to_relative_display(root, &config_path)),
    }

    for directory in [ASSESSMENTS_DIR, SESSIONS_DIR, REVIEW_PLANS_DIR] {
      let path = metadata_root.join(directory);
      if !path.is_dir() {
        missing.push(to_relative_display(root, &path));
      }
    }
  }

  VaultMetadata {
    is_initialized: missing.is_empty(),
    root_path: metadata_root.display().to_string(),
    missing,
  }
}

fn resolve_note_path(root: &Path, relative_path: &str) -> Result<PathBuf> {
  let trimmed = relative_path.trim();
  if trimmed.is_empty() {
    bail!("Escolha uma nota valida.");
  }

  let candidate = Path::new(trimmed);
  if candidate.is_absolute() {
    bail!("A nota precisa usar um caminho relativo ao vault.");
  }

  if candidate
    .components()
    .any(|component| matches!(component, std::path::Component::ParentDir))
  {
    bail!("Nao e permitido navegar para fora do vault.");
  }

  if candidate
    .components()
    .any(|component| component.as_os_str() == METADATA_DIR)
  {
    bail!("A pasta .mirmind e reservada para metadados do app.");
  }

  let normalized = if trimmed.ends_with(".md") {
    trimmed.to_string()
  } else {
    format!("{trimmed}.md")
  };

  let resolved = root.join(normalized);
  if let Some(parent) = resolved.parent() {
    let parent_path = if parent.exists() {
      parent
        .canonicalize()
        .with_context(|| format!("Nao foi possivel resolver '{}'.", parent.display()))?
    } else {
      let existing_ancestor = parent
        .ancestors()
        .find(|ancestor| ancestor.exists())
        .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta de destino."))?;
      existing_ancestor
        .canonicalize()
        .with_context(|| format!("Nao foi possivel resolver '{}'.", existing_ancestor.display()))?
    };

    if !parent_path.starts_with(root) {
      bail!("A nota precisa ficar dentro do vault atual.");
    }
  }

  Ok(resolved)
}

fn resolve_folder_path(root: &Path, relative_path: &str) -> Result<PathBuf> {
  let trimmed = relative_path.trim().trim_matches(['/', '\\']);
  if trimmed.is_empty() { bail!("Defina um nome para a pasta."); }
  let candidate = Path::new(trimmed);
  if candidate.is_absolute() || candidate.components().any(|component| matches!(component, std::path::Component::ParentDir)) {
    bail!("A pasta precisa usar um caminho relativo dentro do vault.");
  }
  if candidate.components().any(|component| component.as_os_str() == METADATA_DIR) {
    bail!("A pasta .mirmind e reservada para metadados do app.");
  }
  let resolved = root.join(candidate);
  let existing_ancestor = resolved.ancestors().find(|ancestor| ancestor.exists())
    .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta de destino."))?;
  if !existing_ancestor.canonicalize()?.starts_with(root) {
    bail!("A pasta precisa ficar dentro do vault atual.");
  }
  Ok(resolved)
}

fn validate_item_name(name: &str, is_note: bool) -> Result<String> {
  let trimmed = name.trim();
  if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
    bail!("Defina um nome valido.");
  }
  if trimmed.chars().any(|character| character == '/' || character == '\\') {
    bail!("Use apenas o novo nome, sem caminho.");
  }
  let without_extension = if is_note { trimmed.strip_suffix(".md").unwrap_or(trimmed) } else { trimmed };
  validate_vault_name(without_extension)?;
  Ok(if is_note { format!("{without_extension}.md") } else { without_extension.to_string() })
}

fn display_note_title(path: &Path) -> String {
  path
    .file_stem()
    .and_then(|segment| segment.to_str())
    .unwrap_or("Nova nota")
    .replace('-', " ")
}

fn history_path(root: &Path) -> PathBuf {
  root.join(METADATA_DIR).join(HISTORY_FILE)
}

fn trash_root(root: &Path) -> PathBuf {
  root.join(METADATA_DIR).join(TRASH_DIR)
}

fn trash_manifest_path(root: &Path) -> PathBuf {
  root.join(METADATA_DIR).join(TRASH_FILE)
}

fn read_trash_entries(root: &Path) -> Result<Vec<TrashEntry>> {
  let path = trash_manifest_path(root);
  if !path.exists() {
    return Ok(Vec::new());
  }
  Ok(serde_json::from_str::<Vec<TrashEntry>>(&fs::read_to_string(path)?) .unwrap_or_default())
}

fn list_trash_in_root(root: &Path) -> Result<Vec<TrashEntry>> {
  prune_expired_trash_items_in_root(root)
}

fn prune_expired_trash_items_in_root(root: &Path) -> Result<Vec<TrashEntry>> {
  let entries = read_trash_entries(root)?;
  let entry_count = entries.len();
  let today = today_day();
  let mut retained = Vec::with_capacity(entries.len());

  for entry in entries {
    if today.saturating_sub(entry.deleted_at_day) >= TRASH_RETENTION_DAYS {
      let path = trash_item_path(root, &entry.trashed_name)?;
      if path.is_dir() {
        fs::remove_dir_all(&path)
          .with_context(|| format!("Nao foi possivel limpar '{}' da lixeira.", entry.original_relative_path))?;
      } else if path.exists() {
        fs::remove_file(&path)
          .with_context(|| format!("Nao foi possivel limpar '{}' da lixeira.", entry.original_relative_path))?;
      }
    } else {
      retained.push(entry);
    }
  }

  if retained.len() != entry_count {
    write_trash_entries(root, &retained)?;
  }

  Ok(retained)
}

fn write_trash_entries(root: &Path, entries: &[TrashEntry]) -> Result<()> {
  fs::create_dir_all(root.join(METADATA_DIR))?;
  fs::write(trash_manifest_path(root), serde_json::to_string(entries)?)?;
  Ok(())
}

fn trash_item_path(root: &Path, trashed_name: &str) -> Result<PathBuf> {
  let candidate = Path::new(trashed_name);
  if candidate.components().count() != 1 || candidate.file_name().is_none() {
    bail!("Item invalido na lixeira.");
  }
  Ok(trash_root(root).join(candidate))
}

fn read_history(root: &Path) -> Result<HistoryState> {
  let path = history_path(root);
  if !path.exists() {
    return Ok(HistoryState::default());
  }
  Ok(serde_json::from_str::<HistoryState>(&fs::read_to_string(path)?) .unwrap_or_default())
}

fn write_history(root: &Path, history: &HistoryState) -> Result<()> {
  fs::create_dir_all(root.join(METADATA_DIR))?;
  fs::write(history_path(root), serde_json::to_string(history)?)?;
  Ok(())
}

fn record_history(root: &Path, command: HistoryCommand) -> Result<()> {
  let mut history = read_history(root)?;
  history.undo.push(command);
  history.redo.clear();
  if history.undo.len() > HISTORY_LIMIT {
    history.undo.remove(0);
  }
  write_history(root, &history)
}

fn apply_history_command(root: &Path, command: &HistoryCommand, undo: bool) -> Result<()> {
  match command {
    HistoryCommand::CreateNote { relative_path, content } => {
      let path = resolve_note_path(root, relative_path)?;
      if undo {
        if path.exists() { fs::remove_file(path)?; }
      } else {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        fs::write(path, content)?;
      }
    }
    HistoryCommand::SaveNote { relative_path, before_content, after_content } => {
      let path = resolve_note_path(root, relative_path)?;
      fs::write(path, if undo { before_content } else { after_content })?;
    }
  }
  Ok(())
}

fn history_status(history: &HistoryState) -> HistoryStatus {
  HistoryStatus { can_undo: !history.undo.is_empty(), can_redo: !history.redo.is_empty() }
}

fn ensure_metadata_layout(root: &Path) -> Result<()> {
  let metadata_root = root.join(METADATA_DIR);
  fs::create_dir_all(metadata_root.join(ASSESSMENTS_DIR))?;
  fs::create_dir_all(metadata_root.join(SESSIONS_DIR))?;
  fs::create_dir_all(metadata_root.join(REVIEW_PLANS_DIR))?;

  let config_path = metadata_root.join(CONFIG_FILE);
  if !config_path.exists() {
    let vault_name = root
      .file_name()
      .and_then(|segment| segment.to_str())
      .unwrap_or("Vault");

    let config = json!({
      "version": 1,
      "vaultName": vault_name,
      "reviewEngine": {
        "mode": "spaced-repetition",
        "assessmentStyle": "free-recall"
      },
      "createdBy": "MirrorMind",
    });

    fs::write(&config_path, serde_json::to_string_pretty(&config)?)
      .with_context(|| format!("Nao foi possivel escrever '{}'.", config_path.display()))?;
  }

  let templates_path = metadata_root.join(TEMPLATES_FILE);
  if !templates_path.exists() {
    let templates = vec![
      NoteTemplate { id: "blank".to_string(), name: "Em branco".to_string(), content: "".to_string() },
      NoteTemplate { id: "study".to_string(), name: "Nota de estudo".to_string(), content: "# Conceito\n\n## Explicacao\n\n## Exemplos\n\n## Duvidas\n".to_string() },
      NoteTemplate { id: "meeting".to_string(), name: "Reuniao".to_string(), content: "# Objetivo\n\n## Participantes\n\n## Decisoes\n\n## Proximos passos\n".to_string() },
    ];
    fs::write(templates_path, serde_json::to_string_pretty(&templates)?)?;
  }

  Ok(())
}

fn to_relative_display(root: &Path, path: &Path) -> String {
  path
    .strip_prefix(root)
    .map(|relative| relative.to_string_lossy().replace('\\', "/"))
    .unwrap_or_else(|_| path.display().to_string())
}

#[derive(Default)]
struct AuthorizedPaths {
  vault_roots: Mutex<HashSet<PathBuf>>,
  parent_directories: Mutex<HashSet<PathBuf>>,
}

impl AuthorizedPaths {
  fn authorize_vault_root(&self, path: &Path) -> Result<()> {
    let mut roots = self
      .vault_roots
      .lock()
      .map_err(|_| anyhow::anyhow!("Nao foi possivel registrar o vault autorizado."))?;
    roots.insert(path.to_path_buf());
    Ok(())
  }

  fn authorize_parent_directory(&self, path: &Path) -> Result<()> {
    let mut parents = self
      .parent_directories
      .lock()
      .map_err(|_| anyhow::anyhow!("Nao foi possivel registrar a pasta pai autorizada."))?;
    parents.insert(path.to_path_buf());
    Ok(())
  }

  fn ensure_authorized_vault_root(&self, path: &Path) -> Result<()> {
    let roots = self
      .vault_roots
      .lock()
      .map_err(|_| anyhow::anyhow!("Nao foi possivel verificar os vaults autorizados."))?;
    if roots.contains(path) {
      return Ok(());
    }

    bail!("Este vault nao foi autorizado pela selecao nativa da aplicacao.");
  }

  fn ensure_authorized_parent_directory(&self, path: &Path) -> Result<()> {
    let parents = self
      .parent_directories
      .lock()
      .map_err(|_| anyhow::anyhow!("Nao foi possivel verificar as pastas autorizadas."))?;
    if parents.contains(path) {
      return Ok(());
    }

    bail!("A pasta pai precisa ser escolhida pelo seletor nativo antes da criacao.");
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AuthorizedPaths::default())
    .invoke_handler(tauri::generate_handler![
      select_existing_vault,
      get_recent_vault_preference,
      reopen_recent_vault,
      set_recent_vault_prompt_preference,
      select_vault_parent,
      initialize_vault_metadata,
      create_vault,
      list_notes,
      list_templates,
      review_note,
      search_notes,
      list_favorites,
      toggle_favorite,
      read_note,
      save_note,
      create_note,
      create_folder,
      list_folders,
      list_attachments,
      rename_vault_item,
      move_vault_item,
      delete_vault_item,
      list_trash,
      restore_trash_item,
      permanently_delete_trash_item,
      import_attachment,
      get_backlinks,
      get_broken_links,
      get_tag_index,
      undo_last_command,
      redo_last_command,
      get_history_status
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::{
    apply_history_command, attachment_directory_for_note, collect_attachment_files, collect_folders, collect_markdown_files, delete_vault_item_in_root, ensure_metadata_layout, extract_tags, extract_wiki_links, get_backlinks_in_root, get_broken_links_in_root, get_tag_index_in_root, import_attachment_in_root, inspect_metadata, search_notes_in_root,
    list_trash_in_root, move_vault_item_in_root, permanently_delete_trash_item_in_root, read_trash_entries, record_history, rename_vault_item_in_root, resolve_folder_path, resolve_note_path, restore_trash_item_in_root, write_trash_entries, HistoryCommand, read_history,
    validate_vault_name, RecentVaultPreference,
    ASSESSMENTS_DIR, ATTACHMENTS_DIR, CONFIG_FILE, METADATA_DIR, REVIEW_PLANS_DIR, SESSIONS_DIR, TRASH_DIR,
  };
  use std::fs;
  use tempfile::tempdir;

  #[test]
  fn collect_markdown_files_ignores_metadata_directory() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path();
    let canonical_root = root.canonicalize().expect("canonical root");

    fs::write(root.join("root-note.md"), "# Root").expect("write root note");
    fs::create_dir_all(root.join("nested")).expect("create nested dir");
    fs::write(root.join("nested").join("nested-note.md"), "# Nested").expect("write nested note");
    fs::create_dir_all(root.join(METADATA_DIR)).expect("create metadata dir");
    fs::write(root.join(METADATA_DIR).join("internal.md"), "# Internal").expect("write internal note");

    let notes = collect_markdown_files(root).expect("collect markdown files");
    let collected = notes
      .iter()
      .map(|path| {
        path
          .strip_prefix(&canonical_root)
          .expect("relative path")
          .to_string_lossy()
          .replace('\\', "/")
      })
      .collect::<Vec<_>>();

    assert_eq!(collected, vec!["nested/nested-note.md", "root-note.md"]);
  }

  #[test]
  fn collect_attachment_files_lists_nested_files_and_ignores_metadata() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join(ATTACHMENTS_DIR).join("curso")).expect("create attachment folder");
    fs::write(root.join(ATTACHMENTS_DIR).join("curso").join("imagem.png"), "image").expect("write attachment");
    fs::create_dir_all(root.join(METADATA_DIR).join(ATTACHMENTS_DIR)).expect("create metadata folder");
    fs::write(root.join(METADATA_DIR).join(ATTACHMENTS_DIR).join("ignored.png"), "ignored").expect("write metadata file");

    assert_eq!(collect_attachment_files(&root).expect("list attachments"), vec![root.join(ATTACHMENTS_DIR).join("curso").join("imagem.png")]);
  }

  #[test]
  fn collect_folders_includes_empty_folders_and_ignores_internal_ones() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path();
    let canonical_root = root.canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("projetos").join("vazios")).expect("create folders");
    fs::create_dir_all(root.join(METADATA_DIR).join("interno")).expect("create metadata folder");
    fs::create_dir_all(root.join(".obsidian")).expect("create obsidian folder");

    let folders = collect_folders(root).expect("collect folders");
    let collected = folders
      .iter()
      .map(|path| path.strip_prefix(&canonical_root).expect("relative path").to_string_lossy().replace('\\', "/"))
      .collect::<Vec<_>>();

    assert_eq!(collected, vec!["projetos", "projetos/vazios"]);
  }

  #[test]
  fn inspect_metadata_marks_invalid_config_as_not_initialized() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path();
    let metadata_root = root.join(METADATA_DIR);

    fs::create_dir_all(metadata_root.join(ASSESSMENTS_DIR)).expect("create assessments dir");
    fs::create_dir_all(metadata_root.join(SESSIONS_DIR)).expect("create sessions dir");
    fs::create_dir_all(metadata_root.join(REVIEW_PLANS_DIR)).expect("create plans dir");
    fs::write(metadata_root.join(CONFIG_FILE), "{not-json").expect("write invalid config");

    let metadata = inspect_metadata(root);

    assert!(!metadata.is_initialized);
    assert!(metadata.missing.iter().any(|entry| entry.contains("config.json")));
  }

  #[test]
  fn ensure_metadata_layout_creates_expected_structure() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path();

    ensure_metadata_layout(root).expect("initialize metadata");

    assert!(root.join(METADATA_DIR).join(CONFIG_FILE).is_file());
    assert!(root.join(METADATA_DIR).join(ASSESSMENTS_DIR).is_dir());
    assert!(root.join(METADATA_DIR).join(SESSIONS_DIR).is_dir());
    assert!(root.join(METADATA_DIR).join(REVIEW_PLANS_DIR).is_dir());
  }

  #[test]
  fn validate_vault_name_rejects_reserved_names() {
    assert!(validate_vault_name("CON").is_err());
    assert!(validate_vault_name("Vault.").is_err());
    assert!(validate_vault_name("Meu Vault").is_ok());
  }

  #[test]
  fn resolve_note_path_rejects_parent_traversal() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");

    assert!(resolve_note_path(&root, "../segredo.md").is_err());
    assert!(resolve_note_path(&root, ".mirmind/interna.md").is_err());
    assert!(resolve_note_path(&root, "area/nova-nota").is_ok());
  }

  #[test]
  fn resolve_folder_path_rejects_unsafe_paths() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");

    assert!(resolve_folder_path(&root, "../segredo").is_err());
    assert!(resolve_folder_path(&root, ".mirmind/interna").is_err());
    assert_eq!(
      resolve_folder_path(&root, "area/subarea").expect("safe folder path"),
      root.join("area/subarea")
    );
  }

  #[test]
  fn rename_vault_item_renames_notes_and_folders() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("materias")).expect("create source folder");
    fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write source note");

    rename_vault_item_in_root(&root, "materias/aula.md", "resumo", "note").expect("rename note");
    rename_vault_item_in_root(&root, "materias", "estudos", "folder").expect("rename folder");

    assert!(root.join("estudos").join("resumo.md").is_file());
    assert!(!root.join("materias").exists());
    assert!(rename_vault_item_in_root(&root, "estudos", "../fora", "folder").is_err());
  }

  #[test]
  fn changing_a_note_path_updates_matching_wiki_links_and_finds_broken_ones() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("origem")).expect("create source folder");
    fs::create_dir_all(root.join("destino")).expect("create destination folder");
    fs::write(root.join("origem").join("aula.md"), "# Aula").expect("write target note");
    fs::write(
      root.join("referencias.md"),
      "[[origem/aula|Aula]]\n[[origem/aula#Resumo]]\n[[origem/aula.md]]\n[[nota-ausente]]",
    )
    .expect("write reference note");

    rename_vault_item_in_root(&root, "origem/aula.md", "resumo", "note").expect("rename note");
    move_vault_item_in_root(&root, "origem/resumo.md", "destino", "note").expect("move note");

    let references = fs::read_to_string(root.join("referencias.md")).expect("read references");
    assert!(references.contains("[[destino/resumo|Aula]]"));
    assert!(references.contains("[[destino/resumo#Resumo]]"));
    assert!(references.contains("[[destino/resumo.md]]"));

    let broken_links = get_broken_links_in_root(&root).expect("get broken links");
    assert_eq!(broken_links.len(), 1);
    assert_eq!(broken_links[0].source_relative_path, "referencias.md");
    assert_eq!(broken_links[0].target, "nota-ausente.md");
  }

  #[test]
  fn move_vault_item_moves_notes_and_rejects_recursive_folder_moves() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("origem").join("filha")).expect("create source folder");
    fs::create_dir_all(root.join("destino")).expect("create destination folder");
    fs::write(root.join("origem").join("aula.md"), "# Aula").expect("write source note");

    move_vault_item_in_root(&root, "origem/aula.md", "destino", "note").expect("move note");

    assert!(root.join("destino").join("aula.md").is_file());
    assert!(move_vault_item_in_root(&root, "origem", "origem/filha", "folder").is_err());
  }

  #[test]
  fn delete_and_restore_vault_item_uses_the_local_trash() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("materias")).expect("create source folder");
    fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write source note");

    delete_vault_item_in_root(&root, "materias/aula.md", "note").expect("move note to trash");
    let entries = read_trash_entries(&root).expect("read trash entries");

    assert_eq!(entries.len(), 1);
    assert!(!root.join("materias").join("aula.md").exists());
    restore_trash_item_in_root(&root, &entries[0].id).expect("restore note");
    assert!(root.join("materias").join("aula.md").is_file());
    assert!(read_trash_entries(&root).expect("read empty trash").is_empty());
  }

  #[test]
  fn permanently_deleting_a_trash_item_removes_its_file_and_manifest_entry() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::write(root.join("temporary.md"), "# Temporary").expect("write source note");

    delete_vault_item_in_root(&root, "temporary.md", "note").expect("move note to trash");
    let entry = read_trash_entries(&root).expect("read trash entry").pop().expect("entry");

    permanently_delete_trash_item_in_root(&root, &entry.id).expect("permanently delete item");

    assert!(!root.join(METADATA_DIR).join(TRASH_DIR).join(entry.trashed_name).exists());
    assert!(read_trash_entries(&root).expect("read empty trash").is_empty());
  }

  #[test]
  fn listing_trash_permanently_removes_items_after_thirty_days() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::write(root.join("expired.md"), "# Expired").expect("write source note");

    delete_vault_item_in_root(&root, "expired.md", "note").expect("move note to trash");
    let mut entries = read_trash_entries(&root).expect("read trash entry");
    let entry = entries.first_mut().expect("entry");
    entry.deleted_at_day = 0;
    let trashed_name = entry.trashed_name.clone();
    write_trash_entries(&root, &entries).expect("write expired trash entry");

    assert!(list_trash_in_root(&root).expect("prune expired trash").is_empty());
    assert!(!root.join(METADATA_DIR).join(TRASH_DIR).join(trashed_name).exists());
    assert!(read_trash_entries(&root).expect("read empty trash").is_empty());
  }

  #[test]
  fn import_attachment_copies_file_into_the_vault() {
    let temporary_directory = tempdir().expect("temp dir");
    let source_directory = tempdir().expect("source dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    let source = source_directory.path().join("diagrama.png");
    fs::write(&source, "image bytes").expect("write attachment");

    let attachment = import_attachment_in_root(&root, &source, "escola/portugues/aula.md").expect("import attachment");

    assert_eq!(attachment.relative_path, "attachments/escola/portugues/diagrama.png");
    assert!(attachment.is_image);
    assert_eq!(fs::read(root.join(&attachment.relative_path)).expect("read copied attachment"), b"image bytes");
  }

  #[test]
  fn attachments_for_new_notes_use_the_vault_attachment_root() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");

    assert_eq!(attachment_directory_for_note(&root, "").expect("attachment root"), root.join(ATTACHMENTS_DIR));
  }

  #[test]
  fn backlinks_find_notes_using_wiki_links_with_aliases() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::create_dir_all(root.join("escola")).expect("create folder");
    fs::write(root.join("escola").join("portugues.md"), "# Portugues").expect("write target");
    fs::write(root.join("historia.md"), "Veja [[escola/portugues|a aula de portugues]].").expect("write backlink");

    let backlinks = get_backlinks_in_root(&root, "escola/portugues.md").expect("get backlinks");

    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].relative_path, "historia.md");
    assert_eq!(extract_wiki_links("[[nota#secao]]"), vec!["nota.md"]);
  }

  #[test]
  fn tag_index_extracts_unique_tags_and_their_notes() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::write(root.join("aula.md"), "# Titulo\n#portugues #Revisao").expect("write first note");
    fs::write(root.join("resumo.md"), "#portugues").expect("write second note");

    let tags = get_tag_index_in_root(&root).expect("tag index");

    assert_eq!(extract_tags("#tag #tag #outra-tag"), vec!["outra-tag", "tag"]);
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].tag, "portugues");
    assert_eq!(tags[0].note_paths, vec!["aula.md", "resumo.md"]);
  }

  #[test]
  fn search_notes_finds_content_and_returns_an_excerpt() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    fs::write(root.join("historia.md"), "# Historia\nImperio Romano e #revisao").expect("write note");
    let results = search_notes_in_root(&root, "romano").expect("search notes");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].relative_path, "historia.md");
    assert!(results[0].excerpt.contains("Romano"));
  }

  #[test]
  fn recent_vault_preference_defaults_to_confirmation() {
    let preference = RecentVaultPreference::default();

    assert!(preference.last_vault_path.is_none());
    assert!(preference.ask_before_reopen);
  }

  #[test]
  fn history_reverts_and_reapplies_created_notes() {
    let temporary_directory = tempdir().expect("temp dir");
    let root = temporary_directory.path().canonicalize().expect("canonical root");
    let relative_path = "area/nota.md".to_string();
    let content = "# Nota\n".to_string();

    let command = HistoryCommand::CreateNote { relative_path: relative_path.clone(), content: content.clone() };
    apply_history_command(&root, &command, false).expect("create note");
    record_history(&root, command.clone()).expect("record history");
    assert!(root.join(&relative_path).is_file());
    assert_eq!(read_history(&root).expect("history").undo.len(), 1);

    apply_history_command(&root, &command, true).expect("undo note");
    assert!(!root.join(&relative_path).exists());
  }
}
