use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
  collections::HashSet,
  fs,
  path::{Path, PathBuf},
  sync::Mutex,
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
      read_note,
      save_note,
      create_note
      ,undo_last_command,
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
    apply_history_command, collect_markdown_files, ensure_metadata_layout, inspect_metadata,
    record_history, resolve_note_path, HistoryCommand, read_history,
    validate_vault_name, RecentVaultPreference,
    ASSESSMENTS_DIR, CONFIG_FILE, METADATA_DIR, REVIEW_PLANS_DIR, SESSIONS_DIR,
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
