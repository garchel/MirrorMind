use anyhow::{bail, Context, Result};
use notify::{
    event::ModifyKind, Event as NotifyEvent, EventKind as NotifyEventKind, RecommendedWatcher,
    RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

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
const MAX_OBSIDIAN_APP_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_OBSIDIAN_PREFERENCE_UTF16_UNITS: usize = 1024;
const MAX_OBSIDIAN_IGNORE_FILTERS: usize = 256;
const SUPPORTED_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "avif", "bmp", "flac", "gif", "jpeg", "jpg", "m4a", "mkv", "mov", "mp3", "mp4", "ogg", "pdf",
    "png", "svg", "wav", "webm", "webp",
];
const TEMPLATES_FILE: &str = "templates.json";
const MAX_PDF_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TAG_FRONTMATTER_BYTES: usize = 256 * 1024;
const MAX_TAG_INDEX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TAG_INDEX_ENTRIES: usize = 10_000;
const MAX_TAG_INDEX_NOTES: usize = 10_000;
const MAX_TAG_LENGTH: usize = 128;
const MAX_TAG_NOTE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TAGS_PER_NOTE: usize = 256;
static NEXT_VAULT_WATCHER_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_LINK_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HistoryCommand {
    CreateNote {
        relative_path: String,
        content: String,
    },
    SaveNote {
        relative_path: String,
        before_content: String,
        after_content: String,
    },
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
    obsidian_preferences: Option<ObsidianPreferences>,
    metadata: VaultMetadata,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianPreferences {
    new_file_location: Option<String>,
    new_file_folder_path: Option<String>,
    attachment_folder_path: Option<String>,
    new_link_format: Option<String>,
    use_markdown_links: Option<bool>,
    always_update_links: Option<bool>,
    show_unsupported_files: Option<bool>,
    prompt_delete: Option<bool>,
    trash_option: Option<String>,
    #[serde(default)]
    user_ignore_filters: Vec<String>,
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

const MAX_SPECIAL_VAULT_FILES: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SpecialVaultFileKind {
    Canvas,
    Excalidraw,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpecialVaultFile {
    name: String,
    relative_path: String,
    kind: SpecialVaultFileKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpecialVaultInventory {
    files: Vec<SpecialVaultFile>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchResult {
    name: String,
    relative_path: String,
    excerpt: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteTemplate {
    id: String,
    name: String,
    content: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewPlan {
    relative_path: String,
    interval_days: u32,
    repetitions: u32,
    due_day: u64,
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
    let selected = app
        .dialog()
        .file()
        .set_title("Abrir vault existente")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let Some(selected_path) = selected.as_path() else {
        return Err("O seletor retornou um caminho nao suportado nesta plataforma.".to_string());
    };

    let canonical_root =
        canonicalize_directory(selected_path).map_err(|error| error.to_string())?;
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
    inspect_vault_path(&root)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_recent_vault_prompt_preference(
    app: AppHandle,
    ask_before_reopen: bool,
) -> Result<(), String> {
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
fn list_notes(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<NotePreview>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    collect_markdown_files(&root)
        .map(|paths| build_note_previews(&root, &paths))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_templates(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<NoteTemplate>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    read_templates(&root).map_err(|error| error.to_string())
}

fn read_templates(root: &Path) -> Result<Vec<NoteTemplate>> {
    ensure_metadata_layout(root)?;
    Ok(serde_json::from_str(&fs::read_to_string(
        root.join(METADATA_DIR).join(TEMPLATES_FILE),
    )?)
    .unwrap_or_default())
}

fn review_plan_path(root: &Path, relative_path: &str) -> PathBuf {
    root.join(METADATA_DIR).join(REVIEW_PLANS_DIR).join(format!(
        "{}.json",
        relative_path.replace(['/', '\\', '.'], "_")
    ))
}
fn today_day() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}

#[tauri::command]
fn review_note(
    path: String,
    relative_path: String,
    quality: u8,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<ReviewPlan, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let note = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
    if !note.exists() {
        return Err("A nota nao existe mais.".to_string());
    }
    ensure_metadata_layout(&root).map_err(|error| error.to_string())?;
    let plan_path = review_plan_path(&root, &relative_path);
    let old: ReviewPlan = fs::read_to_string(&plan_path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or(ReviewPlan {
            relative_path: relative_path.clone(),
            interval_days: 1,
            repetitions: 0,
            due_day: today_day(),
        });
    let interval_days = if quality <= 1 {
        1
    } else if quality == 2 {
        old.interval_days.max(1) * 2
    } else {
        old.interval_days.max(1) * 3
    };
    let plan = ReviewPlan {
        relative_path,
        interval_days,
        repetitions: old.repetitions + 1,
        due_day: today_day() + interval_days as u64,
    };
    let serialized = serde_json::to_string_pretty(&plan).map_err(|error| error.to_string())?;
    fs::write(plan_path, serialized).map_err(|error| error.to_string())?;
    Ok(plan)
}

#[tauri::command]
fn search_notes(
    path: String,
    query: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<NoteSearchResult>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    search_notes_in_root(&root, &query).map_err(|error| error.to_string())
}

fn search_notes_in_root(root: &Path, query: &str) -> Result<Vec<NoteSearchResult>> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    for note_path in collect_markdown_files(root)? {
        let relative_path = to_relative_display(root, &note_path);
        let content = fs::read_to_string(&note_path)?;
        let haystack = format!("{relative_path}\n{content}").to_ascii_lowercase();
        if !haystack.contains(&normalized) {
            continue;
        }
        let excerpt = content
            .lines()
            .find(|line| line.to_ascii_lowercase().contains(&normalized))
            .unwrap_or("Correspondencia no titulo ou caminho.")
            .trim();
        results.push(NoteSearchResult {
            name: note_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            relative_path,
            excerpt: excerpt.chars().take(140).collect(),
        });
    }
    results.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(results)
}

#[tauri::command]
fn list_favorites(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<String>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    read_favorites(&root).map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_favorite(
    path: String,
    relative_path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<String>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let note = resolve_note_path(&root, &relative_path).map_err(|error| error.to_string())?;
    if !note.exists() {
        return Err("A nota nao existe mais.".to_string());
    }
    let mut favorites = read_favorites(&root).map_err(|error| error.to_string())?;
    let path = to_relative_display(&root, &note);
    if favorites.contains(&path) {
        favorites.retain(|item| item != &path);
    } else {
        favorites.push(path);
        favorites.sort();
    }
    write_favorites(&root, &favorites).map_err(|error| error.to_string())?;
    Ok(favorites)
}

fn read_favorites(root: &Path) -> Result<Vec<String>> {
    ensure_metadata_layout(root)?;
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(
        root.join(METADATA_DIR).join(CONFIG_FILE),
    )?)
    .unwrap_or_else(|_| json!({}));
    Ok(value
        .get("favorites")
        .and_then(|entry| entry.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

fn write_favorites(root: &Path, favorites: &[String]) -> Result<()> {
    ensure_metadata_layout(root)?;
    let path = root.join(METADATA_DIR).join(CONFIG_FILE);
    let mut value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path)?).unwrap_or_else(|_| json!({}));
    value["favorites"] = json!(favorites);
    fs::write(path, serde_json::to_string_pretty(&value)?)?;
    Ok(())
}

#[tauri::command]
fn list_folders(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<String>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    collect_folders(&root)
        .map(|folders| {
            folders
                .iter()
                .map(|folder| to_relative_display(&root, folder))
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_attachments(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<String>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    collect_attachment_files(&root)
        .map(|attachments| {
            attachments
                .iter()
                .map(|attachment| to_relative_display(&root, attachment))
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_pdf_attachment(
    path: String,
    relative_path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<tauri::ipc::Response, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    read_pdf_attachment_in_root(&root, &relative_path)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

fn read_pdf_attachment_in_root(root: &Path, relative_path: &str) -> Result<Vec<u8>> {
    let canonical_root = canonicalize_directory(root)?;
    let normalized = relative_path.trim().replace('\\', "/");
    let candidate = Path::new(&normalized);
    if normalized.is_empty()
        || candidate.is_absolute()
        || candidate.components().any(|component| match component {
            std::path::Component::Normal(segment) => segment.to_string_lossy().starts_with('.'),
            _ => true,
        })
        || !candidate
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        bail!("Escolha um PDF valido do inventario de anexos.");
    }

    let requested = canonical_root.join(candidate);
    if fs::symlink_metadata(&requested).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("Links simbolicos nao podem ser usados como anexos PDF.");
    }
    let canonical_requested = requested
        .canonicalize()
        .with_context(|| "O PDF incorporado nao foi encontrado.")?;
    if !canonical_requested.starts_with(&canonical_root) {
        bail!("O PDF precisa ficar dentro do Vault atual.");
    }

    let is_inventoried = collect_attachment_files(&canonical_root)?
        .into_iter()
        .any(|attachment| {
            attachment
                .canonicalize()
                .is_ok_and(|path| path == canonical_requested)
        });
    if !is_inventoried {
        bail!("O PDF nao faz parte do inventario de anexos do Vault.");
    }

    let metadata = fs::metadata(&canonical_requested)?;
    if metadata.len() > MAX_PDF_ATTACHMENT_BYTES {
        bail!("O PDF excede o limite de 25 MB para visualizacao interna.");
    }
    fs::read(canonical_requested).context("Nao foi possivel ler o PDF incorporado.")
}

#[tauri::command]
fn list_special_files(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<SpecialVaultInventory, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    collect_special_vault_files(&root).map_err(|error| error.to_string())
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
    let note_paths = collect_markdown_files(root)?;
    let available_paths = note_paths
        .iter()
        .map(|path| to_relative_display(root, path))
        .collect::<Vec<_>>();
    for note_path in note_paths {
        let note_relative_path = to_relative_display(root, &note_path);
        if note_relative_path == target_relative_path {
            continue;
        }
        let content = fs::read_to_string(&note_path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
        if extract_wiki_link_targets(&content).iter().any(|link| {
            resolve_wiki_link_target(&link.path, &note_relative_path, &available_paths).as_deref()
                == Some(target_relative_path.as_str())
        }) {
            backlinks.push(Backlink {
                name: note_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                relative_path: note_relative_path,
            });
        }
    }
    backlinks.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(backlinks)
}

#[tauri::command]
fn get_broken_links(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<BrokenLink>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    get_broken_links_in_root(&root).map_err(|error| error.to_string())
}

fn get_broken_links_in_root(root: &Path) -> Result<Vec<BrokenLink>> {
    let mut broken_links = Vec::new();
    let mut seen = HashSet::new();
    let note_paths = collect_markdown_files(root)?;
    let available_paths = note_paths
        .iter()
        .map(|path| to_relative_display(root, path))
        .collect::<Vec<_>>();
    for note_path in note_paths {
        let source_relative_path = to_relative_display(root, &note_path);
        let content = fs::read_to_string(&note_path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
        for raw_target in extract_wiki_link_targets(&content) {
            let resolved_target =
                resolve_wiki_link_target(&raw_target.path, &source_relative_path, &available_paths);
            let fragment_exists = if let (Some(target_path), Some(fragment)) =
                (resolved_target.as_ref(), raw_target.fragment.as_ref())
            {
                let target_content =
                    fs::read_to_string(root.join(target_path)).with_context(|| {
                        format!("Nao foi possivel ler o destino '{}'.", target_path)
                    })?;
                markdown_fragment_exists(&target_content, fragment)
            } else {
                true
            };
            if resolved_target.is_none() || !fragment_exists {
                let normalized_path = if raw_target.path.is_empty() {
                    source_relative_path.clone()
                } else {
                    let Some(target) = normalize_wiki_link_target(&raw_target.path) else {
                        continue;
                    };
                    target
                };
                let target = raw_target
                    .fragment
                    .as_ref()
                    .map_or(normalized_path.clone(), |fragment| {
                        format!("{normalized_path}#{fragment}")
                    });
                if !seen.insert((source_relative_path.clone(), target.clone())) {
                    continue;
                }
                broken_links.push(BrokenLink {
                    target,
                    source_name: note_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    source_relative_path: source_relative_path.clone(),
                });
            }
        }
    }
    broken_links.sort_by(|left, right| {
        left.source_relative_path
            .cmp(&right.source_relative_path)
            .then(left.target.cmp(&right.target))
    });
    Ok(broken_links)
}

#[tauri::command]
fn get_tag_index(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<TagSummary>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    get_tag_index_in_root(&root).map_err(|error| error.to_string())
}

fn get_tag_index_in_root(root: &Path) -> Result<Vec<TagSummary>> {
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let note_paths = collect_markdown_files(root)?;
    if note_paths.len() > MAX_TAG_INDEX_NOTES {
        bail!("O Vault excede o limite seguro de notas para indexacao de tags.");
    }
    let mut indexed_bytes = 0_u64;
    for note_path in note_paths {
        let note_bytes = fs::metadata(&note_path)
            .with_context(|| format!("Nao foi possivel inspecionar '{}'.", note_path.display()))?
            .len();
        if note_bytes > MAX_TAG_NOTE_BYTES
            || indexed_bytes.saturating_add(note_bytes) > MAX_TAG_INDEX_BYTES
        {
            bail!("O Vault excede o limite seguro de dados para indexacao de tags.");
        }
        indexed_bytes += note_bytes;
        let content = fs::read_to_string(&note_path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
        let relative_path = to_relative_display(root, &note_path);
        for tag in extract_tags(&content)? {
            tags.entry(tag).or_default().push(relative_path.clone());
            if tags.len() > MAX_TAG_INDEX_ENTRIES {
                bail!("O Vault excede o limite seguro de tags unicas.");
            }
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

fn extract_tags(content: &str) -> Result<Vec<String>> {
    let (frontmatter, body) = split_frontmatter_for_tags(content).unwrap_or(("", content));
    let mut tags = HashSet::new();
    collect_markdown_body_tags(body, &mut tags);

    for tag in extract_frontmatter_tags(frontmatter) {
        tags.insert(tag);
    }

    if tags.len() > MAX_TAGS_PER_NOTE {
        bail!("Uma nota excede o limite seguro de tags.");
    }

    let mut result = tags.into_iter().collect::<Vec<_>>();
    result.sort();
    Ok(result)
}

fn collect_markdown_body_tags(body: &str, tags: &mut HashSet<String>) {
    let mut fence: Option<(u8, usize)> = None;
    let mut html_block: Option<(String, isize)> = None;
    let mut in_html_comment = false;
    let mut in_obsidian_comment = false;

    for line in body.split_inclusive('\n') {
        let line = line.strip_suffix('\n').unwrap_or(line);
        let markdown_line = line.strip_suffix('\r').unwrap_or(line);
        if let Some((tag, depth)) = html_block.as_mut() {
            *depth += markdown_html_tag_depth_delta(markdown_line, tag);
            if *depth <= 0 || markdown_line.trim().is_empty() {
                html_block = None;
            }
            continue;
        }
        if let Some((marker, minimum_length)) = fence {
            if markdown_fence_closes(markdown_line, marker, minimum_length) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = markdown_fence_marker(markdown_line) {
            fence = Some(marker);
            continue;
        }
        if markdown_line.starts_with("    ") || markdown_line.starts_with('\t') {
            continue;
        }
        if let Some(tag) = markdown_html_block_tag(markdown_line) {
            let depth = markdown_html_tag_depth_delta(markdown_line, &tag);
            if depth > 0 {
                html_block = Some((tag, depth));
            }
            continue;
        }
        collect_tags_in_markdown_line(
            markdown_line,
            tags,
            &mut in_html_comment,
            &mut in_obsidian_comment,
        );
    }
}

fn collect_tags_in_markdown_line(
    line: &str,
    tags: &mut HashSet<String>,
    in_html_comment: &mut bool,
    in_obsidian_comment: &mut bool,
) {
    let characters = line.chars().collect::<Vec<_>>();
    let mut inline_code: Option<usize> = None;
    let mut index = 0;
    while index < characters.len() {
        if *in_html_comment {
            if characters[index..].starts_with(&['-', '-', '>']) {
                *in_html_comment = false;
                index += 3;
            } else {
                index += 1;
            }
            continue;
        }
        if *in_obsidian_comment {
            if characters[index..].starts_with(&['%', '%']) {
                *in_obsidian_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if characters[index..].starts_with(&['<', '!', '-', '-']) {
            *in_html_comment = true;
            index += 4;
            continue;
        }
        if characters[index..].starts_with(&['%', '%']) {
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
            index += run_length;
            continue;
        }
        if inline_code.is_some() || characters[index] != '#' {
            index += 1;
            continue;
        }
        if index > 0 {
            let previous = characters[index - 1];
            if previous.is_alphanumeric()
                || is_combining_mark(previous)
                || matches!(previous, '_' | '#' | '/' | '\\')
            {
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
        if let Some(tag) = normalize_tag(&characters[index + 1..end].iter().collect::<String>()) {
            tags.insert(tag);
        }
        index = end.max(index + 1);
    }
}

fn split_frontmatter_for_tags(content: &str) -> Option<(&str, &str)> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let (remaining, delimiter) = content
        .strip_prefix("---\r\n")
        .map(|remaining| (remaining, "\r\n---"))
        .or_else(|| {
            content
                .strip_prefix("---\n")
                .map(|remaining| (remaining, "\n---"))
        })?;
    let (frontmatter, after_delimiter) = remaining.split_once(delimiter)?;
    let body = after_delimiter
        .strip_prefix("\r\n")
        .or_else(|| after_delimiter.strip_prefix('\n'))
        .unwrap_or(after_delimiter);
    Some((frontmatter, body))
}

fn extract_frontmatter_tags(frontmatter: &str) -> Vec<String> {
    if frontmatter.len() > MAX_TAG_FRONTMATTER_BYTES {
        return Vec::new();
    }
    let Ok(properties) = serde_yaml_ng::from_str::<TagFrontmatter>(frontmatter) else {
        return Vec::new();
    };
    let mut tags = Vec::new();
    if let Some(value) = properties.tags.as_ref() {
        collect_frontmatter_tag_values(value, &mut tags);
    }
    tags.sort();
    tags.dedup();
    tags
}

#[derive(Deserialize)]
struct TagFrontmatter {
    tags: Option<FrontmatterTagValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FrontmatterTagValue {
    Text(String),
    Sequence(Vec<FrontmatterTagValue>),
    Unsupported(serde::de::IgnoredAny),
}

fn collect_frontmatter_tag_values(value: &FrontmatterTagValue, tags: &mut Vec<String>) {
    match value {
        FrontmatterTagValue::Text(value) => {
            for candidate in value.split(',') {
                if let Some(tag) = normalize_tag(candidate) {
                    tags.push(tag);
                }
            }
        }
        FrontmatterTagValue::Sequence(values) => {
            for value in values {
                collect_frontmatter_tag_values(value, tags);
            }
        }
        FrontmatterTagValue::Unsupported(_) => {}
    }
}

fn normalize_tag(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let tag = trimmed
        .strip_prefix('#')
        .unwrap_or(trimmed)
        .nfc()
        .collect::<String>();
    if tag.is_empty()
        || tag.chars().count() > MAX_TAG_LENGTH
        || tag.starts_with('/')
        || tag.ends_with('/')
        || tag.contains("//")
        || !tag.chars().all(|character| {
            character.is_alphanumeric()
                || is_combining_mark(character)
                || matches!(character, '_' | '-' | '/')
        })
    {
        return None;
    }
    Some(tag.to_lowercase())
}

fn normalize_wiki_link_target(target: &str) -> Option<String> {
    let normalized = target.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.contains("..")
        || normalized.starts_with('/')
        || Path::new(&normalized).is_absolute()
    {
        return None;
    }
    Some(if normalized.to_ascii_lowercase().ends_with(".md") {
        normalized
    } else {
        format!("{normalized}.md")
    })
}

#[derive(Debug, PartialEq)]
struct WikiLinkTarget {
    path: String,
    fragment: Option<String>,
}

fn extract_wiki_link_targets(content: &str) -> Vec<WikiLinkTarget> {
    let mut links = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut in_html_comment = false;
    let mut in_obsidian_comment = false;
    let mut html_block: Option<String> = None;

    for line in content.lines() {
        let lower_line = line.to_lowercase();
        if let Some(tag) = html_block.as_ref() {
            if lower_line.contains(&format!("</{tag}")) {
                html_block = None;
            }
            continue;
        }
        if let Some((marker, minimum_length)) = fence {
            if markdown_fence_closes(line, marker, minimum_length) {
                fence = None;
            }
            continue;
        }

        if let Some(marker) = markdown_fence_marker(line) {
            fence = Some(marker);
            continue;
        }

        if line.starts_with("    ") || line.starts_with('\t') {
            continue;
        }

        if let Some(tag) = markdown_html_block_tag(line) {
            if !lower_line.contains(&format!("</{tag}")) {
                html_block = Some(tag);
            }
            continue;
        }

        extract_wiki_link_targets_from_line(
            line,
            &mut in_html_comment,
            &mut in_obsidian_comment,
            &mut links,
        );
    }
    links
}

fn markdown_fence_marker(line: &str) -> Option<(u8, usize)> {
    let line = markdown_container_content(line);
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    if indentation > 3 {
        return None;
    }

    let bytes = line.as_bytes();
    let marker = *bytes.get(indentation)?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let length = bytes[indentation..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    (length >= 3).then_some((marker, length))
}

fn markdown_fence_closes(line: &str, marker: u8, minimum_length: usize) -> bool {
    let line = markdown_container_content(line);
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    let Some((candidate, length)) = markdown_fence_marker(line) else {
        return false;
    };
    candidate == marker
        && length >= minimum_length
        && line[indentation + length..].trim().is_empty()
}

fn markdown_container_content(mut line: &str) -> &str {
    loop {
        let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
        if indentation > 3 {
            return line;
        }
        let candidate = &line[indentation..];
        if let Some(after_quote) = candidate.strip_prefix('>') {
            line = after_quote.strip_prefix(' ').unwrap_or(after_quote);
            continue;
        }
        let list_marker_length = if candidate.starts_with("- ")
            || candidate.starts_with("* ")
            || candidate.starts_with("+ ")
        {
            Some(2)
        } else {
            candidate
                .find(['.', ')'])
                .filter(|index| *index > 0 && *index <= 9)
                .filter(|index| {
                    candidate[..*index]
                        .chars()
                        .all(|character| character.is_ascii_digit())
                })
                .filter(|index| candidate.as_bytes().get(index + 1) == Some(&b' '))
                .map(|index| index + 2)
        };
        if let Some(marker_length) = list_marker_length {
            line = &candidate[marker_length..];
            continue;
        }
        return line;
    }
}

fn markdown_html_block_tag(line: &str) -> Option<String> {
    const BLOCK_TAGS: &[&str] = &[
        "address",
        "article",
        "aside",
        "base",
        "basefont",
        "body",
        "blockquote",
        "caption",
        "center",
        "col",
        "colgroup",
        "dd",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "frame",
        "frameset",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "header",
        "hr",
        "html",
        "iframe",
        "legend",
        "li",
        "link",
        "main",
        "menu",
        "menuitem",
        "nav",
        "noframes",
        "ol",
        "optgroup",
        "option",
        "p",
        "param",
        "pre",
        "search",
        "script",
        "section",
        "style",
        "summary",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "textarea",
        "title",
        "tr",
        "track",
        "ul",
    ];
    let trimmed = line.trim_start().to_lowercase();
    BLOCK_TAGS.iter().find_map(|tag| {
        let opening = format!("<{tag}");
        if !trimmed.starts_with(&opening) {
            return None;
        }
        trimmed
            .as_bytes()
            .get(opening.len())
            .is_none_or(|next| next.is_ascii_whitespace() || matches!(*next, b'>' | b'/'))
            .then(|| (*tag).to_string())
    })
}

fn markdown_html_tag_depth_delta(line: &str, tag: &str) -> isize {
    let lower = line.to_lowercase();
    let bytes = lower.as_bytes();
    let tag_bytes = tag.as_bytes();
    let mut delta = 0;
    let mut index = 0;
    while index < bytes.len() {
        let Some(relative_start) = bytes[index..].iter().position(|byte| *byte == b'<') else {
            break;
        };
        index += relative_start + 1;
        let is_closing = bytes.get(index) == Some(&b'/');
        if is_closing {
            index += 1;
        }
        if bytes[index..].starts_with(tag_bytes) {
            let boundary = bytes.get(index + tag_bytes.len());
            if boundary
                .is_none_or(|byte| byte.is_ascii_whitespace() || matches!(*byte, b'>' | b'/'))
            {
                delta += if is_closing { -1 } else { 1 };
            }
        }
    }
    delta
}

fn markdown_code_line_mask(lines: &[&str]) -> Vec<bool> {
    let mut mask = vec![false; lines.len()];
    let mut fence: Option<(u8, usize)> = None;
    for (index, line) in lines.iter().enumerate() {
        if let Some((marker, minimum_length)) = fence {
            mask[index] = true;
            if markdown_fence_closes(line, marker, minimum_length) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = markdown_fence_marker(line) {
            mask[index] = true;
            fence = Some(marker);
        } else if line.starts_with("    ") || line.starts_with('\t') {
            mask[index] = true;
        }
    }
    mask
}

fn normalize_markdown_heading(value: &str) -> String {
    let characters = value.chars().collect::<Vec<_>>();
    let mut visible = String::new();
    let mut index = 0;
    while index < characters.len() {
        let image_offset = usize::from(characters[index] == '!');
        if characters.get(index + image_offset) == Some(&'[') {
            if let Some(label_end_offset) = characters[index + image_offset + 1..]
                .iter()
                .position(|character| *character == ']')
            {
                let label_start = index + image_offset + 1;
                let label_end = label_start + label_end_offset;
                if characters.get(label_end + 1) == Some(&'(') {
                    if let Some(destination_end_offset) = characters[label_end + 2..]
                        .iter()
                        .position(|character| *character == ')')
                    {
                        visible.extend(characters[label_start..label_end].iter());
                        index = label_end + 3 + destination_end_offset;
                        continue;
                    }
                }
            }
        }
        if characters[index..].starts_with(&['[', '[']) {
            if let Some(link_end_offset) = characters[index + 2..]
                .windows(2)
                .position(|window| window == [']', ']'])
            {
                let link_end = index + 2 + link_end_offset;
                let link_text = characters[index + 2..link_end].iter().collect::<String>();
                visible.push_str(
                    link_text
                        .rsplit_once('|')
                        .map_or(&link_text, |(_, alias)| alias),
                );
                index = link_end + 2;
                continue;
            }
        }
        visible.push(characters[index]);
        index += 1;
    }

    let decoded = html_escape::decode_html_entities(&visible);

    let mut unescaped = String::new();
    let mut decoded_characters = decoded.chars().peekable();
    while let Some(character) = decoded_characters.next() {
        if character == '\\'
            && decoded_characters
                .peek()
                .is_some_and(|next| next.is_ascii_punctuation())
        {
            unescaped.push(decoded_characters.next().unwrap_or_default());
        } else {
            unescaped.push(character);
        }
    }

    let mut normalized = String::new();
    let mut in_html_tag = false;
    for character in unescaped.chars() {
        match character {
            '<' => in_html_tag = true,
            '>' if in_html_tag => in_html_tag = false,
            '`' | '*' | '_' | '~' if !in_html_tag => {}
            _ if !in_html_tag => normalized.push(character),
            _ => {}
        }
    }
    normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn markdown_fragment_exists(content: &str, fragment: &str) -> bool {
    let lines = content.lines().collect::<Vec<_>>();
    let code_lines = markdown_code_line_mask(&lines);
    if let Some(block_id) = fragment.strip_prefix('^') {
        let suffix = format!("^{block_id}");
        return lines.iter().enumerate().any(|(index, line)| {
            if code_lines[index] {
                return false;
            }
            let trimmed = line.trim_end();
            let Some(prefix) = trimmed.strip_suffix(&suffix) else {
                return false;
            };
            prefix.is_empty() || prefix.chars().last().is_some_and(char::is_whitespace)
        });
    }

    let target_path = fragment
        .split('#')
        .map(normalize_markdown_heading)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if target_path.is_empty() {
        return false;
    }

    let mut hierarchy = Vec::<String>::new();
    for (index, line) in lines.iter().enumerate() {
        if code_lines[index] {
            continue;
        }
        let trimmed = line.trim_start();
        let marker_length = trimmed.bytes().take_while(|byte| *byte == b'#').count();
        let atx = (1..=6).contains(&marker_length)
            && trimmed
                .as_bytes()
                .get(marker_length)
                .is_some_and(u8::is_ascii_whitespace);
        let setext_marker = lines
            .get(index + 1)
            .filter(|_| !code_lines.get(index + 1).copied().unwrap_or(true))
            .map(|next| next.trim())
            .filter(|next| {
                !next.is_empty()
                    && (next.bytes().all(|byte| byte == b'=')
                        || next.bytes().all(|byte| byte == b'-'))
            });
        if !atx && setext_marker.is_none() {
            continue;
        }

        let level = if atx {
            marker_length
        } else if setext_marker.is_some_and(|marker| marker.starts_with('=')) {
            1
        } else {
            2
        };
        let title = if atx {
            trimmed[marker_length..].trim().trim_end_matches('#').trim()
        } else {
            line.trim()
        };
        hierarchy.truncate(level.saturating_sub(1));
        hierarchy.push(normalize_markdown_heading(title));
        let title_matches = target_path.len() == 1 && hierarchy.last() == target_path.last();
        let path_matches = hierarchy.len() >= target_path.len()
            && hierarchy[hierarchy.len() - target_path.len()..] == target_path;
        if title_matches || path_matches {
            return true;
        }
    }
    false
}

fn extract_wiki_link_targets_from_line(
    line: &str,
    in_html_comment: &mut bool,
    in_obsidian_comment: &mut bool,
    links: &mut Vec<WikiLinkTarget>,
) {
    let bytes = line.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if *in_html_comment {
            let Some(comment_end) = line[index..].find("-->") else {
                return;
            };
            index += comment_end + 3;
            *in_html_comment = false;
            continue;
        }

        if bytes[index..].starts_with(b"<!--") {
            *in_html_comment = true;
            index += 4;
            continue;
        }

        if *in_obsidian_comment {
            let Some(comment_end) = line[index..].find("%%") else {
                return;
            };
            index += comment_end + 2;
            *in_obsidian_comment = false;
            continue;
        }

        if bytes[index..].starts_with(b"%%") && !is_escaped_at(bytes, index) {
            *in_obsidian_comment = true;
            index += 2;
            continue;
        }

        if bytes[index] == b'`' {
            let delimiter_length = bytes[index..]
                .iter()
                .take_while(|byte| **byte == b'`')
                .count();
            let mut closing_index = index + delimiter_length;
            let mut closing_delimiter = None;
            while closing_index < bytes.len() {
                if bytes[closing_index] == b'`' {
                    let candidate_length = bytes[closing_index..]
                        .iter()
                        .take_while(|byte| **byte == b'`')
                        .count();
                    if candidate_length == delimiter_length {
                        closing_delimiter = Some(closing_index + candidate_length);
                        break;
                    }
                    closing_index += candidate_length;
                } else {
                    closing_index += 1;
                }
            }
            index = closing_delimiter.unwrap_or(index + delimiter_length);
            continue;
        }

        if bytes[index] == b'<' {
            if let Some(tag_end) = bytes[index..].iter().position(|byte| *byte == b'>') {
                index += tag_end + 1;
                continue;
            }
        }

        if bytes[index..].starts_with(b"[[") && !is_escaped_at(bytes, index) {
            let content_start = index + 2;
            let Some(relative_end) = line[content_start..].find("]]") else {
                return;
            };
            let content_end = content_start + relative_end;
            let raw_link = &line[content_start..content_end];
            let target_and_fragment = raw_link.split('|').next().unwrap_or_default();
            let mut parts = target_and_fragment.splitn(2, '#');
            let target = parts.next().unwrap_or_default().trim().replace('\\', "/");
            let fragment = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if !target.is_empty() || target_and_fragment.trim_start().starts_with('#') {
                links.push(WikiLinkTarget {
                    path: target,
                    fragment,
                });
            }
            index = content_end + 2;
            continue;
        }

        index += 1;
    }
}

fn is_escaped_at(bytes: &[u8], index: usize) -> bool {
    let preceding_backslashes = bytes[..index]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count();
    preceding_backslashes % 2 == 1
}

fn resolve_wiki_link_target(
    raw_target: &str,
    source_relative_path: &str,
    available_paths: &[String],
) -> Option<String> {
    let normalize = |value: &str| value.replace('\\', "/").to_lowercase();
    let source = normalize(source_relative_path);
    if raw_target.trim().is_empty() {
        return available_paths
            .iter()
            .find(|path| normalize(path) == source)
            .cloned();
    }

    let link = normalize_wiki_link_target(raw_target)?;
    let normalized_link = normalize(&link);
    let exact_root = available_paths
        .iter()
        .find(|path| normalize(path) == normalized_link)
        .cloned();
    if normalized_link.contains('/') {
        return exact_root;
    }

    let source_folder = source
        .rsplit_once('/')
        .map(|(folder, _)| folder)
        .unwrap_or("");
    let relative_candidate = if source_folder.is_empty() {
        normalized_link.clone()
    } else {
        format!("{source_folder}/{normalized_link}")
    };
    if let Some(relative_match) = available_paths
        .iter()
        .find(|path| normalize(path) == relative_candidate)
    {
        return Some(relative_match.clone());
    }
    if exact_root.is_some() {
        return exact_root;
    }

    let source_segments = source_folder.split('/').collect::<Vec<_>>();
    let mut basename_matches = available_paths
        .iter()
        .filter(|path| normalize(path).rsplit('/').next() == Some(normalized_link.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    basename_matches.sort_by(|left, right| {
        let shared_prefix = |path: &str| {
            normalize(path)
                .split('/')
                .zip(source_segments.iter())
                .take_while(|(left_segment, right_segment)| *left_segment == **right_segment)
                .count()
        };
        shared_prefix(right)
            .cmp(&shared_prefix(left))
            .then_with(|| left.cmp(right))
    });
    basename_matches.into_iter().next()
}

#[cfg(test)]
fn extract_wiki_links(content: &str) -> Vec<String> {
    extract_wiki_link_targets(content)
        .into_iter()
        .filter_map(|target| normalize_wiki_link_target(&target.path))
        .collect()
}

fn rewrite_wiki_links(
    content: &str,
    reference_note_path_before_change: &str,
    reference_note_path_after_change: &str,
    path_changes: &[(String, String)],
    available_paths_before_change: &[String],
    available_paths_after_change: &[String],
) -> String {
    let mut rewritten = String::with_capacity(content.len());
    let mut fence: Option<(u8, usize)> = None;
    let mut in_html_comment = false;
    let mut in_obsidian_comment = false;
    let mut html_block: Option<(String, isize)> = None;

    for line in content.split_inclusive('\n') {
        let line_without_newline = line.strip_suffix('\n').unwrap_or(line);
        let markdown_line = line_without_newline
            .strip_suffix('\r')
            .unwrap_or(line_without_newline);
        let lower_line = markdown_line.to_lowercase();

        if html_block.is_some() {
            let should_close = {
                let (tag, depth) = html_block.as_mut().expect("checked HTML block");
                *depth += markdown_html_tag_depth_delta(markdown_line, tag);
                *depth <= 0 || markdown_line.trim().is_empty()
            };
            rewritten.push_str(line);
            if should_close {
                html_block = None;
            }
            continue;
        }
        if let Some((marker, minimum_length)) = fence {
            rewritten.push_str(line);
            if markdown_fence_closes(markdown_line, marker, minimum_length) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = markdown_fence_marker(markdown_line) {
            fence = Some(marker);
            rewritten.push_str(line);
            continue;
        }
        if markdown_line.starts_with("    ") || markdown_line.starts_with('\t') {
            rewritten.push_str(line);
            continue;
        }
        if let Some(tag) = markdown_html_block_tag(markdown_line) {
            let depth = markdown_html_tag_depth_delta(&lower_line, &tag);
            const VOID_TAGS: &[&str] = &[
                "base", "basefont", "col", "hr", "link", "menuitem", "param", "track",
            ];
            if depth > 0 && !VOID_TAGS.contains(&tag.as_str()) {
                html_block = Some((tag, depth));
            }
            rewritten.push_str(line);
            continue;
        }

        rewritten.push_str(&rewrite_wiki_links_in_line(
            line,
            reference_note_path_before_change,
            reference_note_path_after_change,
            path_changes,
            available_paths_before_change,
            available_paths_after_change,
            &mut in_html_comment,
            &mut in_obsidian_comment,
        ));
    }
    rewritten
}

fn rewrite_wiki_links_in_line(
    line: &str,
    reference_note_path_before_change: &str,
    reference_note_path_after_change: &str,
    path_changes: &[(String, String)],
    available_paths_before_change: &[String],
    available_paths_after_change: &[String],
    in_html_comment: &mut bool,
    in_obsidian_comment: &mut bool,
) -> String {
    let bytes = line.as_bytes();
    let mut rewritten = String::with_capacity(line.len());
    let mut copied_until = 0;
    let mut index = 0;

    while index < bytes.len() {
        if *in_html_comment {
            let Some(comment_end) = line[index..].find("-->") else {
                break;
            };
            index += comment_end + 3;
            *in_html_comment = false;
            continue;
        }
        if bytes[index..].starts_with(b"<!--") {
            *in_html_comment = true;
            index += 4;
            continue;
        }
        if *in_obsidian_comment {
            let Some(comment_end) = line[index..].find("%%") else {
                break;
            };
            index += comment_end + 2;
            *in_obsidian_comment = false;
            continue;
        }
        if bytes[index..].starts_with(b"%%") && !is_escaped_at(bytes, index) {
            *in_obsidian_comment = true;
            index += 2;
            continue;
        }
        if bytes[index] == b'`' {
            let delimiter_length = bytes[index..]
                .iter()
                .take_while(|byte| **byte == b'`')
                .count();
            let mut closing_index = index + delimiter_length;
            let mut closing_delimiter = None;
            while closing_index < bytes.len() {
                if bytes[closing_index] == b'`' {
                    let candidate_length = bytes[closing_index..]
                        .iter()
                        .take_while(|byte| **byte == b'`')
                        .count();
                    if candidate_length == delimiter_length {
                        closing_delimiter = Some(closing_index + candidate_length);
                        break;
                    }
                    closing_index += candidate_length;
                } else {
                    closing_index += 1;
                }
            }
            index = closing_delimiter.unwrap_or(index + delimiter_length);
            continue;
        }
        if bytes[index] == b'<' {
            if let Some(tag_end) = bytes[index..].iter().position(|byte| *byte == b'>') {
                index += tag_end + 1;
                continue;
            }
        }
        if bytes[index..].starts_with(b"[[") && !is_escaped_at(bytes, index) {
            let content_start = index + 2;
            let Some(relative_end) = line[content_start..].find("]]") else {
                break;
            };
            let content_end = content_start + relative_end;
            let raw_link = &line[content_start..content_end];
            let path_end = raw_link.find(['#', '|']).unwrap_or(raw_link.len());
            let raw_target = &raw_link[..path_end];
            let trimmed_target = raw_target.trim();
            let previous_target = (!trimmed_target.is_empty())
                .then(|| {
                    resolve_wiki_link_target(
                        trimmed_target,
                        reference_note_path_before_change,
                        available_paths_before_change,
                    )
                })
                .flatten();
            let desired_target = previous_target.map(|resolved| {
                path_changes
                    .iter()
                    .find(|(source, _)| resolved.replace('\\', "/").eq_ignore_ascii_case(source))
                    .map(|(_, target)| target.clone())
                    .unwrap_or(resolved)
            });
            let current_target = (!trimmed_target.is_empty())
                .then(|| {
                    resolve_wiki_link_target(
                        trimmed_target,
                        reference_note_path_after_change,
                        available_paths_after_change,
                    )
                })
                .flatten();
            let requires_rewrite = desired_target.as_ref().is_some_and(|desired| {
                current_target.as_ref().is_none_or(|current| {
                    !current
                        .replace('\\', "/")
                        .eq_ignore_ascii_case(&desired.replace('\\', "/"))
                })
            });

            if requires_rewrite {
                let leading_whitespace = raw_target.len() - raw_target.trim_start().len();
                let trailing_start = raw_target.trim_end().len();
                let desired_target = desired_target.expect("rewrite requires a resolved target");
                let replacement = if trimmed_target.to_ascii_lowercase().ends_with(".md") {
                    desired_target.as_str()
                } else {
                    desired_target.trim_end_matches(".md")
                };
                rewritten.push_str(&line[copied_until..content_start]);
                rewritten.push_str(&raw_target[..leading_whitespace]);
                rewritten.push_str(replacement);
                rewritten.push_str(&raw_target[trailing_start..]);
                rewritten.push_str(&raw_link[path_end..]);
                copied_until = content_end;
            }
            index = content_end + 2;
            continue;
        }
        index += 1;
    }

    rewritten.push_str(&line[copied_until..]);
    rewritten
}

struct PlannedWikiLinkUpdate {
    original_content: Vec<u8>,
    path_after_change: PathBuf,
    updated_content: Vec<u8>,
}

fn prepare_wiki_link_updates(
    root: &Path,
    path_changes: &[(String, String)],
    available_paths_before_change: &[String],
) -> Result<Vec<PlannedWikiLinkUpdate>> {
    let available_paths_after_change = available_paths_before_change
        .iter()
        .map(|path| {
            path_changes
                .iter()
                .find(|(source, _)| path.eq_ignore_ascii_case(source))
                .map(|(_, target)| target.clone())
                .unwrap_or_else(|| path.clone())
        })
        .collect::<Vec<_>>();
    let mut updates = Vec::new();
    for note_relative_path in available_paths_before_change {
        let note_path = resolve_note_path(root, note_relative_path)?;
        let note_path_after_change = path_changes
            .iter()
            .find(|(source, _)| note_relative_path.eq_ignore_ascii_case(source))
            .map(|(_, target)| target.as_str())
            .unwrap_or(note_relative_path);
        let reference_note_path_before_change = path_changes
            .iter()
            .find(|(source, _)| note_relative_path.eq_ignore_ascii_case(source))
            .map(|(source, _)| source.as_str())
            .unwrap_or(note_relative_path);
        let original_content = fs::read(&note_path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
        let content = std::str::from_utf8(&original_content).with_context(|| {
            format!(
                "A nota '{}' nao esta codificada como UTF-8 e impede a atualizacao segura dos links.",
                note_path.display()
            )
        })?;
        let updated_content = rewrite_wiki_links(
            content,
            reference_note_path_before_change,
            note_path_after_change,
            path_changes,
            available_paths_before_change,
            &available_paths_after_change,
        );
        if updated_content != content {
            updates.push(PlannedWikiLinkUpdate {
                original_content,
                path_after_change: root.join(note_path_after_change),
                updated_content: updated_content.into_bytes(),
            });
        }
    }
    Ok(updates)
}

struct StagedWikiLinkUpdate {
    staged_path: PathBuf,
    target_path: PathBuf,
}

struct LinkUpdateBackup {
    backup_path: PathBuf,
    original_content: Vec<u8>,
    target_path: PathBuf,
    updated_content: Vec<u8>,
}

fn temporary_sibling_path(target: &Path, extension: &str) -> Result<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("A nota nao possui uma pasta valida."))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    let id = NEXT_LINK_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(".{file_name}.mirmind-{id}.{extension}")))
}

fn restore_link_update_backups(backups: &[LinkUpdateBackup]) -> Result<()> {
    let mut failures = Vec::new();
    for backup in backups.iter().rev() {
        if backup.target_path.exists() {
            match fs::read(&backup.target_path) {
                Ok(content) if content == backup.updated_content => {
                    if let Err(error) = fs::remove_file(&backup.target_path) {
                        failures.push(format!(
                            "remover '{}': {error}",
                            backup.target_path.display()
                        ));
                        continue;
                    }
                }
                Ok(_) | Err(_) => match temporary_sibling_path(&backup.target_path, "conflict") {
                    Ok(conflict_path) => {
                        if let Err(error) = fs::rename(&backup.target_path, &conflict_path) {
                            failures.push(format!(
                                "preservar conflito de '{}': {error}",
                                backup.target_path.display()
                            ));
                            continue;
                        }
                    }
                    Err(error) => {
                        failures.push(error.to_string());
                        continue;
                    }
                },
            }
        }
        if let Err(error) = fs::rename(&backup.backup_path, &backup.target_path) {
            failures.push(format!(
                "restaurar '{}': {error}",
                backup.target_path.display()
            ));
        }
    }
    if !failures.is_empty() {
        bail!("Rollback incompleto: {}", failures.join("; "));
    }
    Ok(())
}

fn cleanup_staged_link_updates(staged_updates: &[StagedWikiLinkUpdate]) {
    for staged in staged_updates {
        if staged.staged_path.exists() {
            let _ = fs::remove_file(&staged.staged_path);
        }
    }
}

fn abort_link_update_transaction(
    error: anyhow::Error,
    backups: &[LinkUpdateBackup],
    staged_updates: &[StagedWikiLinkUpdate],
) -> anyhow::Error {
    let rollback_result = restore_link_update_backups(backups);
    cleanup_staged_link_updates(staged_updates);
    match rollback_result {
        Ok(()) => error,
        Err(rollback_error) => anyhow::anyhow!("{error}. {rollback_error}"),
    }
}

fn verify_link_update_path(root: &Path, path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Nao foi possivel verificar '{}'.", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!(
            "A nota '{}' nao e um arquivo regular seguro.",
            path.display()
        );
    }
    let canonical = path
        .canonicalize()
        .with_context(|| format!("Nao foi possivel verificar '{}'.", path.display()))?;
    if !canonical.starts_with(root) {
        bail!("A nota '{}' aponta para fora do Vault.", path.display());
    }
    Ok(())
}

fn update_wiki_links_for_note_path_change(
    root: &Path,
    updates: &[PlannedWikiLinkUpdate],
) -> Result<()> {
    update_wiki_links_for_note_path_change_with_hook(root, updates, |_| Ok(()))
}

fn update_wiki_links_for_note_path_change_with_hook<F>(
    root: &Path,
    updates: &[PlannedWikiLinkUpdate],
    mut after_commit: F,
) -> Result<()>
where
    F: FnMut(usize) -> Result<()>,
{
    for update in updates {
        verify_link_update_path(root, &update.path_after_change)?;
        let current_content = fs::read(&update.path_after_change).with_context(|| {
            format!(
                "Nao foi possivel verificar '{}'.",
                update.path_after_change.display()
            )
        })?;
        if current_content != update.original_content {
            bail!(
                "A nota '{}' foi alterada por outro aplicativo durante a renomeacao. Nenhum link foi sobrescrito.",
                update.path_after_change.display()
            );
        }
    }

    let mut staged_updates: Vec<StagedWikiLinkUpdate> = Vec::new();
    for update in updates {
        let staged_path = temporary_sibling_path(&update.path_after_change, "tmp")?;
        let stage_result = (|| -> Result<()> {
            let mut staged_file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged_path)
                .with_context(|| {
                    format!("Nao foi possivel preparar '{}'.", staged_path.display())
                })?;
            staged_file.write_all(&update.updated_content)?;
            staged_file.sync_all()?;
            let permissions = fs::metadata(&update.path_after_change)?.permissions();
            fs::set_permissions(&staged_path, permissions)?;
            Ok(())
        })();
        if let Err(error) = stage_result {
            let _ = fs::remove_file(&staged_path);
            for staged in &staged_updates {
                let _ = fs::remove_file(&staged.staged_path);
            }
            return Err(error);
        }
        staged_updates.push(StagedWikiLinkUpdate {
            staged_path,
            target_path: update.path_after_change.clone(),
        });
    }

    for update in updates {
        let current_content = match fs::read(&update.path_after_change) {
            Ok(content) => content,
            Err(error) => {
                cleanup_staged_link_updates(&staged_updates);
                return Err(error.into());
            }
        };
        if current_content != update.original_content {
            cleanup_staged_link_updates(&staged_updates);
            bail!(
                "A nota '{}' foi alterada durante a preparacao. Nenhum link foi sobrescrito.",
                update.path_after_change.display()
            );
        }
    }

    let mut backups: Vec<LinkUpdateBackup> = Vec::new();
    for (index, (update, staged)) in updates.iter().zip(&staged_updates).enumerate() {
        let commit_result = (|| -> Result<()> {
            verify_link_update_path(root, &staged.target_path)?;
            let backup_path = temporary_sibling_path(&staged.target_path, "bak")?;
            fs::hard_link(&staged.target_path, &backup_path).with_context(|| {
                format!(
                    "Nao foi possivel reservar backup de '{}'.",
                    staged.target_path.display()
                )
            })?;
            if let Err(error) = fs::remove_file(&staged.target_path) {
                let _ = fs::remove_file(&backup_path);
                return Err(error.into());
            }
            backups.push(LinkUpdateBackup {
                backup_path: backup_path.clone(),
                original_content: update.original_content.clone(),
                target_path: staged.target_path.clone(),
                updated_content: update.updated_content.clone(),
            });
            if fs::read(&backup_path)? != update.original_content {
                bail!(
                    "A nota '{}' foi alterada durante a substituicao.",
                    staged.target_path.display()
                );
            }
            fs::hard_link(&staged.staged_path, &staged.target_path).with_context(|| {
                format!(
                    "O destino '{}' foi ocupado durante a substituicao.",
                    staged.target_path.display()
                )
            })?;
            fs::remove_file(&staged.staged_path)?;
            after_commit(index)?;
            Ok(())
        })();
        if let Err(error) = commit_result {
            return Err(abort_link_update_transaction(
                error,
                &backups,
                &staged_updates,
            ));
        }
    }

    for backup in &backups {
        let backup_content = match fs::read(&backup.backup_path) {
            Ok(content) => content,
            Err(error) => {
                return Err(abort_link_update_transaction(
                    error.into(),
                    &backups,
                    &staged_updates,
                ));
            }
        };
        if backup_content != backup.original_content {
            return Err(abort_link_update_transaction(
                anyhow::anyhow!(
                    "A nota '{}' recebeu uma edicao concorrente durante a substituicao.",
                    backup.target_path.display()
                ),
                &backups,
                &staged_updates,
            ));
        }
    }

    for backup in backups {
        if let Err(error) = fs::remove_file(&backup.backup_path) {
            log::warn!(
                "could not remove completed link-update backup '{}': {error}",
                backup.backup_path.display()
            );
        }
    }
    cleanup_staged_link_updates(&staged_updates);
    Ok(())
}

fn note_path_changes_for_item(
    root: &Path,
    source: &Path,
    target: &Path,
    is_note: bool,
) -> Result<(Vec<String>, Vec<(String, String)>)> {
    let available_paths = collect_markdown_files_strict(root)?
        .iter()
        .map(|path| to_relative_display(root, path))
        .collect::<Vec<_>>();
    let source_relative = to_relative_display(root, source);
    let target_relative = to_relative_display(root, target);
    let path_changes = if is_note {
        vec![(source_relative, target_relative)]
    } else {
        let source_prefix = format!("{}/", source_relative.trim_end_matches('/'));
        let target_prefix = format!("{}/", target_relative.trim_end_matches('/'));
        available_paths
            .iter()
            .filter_map(|path| {
                path.strip_prefix(&source_prefix)
                    .map(|suffix| (path.clone(), format!("{target_prefix}{suffix}")))
            })
            .collect()
    };
    Ok((available_paths, path_changes))
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

    save_note_in_root(&root, &relative_path, &content).map_err(|error| error.to_string())
}

fn save_note_in_root(root: &Path, relative_path: &str, content: &str) -> Result<NoteDocument> {
    let note_path = resolve_note_path(root, relative_path)?;
    let before_content = fs::read_to_string(&note_path)
        .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    fs::write(&note_path, content.as_bytes())
        .with_context(|| format!("Nao foi possivel salvar '{}'.", note_path.display()))?;

    if before_content != content {
        record_history(
            root,
            HistoryCommand::SaveNote {
                relative_path: relative_path.to_string(),
                before_content,
                after_content: content.to_string(),
            },
        )?;
    }

    Ok(NoteDocument {
        name: note_path
            .file_name()
            .and_then(|segment| segment.to_str())
            .unwrap_or_default()
            .to_string(),
        relative_path: to_relative_display(root, &note_path),
        content: content.to_string(),
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
    write_new_file(&note_path, initial_content.as_bytes()).map_err(|error| error.to_string())?;

    record_history(
        &root,
        HistoryCommand::CreateNote {
            relative_path: relative_path.clone(),
            content: initial_content.clone(),
        },
    )
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

fn write_new_file(path: &Path, content: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("Nao foi possivel criar '{}'.", path.display()))?;
    file.write_all(content)
        .with_context(|| format!("Nao foi possivel escrever '{}'.", path.display()))
}

fn recover_note_in_root(root: &Path, relative_path: &str, content: &str) -> Result<NoteDocument> {
    let note_path = resolve_note_path(root, relative_path)?;
    if let Some(parent) = note_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Nao foi possivel criar '{}'.", parent.display()))?;
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&note_path)
        .with_context(|| {
            format!(
                "Nao foi possivel recuperar '{}'; o caminho pode ja existir.",
                note_path.display()
            )
        })?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(&note_path);
        return Err(error)
            .with_context(|| format!("Nao foi possivel recuperar '{}'.", note_path.display()));
    }

    if let Err(error) = record_history(
        root,
        HistoryCommand::CreateNote {
            relative_path: relative_path.to_string(),
            content: content.to_string(),
        },
    ) {
        log::warn!("A nota foi recuperada, mas nao entrou no historico: {error}");
    }

    Ok(NoteDocument {
        name: note_path
            .file_name()
            .and_then(|segment| segment.to_str())
            .unwrap_or_default()
            .to_string(),
        relative_path: to_relative_display(root, &note_path),
        content: content.to_string(),
    })
}

#[tauri::command]
fn recover_note(
    path: String,
    relative_path: String,
    content: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    recover_note_in_root(&root, &relative_path, &content).map_err(|error| error.to_string())
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
    let folder_path =
        resolve_folder_path(&root, &relative_path).map_err(|error| error.to_string())?;
    if folder_path.exists() {
        return Err(format!("A pasta '{}' ja existe.", folder_path.display()));
    }
    fs::create_dir_all(&folder_path)
        .with_context(|| format!("Nao foi possivel criar '{}'.", folder_path.display()))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn move_vault_path_without_overwrite(source: &Path, target: &Path, is_note: bool) -> Result<()> {
    if !is_note {
        #[cfg(unix)]
        {
            fs::create_dir(target)
                .with_context(|| format!("O destino seguro '{}' ja existe.", target.display()))?;
            let rename_result = fs::rename(source, target).with_context(|| {
                format!(
                    "Nao foi possivel mover '{}' para '{}'.",
                    source.display(),
                    target.display()
                )
            });
            if rename_result.is_err() {
                let _ = fs::remove_dir(target);
            }
            return rename_result;
        }

        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

            let source_wide = source
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let target_wide = target
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let moved = unsafe { MoveFileExW(source_wide.as_ptr(), target_wide.as_ptr(), 0) };
            if moved == 0 {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!(
                        "Nao foi possivel mover '{}' para '{}' sem sobrescrever o destino.",
                        source.display(),
                        target.display()
                    )
                });
            }
            return Ok(());
        }

        #[cfg(not(any(unix, windows)))]
        bail!("Movimentacao segura de pastas nao suportada nesta plataforma.");
    }

    fs::hard_link(source, target).with_context(|| {
        format!(
            "Nao foi possivel reservar o destino seguro '{}'.",
            target.display()
        )
    })?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error)
            .with_context(|| format!("Nao foi possivel remover '{}'.", source.display()));
    }
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

fn rename_vault_item_in_root(
    root: &Path,
    relative_path: &str,
    new_name: &str,
    item_type: &str,
) -> Result<()> {
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
    let parent = source
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta do item."))?;
    let destination = parent.join(destination_name);
    if destination.exists() {
        bail!("Ja existe um item com esse nome nessa pasta.");
    }

    let (available_paths_before_change, path_changes) =
        note_path_changes_for_item(root, &source, &destination, is_note)?;
    let planned_link_updates =
        prepare_wiki_link_updates(root, &path_changes, &available_paths_before_change)?;

    move_vault_path_without_overwrite(&source, &destination, is_note)
        .with_context(|| format!("Nao foi possivel renomear '{}'.", source.display()))?;
    if let Err(error) = update_wiki_links_for_note_path_change(root, &planned_link_updates) {
        move_vault_path_without_overwrite(&destination, &source, is_note).with_context(|| {
            format!(
                "A atualizacao dos links falhou e tambem nao foi possivel restaurar '{}'.",
                source.display()
            )
        })?;
        return Err(error);
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

fn move_vault_item_in_root(
    root: &Path,
    relative_path: &str,
    destination_folder: &str,
    item_type: &str,
) -> Result<()> {
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
    if !is_note
        && destination
            .canonicalize()?
            .starts_with(source.canonicalize()?)
    {
        bail!("Uma pasta nao pode ser movida para dentro dela mesma.");
    }

    let source_name = source
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("O item nao possui um nome valido."))?;
    let target = destination.join(source_name);
    if target.exists() {
        bail!("Ja existe um item com esse nome na pasta de destino.");
    }
    let (available_paths_before_change, path_changes) =
        note_path_changes_for_item(root, &source, &target, is_note)?;
    let planned_link_updates =
        prepare_wiki_link_updates(root, &path_changes, &available_paths_before_change)?;
    move_vault_path_without_overwrite(&source, &target, is_note)
        .with_context(|| format!("Nao foi possivel mover '{}'.", source.display()))?;
    if let Err(error) = update_wiki_links_for_note_path_change(root, &planned_link_updates) {
        move_vault_path_without_overwrite(&target, &source, is_note).with_context(|| {
            format!(
                "A atualizacao dos links falhou e tambem nao foi possivel restaurar '{}'.",
                source.display()
            )
        })?;
        return Err(error);
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
fn list_trash(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<TrashEntry>, String> {
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

    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .to_string();
    let source_name = source
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("O item nao possui um nome valido."))?
        .to_string_lossy();
    let trashed_name = format!("{id}-{source_name}");
    let trash_root = trash_root(root);
    fs::create_dir_all(&trash_root)?;
    let trash_path = trash_root.join(&trashed_name);
    fs::rename(&source, &trash_path).with_context(|| {
        format!(
            "Nao foi possivel mover '{}' para a lixeira.",
            source.display()
        )
    })?;

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
    let index = entries
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| anyhow::anyhow!("Item nao encontrado na lixeira."))?;
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
        bail!(
            "Ja existe um item no local original. Renomeie ou mova esse item antes de restaurar."
        );
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &destination).with_context(|| {
        format!(
            "Nao foi possivel restaurar '{}'.",
            entry.original_relative_path
        )
    })?;
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
        fs::remove_dir_all(&source).with_context(|| {
            format!(
                "Nao foi possivel excluir '{}' permanentemente.",
                entry.original_relative_path
            )
        })?;
    } else if source.exists() {
        fs::remove_file(&source).with_context(|| {
            format!(
                "Nao foi possivel excluir '{}' permanentemente.",
                entry.original_relative_path
            )
        })?;
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
    import_attachment_in_root(&root, Path::new(&source_path), &note_relative_path)
        .map_err(|error| error.to_string())
}

fn import_attachment_in_root(
    root: &Path,
    source_path: &Path,
    note_relative_path: &str,
) -> Result<Attachment> {
    if !source_path.is_file() {
        bail!("Selecione um arquivo valido para anexar.");
    }
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("O arquivo nao possui um nome valido."))?;
    let attachments_root = attachment_directory_for_note(root, note_relative_path)?;
    create_confined_attachment_directory(root, &attachments_root)?;
    let (destination, mut destination_file) =
        unique_attachment_path(&attachments_root, source_name)?;
    let copy_result = (|| -> Result<()> {
        let mut source_file = fs::File::open(source_path)
            .with_context(|| format!("Nao foi possivel abrir '{}'.", source_path.display()))?;
        io::copy(&mut source_file, &mut destination_file)
            .with_context(|| format!("Nao foi possivel copiar '{}'.", source_path.display()))?;
        destination_file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = copy_result {
        drop(destination_file);
        let _ = fs::remove_file(&destination);
        return Err(error);
    }

    Ok(Attachment {
        name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(source_name)
            .to_string(),
        relative_path: to_relative_display(root, &destination),
        is_image: is_image_path(&destination),
    })
}

fn create_confined_attachment_directory(root: &Path, directory: &Path) -> Result<()> {
    let canonical_root = canonicalize_directory(root)?;
    if !directory.starts_with(root) {
        bail!("A pasta de anexos precisa ficar dentro do Vault atual.");
    }
    let existing_ancestor = directory
        .ancestors()
        .find(|ancestor| ancestor.exists())
        .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar o Vault atual."))?;
    let canonical_ancestor = existing_ancestor.canonicalize().with_context(|| {
        format!(
            "Nao foi possivel verificar '{}'.",
            existing_ancestor.display()
        )
    })?;
    if !canonical_ancestor.starts_with(&canonical_root) {
        bail!("A pasta de anexos precisa ficar dentro do Vault atual.");
    }

    fs::create_dir_all(directory)?;
    let canonical_directory = directory
        .canonicalize()
        .with_context(|| format!("Nao foi possivel verificar '{}'.", directory.display()))?;
    if !canonical_directory.starts_with(&canonical_root) {
        bail!("A pasta de anexos precisa ficar dentro do Vault atual.");
    }
    Ok(())
}

fn attachment_directory_for_note(root: &Path, note_relative_path: &str) -> Result<PathBuf> {
    if let Some(configured_directory) = obsidian_attachment_directory(root, note_relative_path)? {
        return Ok(configured_directory);
    }

    if note_relative_path.trim().is_empty() {
        return Ok(root.join(ATTACHMENTS_DIR));
    }
    let note_path = resolve_note_path(root, note_relative_path)?;
    let note_parent = note_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta da nota."))?;
    let relative_parent = note_parent
        .strip_prefix(root)
        .map_err(|_| anyhow::anyhow!("A nota precisa ficar dentro do vault atual."))?;
    Ok(root.join(ATTACHMENTS_DIR).join(relative_parent))
}

fn obsidian_attachment_directory(root: &Path, note_relative_path: &str) -> Result<Option<PathBuf>> {
    let Some(configured_path) =
        read_obsidian_preferences(root).and_then(|preferences| preferences.attachment_folder_path)
    else {
        return Ok(None);
    };
    let configured_path = configured_path.trim().replace('\\', "/");

    if configured_path.is_empty() || configured_path == "/" {
        return Ok(Some(root.to_path_buf()));
    }

    let is_note_relative =
        configured_path == "." || configured_path == "./" || configured_path.starts_with("./");
    if is_note_relative
        && Path::new(note_relative_path)
            .components()
            .any(|component| match component {
                std::path::Component::Normal(segment) => segment.to_string_lossy().starts_with('.'),
                _ => false,
            })
    {
        bail!("A pasta de anexos relativa nao pode usar diretorios internos do Vault.");
    }
    let relative_value = if configured_path == "." || configured_path == "./" {
        ""
    } else if is_note_relative {
        configured_path.trim_start_matches("./")
    } else {
        configured_path.as_str()
    };
    let relative_path = Path::new(relative_value);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| match component {
            std::path::Component::Normal(segment) => segment.to_string_lossy().starts_with('.'),
            std::path::Component::CurDir => false,
            _ => true,
        })
    {
        bail!(
            "A configuracao de anexos do Obsidian precisa apontar para uma pasta segura do Vault."
        );
    }

    let base = if is_note_relative && !note_relative_path.trim().is_empty() {
        resolve_note_path(root, note_relative_path)?
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Nao foi possivel encontrar a pasta da nota."))?
            .to_path_buf()
    } else {
        root.to_path_buf()
    };
    Ok(Some(base.join(relative_path)))
}

fn read_obsidian_preferences(root: &Path) -> Option<ObsidianPreferences> {
    let canonical_root = root.canonicalize().ok()?;
    let config_path = root.join(".obsidian").join("app.json");
    let link_metadata = fs::symlink_metadata(&config_path).ok()?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return None;
    }
    let canonical_config = config_path.canonicalize().ok()?;
    if !canonical_config.starts_with(&canonical_root) {
        return None;
    }

    let mut file = fs::File::open(canonical_config).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_OBSIDIAN_APP_CONFIG_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_OBSIDIAN_APP_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_OBSIDIAN_APP_CONFIG_BYTES {
        return None;
    }
    let content = String::from_utf8(bytes).ok()?;
    let mut preferences = serde_json::from_str::<ObsidianPreferences>(&content).ok()?;

    fn bounded(value: &mut Option<String>) {
        if value
            .as_ref()
            .is_some_and(|text| text.encode_utf16().count() > MAX_OBSIDIAN_PREFERENCE_UTF16_UNITS)
        {
            *value = None;
        }
    }
    bounded(&mut preferences.new_file_location);
    bounded(&mut preferences.new_file_folder_path);
    bounded(&mut preferences.attachment_folder_path);
    bounded(&mut preferences.new_link_format);
    bounded(&mut preferences.trash_option);
    preferences
        .user_ignore_filters
        .retain(|filter| filter.encode_utf16().count() <= MAX_OBSIDIAN_PREFERENCE_UTF16_UNITS);
    preferences
        .user_ignore_filters
        .truncate(MAX_OBSIDIAN_IGNORE_FILTERS);
    Some(preferences)
}

fn unique_attachment_path(
    attachments_root: &Path,
    source_name: &str,
) -> Result<(PathBuf, fs::File)> {
    let stem = Path::new(source_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("anexo");
    let extension = Path::new(source_name)
        .extension()
        .and_then(|value| value.to_str());
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    for attempt in 0..10_000_u32 {
        let name = if attempt == 0 {
            source_name.to_string()
        } else {
            let suffix = if attempt == 1 {
                timestamp.to_string()
            } else {
                format!("{timestamp}-{attempt}")
            };
            extension
                .map(|extension| format!("{stem}-{suffix}.{extension}"))
                .unwrap_or_else(|| format!("{stem}-{suffix}"))
        };
        let destination = attachments_root.join(name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(file) => return Ok((destination, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    bail!("Nao foi possivel reservar um nome unico para o anexo.")
}

fn is_image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("avif" | "bmp" | "gif" | "jpeg" | "jpg" | "png" | "svg" | "webp")
    )
}

#[tauri::command]
fn undo_last_command(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<HistoryStatus, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let mut history = read_history(&root).map_err(|error| error.to_string())?;
    if let Some(command) = history.undo.pop() {
        apply_history_command(&root, &command, true).map_err(|error| error.to_string())?;
        history.redo.push(command);
        write_history(&root, &history).map_err(|error| error.to_string())?;
    }
    Ok(history_status(&history))
}

#[tauri::command]
fn redo_last_command(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<HistoryStatus, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let mut history = read_history(&root).map_err(|error| error.to_string())?;
    if let Some(command) = history.redo.pop() {
        apply_history_command(&root, &command, false).map_err(|error| error.to_string())?;
        history.undo.push(command);
        write_history(&root, &history).map_err(|error| error.to_string())?;
    }
    Ok(history_status(&history))
}

#[tauri::command]
fn get_history_status(
    path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<HistoryStatus, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    read_history(&root)
        .map(|history| history_status(&history))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_vault(
    app: AppHandle,
    parent_path: String,
    name: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<VaultSummary, String> {
    validate_vault_name(&name).map_err(|error| error.to_string())?;

    let parent =
        canonicalize_directory(Path::new(&parent_path)).map_err(|error| error.to_string())?;
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

fn write_recent_vault_preference(
    app: &AppHandle,
    preference: &RecentVaultPreference,
) -> Result<()> {
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
        obsidian_preferences: read_obsidian_preferences(&canonical_root),
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
    path.canonicalize()
        .with_context(|| format!("Nao foi possivel resolver '{}'.", path.display()))
}

fn validate_vault_name(name: &str) -> Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        bail!("O nome do vault nao pode ficar vazio.");
    }

    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if trimmed
        .chars()
        .any(|character| invalid.contains(&character))
    {
        bail!("O nome do vault possui caracteres invalidos para uma pasta.");
    }

    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        bail!("O nome do vault nao pode terminar com ponto ou espaco.");
    }

    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
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
    visit_directory(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut notes,
    );
    notes.sort();
    Ok(notes)
}

fn collect_markdown_files_strict(root: &Path) -> Result<Vec<PathBuf>> {
    fn visit(
        directory: &Path,
        canonical_root: &Path,
        visited_directories: &mut HashSet<PathBuf>,
        notes: &mut Vec<PathBuf>,
    ) -> Result<()> {
        let canonical_directory = directory.canonicalize().with_context(|| {
            format!(
                "Nao foi possivel verificar o diretorio '{}'.",
                directory.display()
            )
        })?;
        if !canonical_directory.starts_with(canonical_root) {
            bail!("Um diretorio do Vault aponta para fora da raiz autorizada.");
        }
        if !visited_directories.insert(canonical_directory) {
            return Ok(());
        }
        for entry in fs::read_dir(directory)
            .with_context(|| format!("Nao foi possivel listar '{}'.", directory.display()))?
        {
            let entry = entry.with_context(|| {
                format!(
                    "Nao foi possivel ler uma entrada em '{}'.",
                    directory.display()
                )
            })?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .with_context(|| format!("Nao foi possivel verificar '{}'.", path.display()))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if path
                    .file_name()
                    .and_then(|segment| segment.to_str())
                    .is_some_and(|name| name == METADATA_DIR || name.starts_with('.'))
                {
                    continue;
                }
                visit(&path, canonical_root, visited_directories, notes)?;
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if file_type.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                && !file_name.to_lowercase().ends_with(".excalidraw.md")
            {
                notes.push(path);
            }
        }
        Ok(())
    }

    let canonical_root = canonicalize_directory(root)?;
    let mut notes = Vec::new();
    let mut visited_directories = HashSet::new();
    visit(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut notes,
    )?;
    notes.sort();
    Ok(notes)
}

fn collect_attachment_files(root: &Path) -> Result<Vec<PathBuf>> {
    let canonical_root = canonicalize_directory(root)?;
    let mut attachments = Vec::new();
    let mut visited_directories = HashSet::new();
    visit_attachment_directory(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut attachments,
    );
    attachments.sort();
    Ok(attachments)
}

fn collect_special_vault_files(root: &Path) -> Result<SpecialVaultInventory> {
    let canonical_root = root.canonicalize()?;
    let mut visited_directories = HashSet::new();
    let mut files = Vec::new();
    visit_special_vault_directory(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut files,
    );
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let truncated = files.len() > MAX_SPECIAL_VAULT_FILES;
    files.truncate(MAX_SPECIAL_VAULT_FILES);
    Ok(SpecialVaultInventory { files, truncated })
}

fn special_vault_file_kind(path: &Path) -> Option<SpecialVaultFileKind> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.starts_with('.') {
        return None;
    }
    if name.ends_with(".excalidraw.md") || name.ends_with(".excalidraw") {
        return Some(SpecialVaultFileKind::Excalidraw);
    }
    if name.ends_with(".canvas") {
        return Some(SpecialVaultFileKind::Canvas);
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase);
    if extension.as_deref() == Some("md")
        || extension
            .as_deref()
            .is_some_and(|extension| SUPPORTED_ATTACHMENT_EXTENSIONS.contains(&extension))
    {
        return None;
    }
    Some(SpecialVaultFileKind::Unknown)
}

fn visit_special_vault_directory(
    directory: &Path,
    canonical_root: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    files: &mut Vec<SpecialVaultFile>,
) {
    if files.len() > MAX_SPECIAL_VAULT_FILES {
        return;
    }
    let canonical_directory = match directory.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            log::warn!(
                "skipping unreadable special-file directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };
    if !canonical_directory.starts_with(canonical_root)
        || !visited_directories.insert(canonical_directory)
    {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            log::warn!(
                "skipping unreadable special-file directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };
    for entry in entries.flatten() {
        if files.len() > MAX_SPECIAL_VAULT_FILES {
            return;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if path
                .file_name()
                .and_then(|segment| segment.to_str())
                .is_some_and(|name| name == METADATA_DIR || name.starts_with('.'))
            {
                continue;
            }
            visit_special_vault_directory(&path, canonical_root, visited_directories, files);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(kind) = special_vault_file_kind(&path) else {
            continue;
        };
        files.push(SpecialVaultFile {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            relative_path: to_relative_display(canonical_root, &path),
            kind,
        });
    }
}

fn collect_folders(root: &Path) -> Result<Vec<PathBuf>> {
    let canonical_root = canonicalize_directory(root)?;
    let mut folders = Vec::new();
    let mut visited_directories = HashSet::new();
    visit_folders(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut folders,
    );
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
            log::warn!(
                "skipping unreadable directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };
    if !canonical_directory.starts_with(canonical_root)
        || !visited_directories.insert(canonical_directory)
    {
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
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|segment| segment.to_str()) else {
            continue;
        };
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
            log::warn!(
                "skipping unreadable directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };

    if !canonical_directory.starts_with(canonical_root)
        || !visited_directories.insert(canonical_directory)
    {
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
                log::warn!(
                    "skipping unreadable entry in '{}': {error}",
                    directory.display()
                );
                continue;
            }
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                log::warn!(
                    "skipping entry with unreadable file type '{}': {error}",
                    path.display()
                );
                continue;
            }
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if path
                .file_name()
                .and_then(|segment| segment.to_str())
                .is_some_and(|name| name == METADATA_DIR || name.starts_with('.'))
            {
                continue;
            }

            visit_directory(&path, canonical_root, visited_directories, notes);
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if file_type.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            && !file_name.to_lowercase().ends_with(".excalidraw.md")
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
            log::warn!(
                "skipping unreadable attachment directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };
    if !canonical_directory.starts_with(canonical_root)
        || !visited_directories.insert(canonical_directory)
    {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            log::warn!(
                "skipping attachment directory '{}': {error}",
                directory.display()
            );
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if path
                .file_name()
                .and_then(|segment| segment.to_str())
                .is_some_and(|name| name == METADATA_DIR || name.starts_with('.'))
            {
                continue;
            }
            visit_attachment_directory(&path, canonical_root, visited_directories, attachments);
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    SUPPORTED_ATTACHMENT_EXTENSIONS
                        .iter()
                        .any(|supported| extension.eq_ignore_ascii_case(supported))
                })
        {
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
                    missing.push(format!(
                        "{} (invalido)",
                        to_relative_display(root, &config_path)
                    ));
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
    if fs::symlink_metadata(&resolved).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("Links simbolicos nao podem ser usados como notas.");
    }
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
            existing_ancestor.canonicalize().with_context(|| {
                format!(
                    "Nao foi possivel resolver '{}'.",
                    existing_ancestor.display()
                )
            })?
        };

        if !parent_path.starts_with(root) {
            bail!("A nota precisa ficar dentro do vault atual.");
        }
    }

    Ok(resolved)
}

fn resolve_folder_path(root: &Path, relative_path: &str) -> Result<PathBuf> {
    let trimmed = relative_path.trim().trim_matches(['/', '\\']);
    if trimmed.is_empty() {
        bail!("Defina um nome para a pasta.");
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("A pasta precisa usar um caminho relativo dentro do vault.");
    }
    if candidate
        .components()
        .any(|component| component.as_os_str() == METADATA_DIR)
    {
        bail!("A pasta .mirmind e reservada para metadados do app.");
    }
    let resolved = root.join(candidate);
    let existing_ancestor = resolved
        .ancestors()
        .find(|ancestor| ancestor.exists())
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
    if trimmed
        .chars()
        .any(|character| character == '/' || character == '\\')
    {
        bail!("Use apenas o novo nome, sem caminho.");
    }
    let without_extension = if is_note {
        trimmed.strip_suffix(".md").unwrap_or(trimmed)
    } else {
        trimmed
    };
    validate_vault_name(without_extension)?;
    Ok(if is_note {
        format!("{without_extension}.md")
    } else {
        without_extension.to_string()
    })
}

fn display_note_title(path: &Path) -> String {
    path.file_stem()
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
    Ok(serde_json::from_str::<Vec<TrashEntry>>(&fs::read_to_string(path)?).unwrap_or_default())
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
                fs::remove_dir_all(&path).with_context(|| {
                    format!(
                        "Nao foi possivel limpar '{}' da lixeira.",
                        entry.original_relative_path
                    )
                })?;
            } else if path.exists() {
                fs::remove_file(&path).with_context(|| {
                    format!(
                        "Nao foi possivel limpar '{}' da lixeira.",
                        entry.original_relative_path
                    )
                })?;
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
    Ok(serde_json::from_str::<HistoryState>(&fs::read_to_string(path)?).unwrap_or_default())
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
        HistoryCommand::CreateNote {
            relative_path,
            content,
        } => {
            let path = resolve_note_path(root, relative_path)?;
            if undo {
                if path.exists() {
                    fs::remove_file(path)?;
                }
            } else {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(path, content)?;
            }
        }
        HistoryCommand::SaveNote {
            relative_path,
            before_content,
            after_content,
        } => {
            let path = resolve_note_path(root, relative_path)?;
            fs::write(path, if undo { before_content } else { after_content })?;
        }
    }
    Ok(())
}

fn history_status(history: &HistoryState) -> HistoryStatus {
    HistoryStatus {
        can_undo: !history.undo.is_empty(),
        can_redo: !history.redo.is_empty(),
    }
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
            NoteTemplate {
                id: "blank".to_string(),
                name: "Em branco".to_string(),
                content: "".to_string(),
            },
            NoteTemplate {
                id: "study".to_string(),
                name: "Nota de estudo".to_string(),
                content: "# Conceito\n\n## Explicacao\n\n## Exemplos\n\n## Duvidas\n".to_string(),
            },
            NoteTemplate {
                id: "meeting".to_string(),
                name: "Reuniao".to_string(),
                content: "# Objetivo\n\n## Participantes\n\n## Decisoes\n\n## Proximos passos\n"
                    .to_string(),
            },
        ];
        fs::write(templates_path, serde_json::to_string_pretty(&templates)?)?;
    }

    Ok(())
}

fn to_relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.display().to_string())
}

#[derive(Default)]
struct AuthorizedPaths {
    vault_roots: Mutex<HashSet<PathBuf>>,
    parent_directories: Mutex<HashSet<PathBuf>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFileSystemChange {
    kind: String,
    paths: Vec<String>,
}

struct ActiveVaultWatcher {
    id: u64,
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
struct VaultWatcherState {
    active: Mutex<Option<ActiveVaultWatcher>>,
}

fn is_internal_vault_path(relative_path: &str) -> bool {
    relative_path == METADATA_DIR || relative_path.starts_with(&format!("{METADATA_DIR}/"))
}

fn classify_vault_file_system_change(
    root: &Path,
    event: &NotifyEvent,
) -> Option<VaultFileSystemChange> {
    if matches!(event.kind, NotifyEventKind::Access(_)) {
        return None;
    }

    let all_paths = event
        .paths
        .iter()
        .filter_map(|path| path.strip_prefix(root).ok())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .collect::<Vec<_>>();
    let paths = all_paths
        .iter()
        .filter(|path| !is_internal_vault_path(path))
        .cloned()
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return None;
    }

    let kind = match &event.kind {
        NotifyEventKind::Create(_) => "create",
        NotifyEventKind::Remove(_) => "remove",
        NotifyEventKind::Modify(ModifyKind::Name(_)) if paths.len() >= 2 => "rename",
        NotifyEventKind::Modify(ModifyKind::Name(_)) if all_paths.len() >= 2 => {
            let first_is_internal = is_internal_vault_path(&all_paths[0]);
            if first_is_internal {
                "create"
            } else {
                "remove"
            }
        }
        NotifyEventKind::Modify(ModifyKind::Name(_)) => "rescan",
        NotifyEventKind::Modify(_) => "modify",
        _ => "rescan",
    };

    Some(VaultFileSystemChange {
        kind: kind.to_string(),
        paths,
    })
}

#[tauri::command]
fn watch_vault(
    path: String,
    app: AppHandle,
    authorized_paths: State<AuthorizedPaths>,
    watcher_state: State<VaultWatcherState>,
) -> Result<u64, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let callback_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<NotifyEvent>| {
        let Ok(event) = result else {
            return;
        };
        let Some(change) = classify_vault_file_system_change(&callback_root, &event) else {
            return;
        };
        if let Err(error) = app.emit("vault-file-system-change", change) {
            log::warn!("Nao foi possivel emitir uma mudanca do vault: {error}");
        }
    })
    .map_err(|error| format!("Nao foi possivel iniciar a observacao do vault: {error}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("Nao foi possivel observar '{}': {error}", root.display()))?;

    let mut active = watcher_state
        .active
        .lock()
        .map_err(|_| "Nao foi possivel atualizar o observador do vault.".to_string())?;
    let watcher_id = NEXT_VAULT_WATCHER_ID.fetch_add(1, Ordering::Relaxed);
    *active = Some(ActiveVaultWatcher {
        id: watcher_id,
        _watcher: watcher,
    });
    Ok(watcher_id)
}

#[tauri::command]
fn unwatch_vault(watcher_id: u64, watcher_state: State<VaultWatcherState>) -> Result<(), String> {
    let mut active = watcher_state
        .active
        .lock()
        .map_err(|_| "Nao foi possivel encerrar o observador do vault.".to_string())?;
    if active
        .as_ref()
        .is_some_and(|watcher| watcher.id == watcher_id)
    {
        *active = None;
    }
    Ok(())
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
        .manage(VaultWatcherState::default())
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
            recover_note,
            create_folder,
            list_folders,
            list_attachments,
            read_pdf_attachment,
            list_special_files,
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
            get_history_status,
            watch_vault,
            unwatch_vault
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
        apply_history_command, attachment_directory_for_note, classify_vault_file_system_change,
        collect_attachment_files, collect_folders, collect_markdown_files,
        collect_special_vault_files, delete_vault_item_in_root, ensure_metadata_layout,
        extract_tags, extract_wiki_links, get_backlinks_in_root, get_broken_links_in_root,
        get_tag_index_in_root, import_attachment_in_root, inspect_metadata, inspect_vault_path,
        list_trash_in_root, move_vault_item_in_root, move_vault_path_without_overwrite,
        permanently_delete_trash_item_in_root, prepare_wiki_link_updates, read_history,
        read_pdf_attachment_in_root, read_trash_entries, record_history, recover_note_in_root,
        rename_vault_item_in_root, resolve_folder_path, resolve_note_path,
        restore_trash_item_in_root, save_note_in_root, search_notes_in_root, to_relative_display,
        update_wiki_links_for_note_path_change, update_wiki_links_for_note_path_change_with_hook,
        validate_vault_name, write_new_file, write_trash_entries, HistoryCommand,
        PlannedWikiLinkUpdate, RecentVaultPreference, SpecialVaultFileKind, ASSESSMENTS_DIR,
        ATTACHMENTS_DIR, CONFIG_FILE, MAX_PDF_ATTACHMENT_BYTES, MAX_SPECIAL_VAULT_FILES,
        METADATA_DIR, REVIEW_PLANS_DIR, SESSIONS_DIR, TRASH_DIR,
    };
    use notify::{
        event::{CreateKind, ModifyKind, RenameMode},
        Event as NotifyEvent, EventKind as NotifyEventKind,
    };
    use std::{fs, path::Path};
    use tempfile::tempdir;

    struct ObsidianRegressionScenario {
        name: &'static str,
        fixture_directory: &'static str,
        indexed_notes: &'static [&'static str],
        editable_note: &'static str,
    }

    fn inventory_fixture_tree(scenario_name: &str, fixture_root: &Path) -> Vec<(String, Vec<u8>)> {
        fn visit(
            scenario_name: &str,
            fixture_root: &Path,
            directory: &Path,
            files: &mut Vec<(String, Vec<u8>)>,
        ) {
            let mut entries = fs::read_dir(directory)
                .unwrap_or_else(|error| {
                    panic!(
                        "{scenario_name}: inventory fixture directory {}: {error}",
                        directory.display()
                    )
                })
                .map(|entry| {
                    entry.unwrap_or_else(|error| {
                        panic!(
                            "{scenario_name}: read fixture entry in {}: {error}",
                            directory.display()
                        )
                    })
                })
                .collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.path());

            for entry in entries {
                let path = entry.path();
                if path.is_dir() {
                    visit(scenario_name, fixture_root, &path, files);
                    continue;
                }
                let relative_path = path
                    .strip_prefix(fixture_root)
                    .unwrap_or_else(|error| {
                        panic!(
                            "{scenario_name}: make fixture path {} relative: {error}",
                            path.display()
                        )
                    })
                    .to_string_lossy()
                    .replace('\\', "/");
                let content = fs::read(&path).unwrap_or_else(|error| {
                    panic!(
                        "{scenario_name}: read fixture file {}: {error}",
                        path.display()
                    )
                });
                files.push((relative_path, content));
            }
        }

        let mut files = Vec::new();
        visit(scenario_name, fixture_root, fixture_root, &mut files);
        files
    }

    fn run_obsidian_regression_scenario(scenario: &ObsidianRegressionScenario) {
        let temporary_directory = tempdir()
            .unwrap_or_else(|error| panic!("{}: create temporary vault: {error}", scenario.name));
        let root = temporary_directory
            .path()
            .canonicalize()
            .unwrap_or_else(|error| {
                panic!("{}: canonicalize temporary vault: {error}", scenario.name)
            });

        let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(scenario.fixture_directory);
        let fixture_files = inventory_fixture_tree(scenario.name, &fixture_root);
        assert!(
            !fixture_files.is_empty(),
            "{}: fixture vault must contain files",
            scenario.name
        );

        for (relative_path, content) in &fixture_files {
            let path = root.join(relative_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap_or_else(|error| {
                    panic!(
                        "{}: create parent for fixture {}: {error}",
                        scenario.name, relative_path
                    )
                });
            }
            fs::write(&path, content).unwrap_or_else(|error| {
                panic!(
                    "{}: materialize fixture {}: {error}",
                    scenario.name, relative_path
                )
            });
        }

        let indexed_before = collect_markdown_files(&root)
            .unwrap_or_else(|error| panic!("{}: open and index vault: {error}", scenario.name))
            .iter()
            .map(|path| to_relative_display(&root, path))
            .collect::<Vec<_>>();
        assert_eq!(
            indexed_before, scenario.indexed_notes,
            "{}: opening must index only the expected Markdown notes",
            scenario.name
        );

        let original_note =
            fs::read_to_string(root.join(scenario.editable_note)).unwrap_or_else(|error| {
                panic!("{}: read editable fixture note: {error}", scenario.name)
            });
        let edit_marker = format!("\nRegression edit for {}.\n", scenario.name);
        let edited_note = format!("{original_note}{edit_marker}");

        save_note_in_root(&root, scenario.editable_note, &edited_note)
            .unwrap_or_else(|error| panic!("{}: edit fixture note: {error}", scenario.name));

        let reopened_note = fs::read_to_string(root.join(scenario.editable_note))
            .unwrap_or_else(|error| panic!("{}: reopen edited note: {error}", scenario.name));
        assert_eq!(
            reopened_note, edited_note,
            "{}: reopening must return the exact edited Markdown",
            scenario.name
        );
        let indexed_after = collect_markdown_files(&root)
            .unwrap_or_else(|error| panic!("{}: reindex reopened vault: {error}", scenario.name))
            .iter()
            .map(|path| to_relative_display(&root, path))
            .collect::<Vec<_>>();
        assert_eq!(
            indexed_after, scenario.indexed_notes,
            "{}: editing and reopening must not change the indexed note set",
            scenario.name
        );

        for (relative_path, original_content) in fixture_files
            .iter()
            .filter(|(relative_path, _)| relative_path != scenario.editable_note)
        {
            let reopened = fs::read(root.join(relative_path)).unwrap_or_else(|error| {
                panic!(
                    "{}: reopen untouched fixture {}: {error}",
                    scenario.name, relative_path
                )
            });
            assert_eq!(
                reopened, *original_content,
                "{}: untouched file {} changed byte-for-byte",
                scenario.name, relative_path
            );
        }
    }

    #[test]
    fn vault_watcher_reports_relative_rename_paths() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let event = NotifyEvent::new(NotifyEventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(root.join("origem").join("nota.md"))
            .add_path(root.join("destino").join("nota.md"));

        let change = classify_vault_file_system_change(root, &event).expect("watcher change");

        assert_eq!(change.kind, "rename");
        assert_eq!(change.paths, ["origem/nota.md", "destino/nota.md"]);
    }

    #[test]
    fn vault_watcher_ignores_internal_metadata_changes() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let event = NotifyEvent::new(NotifyEventKind::Create(CreateKind::Any))
            .add_path(root.join(METADATA_DIR).join(CONFIG_FILE));

        assert!(classify_vault_file_system_change(root, &event).is_none());
    }

    #[test]
    fn vault_watcher_treats_a_move_to_metadata_as_a_removal() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let event = NotifyEvent::new(NotifyEventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(root.join("nota.md"))
            .add_path(root.join(METADATA_DIR).join(TRASH_DIR).join("nota.md"));

        let change = classify_vault_file_system_change(root, &event).expect("watcher change");

        assert_eq!(change.kind, "remove");
        assert_eq!(change.paths, ["nota.md"]);
    }

    #[test]
    fn recovering_a_note_preserves_content_and_never_overwrites() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        let recovered = recover_note_in_root(&root, "recuperadas/aula.md", "# Rascunho\n")
            .expect("recover note");

        assert_eq!(recovered.relative_path, "recuperadas/aula.md");
        assert_eq!(
            fs::read_to_string(root.join(&recovered.relative_path)).unwrap(),
            "# Rascunho\n"
        );
        assert!(recover_note_in_root(&root, "recuperadas/aula.md", "sobrescrever").is_err());
        assert_eq!(
            fs::read_to_string(root.join(&recovered.relative_path)).unwrap(),
            "# Rascunho\n"
        );
    }

    #[test]
    fn collect_markdown_files_ignores_metadata_directory() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");

        fs::write(root.join("root-note.md"), "# Root").expect("write root note");
        fs::create_dir_all(root.join("nested")).expect("create nested dir");
        fs::write(root.join("nested").join("nested-note.md"), "# Nested")
            .expect("write nested note");
        fs::create_dir_all(root.join(METADATA_DIR)).expect("create metadata dir");
        fs::write(root.join(METADATA_DIR).join("internal.md"), "# Internal")
            .expect("write internal note");

        let notes = collect_markdown_files(root).expect("collect markdown files");
        let collected = notes
            .iter()
            .map(|path| {
                path.strip_prefix(&canonical_root)
                    .expect("relative path")
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect::<Vec<_>>();

        assert_eq!(collected, vec!["nested/nested-note.md", "root-note.md"]);
    }

    #[test]
    fn collect_markdown_files_ignores_obsidian_configuration() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        fs::write(root.join("nota.md"), "# Nota").expect("write note");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian folder");
        fs::write(root.join(".obsidian").join("template.md"), "# Interno")
            .expect("write internal note");

        let notes = collect_markdown_files(root).expect("collect notes");
        let names = notes
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["nota.md"]);
    }

    #[test]
    fn obsidian_compatibility_fixture_opens_without_indexing_internal_files() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let fixture = include_str!("../../src/fixtures/obsidian-vault/compatibility.md");
        fs::write(root.join("compatibility.md"), fixture).expect("write compatibility fixture");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian folder");
        fs::write(root.join(".obsidian").join("internal.md"), "# Interno")
            .expect("write internal file");

        let notes = collect_markdown_files(root).expect("collect compatibility fixture");
        let note_paths = notes
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(note_paths, vec!["compatibility.md"]);
        assert_eq!(
            extract_tags(fixture).expect("extract tags"),
            vec!["estudo/portugues"]
        );
        assert!(fs::read_to_string(root.join("compatibility.md"))
            .expect("reopen fixture")
            .contains("[!info] Callout do Obsidian"));
    }

    #[test]
    fn obsidian_regression_matrix_study_vault() {
        run_obsidian_regression_scenario(&ObsidianRegressionScenario {
            name: "study vault",
            fixture_directory: "src/fixtures/obsidian-vaults/study-vault",
            indexed_notes: &["Notas/Indice.md", "Notas/Quimica.md"],
            editable_note: "Notas/Quimica.md",
        });
    }

    #[test]
    fn obsidian_regression_matrix_project_vault() {
        run_obsidian_regression_scenario(&ObsidianRegressionScenario {
            name: "project vault",
            fixture_directory: "src/fixtures/obsidian-vaults/project-vault",
            indexed_notes: &["Diarias/2026-07-14.md", "Projetos/Roadmap.md"],
            editable_note: "Projetos/Roadmap.md",
        });
    }

    #[test]
    fn special_vault_files_are_read_only_and_excluded_from_note_indexing() {
        let temporary_directory = tempdir().expect("special files vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical special files vault");
        let canvas = br#"{"nodes":[],"edges":[]}"#;
        let excalidraw = b"excalidraw source";
        let excalidraw_markdown = b"---\nexcalidraw-plugin: parsed\n---\n# Drawing";
        let unknown = b"plugin-specific bytes";

        fs::write(root.join("nota.md"), "# Nota").expect("write regular note");
        fs::write(root.join("Planejamento.canvas"), canvas).expect("write canvas");
        fs::write(root.join("desenho.excalidraw"), excalidraw).expect("write excalidraw");
        fs::write(root.join("quadro.excalidraw.md"), excalidraw_markdown)
            .expect("write excalidraw markdown");
        fs::write(root.join("dados.plugin-cache"), unknown).expect("write unknown file");
        fs::write(root.join("imagem.png"), b"supported attachment").expect("write attachment");
        fs::create_dir_all(root.join(".obsidian").join("plugins")).expect("create obsidian data");
        fs::write(root.join(".obsidian/plugins/data.json"), "secret")
            .expect("write obsidian plugin data");
        fs::create_dir_all(root.join(".hidden")).expect("create hidden directory");
        fs::write(root.join(".hidden/ignored.cache"), "hidden").expect("write hidden data");
        fs::create_dir_all(root.join(METADATA_DIR)).expect("create metadata directory");
        fs::write(root.join(METADATA_DIR).join("ignored.cache"), "metadata")
            .expect("write metadata data");

        let notes = collect_markdown_files(&root).expect("index regular notes");
        assert_eq!(
            notes
                .iter()
                .map(|path| to_relative_display(&root, path))
                .collect::<Vec<_>>(),
            ["nota.md"]
        );

        let inventory = collect_special_vault_files(&root).expect("list special files");
        assert!(!inventory.truncated);
        assert_eq!(
            inventory
                .files
                .iter()
                .map(|file| (file.relative_path.as_str(), file.kind))
                .collect::<Vec<_>>(),
            [
                ("Planejamento.canvas", SpecialVaultFileKind::Canvas),
                ("dados.plugin-cache", SpecialVaultFileKind::Unknown),
                ("desenho.excalidraw", SpecialVaultFileKind::Excalidraw),
                ("quadro.excalidraw.md", SpecialVaultFileKind::Excalidraw),
            ]
        );
        assert_eq!(fs::read(root.join("Planejamento.canvas")).unwrap(), canvas);
        assert_eq!(
            fs::read(root.join("desenho.excalidraw")).unwrap(),
            excalidraw
        );
        assert_eq!(
            fs::read(root.join("quadro.excalidraw.md")).unwrap(),
            excalidraw_markdown
        );
        assert_eq!(fs::read(root.join("dados.plugin-cache")).unwrap(), unknown);
    }

    #[test]
    fn special_vault_inventory_stops_after_the_safe_limit() {
        let temporary_directory = tempdir().expect("large special files vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical large special files vault");

        for index in 0..=MAX_SPECIAL_VAULT_FILES {
            fs::write(root.join(format!("unknown-{index:04}.cache")), b"preserved")
                .expect("write special file");
        }

        let inventory = collect_special_vault_files(&root).expect("collect bounded inventory");
        assert!(inventory.truncated);
        assert_eq!(inventory.files.len(), MAX_SPECIAL_VAULT_FILES);
    }

    #[test]
    fn collect_attachment_files_lists_nested_files_and_ignores_metadata() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(ATTACHMENTS_DIR).join("curso"))
            .expect("create attachment folder");
        fs::write(
            root.join(ATTACHMENTS_DIR).join("curso").join("imagem.png"),
            "image",
        )
        .expect("write attachment");
        fs::create_dir_all(root.join(METADATA_DIR).join(ATTACHMENTS_DIR))
            .expect("create metadata folder");
        fs::write(
            root.join(METADATA_DIR)
                .join(ATTACHMENTS_DIR)
                .join("ignored.png"),
            "ignored",
        )
        .expect("write metadata file");

        assert_eq!(
            collect_attachment_files(&root).expect("list attachments"),
            vec![root.join(ATTACHMENTS_DIR).join("curso").join("imagem.png")]
        );
    }

    #[test]
    fn collect_attachment_files_finds_supported_files_across_the_visible_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("Notas").join("media")).expect("create note media folder");
        fs::write(
            root.join("Notas").join("media").join("diagrama.png"),
            "image",
        )
        .expect("write attachment");
        fs::write(root.join("Notas").join("rascunho.txt"), "unsupported")
            .expect("write unsupported file");

        assert_eq!(
            collect_attachment_files(&root).expect("list attachments"),
            vec![root.join("Notas").join("media").join("diagrama.png")]
        );
    }

    #[test]
    fn read_pdf_attachment_only_reads_inventoried_pdf_files_within_the_size_limit() {
        let directory = tempdir().expect("create temp directory");
        let root = directory.path().join("vault");
        fs::create_dir_all(root.join(ATTACHMENTS_DIR)).expect("create attachments folder");
        fs::create_dir_all(root.join(".obsidian").join("plugins")).expect("create hidden folder");
        fs::write(root.join(ATTACHMENTS_DIR).join("manual.pdf"), b"%PDF-safe")
            .expect("write safe pdf");
        fs::write(
            root.join(".obsidian").join("plugins").join("secret.pdf"),
            b"%PDF-secret",
        )
        .expect("write hidden pdf");

        assert_eq!(
            read_pdf_attachment_in_root(&root, "attachments/manual.pdf").expect("read safe pdf"),
            b"%PDF-safe".to_vec()
        );
        assert!(read_pdf_attachment_in_root(&root, ".obsidian/plugins/secret.pdf").is_err());

        let oversized = root.join(ATTACHMENTS_DIR).join("oversized.pdf");
        let file = fs::File::create(&oversized).expect("create oversized pdf");
        file.set_len(MAX_PDF_ATTACHMENT_BYTES + 1)
            .expect("extend oversized pdf");
        assert!(read_pdf_attachment_in_root(&root, "attachments/oversized.pdf").is_err());
    }

    #[test]
    fn collect_folders_includes_empty_folders_and_ignores_internal_ones() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");
        fs::create_dir_all(root.join("projetos").join("vazios")).expect("create folders");
        fs::create_dir_all(root.join(METADATA_DIR).join("interno"))
            .expect("create metadata folder");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian folder");

        let folders = collect_folders(root).expect("collect folders");
        let collected = folders
            .iter()
            .map(|path| {
                path.strip_prefix(&canonical_root)
                    .expect("relative path")
                    .to_string_lossy()
                    .replace('\\', "/")
            })
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
        assert!(metadata
            .missing
            .iter()
            .any(|entry| entry.contains("config.json")));
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
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        assert!(resolve_note_path(&root, "../segredo.md").is_err());
        assert!(resolve_note_path(&root, ".mirmind/interna.md").is_err());
        assert!(resolve_note_path(&root, "area/nova-nota").is_ok());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn resolve_note_path_rejects_a_symbolic_link_as_the_final_note() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let outside = temporary_directory.path().join("outside.txt");
        fs::write(&outside, "secret").expect("write outside file");
        let link = root.join("linked.md");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).expect("create file symlink");
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_file(&outside, &link) {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("create file symlink: {error}");
        }

        assert!(resolve_note_path(&root, "linked.md").is_err());
    }

    #[test]
    fn write_new_file_never_overwrites_an_existing_note() {
        let temporary_directory = tempdir().expect("temp dir");
        let note_path = temporary_directory.path().join("existing.md");
        fs::write(&note_path, "original").expect("write original note");

        assert!(write_new_file(&note_path, b"replacement").is_err());
        assert_eq!(
            fs::read_to_string(&note_path).expect("read original note"),
            "original"
        );
    }

    #[test]
    fn resolve_folder_path_rejects_unsafe_paths() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

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
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("materias")).expect("create source folder");
        fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write source note");

        rename_vault_item_in_root(&root, "materias/aula.md", "resumo", "note")
            .expect("rename note");
        rename_vault_item_in_root(&root, "materias", "estudos", "folder").expect("rename folder");

        assert!(root.join("estudos").join("resumo.md").is_file());
        assert!(!root.join("materias").exists());
        assert!(rename_vault_item_in_root(&root, "estudos", "../fora", "folder").is_err());
    }

    #[test]
    fn changing_a_note_path_updates_matching_wiki_links_and_finds_broken_ones() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("origem")).expect("create source folder");
        fs::create_dir_all(root.join("destino")).expect("create destination folder");
        fs::write(root.join("origem").join("aula.md"), "# Aula\n\n## Resumo")
            .expect("write target note");
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
    fn compatible_note_rename_preserves_wikilink_semantics_and_ignored_regions() {
        let temporary_directory = tempdir().expect("compatible rename vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical compatible rename vault");
        fs::create_dir_all(root.join("curso")).expect("create source folder");
        fs::create_dir_all(root.join("outro")).expect("create duplicate folder");
        fs::create_dir_all(root.join("destino")).expect("create destination folder");
        fs::write(
            root.join("curso/aula.md"),
            "# Aula\r\n\r\n[[#Resumo]]\r\n[[#^bloco]]\r\n\r\n## Resumo\r\n\r\nTexto ^bloco\r\n",
        )
        .expect("write target note");
        fs::write(root.join("outro/aula.md"), "# Outra aula\r\n").expect("write duplicate note");

        let reference_source = concat!(
            "[[aula|Alias preservado]]\r\n",
            "![[aula#Resumo|Trecho incorporado]]\r\n",
            "[[aula#^bloco]]\r\n",
            "[[curso/aula.md#Resumo|Caminho completo]]\r\n",
            "[[outro/aula|Duplicata]]\r\n",
            "`[[curso/aula]]`\r\n",
            "```md\r\n[[curso/aula]]\r\n```\r\n",
            "<!-- [[curso/aula]] -->\r\n",
            "<div>[[curso/aula]]</div>\r\n",
            "\\[[curso/aula]]\r\n",
            "%% [[curso/aula]] %%\r\n",
            "%% comentario\r\n[[curso/aula]]\r\n%%\r\n",
            "```md\r\n```nao-fecha\r\n[[curso/aula]]\r\n```\r\n",
            "<div>\r\n<div>interno</div>\r\n[[curso/aula]]\r\n</div>\r\n",
            "<hr>\r\n[[curso/aula]]\r\n",
            "<p>bloco HTML\r\n\r\n[[curso/aula]]\r\n",
        );
        fs::write(root.join("curso/referencias.md"), reference_source)
            .expect("write reference note");

        rename_vault_item_in_root(&root, "curso/aula.md", "resumo", "note")
            .expect("rename compatible note");
        move_vault_item_in_root(&root, "curso/resumo.md", "destino", "note")
            .expect("move compatible note");

        let references =
            fs::read_to_string(root.join("curso/referencias.md")).expect("read references");
        assert_eq!(
            references,
            concat!(
                "[[destino/resumo|Alias preservado]]\r\n",
                "![[destino/resumo#Resumo|Trecho incorporado]]\r\n",
                "[[destino/resumo#^bloco]]\r\n",
                "[[destino/resumo.md#Resumo|Caminho completo]]\r\n",
                "[[outro/aula|Duplicata]]\r\n",
                "`[[curso/aula]]`\r\n",
                "```md\r\n[[curso/aula]]\r\n```\r\n",
                "<!-- [[curso/aula]] -->\r\n",
                "<div>[[curso/aula]]</div>\r\n",
                "\\[[curso/aula]]\r\n",
                "%% [[curso/aula]] %%\r\n",
                "%% comentario\r\n[[curso/aula]]\r\n%%\r\n",
                "```md\r\n```nao-fecha\r\n[[curso/aula]]\r\n```\r\n",
                "<div>\r\n<div>interno</div>\r\n[[curso/aula]]\r\n</div>\r\n",
                "<hr>\r\n[[destino/resumo]]\r\n",
                "<p>bloco HTML\r\n\r\n[[destino/resumo]]\r\n",
            )
        );

        let moved_note =
            fs::read_to_string(root.join("destino/resumo.md")).expect("read moved note");
        assert!(moved_note.contains("[[#Resumo]]\r\n[[#^bloco]]"));
    }

    #[test]
    fn moving_a_note_preserves_the_targets_of_its_outgoing_links() {
        let temporary_directory = tempdir().expect("outgoing links vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical outgoing links vault");
        fs::create_dir_all(root.join("curso")).expect("create source folder");
        fs::create_dir_all(root.join("destino")).expect("create destination folder");
        fs::write(root.join("curso/topico.md"), "[[material|Material]]")
            .expect("write moving note");
        fs::write(root.join("curso/material.md"), "# Material correto")
            .expect("write original neighbor");
        fs::write(root.join("destino/material.md"), "# Material homonimo")
            .expect("write destination neighbor");

        move_vault_item_in_root(&root, "curso/topico.md", "destino", "note")
            .expect("move note preserving outgoing links");

        assert_eq!(
            fs::read_to_string(root.join("destino/topico.md")).expect("read moved note"),
            "[[curso/material|Material]]"
        );
    }

    #[test]
    fn renaming_and_moving_a_folder_updates_links_for_all_contained_notes() {
        let temporary_directory = tempdir().expect("folder links vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical folder links vault");
        fs::create_dir_all(root.join("curso/sub")).expect("create source tree");
        fs::create_dir_all(root.join("arquivo")).expect("create destination tree");
        fs::write(
            root.join("curso/aula.md"),
            "[[curso/sub/material|Material]]",
        )
        .expect("write source note");
        fs::write(root.join("curso/sub/material.md"), "# Material").expect("write nested note");
        fs::write(
            root.join("indice.md"),
            "[[curso/aula|Aula]]\n![[curso/sub/material]]",
        )
        .expect("write root index");

        rename_vault_item_in_root(&root, "curso", "estudos", "folder")
            .expect("rename linked folder");
        move_vault_item_in_root(&root, "estudos", "arquivo", "folder").expect("move linked folder");

        assert_eq!(
            fs::read_to_string(root.join("indice.md")).expect("read root index"),
            "[[arquivo/estudos/aula|Aula]]\n![[arquivo/estudos/sub/material]]"
        );
        assert_eq!(
            fs::read_to_string(root.join("arquivo/estudos/aula.md")).expect("read contained note"),
            "[[arquivo/estudos/sub/material|Material]]"
        );
    }

    #[test]
    fn failed_link_rewrite_leaves_the_note_and_references_unchanged() {
        let temporary_directory = tempdir().expect("failed rename vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical failed rename vault");
        fs::write(root.join("aula.md"), "# Aula").expect("write target note");
        fs::write(root.join("referencias.md"), "[[aula]]").expect("write reference note");
        fs::write(root.join("z-invalida.md"), [0xff, 0xfe, 0xfd])
            .expect("write invalid UTF-8 note");

        assert!(rename_vault_item_in_root(&root, "aula.md", "resumo", "note").is_err());
        assert!(root.join("aula.md").is_file());
        assert!(!root.join("resumo.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("referencias.md")).expect("read unchanged reference"),
            "[[aula]]"
        );
    }

    #[test]
    fn link_rewrite_refuses_to_overwrite_a_concurrent_external_edit() {
        let temporary_directory = tempdir().expect("concurrent edit vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical concurrent edit vault");
        fs::write(root.join("aula.md"), "# Aula").expect("write target note");
        fs::write(root.join("referencias.md"), "[[aula]]").expect("write reference note");
        let changes = vec![("aula.md".to_string(), "resumo.md".to_string())];
        let available = vec!["aula.md".to_string(), "referencias.md".to_string()];
        let updates =
            prepare_wiki_link_updates(&root, &changes, &available).expect("prepare link updates");

        fs::rename(root.join("aula.md"), root.join("resumo.md")).expect("rename target note");
        fs::write(
            root.join("referencias.md"),
            "Edicao externa mais recente\n[[aula]]",
        )
        .expect("write concurrent edit");

        assert!(update_wiki_links_for_note_path_change(&root, &updates).is_err());
        assert_eq!(
            fs::read_to_string(root.join("referencias.md")).expect("read concurrent edit"),
            "Edicao externa mais recente\n[[aula]]"
        );
    }

    #[test]
    fn link_rewrite_rolls_back_every_file_after_a_partial_commit_failure() {
        let temporary_directory = tempdir().expect("rollback vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical rollback vault");
        fs::write(root.join("primeira.md"), "original 1").expect("write first note");
        fs::write(root.join("segunda.md"), "original 2").expect("write second note");
        let updates = vec![
            PlannedWikiLinkUpdate {
                original_content: b"original 1".to_vec(),
                path_after_change: root.join("primeira.md"),
                updated_content: b"atualizada 1".to_vec(),
            },
            PlannedWikiLinkUpdate {
                original_content: b"original 2".to_vec(),
                path_after_change: root.join("segunda.md"),
                updated_content: b"atualizada 2".to_vec(),
            },
        ];

        let result =
            update_wiki_links_for_note_path_change_with_hook(&root, &updates, |committed_index| {
                if committed_index == 0 {
                    anyhow::bail!("falha injetada depois do primeiro commit");
                }
                Ok(())
            });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("primeira.md")).expect("read restored first note"),
            "original 1"
        );
        assert_eq!(
            fs::read_to_string(root.join("segunda.md")).expect("read untouched second note"),
            "original 2"
        );
        assert!(fs::read_dir(&root)
            .expect("list rollback vault")
            .all(|entry| !entry
                .expect("read rollback entry")
                .file_name()
                .to_string_lossy()
                .contains(".mirmind-")));
    }

    #[test]
    fn moving_a_folder_never_overwrites_an_existing_destination() {
        let temporary_directory = tempdir().expect("folder collision vault");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical folder collision vault");
        fs::create_dir(root.join("origem")).expect("create source folder");
        fs::write(root.join("origem/nota.md"), "# Nota").expect("write source note");
        fs::create_dir(root.join("destino")).expect("create destination folder");

        assert!(move_vault_path_without_overwrite(
            &root.join("origem"),
            &root.join("destino"),
            false,
        )
        .is_err());
        assert!(root.join("origem/nota.md").is_file());
        assert!(root.join("destino").is_dir());
    }

    #[test]
    fn move_vault_item_moves_notes_and_rejects_recursive_folder_moves() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
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
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("materias")).expect("create source folder");
        fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write source note");

        delete_vault_item_in_root(&root, "materias/aula.md", "note").expect("move note to trash");
        let entries = read_trash_entries(&root).expect("read trash entries");

        assert_eq!(entries.len(), 1);
        assert!(!root.join("materias").join("aula.md").exists());
        restore_trash_item_in_root(&root, &entries[0].id).expect("restore note");
        assert!(root.join("materias").join("aula.md").is_file());
        assert!(read_trash_entries(&root)
            .expect("read empty trash")
            .is_empty());
    }

    #[test]
    fn permanently_deleting_a_trash_item_removes_its_file_and_manifest_entry() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(root.join("temporary.md"), "# Temporary").expect("write source note");

        delete_vault_item_in_root(&root, "temporary.md", "note").expect("move note to trash");
        let entry = read_trash_entries(&root)
            .expect("read trash entry")
            .pop()
            .expect("entry");

        permanently_delete_trash_item_in_root(&root, &entry.id).expect("permanently delete item");

        assert!(!root
            .join(METADATA_DIR)
            .join(TRASH_DIR)
            .join(entry.trashed_name)
            .exists());
        assert!(read_trash_entries(&root)
            .expect("read empty trash")
            .is_empty());
    }

    #[test]
    fn listing_trash_permanently_removes_items_after_thirty_days() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(root.join("expired.md"), "# Expired").expect("write source note");

        delete_vault_item_in_root(&root, "expired.md", "note").expect("move note to trash");
        let mut entries = read_trash_entries(&root).expect("read trash entry");
        let entry = entries.first_mut().expect("entry");
        entry.deleted_at_day = 0;
        let trashed_name = entry.trashed_name.clone();
        write_trash_entries(&root, &entries).expect("write expired trash entry");

        assert!(list_trash_in_root(&root)
            .expect("prune expired trash")
            .is_empty());
        assert!(!root
            .join(METADATA_DIR)
            .join(TRASH_DIR)
            .join(trashed_name)
            .exists());
        assert!(read_trash_entries(&root)
            .expect("read empty trash")
            .is_empty());
    }

    #[test]
    fn import_attachment_copies_file_into_the_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let source_directory = tempdir().expect("source dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let source = source_directory.path().join("diagrama.png");
        fs::write(&source, "image bytes").expect("write attachment");

        let attachment = import_attachment_in_root(&root, &source, "escola/portugues/aula.md")
            .expect("import attachment");

        assert_eq!(
            attachment.relative_path,
            "attachments/escola/portugues/diagrama.png"
        );
        assert!(attachment.is_image);
        assert_eq!(
            fs::read(root.join(&attachment.relative_path)).expect("read copied attachment"),
            b"image bytes"
        );
    }

    #[test]
    fn attachments_for_new_notes_use_the_vault_attachment_root() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        assert_eq!(
            attachment_directory_for_note(&root, "").expect("attachment root"),
            root.join(ATTACHMENTS_DIR)
        );
    }

    #[test]
    fn obsidian_attachment_folder_configuration_is_respected() {
        let temporary_directory = tempdir().expect("temp dir");
        let source_directory = tempdir().expect("source dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"media"}"#,
        )
        .expect("write obsidian config");
        let source = source_directory.path().join("diagrama.png");
        fs::write(&source, "image bytes").expect("write attachment");

        let attachment =
            import_attachment_in_root(&root, &source, "aula.md").expect("import attachment");

        assert_eq!(attachment.relative_path, "media/diagrama.png");
        assert_eq!(
            collect_attachment_files(&root).expect("list attachments"),
            vec![root.join("media").join("diagrama.png")]
        );
    }

    #[test]
    fn vault_summary_reads_supported_obsidian_preferences_without_modifying_app_json() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        let app_json = br#"{
  "newFileLocation": "folder",
  "newFileFolderPath": "Notas",
  "attachmentFolderPath": "./media",
  "newLinkFormat": "relative",
  "useMarkdownLinks": true,
  "alwaysUpdateLinks": false,
  "showUnsupportedFiles": true,
  "promptDelete": false,
  "trashOption": "local",
  "userIgnoreFilters": ["Arquivo/", "Temporario\\.md$"],
  "pluginOwnedSetting": { "mustRemain": true }
}"#;
        let config_path = root.join(".obsidian").join("app.json");
        fs::write(&config_path, app_json).expect("write obsidian config");

        let summary = inspect_vault_path(&root).expect("inspect vault");
        let preferences = summary
            .obsidian_preferences
            .expect("read supported obsidian preferences");

        assert_eq!(preferences.new_file_location.as_deref(), Some("folder"));
        assert_eq!(preferences.new_file_folder_path.as_deref(), Some("Notas"));
        assert_eq!(
            preferences.attachment_folder_path.as_deref(),
            Some("./media")
        );
        assert_eq!(preferences.new_link_format.as_deref(), Some("relative"));
        assert_eq!(preferences.use_markdown_links, Some(true));
        assert_eq!(preferences.always_update_links, Some(false));
        assert_eq!(preferences.show_unsupported_files, Some(true));
        assert_eq!(preferences.prompt_delete, Some(false));
        assert_eq!(preferences.trash_option.as_deref(), Some("local"));
        assert_eq!(
            preferences.user_ignore_filters,
            vec!["Arquivo/", "Temporario\\.md$"]
        );
        assert_eq!(
            fs::read(&config_path).expect("reread obsidian config"),
            app_json
        );
    }

    #[test]
    fn vault_summary_tolerates_invalid_or_missing_obsidian_app_configuration() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        assert!(inspect_vault_path(&root)
            .expect("inspect markdown vault")
            .obsidian_preferences
            .is_none());

        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::write(root.join(".obsidian").join("app.json"), "{ invalid")
            .expect("write invalid obsidian config");
        assert!(inspect_vault_path(&root)
            .expect("inspect invalid obsidian vault")
            .obsidian_preferences
            .is_none());
    }

    #[test]
    fn vault_summary_limits_obsidian_configuration_and_preference_strings() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        let config_path = root.join(".obsidian").join("app.json");

        fs::write(
            &config_path,
            vec![b' '; super::MAX_OBSIDIAN_APP_CONFIG_BYTES as usize + 1],
        )
        .expect("write oversized obsidian config");
        assert!(inspect_vault_path(&root)
            .expect("inspect oversized obsidian config")
            .obsidian_preferences
            .is_none());

        let long_ascii = "a".repeat(super::MAX_OBSIDIAN_PREFERENCE_UTF16_UNITS + 1);
        let astral_filter = "😀".repeat(600);
        let filters = std::iter::once(astral_filter)
            .chain((0..258).map(|index| format!("filtro-{index}")))
            .collect::<Vec<_>>();
        fs::write(
            &config_path,
            serde_json::to_vec(&serde_json::json!({
                "newFileLocation": long_ascii,
                "attachmentFolderPath": "media",
                "userIgnoreFilters": filters,
            }))
            .expect("serialize bounded preferences"),
        )
        .expect("write bounded preferences");

        let preferences = inspect_vault_path(&root)
            .expect("inspect bounded preferences")
            .obsidian_preferences
            .expect("read bounded preferences");
        assert_eq!(preferences.new_file_location, None);
        assert_eq!(preferences.attachment_folder_path.as_deref(), Some("media"));
        assert_eq!(preferences.user_ignore_filters.len(), 256);
        assert_eq!(preferences.user_ignore_filters.first().unwrap(), "filtro-0");
        assert_eq!(
            preferences.user_ignore_filters.last().unwrap(),
            "filtro-255"
        );
    }

    #[test]
    fn vault_summary_rejects_symlinked_obsidian_app_configuration() {
        let temporary_directory = tempdir().expect("temp dir");
        let outside_directory = tempdir().expect("outside dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        let outside = outside_directory.path().join("app.json");
        fs::write(&outside, r#"{"attachmentFolderPath":"outside"}"#)
            .expect("write outside obsidian config");
        let link = root.join(".obsidian").join("app.json");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).expect("create obsidian config symlink");
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_file(&outside, &link) {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("create obsidian config symlink: {error}");
        }

        assert!(inspect_vault_path(&root)
            .expect("inspect symlinked obsidian config")
            .obsidian_preferences
            .is_none());
    }

    #[test]
    fn obsidian_note_relative_attachment_locations_are_respected() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");

        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"./"}"#,
        )
        .expect("write same-folder config");
        assert_eq!(
            attachment_directory_for_note(&root, "Projetos/Roadmap.md").expect("same note folder"),
            root.join("Projetos")
        );

        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"./media"}"#,
        )
        .expect("write note-subfolder config");
        assert_eq!(
            attachment_directory_for_note(&root, "Projetos/Roadmap.md").expect("note subfolder"),
            root.join("Projetos").join("media")
        );

        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"/"}"#,
        )
        .expect("write vault-root config");
        assert_eq!(
            attachment_directory_for_note(&root, "Projetos/Roadmap.md").expect("vault root"),
            root
        );
    }

    #[test]
    fn attachment_locations_match_the_real_obsidian_vault_fixtures() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("fixtures")
            .join("obsidian-vaults")
            .canonicalize()
            .expect("canonical fixture root");
        let project_vault = fixtures.join("project-vault");
        let study_vault = fixtures.join("study-vault");

        assert_eq!(
            attachment_directory_for_note(&project_vault, "Projetos/Roadmap.md")
                .expect("project fixture attachment folder"),
            project_vault.join("Projetos")
        );
        assert_eq!(
            attachment_directory_for_note(&study_vault, "Notas/Quimica.md")
                .expect("study fixture attachment folder"),
            study_vault.join("assets")
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn import_attachment_rejects_a_configured_directory_outside_the_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let source_directory = tempdir().expect("source dir");
        let root = temporary_directory.path().join("vault");
        let outside = temporary_directory.path().join("outside");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::create_dir_all(&outside).expect("create outside folder");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("media")).expect("create directory symlink");
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_dir(&outside, root.join("media")) {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("create directory symlink: {error}");
        }
        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"media/subpasta"}"#,
        )
        .expect("write obsidian config");
        let source = source_directory.path().join("diagrama.png");
        fs::write(&source, "image bytes").expect("write attachment");

        assert!(import_attachment_in_root(&root, &source, "aula.md").is_err());
        assert!(!outside.join("subpasta").exists());
        assert!(!outside.join("diagrama.png").exists());
    }

    #[test]
    fn concurrent_attachment_imports_never_overwrite_each_other() {
        let temporary_directory = tempdir().expect("temp dir");
        let first_source_directory = tempdir().expect("first source dir");
        let second_source_directory = tempdir().expect("second source dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let first_source = first_source_directory.path().join("diagrama.png");
        let second_source = second_source_directory.path().join("diagrama.png");
        fs::write(&first_source, "first image").expect("write first attachment");
        fs::write(&second_source, "second image").expect("write second attachment");

        let first_root = root.clone();
        let first = std::thread::spawn(move || {
            import_attachment_in_root(&first_root, &first_source, "aula.md")
        });
        let second_root = root.clone();
        let second = std::thread::spawn(move || {
            import_attachment_in_root(&second_root, &second_source, "aula.md")
        });
        let first_attachment = first
            .join()
            .expect("join first import")
            .expect("first import");
        let second_attachment = second
            .join()
            .expect("join second import")
            .expect("second import");

        assert_ne!(
            first_attachment.relative_path,
            second_attachment.relative_path
        );
        let mut contents = [
            fs::read_to_string(root.join(first_attachment.relative_path))
                .expect("read first imported attachment"),
            fs::read_to_string(root.join(second_attachment.relative_path))
                .expect("read second imported attachment"),
        ];
        contents.sort();
        assert_eq!(contents, ["first image", "second image"]);
    }

    #[test]
    fn note_relative_attachment_location_rejects_internal_vault_directories() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path().join("vault");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{"attachmentFolderPath":"./"}"#,
        )
        .expect("write obsidian config");

        assert!(attachment_directory_for_note(&root, ".obsidian/interna.md").is_err());
        assert!(attachment_directory_for_note(&root, ".mirmind/interna.md").is_err());
    }

    #[test]
    fn backlinks_find_notes_using_wiki_links_with_aliases() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("escola")).expect("create folder");
        fs::write(root.join("escola").join("portugues.md"), "# Portugues").expect("write target");
        fs::write(
            root.join("historia.md"),
            "Veja [[escola/portugues|a aula de portugues]].",
        )
        .expect("write backlink");

        let backlinks = get_backlinks_in_root(&root, "escola/portugues.md").expect("get backlinks");

        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].relative_path, "historia.md");
        assert_eq!(extract_wiki_links("[[nota#secao]]"), vec!["nota.md"]);
        assert_eq!(
            extract_wiki_links("%% [[ignorada]] %%\n%% bloco\n[[tambem-ignorada]]\n%%\n[[nota]]"),
            vec!["nota.md"]
        );
    }

    #[test]
    fn wikilinks_resolve_local_notes_root_paths_and_nearest_duplicate_names() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("projetos")).expect("create projects");
        fs::create_dir_all(root.join("arquivo")).expect("create archive");
        fs::write(root.join("projetos").join("aula.md"), "# Aula\n\n## Resumo")
            .expect("write near note");
        fs::write(root.join("arquivo").join("aula.md"), "# Aula antiga")
            .expect("write duplicate note");
        fs::write(
            root.join("projetos").join("referencias.md"),
            "# Secao local\n\n[[aula#Resumo|Aula atual]]\n[[arquivo/aula]]\n[[#Secao local]]\n[[nota-ausente]]\n\
             `[[inline-ausente]]`\n\
             \\[[escapado-ausente]]\n\
             <!-- [[comentario-ausente]] -->\n\
             ```md\n[[codigo-ausente]]\n```",
        )
        .expect("write references");

        let backlinks =
            get_backlinks_in_root(&root, "projetos/aula.md").expect("get nearest backlinks");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].relative_path, "projetos/referencias.md");

        let archive_backlinks =
            get_backlinks_in_root(&root, "arquivo/aula.md").expect("get root path backlinks");
        assert_eq!(archive_backlinks.len(), 1);
        assert_eq!(
            archive_backlinks[0].relative_path,
            "projetos/referencias.md"
        );

        let broken_links = get_broken_links_in_root(&root).expect("get broken links");
        assert_eq!(broken_links.len(), 1);
        assert_eq!(broken_links[0].target, "nota-ausente.md");
    }

    #[test]
    fn broken_wikilinks_validate_fragments_unicode_and_ignore_html_regions() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(
            root.join("Árvore.md"),
            "**API** `v2`\n-\n\n   ### [Guia](https://example.com)\n\n### C\\+\\+ &amp; R\n\n### Caf&eacute;\n\nConteudo. ^real\n\n```md\nCodigo. ^falso\n```",
        )
        .expect("write unicode target");
        fs::write(
            root.join("referencias.md"),
            "[[árvore#API v2]]\n[[Árvore#Guia]]\n[[Árvore#C++ & R]]\n[[Árvore#Café]]\n[[Árvore#^real]]\n[[Árvore#Ausente]]\n[[Árvore#Ausente]]\n\
             [[Árvore#^falso]]\n<div data-note=\"[[fantasma]]\">[[tambem-fantasma]]</div>\n\
             <span data-note=\"[[atributo]]\">[[Árvore]]</span>",
        )
        .expect("write references");

        let backlinks = get_backlinks_in_root(&root, "Árvore.md").expect("get unicode backlinks");
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].relative_path, "referencias.md");

        let broken_links = get_broken_links_in_root(&root).expect("get fragment failures");
        assert_eq!(broken_links.len(), 2);
        assert_eq!(broken_links[0].target, "Árvore.md#Ausente");
        assert_eq!(broken_links[1].target, "Árvore.md#^falso");
    }

    #[test]
    fn tag_index_extracts_unique_tags_and_their_notes() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(
            root.join("aula.md"),
            "---\ntags:\n  - estudo/portugues\n  - ação\n---\n\n# Titulo\n#portugues #Revisao",
        )
        .expect("write first note");
        fs::write(root.join("resumo.md"), "#portugues").expect("write second note");

        let tags = get_tag_index_in_root(&root).expect("tag index");

        assert_eq!(
            extract_tags("#tag #tag #outra-tag #estudo/portugues").expect("extract tags"),
            vec!["estudo/portugues", "outra-tag", "tag"]
        );
        assert_eq!(tags.len(), 4);
        assert_eq!(tags[1].tag, "estudo/portugues");
        assert_eq!(tags[2].tag, "portugues");
        assert_eq!(tags[2].note_paths, vec!["aula.md", "resumo.md"]);
    }

    #[test]
    fn tag_index_supports_complex_obsidian_frontmatter_values() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let content = "\u{feff}---\r\nshared: &shared\r\n  - Estudo/Quimica\r\n  - \"#Ação\"\r\ntags:\r\n  - *shared\r\n  - Revisão\r\n  - on\r\n  - off\r\n  - yes\r\n  - no\r\n---\r\n\r\n#Corpo #ac\u{327}a\u{303}o #pai/ #pai//filho café#privado\r\n\r\n`#codigo-inline`\r\n\r\n```\r\n#codigo-bloco\r\n```\r\n\r\n<!-- #comentario-html -->\r\n%% #comentario-obsidian %%\r\nhttps://exemplo.test/#fragmento";
        fs::write(root.join("complexa.md"), content).expect("write note");

        let tags = get_tag_index_in_root(&root).expect("tag index");

        assert_eq!(
            tags.into_iter()
                .map(|summary| (summary.tag, summary.note_paths))
                .collect::<Vec<_>>(),
            vec![
                ("ação".to_string(), vec!["complexa.md".to_string()]),
                ("corpo".to_string(), vec!["complexa.md".to_string()]),
                (
                    "estudo/quimica".to_string(),
                    vec!["complexa.md".to_string()]
                ),
                ("no".to_string(), vec!["complexa.md".to_string()]),
                ("off".to_string(), vec!["complexa.md".to_string()]),
                ("on".to_string(), vec!["complexa.md".to_string()]),
                ("revisão".to_string(), vec!["complexa.md".to_string()]),
                ("yes".to_string(), vec!["complexa.md".to_string()]),
            ]
        );
    }

    #[test]
    fn tag_index_rejects_notes_above_the_resource_budget() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(
            root.join("grande.md"),
            vec![b'a'; super::MAX_TAG_NOTE_BYTES as usize + 1],
        )
        .expect("write oversized note");

        let error = match get_tag_index_in_root(&root) {
            Ok(_) => panic!("oversized note should be rejected"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("limite seguro"));
    }

    #[test]
    fn search_notes_finds_content_and_returns_an_excerpt() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(
            root.join("historia.md"),
            "# Historia\nImperio Romano e #revisao",
        )
        .expect("write note");
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
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let relative_path = "area/nota.md".to_string();
        let content = "# Nota\n".to_string();

        let command = HistoryCommand::CreateNote {
            relative_path: relative_path.clone(),
            content: content.clone(),
        };
        apply_history_command(&root, &command, false).expect("create note");
        record_history(&root, command.clone()).expect("record history");
        assert!(root.join(&relative_path).is_file());
        assert_eq!(read_history(&root).expect("history").undo.len(), 1);

        apply_history_command(&root, &command, true).expect("undo note");
        assert!(!root.join(&relative_path).exists());
    }
}
