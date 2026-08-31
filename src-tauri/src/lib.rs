use anyhow::{bail, Context, Result};
use notify::{
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    Event as NotifyEvent, EventKind as NotifyEventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub mod review;
mod tag_management;
mod vault_metadata;

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
/// Formatos tratados como anexos (além das quatro localizacoes documentadas,
/// ampliados para o conjunto que o Obsidian armazena/abre e os formatos que ele
/// delega a plugins — o inventario continua read-only e nunca executa nada).
const SUPPORTED_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "aac", "apng", "avif", "avi", "bin", "bmp", "csv", "doc", "docx", "eot", "epub", "flac", "flv",
    "gif", "gz", "heic", "heif", "html", "ics", "jpeg", "jpg", "json", "m4a", "m4v", "mkv", "mov",
    "mp3", "mp4", "mpg", "mpeg", "numbers", "odt", "oga", "ogg", "ogv", "opus", "otf", "pages",
    "pdf", "png", "ppt", "pptx", "psd", "rar", "rtf", "srt", "svg", "tar", "tif", "tiff", "ttf",
    "txt", "wav", "webm", "webp", "wmv", "xls", "xlsx", "xml", "yaml", "yml", "zip", "7z",
];
/// Limite explicito de anexos no inventario da varredura unificada: Vaults com
/// muitos anexos nao inflam a resposta; o excedente e sinalizado por
/// `attachmentsTruncated` (nunca silencioso).
const MAX_ATTACHMENT_INVENTORY_FILES: usize = 5_000;
const TEMPLATES_FILE: &str = "templates.json";
const MAX_PDF_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
const WATCHER_DUPLICATE_WINDOW: Duration = Duration::from_millis(250);
const WATCHER_EVENT_QUEUE_CAPACITY: usize = 1024;
const WATCHER_RESCAN_MAX_INTERVAL: Duration = Duration::from_secs(2);
const MAX_TAG_FRONTMATTER_BYTES: usize = 256 * 1024;
const MAX_TAG_INDEX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TAG_INDEX_ENTRIES: usize = 10_000;
const MAX_TAG_INDEX_NOTES: usize = 10_000;
const MAX_TAG_LENGTH: usize = 128;
const MAX_TAG_NOTE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TAGS_PER_NOTE: usize = 256;
static NEXT_VAULT_WATCHER_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_LINK_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);

// HistoryCommand/HistoryState/HistoryStatus e TrashEntry vivem em
// vault_metadata.rs (extraidos sem mudanca de comportamento).
#[allow(unused_imports)]
use vault_metadata::{
    apply_history_command, delete_vault_item_in_root, history_status, list_trash_in_root,
    permanently_delete_trash_item_in_root, read_history, read_trash_entries, record_history,
    restore_trash_item_in_root, write_history, write_trash_entries, HistoryCommand, HistoryStatus,
    TrashEntry,
};

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
    /// Preferencias visuais read-only de `appearance.json` (importaveis, nunca
    /// sobrescritas).
    obsidian_appearance: Option<ObsidianAppearance>,
    /// Configuracoes read-only conhecidas presentes em `.obsidian` que o app
    /// valida mas nao aplica (nomes apenas; nenhum conteudo e exposto).
    obsidian_ignored_config_files: Vec<String>,
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
    /// Campos conhecidos presentes em `app.json` com tipo invalido, ignorados
    /// sem descartar as demais preferencias validas (nomes apenas).
    #[serde(default)]
    ignored_preference_fields: Vec<String>,
}

/// Preferencias visuais read-only de `appearance.json` (tema, acento, fonte e
/// tamanho base) que o app pode IMPORTAR sem nunca sobrescrever o `.obsidian`.
/// Campos com tipo invalido ficam `None`; nenhum conteudo de plugin e exposto.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianAppearance {
    /// `obsidian` (escuro) ou `moonstone` (claro).
    theme: Option<String>,
    /// Cor de acento em hexadecimal (ex.: `#c46a2b`).
    accent_color: Option<String>,
    /// Tamanho base da fonte do editor/leitura (px, geralmente 16).
    base_font_size: Option<f64>,
    /// Tema CSS do `cssTheme` (nome apenas, nunca aplicado).
    css_theme: Option<String>,
    /// Familias de fonte declaradas (nomes apenas, sem conteudo).
    interface_font_family: Option<String>,
    text_font_family: Option<String>,
    monospace_font_family: Option<String>,
    /// Nomes de campos com tipo invalido, ignorados sem descartar os validos.
    #[serde(default)]
    ignored_appearance_fields: Vec<String>,
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

/// Progresso da leitura unificada das notas do Vault (notas processadas /
/// total), emitido ao frontend durante o comando `read_vault_notes`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultNotesReadProgress {
    processed: usize,
    total: usize,
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
/// Amostra maxima de notas diagnosticadas por varredura (falhas parciais de
/// leitura), mantendo a indexacao responsiva em Vaults grandes.
const DIAGNOSTIC_NOTE_LIMIT: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SpecialVaultFileKind {
    Canvas,
    Excalidraw,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
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
    // Build E2E: a jornada grava o caminho do fixture em um marcador dentro do
    // runRoot antes de clicar (o caminho so existe no momento do teste); sem o
    // marcador, o fluxo normal abre o dialogo nativo de pasta.
    #[cfg(feature = "e2e")]
    if let Ok(run_root) = std::env::var("MIRRORMIND_E2E_RUN_ROOT") {
        let marker = Path::new(&run_root).join("e2e-existing-vault.json");
        if let Ok(content) = fs::read_to_string(&marker) {
            if let Ok(Some(existing_path)) = serde_json::from_str::<Option<String>>(&content) {
                let canonical_root = canonicalize_directory(Path::new(&existing_path))
                    .map_err(|error| error.to_string())?;
                authorized_paths
                    .authorize_vault_root(&canonical_root)
                    .map_err(|error| error.to_string())?;
                let vault =
                    inspect_vault_path(&canonical_root).map_err(|error| error.to_string())?;
                let _ = persist_recent_vault(&app, &canonical_root);
                return Ok(Some(vault));
            }
        }
    }

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
    #[cfg(feature = "e2e")]
    if let Some(parent_path) = std::env::var_os("MIRRORMIND_E2E_VAULT_PARENT") {
        let canonical_parent =
            canonicalize_directory(Path::new(&parent_path)).map_err(|error| error.to_string())?;
        authorized_paths
            .authorize_parent_directory(&canonical_parent)
            .map_err(|error| error.to_string())?;
        return Ok(Some(canonical_parent.display().to_string()));
    }

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

/// Inventario completo do Vault em UMA unica varredura compartilhada (notas,
/// pastas, anexos e arquivos especiais). Os comandos individuais (`list_notes`,
/// `list_folders`, `list_attachments`, `list_special_files`) continuam
/// disponiveis como visoes da MESMA varredura unificada.
#[tauri::command]
fn scan_vault_inventory(
    path: String,
    inventory_state: State<VaultInventoryState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<VaultInventory, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let mut scan = scan_vault_unified(&root).map_err(|error| error.to_string())?;
    // Recupera renomeacoes interrompidas por crash ANTES de montar o
    // inventario, para que o estado refletido ja esteja consistente. A
    // recuperacao altera conteudos (roll forward), nunca o conjunto de
    // caminhos — a varredura unica permanece valida.
    match review::rename_journal::recover_pending_rename_transaction(&root) {
        Ok(conflicts) => scan.diagnostics.rename_recovery_conflicts = conflicts,
        Err(error) => {
            log::warn!("could not recover a pending rename transaction while scanning: {error}");
        }
    }
    diagnose_unreadable_notes(&root, &scan.notes, &mut scan.diagnostics);
    // Limite explicito de anexos no INVENTARIO (a varredura compartilhada e as
    // colecoes pontuais continuam completas para resolucao de embeds).
    scan.diagnostics.attachments_truncated =
        truncate_attachment_inventory(&mut scan.attachments, MAX_ATTACHMENT_INVENTORY_FILES);
    // Base do inventario incremental para eventos do watcher nesta sessao.
    inventory_state.store(&root, scan.clone());
    Ok(VaultInventory {
        notes: build_note_previews(&root, &scan.notes),
        folders: scan
            .folders
            .iter()
            .map(|folder| to_relative_display(&root, folder))
            .collect(),
        attachments: scan
            .attachments
            .iter()
            .map(|attachment| to_relative_display(&root, attachment))
            .collect(),
        special_files: SpecialVaultInventory {
            files: scan.special_files,
            truncated: scan.special_files_truncated,
        },
        diagnostics: scan.diagnostics,
    })
}

/// Aplica mudancas do watcher ao inventario bruto armazenado, SEM re-varrer o
/// Vault: criacao/remocao/renomeacao de anexos, pastas e (defensivamente)
/// notas/arquivos especiais usam a MESMA classificacao da varredura. Tipos
/// `modify`/`rescan` sao ignorados aqui (o chamador usa a varredura completa).
/// O resultado e reordenado e deduplicado como a varredura faz.
#[tauri::command]
fn apply_vault_inventory_changes(
    path: String,
    changes: Vec<VaultFileSystemChange>,
    inventory_state: State<VaultInventoryState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<VaultInventory, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let key = root.to_string_lossy().into_owned();
    let mut latest = inventory_state
        .latest
        .lock()
        .expect("vault inventory state poisoned");
    let Some(scan) = latest.get_mut(&key) else {
        return Err("O inventario do Vault ainda nao foi escaneado nesta sessao.".to_string());
    };
    for change in &changes {
        apply_vault_scan_change(scan, &root, change);
    }
    scan.notes.sort();
    scan.notes.dedup();
    scan.folders.sort();
    scan.folders.dedup();
    scan.attachments.sort();
    scan.attachments.dedup();
    scan.special_files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    scan.special_files
        .dedup_by(|left, right| left.relative_path == right.relative_path);
    scan.diagnostics.attachments_truncated =
        truncate_attachment_inventory(&mut scan.attachments, MAX_ATTACHMENT_INVENTORY_FILES);
    Ok(VaultInventory {
        notes: build_note_previews(&root, &scan.notes),
        folders: scan
            .folders
            .iter()
            .map(|folder| to_relative_display(&root, folder))
            .collect(),
        attachments: scan
            .attachments
            .iter()
            .map(|attachment| to_relative_display(&root, attachment))
            .collect(),
        special_files: SpecialVaultInventory {
            files: scan.special_files.clone(),
            truncated: scan.special_files_truncated,
        },
        diagnostics: scan.diagnostics.clone(),
    })
}

/// Aplica UMA mudanca do watcher ao inventario bruto, com a mesma
/// classificacao da varredura unificada (nota, anexo, arquivo especial, pasta).
fn apply_vault_scan_change(scan: &mut VaultScan, root: &Path, change: &VaultFileSystemChange) {
    match change.kind {
        VaultFileSystemChangeKind::Create => {
            for relative in &change.paths {
                insert_inventory_path(scan, root, relative);
            }
        }
        VaultFileSystemChangeKind::Remove => {
            for relative in &change.paths {
                remove_inventory_path(scan, root, relative);
            }
        }
        VaultFileSystemChangeKind::Rename => {
            if change.paths.len() >= 2 {
                rename_inventory_path(scan, root, &change.paths[0], &change.paths[1]);
            }
        }
        VaultFileSystemChangeKind::Modify | VaultFileSystemChangeKind::Rescan => {}
    }
}

fn inventory_note_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|segment| segment.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase);
    extension.as_deref() == Some("md") && !name.ends_with(".excalidraw.md")
}

fn is_supported_attachment_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_ATTACHMENT_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

/// Insere um caminho recem-criado no inventario, classificando como a varredura
/// faz (diretorio, nota, anexo, arquivo especial; symlinks e desconhecidos fora).
fn insert_inventory_path(scan: &mut VaultScan, root: &Path, relative: &str) {
    let absolute = root.join(relative);
    if let Ok(metadata) = fs::symlink_metadata(&absolute) {
        if metadata.file_type().is_symlink() {
            return;
        }
        if metadata.is_dir() {
            if !scan.folders.contains(&absolute) {
                scan.folders.push(absolute);
            }
            return;
        }
    }
    if inventory_note_path(&absolute) {
        if !scan.notes.contains(&absolute) {
            scan.notes.push(absolute);
        }
        return;
    }
    if is_supported_attachment_path(&absolute) {
        if !scan.attachments.contains(&absolute) {
            scan.attachments.push(absolute);
        }
        return;
    }
    if let Some(kind) = special_vault_file_kind(&absolute) {
        let relative_display = to_relative_display(root, &absolute);
        let name = absolute
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if scan
            .special_files
            .iter()
            .all(|file| file.relative_path != relative_display)
        {
            if scan.special_files.len() < MAX_SPECIAL_VAULT_FILES {
                scan.special_files.push(SpecialVaultFile {
                    name,
                    relative_path: relative_display,
                    kind,
                });
            } else {
                scan.special_files_truncated = true;
            }
        }
    }
}

/// Remove um caminho (ou, sendo pasta, tudo sob ele) do inventario.
fn remove_inventory_path(scan: &mut VaultScan, root: &Path, relative: &str) {
    let absolute = root.join(relative);
    let absolute_prefix = format!("{}/", absolute.to_string_lossy());
    scan.notes.retain(|path| {
        let display = path.to_string_lossy();
        path != &absolute && !display.starts_with(&absolute_prefix)
    });
    scan.attachments.retain(|path| {
        let display = path.to_string_lossy();
        path != &absolute && !display.starts_with(&absolute_prefix)
    });
    scan.folders.retain(|path| {
        let display = path.to_string_lossy();
        path != &absolute && !display.starts_with(&absolute_prefix)
    });
    let relative_prefix = format!("{}/", relative.replace('\\', "/"));
    scan.special_files.retain(|file| {
        file.relative_path != relative && !file.relative_path.starts_with(&relative_prefix)
    });
}

/// Renomeia um caminho (pasta: tudo sob ela) no inventario, usando o proprio
/// inventario para descobrir a categoria. Caminhos desconhecidos caem para a
/// classificacao por extensao no destino.
fn rename_inventory_path(scan: &mut VaultScan, root: &Path, from: &str, to: &str) {
    let from_absolute = root.join(from);
    let to_absolute = root.join(to);
    let is_folder = scan.folders.iter().any(|folder| folder == &from_absolute)
        || fs::symlink_metadata(&to_absolute).is_ok_and(|metadata| metadata.is_dir());

    if is_folder {
        let mut found = false;
        for folder in &mut scan.folders {
            if folder == &from_absolute {
                *folder = to_absolute.clone();
                found = true;
            } else if let Ok(suffix) = folder.strip_prefix(&from_absolute) {
                *folder = to_absolute.join(suffix);
                found = true;
            }
        }
        for note in &mut scan.notes {
            if let Ok(suffix) = note.strip_prefix(&from_absolute) {
                *note = to_absolute.join(suffix);
                found = true;
            }
        }
        for attachment in &mut scan.attachments {
            if let Ok(suffix) = attachment.strip_prefix(&from_absolute) {
                *attachment = to_absolute.join(suffix);
                found = true;
            }
        }
        let from_prefix = format!("{}/", from.replace('\\', "/"));
        let to_prefix = format!("{}/", to.replace('\\', "/"));
        for file in &mut scan.special_files {
            if let Some(suffix) = file.relative_path.strip_prefix(&from_prefix) {
                file.relative_path = format!("{to_prefix}{suffix}");
                found = true;
            }
        }
        if !found {
            insert_inventory_path(scan, root, to);
        }
        return;
    }

    let mut moved = false;
    for note in &mut scan.notes {
        if *note == from_absolute {
            *note = to_absolute.clone();
            moved = true;
        }
    }
    for attachment in &mut scan.attachments {
        if *attachment == from_absolute {
            *attachment = to_absolute.clone();
            moved = true;
        }
    }
    for file in &mut scan.special_files {
        if file.relative_path == from {
            file.relative_path = to.to_string();
            moved = true;
        }
    }
    if !moved {
        insert_inventory_path(scan, root, to);
    }
}

/// Aplica o limite explicito de anexos do inventario, retornando se truncou.
fn truncate_attachment_inventory(attachments: &mut Vec<PathBuf>, limit: usize) -> bool {
    if attachments.len() > limit {
        attachments.truncate(limit);
        true
    } else {
        false
    }
}

/// Diagnostica falhas parciais de leitura das notas (amostra limitada para
/// manter a varredura responsiva em Vaults grandes): Markdown nao UTF-8,
/// leitura indisponivel e falha na extracao de tags. Nunca expoe conteudo.
fn diagnose_unreadable_notes(
    root: &Path,
    note_paths: &[PathBuf],
    diagnostics: &mut ScanDiagnostics,
) {
    for note_path in note_paths
        .iter()
        .take(DIAGNOSTIC_NOTE_LIMIT.min(note_paths.len()))
    {
        let relative_path = to_relative_display(root, note_path);
        let bytes = match fs::read(note_path) {
            Ok(bytes) => bytes,
            Err(error) => {
                log::warn!("unreadable note '{}': {error}", note_path.display());
                diagnostics.unreadable_files.push(UnreadableFile {
                    relative_path,
                    reason: UnreadableReason::Unreadable,
                });
                continue;
            }
        };
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => {
                diagnostics.unreadable_files.push(UnreadableFile {
                    relative_path,
                    reason: UnreadableReason::NotUtf8,
                });
                continue;
            }
        };
        if let Err(error) = extract_tags(&content) {
            log::warn!(
                "tag index failure for note '{}': {error}",
                note_path.display()
            );
            diagnostics.unreadable_files.push(UnreadableFile {
                relative_path,
                reason: UnreadableReason::TagIndexFailure,
            });
        }
    }
    diagnostics
        .unreadable_files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
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

// today_day vive em vault_metadata.rs (extraido sem mudanca de comportamento).

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

/// Limite de bytes para a leitura de arquivos especiais (Canvas/Excalidraw).
const MAX_SPECIAL_VAULT_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// Le um arquivo especial do Vault (`.canvas` ou `.excalidraw`) como JSON cru,
/// read-only: restrito a extensoes conhecidas, sem symlink, dentro do Vault,
/// com limite de tamanho e sem seguir o componente final (TOCTOU).
#[tauri::command]
fn read_special_vault_file(
    path: String,
    relative_path: String,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<tauri::ipc::Response, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let bytes = read_special_vault_file_in_root(&root, &relative_path)
        .map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_special_vault_file_in_root(root: &Path, relative_path: &str) -> Result<Vec<u8>> {
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
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("canvas")
                    || extension.eq_ignore_ascii_case("excalidraw")
            })
    {
        bail!("Escolha um arquivo Canvas ou Excalidraw valido do Vault.");
    }

    let requested = canonical_root.join(candidate);
    if fs::symlink_metadata(&requested).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("Links simbolicos nao podem ser usados como arquivos especiais.");
    }
    let canonical_requested = requested
        .canonicalize()
        .map_err(|error| anyhow::anyhow!(error).context("Arquivo especial indisponivel."))?;
    if !canonical_requested.starts_with(&canonical_root) {
        bail!("O arquivo especial precisa permanecer dentro do Vault.");
    }
    let metadata = fs::metadata(&canonical_requested).map_err(|error| {
        anyhow::anyhow!(error).context("Nao foi possivel inspecionar o arquivo especial.")
    })?;
    if !metadata.is_file() {
        bail!("O caminho escolhido nao e um arquivo regular.");
    }
    if metadata.len() > MAX_SPECIAL_VAULT_FILE_BYTES {
        bail!("O arquivo especial e grande demais para visualizar.");
    }
    let bytes = read_regular_file_no_follow(
        &canonical_requested,
        &canonical_root,
        MAX_SPECIAL_VAULT_FILE_BYTES,
    )
    .ok_or_else(|| anyhow::anyhow!("Nao foi possivel ler o arquivo especial."))?;
    Ok(bytes)
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

/// Leitura unificada: devolve TODOS os conteudos das notas do Vault em UMA
/// chamada IPC, em vez de N chamadas `read_note` (indexacao em segundo plano,
/// grafo e Bases). Progresso emitido em lotes para a UI nao congelar sem
/// feedback em Vaults grandes.
#[tauri::command]
fn read_vault_notes(
    path: String,
    app: AppHandle,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<Vec<NoteDocument>, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let note_paths = collect_markdown_files(&root).map_err(|error| error.to_string())?;

    read_vault_notes_in_root(&root, &note_paths, |processed, total| {
        let _ = app.emit(
            "vault-notes-read-progress",
            VaultNotesReadProgress { processed, total },
        );
    })
    .map_err(|error| error.to_string())
}

/// Nucelo puro (sem IPC) da leitura unificada, testavel com um Vault temporario.
/// `on_progress` recebe (processadas, total) a cada lote de 256 notas e no final.
fn read_vault_notes_in_root(
    root: &Path,
    note_paths: &[PathBuf],
    mut on_progress: impl FnMut(usize, usize),
) -> Result<Vec<NoteDocument>> {
    const PROGRESS_BATCH: usize = 256;
    let total = note_paths.len();
    let mut documents = Vec::with_capacity(total);
    for (index, note_path) in note_paths.iter().enumerate() {
        let content = fs::read_to_string(note_path)
            .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
        documents.push(NoteDocument {
            name: note_path
                .file_name()
                .and_then(|segment| segment.to_str())
                .unwrap_or_default()
                .to_string(),
            relative_path: to_relative_display(root, note_path),
            content,
        });
        let processed = index + 1;
        if processed % PROGRESS_BATCH == 0 || processed == total {
            on_progress(processed, total);
        }
    }
    Ok(documents)
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
    crate::tag_management::recover_pending_tag_operations(&root)
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

pub(crate) fn extract_tags(content: &str) -> Result<Vec<String>> {
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

pub(crate) fn split_frontmatter_for_tags(content: &str) -> Option<(&str, &str)> {
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

pub(crate) fn normalize_tag(value: &str) -> Option<String> {
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

pub(crate) fn extract_wiki_link_targets(content: &str) -> Vec<WikiLinkTarget> {
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

#[cfg(test)]
fn prepare_wiki_link_updates(
    root: &Path,
    path_changes: &[(String, String)],
    available_paths_before_change: &[String],
) -> Result<Vec<PlannedWikiLinkUpdate>> {
    prepare_wiki_link_updates_with_candidates(
        root,
        path_changes,
        available_paths_before_change,
        None,
    )
}

/// Prepara as atualizacoes de links lendo apenas as notas candidatas quando o
/// indice de wikilinks esta disponivel (`Some(candidates)`), evitando reler
/// toda a arvore Markdown em cada renomeacao. O filtro e um superconjunto
/// seguro: toda nota que a reescrita poderia alterar esta em `candidates`.
fn prepare_wiki_link_updates_with_candidates(
    root: &Path,
    path_changes: &[(String, String)],
    available_paths_before_change: &[String],
    candidates: Option<&HashSet<String>>,
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
        if let Some(candidates) = candidates {
            if !candidates.contains(note_relative_path) {
                continue;
            }
        }
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

fn temporary_transaction_path(root: &Path, target: &Path, extension: &str) -> PathBuf {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    let id = NEXT_LINK_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    root.join(format!(".{file_name}.mirmind-{id}.{extension}"))
}

#[cfg(windows)]
fn windows_wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt as _;

    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn replace_file_atomically(target: &Path, replacement: &Path, backup: Option<&Path>) -> Result<()> {
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING};

    if let Some(backup) = backup {
        fs::hard_link(target, backup).with_context(|| {
            format!(
                "Nao foi possivel reservar backup de '{}'.",
                target.display()
            )
        })?;
    }
    let target_wide = windows_wide_path(target);
    let replacement_wide = windows_wide_path(replacement);
    let mut last_error = None;
    for _ in 0..128 {
        let moved = unsafe {
            MoveFileExW(
                replacement_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING,
            )
        };
        if moved != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        let transient = matches!(error.raw_os_error(), Some(5 | 32));
        last_error = Some(error);
        if !transient {
            break;
        }
        std::thread::yield_now();
    }
    if let Some(backup) = backup {
        let _ = fs::remove_file(backup);
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("replace sem resultado"))).with_context(
        || {
            format!(
                "Nao foi possivel substituir '{}' atomicamente.",
                target.display()
            )
        },
    )
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
    after_commit: F,
) -> Result<()>
where
    F: FnMut(usize) -> Result<()>,
{
    update_wiki_links_for_note_path_change_with_hooks(root, updates, |_| Ok(()), after_commit)
}

fn update_wiki_links_for_note_path_change_with_hooks<F, G>(
    root: &Path,
    updates: &[PlannedWikiLinkUpdate],
    mut before_commit: F,
    mut after_commit: G,
) -> Result<()>
where
    F: FnMut(usize) -> Result<()>,
    G: FnMut(usize) -> Result<()>,
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
        let staged_path = temporary_transaction_path(root, &update.path_after_change, "tmp");
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
            before_commit(index)?;
            verify_link_update_path(root, &staged.target_path)?;
            let backup_path = temporary_transaction_path(root, &staged.target_path, "bak");
            #[cfg(windows)]
            replace_file_atomically(&staged.target_path, &staged.staged_path, Some(&backup_path))?;

            #[cfg(not(windows))]
            {
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
                fs::hard_link(&staged.staged_path, &staged.target_path).with_context(|| {
                    format!(
                        "O destino '{}' foi ocupado durante a substituicao.",
                        staged.target_path.display()
                    )
                })?;
                fs::remove_file(&staged.staged_path)?;
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

/// Núcleo testavel do append de conhecimento extra: le a nota, adiciona o texto
/// como citacao ao final e grava com historico. O texto ja foi confirmado pelo
/// usuario na interface; aqui apenas o append e validado e executado.
fn append_knowledge_suggestion_in_root(
    root: &Path,
    relative_path: &str,
    text: &str,
) -> Result<NoteDocument> {
    let text = text.trim();
    if text.is_empty() || text.encode_utf16().count() > 8_192 {
        bail!("A sugestao de conhecimento extra e invalida.");
    }
    let note_path = resolve_note_path(root, relative_path)?;
    let before_content = fs::read_to_string(&note_path)
        .with_context(|| format!("Nao foi possivel ler '{}'.", note_path.display()))?;
    let mut content = before_content.trim_end().to_string();
    if !content.is_empty() {
        content.push_str("\n\n");
    }
    content.push_str("> ");
    content.push_str(text);
    content.push('\n');
    fs::write(&note_path, content.as_bytes())
        .with_context(|| format!("Nao foi possivel salvar '{}'.", note_path.display()))?;
    if before_content != content {
        record_history(
            root,
            HistoryCommand::SaveNote {
                relative_path: relative_path.to_string(),
                before_content,
                after_content: content.clone(),
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
        content,
    })
}

/// Adiciona conhecimento extra sugerido pela IA (e confirmado pelo usuario) ao
/// final da nota. Nenhum conteudo e alterado sem a chamada explicita do
/// cliente apos a confirmacao na interface: o comando apenas executa o append
/// ja aprovado, com a mesma seguranca de escrita de `save_note` (caminho
/// autorizado, historico e indice de wikilinks atualizados).
#[tauri::command]
fn append_knowledge_suggestion_to_note(
    path: String,
    relative_path: String,
    text: String,
    index_state: State<WikilinkIndexState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    let document = append_knowledge_suggestion_in_root(&root, &relative_path, &text)
        .map_err(|error| error.to_string())?;
    update_wikilink_index_after_save(&root, &relative_path, &document.content, &index_state);
    Ok(document)
}

#[tauri::command]
fn save_note(
    path: String,
    relative_path: String,
    content: String,
    index_state: State<WikilinkIndexState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<NoteDocument, String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let document =
        save_note_in_root(&root, &relative_path, &content).map_err(|error| error.to_string())?;
    // Mantem o cache em memoria do indice de wikilinks fresco: uma edicao entre
    // renomeacoes nao deve forcar a reconstrucao completa do indice.
    update_wikilink_index_after_save(&root, &relative_path, &content, &index_state);
    Ok(document)
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
    index_state: State<WikilinkIndexState>,
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

    // Uma nota nova entra no cache em memoria do indice de wikilinks.
    update_wikilink_index_after_save(&root, &relative_path, &initial_content, &index_state);

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

/// Grava bytes em um arquivo regular fechando a janela TOCTOU do componente
/// final: a abertura usa no-follow (unix: `O_NOFOLLOW`; Windows:
/// `FILE_FLAG_OPEN_REPARSE_POINT`, que nao segue o link), e o handle aberto e
/// verificado como arquivo regular nao-simbolico ANTES de qualquer truncamento
/// ou escrita. O caminho tambem e revalidado por canonicalizacao (que segue
/// symlinks) para que um parent trocado por um link apontando para fora do
/// Vault seja rejeitado antes da gravacao. A janela residual de troca
/// concorrente de diretorios intermediarios em Windows (sem `openat`) e
/// documentada como limite conhecido desta camada.
pub(crate) fn write_file_regular_no_follow(
    path: &Path,
    canonical_root: &Path,
    bytes: &[u8],
) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT as u32);
    }
    // Abre SEM truncar: o handle e verificado como regular antes de qualquer
    // mutacao, para que um symlink trocado no ultimo instante nunca seja
    // truncado ou reescrito.
    let mut file = options
        .open(path)
        .with_context(|| format!("Nao foi possivel abrir '{}'.", path.display()))?;
    let metadata = file
        .metadata()
        .with_context(|| format!("Nao foi possivel inspecionar '{}'.", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("'{}' nao e um arquivo regular seguro.", path.display());
    }
    let canonical = path
        .canonicalize()
        .with_context(|| format!("Nao foi possivel verificar '{}'.", path.display()))?;
    if !canonical.starts_with(canonical_root) {
        bail!("'{}' aponta para fora do Vault.", path.display());
    }
    file.set_len(0)
        .with_context(|| format!("Nao foi possivel preparar '{}'.", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("Nao foi possivel escrever '{}'.", path.display()))?;
    file.flush()
        .with_context(|| format!("Nao foi possivel finalizar '{}'.", path.display()))
}

/// Copia sincronizada byte a byte (fallback para filesystems sem hard links).
pub(crate) fn copy_file_synced(source: &Path, target: &Path) -> Result<()> {
    let mut input = fs::File::open(source)
        .with_context(|| format!("Nao foi possivel ler '{}'.", source.display()))?;
    let mut output = fs::File::create(target)
        .with_context(|| format!("Nao foi possivel criar '{}'.", target.display()))?;
    std::io::copy(&mut input, &mut output)
        .with_context(|| format!("Nao foi possivel copiar '{}'.", source.display()))?;
    output
        .sync_all()
        .with_context(|| format!("Nao foi possivel sincronizar '{}'.", target.display()))
}

/// Reserva `target` a partir de `source` com hard link quando o filesystem
/// suporta; caso contrario (FAT/exFAT/redes), usa copia sincronizada. Retorna
/// `true` quando o fallback por copia foi usado. A funcao de hard link e
/// injetada para permitir testes do caminho de fallback.
pub(crate) fn hard_link_or_copy(
    source: &Path,
    target: &Path,
    hard_link: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<bool> {
    match hard_link(source, target) {
        Ok(()) => Ok(false),
        Err(error) => {
            log::warn!(
                "hard link indisponivel para '{}' -> '{}' ({error}); usando copia sincronizada.",
                source.display(),
                target.display()
            );
            copy_file_synced(source, target)?;
            Ok(true)
        }
    }
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

    // Reserva o destino com hard link quando o filesystem suporta; senao usa
    // copia sincronizada (fallback explicito para FAT/exFAT/redes).
    hard_link_or_copy(source, target, |a, b| fs::hard_link(a, b))?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(error)
            .with_context(|| format!("Nao foi possivel remover '{}'.", source.display()));
    }
    Ok(())
}

/// Mantem o indice de wikilinks coerente apos uma renomeacao concluida: notas
/// movidas reutilizam as chaves, notas atualizadas recebem as novas chaves e o
/// resultado e persistido para a proxima sessao. Falhas aqui nunca invalidam a
/// renomeacao (o indice apenas sera reconstruido na proxima vez).
fn update_wikilink_index_after_rename(
    root: &Path,
    wiki_index: Option<review::wikilink_index::WikilinkIndex>,
    path_changes: &[(String, String)],
    planned_link_updates: &[PlannedWikiLinkUpdate],
    index_state: Option<&WikilinkIndexState>,
) {
    let Some(mut index) = wiki_index else {
        return;
    };
    let updated = planned_link_updates
        .iter()
        .map(|update| {
            (
                to_relative_display(root, &update.path_after_change),
                String::from_utf8(update.updated_content.clone()).unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    let result = review::wikilink_index::apply_rename(&mut index, root, path_changes, &updated);
    if let Some(index_state) = index_state {
        index_state.store(root, Some(index.clone()));
    }
    if let Err(error) = result.and_then(|()| review::wikilink_index::persist(root, &index)) {
        log::warn!("could not update the wikilink index after rename: {error}");
    }
}

/// Carrega o indice de wikilinks para uma renomeacao/movimentacao, preferindo o
/// cache em memoria (atualizado incrementalmente em salvamentos, criacoes,
/// exclusoes e renomeacoes) quando presente e fresco; o frescor e sempre
/// validado por stat. `Some(None)` no cache = indisponivel por limites nesta
/// sessao: pula a reconstrucao repetida e usa a varredura completa.
fn load_fresh_index_for_rename(
    root: &Path,
    available_paths: &[String],
    hooks: &review::wikilink_index::BuildHooks,
    index_state: Option<&WikilinkIndexState>,
) -> Result<Option<review::wikilink_index::WikilinkIndex>> {
    if let Some(index_state) = index_state {
        match index_state.cached(root) {
            Some(Some(index)) => {
                let current = review::wikilink_index::fingerprint_map(root, available_paths)?;
                if review::wikilink_index::notes_fingerprints(&index) == &current {
                    return Ok(Some(index));
                }
                log::debug!("wikilink index cache stale; rebuilding");
            }
            Some(None) => {
                log::debug!("wikilink index unavailable (limits); skipping rebuild");
                return Ok(None);
            }
            None => {}
        }
    }
    let index =
        review::wikilink_index::load_fresh_for_rename_with_hooks(root, available_paths, hooks)?;
    if let Some(index_state) = index_state {
        // `None` por limites vira cache de indisponivel (nao repete a
        // reconstrucao cara); `None` por cancelamento do usuario NAO e cacheado
        // para que a proxima renomeacao possa tentar de novo.
        let cancelled = hooks.should_cancel.as_ref().is_some_and(|check| check());
        if !cancelled {
            index_state.store(root, index.clone());
        }
    }
    Ok(index)
}

/// Atualiza o cache em memoria do indice de wikilinks apos um salvamento,
/// criacao ou restauracao de nota (sem tocar o disco: a persistencia acontece
/// na proxima renomeacao). Sem cache, a operacao e um no-op e a proxima
/// renomeacao valida/reconstroi como antes. Falhas aqui nunca invalidam a
/// operacao de escrita.
fn update_wikilink_index_after_save(
    root: &Path,
    relative_path: &str,
    content: &str,
    index_state: &WikilinkIndexState,
) {
    let key = WikilinkIndexState::root_key(root);
    let mut cache = index_state.cache.lock().expect("wikilink cache poisoned");
    if let Some(Some(index)) = cache.get_mut(&key) {
        if let Err(error) =
            review::wikilink_index::refresh_note(index, root, relative_path, content)
        {
            log::warn!("could not update the wikilink index after save: {error}");
        }
    }
}

/// Remove notas do cache em memoria do indice de wikilinks (exclusao/lixeira).
fn remove_notes_from_wikilink_index_with_state(
    root: &Path,
    relative_paths: &[String],
    index_state: &WikilinkIndexState,
) {
    if relative_paths.is_empty() {
        return;
    }
    let key = WikilinkIndexState::root_key(root);
    let mut cache = index_state.cache.lock().expect("wikilink cache poisoned");
    if let Some(Some(index)) = cache.get_mut(&key) {
        for relative_path in relative_paths {
            review::wikilink_index::remove_note(index, relative_path);
        }
    }
}

/// Entradas do journal duravel a partir das atualizacoes planejadas de links:
/// cada nota cujo conteudo muda entra com os bytes exatos antes e depois.
fn journal_entries_for_planned_updates(
    root: &Path,
    planned: &[PlannedWikiLinkUpdate],
) -> Result<Vec<review::rename_journal::RenameJournalEntry>> {
    planned
        .iter()
        .map(|update| {
            Ok(review::rename_journal::RenameJournalEntry {
                relative_path: to_relative_display(root, &update.path_after_change),
                before_content: String::from_utf8(update.original_content.clone())
                    .context("Uma nota afetada nao esta codificada como UTF-8.")?,
                after_content: String::from_utf8(update.updated_content.clone())
                    .context("O conteudo atualizado de uma nota nao e UTF-8.")?,
            })
        })
        .collect()
}

/// Decide o destino do journal apos o resultado da operacao: sucesso limpa o
/// journal; erro com estado fisico consistente (movimento aconteceu ou foi
/// revertido) tambem limpa; estado ambiguo mantem o journal para a recuperacao
/// no proximo startup. O erro original sempre e propagado.
fn resolve_rename_journal_after_outcome(
    root: &Path,
    source_relative: &str,
    destination_relative: &str,
    outcome: Result<usize>,
) -> Result<()> {
    match outcome {
        Ok(_) => review::rename_journal::complete_rename_transaction(root),
        Err(error) => {
            let source = root.join(source_relative);
            let destination = root.join(destination_relative);
            let source_exists = fs::symlink_metadata(&source).is_ok();
            let destination_exists = fs::symlink_metadata(&destination).is_ok();
            if source_exists != destination_exists {
                if let Err(cleanup) = review::rename_journal::complete_rename_transaction(root) {
                    log::warn!("could not clean rename journal after failed rename: {cleanup}");
                }
            } else {
                log::warn!(
                    "rename failed with ambiguous state; journal kept for recovery: {error}"
                );
            }
            Err(error)
        }
    }
}

/// Constroi os hooks de progresso/cancelamento da (re)construcao do indice de
/// wikilinks para uma operacao do backend: o progresso e emitido ao frontend
/// como `wikilink-index-progress` e o cancelamento le a flag do estado.
fn wikilink_index_build_hooks(
    app: AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> review::wikilink_index::BuildHooks {
    review::wikilink_index::BuildHooks {
        on_progress: Some(Box::new(move |processed: usize, total: usize| {
            let _ = app.emit(
                "wikilink-index-progress",
                WikiLinkIndexProgress { processed, total },
            );
        })),
        should_cancel: Some(Box::new(move || cancel_flag.load(Ordering::Acquire))),
    }
}

#[tauri::command]
fn rename_vault_item(
    path: String,
    relative_path: String,
    new_name: String,
    item_type: String,
    app: AppHandle,
    index_state: State<WikilinkIndexState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    index_state.set_cancel(&root, false);
    let cancel_flag = index_state.cancel_flag(&root);
    let hooks = wikilink_index_build_hooks(app, cancel_flag);
    rename_vault_item_in_root_with_state(
        &root,
        &relative_path,
        &new_name,
        &item_type,
        &hooks,
        Some(&index_state),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
fn rename_vault_item_in_root(
    root: &Path,
    relative_path: &str,
    new_name: &str,
    item_type: &str,
) -> Result<()> {
    rename_vault_item_in_root_with_state(
        root,
        relative_path,
        new_name,
        item_type,
        &review::wikilink_index::BuildHooks::default(),
        None,
    )
}

fn rename_vault_item_in_root_with_state(
    root: &Path,
    relative_path: &str,
    new_name: &str,
    item_type: &str,
    hooks: &review::wikilink_index::BuildHooks,
    index_state: Option<&WikilinkIndexState>,
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
    // Indice escalavel: quando disponivel e fresco, le apenas as notas que
    // PODEM referenciar o item (superconjunto seguro) em vez da arvore inteira.
    let wiki_index =
        load_fresh_index_for_rename(root, &available_paths_before_change, hooks, index_state)?;
    let candidates = wiki_index
        .as_ref()
        .map(|index| review::wikilink_index::candidates(index, &path_changes));
    let planned_link_updates = prepare_wiki_link_updates_with_candidates(
        root,
        &path_changes,
        &available_paths_before_change,
        candidates.as_ref(),
    )?;
    let journal_entries = journal_entries_for_planned_updates(root, &planned_link_updates)?;
    let source_relative = to_relative_display(root, &source);
    let destination_relative = to_relative_display(root, &destination);

    // Journal duravel: registra a transacao ANTES de qualquer mutacao para que
    // uma queda de energia no meio seja concluida ou diagnosticada no startup.
    review::rename_journal::begin_rename_transaction(
        root,
        is_note,
        &source_relative,
        &destination_relative,
        &journal_entries,
    )?;
    let outcome = review::storage::with_relocated_learning_documents(root, &path_changes, || {
        move_vault_path_without_overwrite(&source, &destination, is_note)
            .with_context(|| format!("Nao foi possivel renomear '{}'.", source.display()))?;
        if let Err(error) = update_wiki_links_for_note_path_change(root, &planned_link_updates) {
            move_vault_path_without_overwrite(&destination, &source, is_note).with_context(
                || {
                    format!(
                        "A atualizacao dos links falhou e tambem nao foi possivel restaurar '{}'.",
                        source.display()
                    )
                },
            )?;
            return Err(error);
        }
        Ok(())
    });
    let result = resolve_rename_journal_after_outcome(
        root,
        &source_relative,
        &destination_relative,
        outcome,
    );
    if result.is_ok() {
        update_wikilink_index_after_rename(
            root,
            wiki_index,
            &path_changes,
            &planned_link_updates,
            index_state,
        );
    }
    result
}

#[tauri::command]
fn move_vault_item(
    path: String,
    relative_path: String,
    destination_folder: String,
    item_type: String,
    app: AppHandle,
    index_state: State<WikilinkIndexState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    index_state.set_cancel(&root, false);
    let cancel_flag = index_state.cancel_flag(&root);
    let hooks = wikilink_index_build_hooks(app, cancel_flag);
    move_vault_item_in_root_with_state(
        &root,
        &relative_path,
        &destination_folder,
        &item_type,
        &hooks,
        Some(&index_state),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
fn move_vault_item_in_root(
    root: &Path,
    relative_path: &str,
    destination_folder: &str,
    item_type: &str,
) -> Result<()> {
    move_vault_item_in_root_with_state(
        root,
        relative_path,
        destination_folder,
        item_type,
        &review::wikilink_index::BuildHooks::default(),
        None,
    )
}

fn move_vault_item_in_root_with_state(
    root: &Path,
    relative_path: &str,
    destination_folder: &str,
    item_type: &str,
    hooks: &review::wikilink_index::BuildHooks,
    index_state: Option<&WikilinkIndexState>,
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
    // Indice escalavel: le apenas as notas candidatas (superconjunto seguro).
    let wiki_index =
        load_fresh_index_for_rename(root, &available_paths_before_change, hooks, index_state)?;
    let candidates = wiki_index
        .as_ref()
        .map(|index| review::wikilink_index::candidates(index, &path_changes));
    let planned_link_updates = prepare_wiki_link_updates_with_candidates(
        root,
        &path_changes,
        &available_paths_before_change,
        candidates.as_ref(),
    )?;
    let journal_entries = journal_entries_for_planned_updates(root, &planned_link_updates)?;
    let source_relative = to_relative_display(root, &source);
    let target_relative = to_relative_display(root, &target);

    // Journal duravel: registra a transacao ANTES de qualquer mutacao.
    review::rename_journal::begin_rename_transaction(
        root,
        is_note,
        &source_relative,
        &target_relative,
        &journal_entries,
    )?;
    let outcome = review::storage::with_relocated_learning_documents(root, &path_changes, || {
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
    });
    let result =
        resolve_rename_journal_after_outcome(root, &source_relative, &target_relative, outcome);
    if result.is_ok() {
        update_wikilink_index_after_rename(
            root,
            wiki_index,
            &path_changes,
            &planned_link_updates,
            index_state,
        );
    }
    result
}

#[tauri::command]
fn cancel_wikilink_index_build(
    path: String,
    index_state: State<WikilinkIndexState>,
) -> Result<(), String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    index_state.set_cancel(&root, true);
    Ok(())
}

#[tauri::command]
fn delete_vault_item(
    path: String,
    relative_path: String,
    item_type: String,
    index_state: State<WikilinkIndexState>,
    authorized_paths: State<AuthorizedPaths>,
) -> Result<(), String> {
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let removed_notes = if item_type == "note" {
        vec![relative_path.clone()]
    } else {
        index_state.notes_under(&root, &relative_path)
    };
    delete_vault_item_in_root(&root, &relative_path, &item_type)
        .map_err(|error| error.to_string())?;
    remove_notes_from_wikilink_index_with_state(&root, &removed_notes, &index_state);
    Ok(())
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

// delete_vault_item_in_root, restore_trash_item_in_root e
// permanently_delete_trash_item_in_root vivem em vault_metadata.rs.

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

/// Diretorio de anexos configurado em `attachmentFolderPath`.
///
/// Para uma nota AINDA NAO salva (rascunho, `note_relative_path` vazio), um
/// valor relativo `./pasta` e resolvido contra a RAIZ do Vault (o rascunho
/// ainda nao tem pasta); os anexos importados durante o rascunho permanecem no
/// lugar ao salvar, com referencia por caminho relativo ao Vault. Quando a nota
/// existe, `./pasta` resolve relativo a pasta da nota, como o Obsidian faz.
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

/// Le um arquivo regular com abertura no-follow e validacao pelo MESMO handle
/// (nunca pelo caminho resolvido antes), fechando a janela TOCTOU de troca por
/// symlink entre a verificacao e a leitura. Retorna `None` quando o arquivo nao
/// e um regular seguro dentro do Vault ou excede `max` bytes.
fn read_regular_file_no_follow(path: &Path, canonical_root: &Path, max: u64) -> Option<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT as u32);
    }
    let mut file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    if !canonical.starts_with(canonical_root) {
        return None;
    }
    if metadata.len() > max {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(max + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > max {
        return None;
    }
    Some(bytes)
}

/// Configuracoes read-only reconhecidas do Obsidian (validadas como JSON, mas
/// nunca aplicadas nem expostas em conteudo): a whitelist evolui conforme novos
/// formatos sem tratar esses arquivos como notas ou anexos.
const KNOWN_OBSIDIAN_CONFIG_FILES: &[&str] = &[
    "app.json",
    "appearance.json",
    "community-plugins.json",
    "core-plugins.json",
    "daily-notes.json",
    "graph.json",
    "hotkeys.json",
    "workspace.json",
];

/// Preferencias read-only do `app.json` com parse TOLERANTE por campo: um campo
/// conhecido com tipo invalido e ignorado (registrado em `ignored_preference_fields`)
/// sem descartar as demais preferencias validas.
fn parse_obsidian_preferences(content: &str) -> Option<ObsidianPreferences> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let object = value.as_object()?;

    // Campos string conhecidos: extrai com tipo, registrando como ignorados os
    // que estao presentes mas com tipo invalido.
    const STRING_FIELDS: &[&str] = &[
        "newFileLocation",
        "newFileFolderPath",
        "attachmentFolderPath",
        "newLinkFormat",
        "trashOption",
    ];
    let string_values = STRING_FIELDS
        .iter()
        .map(|name| {
            object
                .get(*name)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let mut ignored_preference_fields = Vec::new();
    for (name, extracted) in STRING_FIELDS.iter().zip(string_values.iter()) {
        if object.contains_key(*name) && extracted.is_none() {
            ignored_preference_fields.push((*name).to_string());
        }
    }
    const BOOL_FIELDS: &[&str] = &[
        "useMarkdownLinks",
        "alwaysUpdateLinks",
        "showUnsupportedFiles",
        "promptDelete",
    ];
    let bool_values = BOOL_FIELDS
        .iter()
        .map(|name| object.get(*name).and_then(serde_json::Value::as_bool))
        .collect::<Vec<_>>();
    for (name, extracted) in BOOL_FIELDS.iter().zip(bool_values.iter()) {
        if object.contains_key(*name) && extracted.is_none() {
            ignored_preference_fields.push((*name).to_string());
        }
    }
    let mut filters = Vec::new();
    match object.get("userIgnoreFilters") {
        Some(serde_json::Value::Array(items)) => {
            for item in items {
                if let Some(text) = item.as_str() {
                    filters.push(text.to_string());
                } else {
                    ignored_preference_fields.push("userIgnoreFilters".to_string());
                }
            }
        }
        Some(_) => ignored_preference_fields.push("userIgnoreFilters".to_string()),
        None => {}
    }
    ignored_preference_fields.sort();
    ignored_preference_fields.dedup();

    let mut preferences = ObsidianPreferences {
        new_file_location: string_values[0].clone(),
        new_file_folder_path: string_values[1].clone(),
        attachment_folder_path: string_values[2].clone(),
        new_link_format: string_values[3].clone(),
        use_markdown_links: bool_values[0],
        always_update_links: bool_values[1],
        show_unsupported_files: bool_values[2],
        prompt_delete: bool_values[3],
        trash_option: string_values[4].clone(),
        user_ignore_filters: filters,
        ignored_preference_fields,
    };

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

/// Preferencias read-only do `app.json` com abertura no-follow (TOCTOU) e
/// parse tolerante por campo.
fn read_obsidian_preferences(root: &Path) -> Option<ObsidianPreferences> {
    let canonical_root = root.canonicalize().ok()?;
    let config_path = root.join(".obsidian").join("app.json");
    let bytes =
        read_regular_file_no_follow(&config_path, &canonical_root, MAX_OBSIDIAN_APP_CONFIG_BYTES)?;
    let content = String::from_utf8(bytes).ok()?;
    parse_obsidian_preferences(&content)
}

/// Preferencias visuais read-only de `appearance.json` com parse TOLERANTE:
/// um campo conhecido com tipo invalido e ignorado (registrado em
/// `ignored_appearance_fields`) sem descartar as preferencias validas.
fn parse_obsidian_appearance(content: &str) -> Option<ObsidianAppearance> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let object = value.as_object()?;
    let mut ignored = Vec::new();

    let mut string_field = |name: &str| match object.get(name) {
        Some(serde_json::Value::String(text)) => Some(text.to_string()),
        Some(_) => {
            ignored.push(name.to_string());
            None
        }
        None => None,
    };

    let theme = string_field("theme");
    let accent_color = string_field("accentColor");
    let css_theme = string_field("cssTheme");
    let interface_font_family = string_field("interfaceFontFamily");
    let text_font_family = string_field("textFontFamily");
    let monospace_font_family = string_field("monospaceFontFamily");
    let base_font_size = match object.get("baseFontSize") {
        Some(serde_json::Value::Number(number)) => number.as_f64().filter(|size| *size > 0.0),
        Some(_) => {
            ignored.push("baseFontSize".to_string());
            None
        }
        None => None,
    };

    ignored.sort();
    ignored.dedup();
    Some(ObsidianAppearance {
        theme,
        accent_color,
        base_font_size,
        css_theme,
        interface_font_family,
        text_font_family,
        monospace_font_family,
        ignored_appearance_fields: ignored,
    })
}

/// Preferencias visuais de `appearance.json` com abertura no-follow (TOCTOU) e
/// parse tolerante por campo. Nunca escreve no `.obsidian`.
fn read_obsidian_appearance(root: &Path) -> Option<ObsidianAppearance> {
    let canonical_root = root.canonicalize().ok()?;
    let config_path = root.join(".obsidian").join("appearance.json");
    let bytes =
        read_regular_file_no_follow(&config_path, &canonical_root, MAX_OBSIDIAN_APP_CONFIG_BYTES)?;
    let content = String::from_utf8(bytes).ok()?;
    parse_obsidian_appearance(&content)
}

/// Diagnosticos das configuracoes read-only presentes em `.obsidian`: nomes das
/// configuracoes conhecidas que o app NAO aplica (apenas valida como JSON),
/// sem expor nenhum conteudo ou dado de plugin.
fn ignored_obsidian_config_files(root: &Path) -> Vec<String> {
    let canonical_root = match root.canonicalize() {
        Ok(root) => root,
        Err(_) => return Vec::new(),
    };
    let obsidian_dir = root.join(".obsidian");
    let mut ignored = Vec::new();
    for file_name in KNOWN_OBSIDIAN_CONFIG_FILES {
        if *file_name == "app.json" {
            continue;
        }
        let path = obsidian_dir.join(file_name);
        if read_regular_file_no_follow(&path, &canonical_root, MAX_OBSIDIAN_APP_CONFIG_BYTES)
            .is_some()
        {
            ignored.push((*file_name).to_string());
        }
    }
    ignored
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
    // Build E2E: o Windows resolve a pasta de configuracao pela Known Folder
    // API (nao pelo env APPDATA), entao a preferencia iria parar na APPDATA
    // real do usuario e vazar entre execucoes (ex.: o "nao perguntar" da
    // jornada de configuracoes quebrava as reaberturas seguintes). Em E2E, o
    // arquivo fica isolado no run corrente.
    #[cfg(feature = "e2e")]
    if let Ok(run_root) = std::env::var("MIRRORMIND_E2E_RUN_ROOT") {
        return Ok(Path::new(&run_root).join("appdata").join(RECENT_VAULT_FILE));
    }
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
        obsidian_appearance: read_obsidian_appearance(&canonical_root),
        obsidian_ignored_config_files: ignored_obsidian_config_files(&canonical_root),
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

    if name.ends_with('.') || name.ends_with(' ') {
        bail!("O nome do vault nao pode terminar com ponto ou espaco.");
    }

    let reserved = [
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "COM\u{00B9}",
        "COM\u{00B2}",
        "COM\u{00B3}",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
        "LPT\u{00B9}",
        "LPT\u{00B2}",
        "LPT\u{00B3}",
    ];
    let device_name = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    if reserved.contains(&device_name.as_str()) {
        bail!("Esse nome e reservado pelo sistema operacional.");
    }

    Ok(())
}

fn validate_relative_path_components(path: &Path) -> Result<()> {
    for component in path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let name = segment
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("O caminho possui caracteres invalidos."))?;
                validate_vault_name(name)?;
            }
            std::path::Component::CurDir => {}
            _ => bail!("O caminho precisa ser relativo e permanecer dentro do vault."),
        }
    }
    Ok(())
}

/// Motivo de uma falha parcial de leitura registrada na indexacao. Nunca
/// expoe o conteudo do arquivo — apenas o caminho e a classificacao.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
enum UnreadableReason {
    /// Markdown legivel, mas nao codificado como UTF-8 (impede leitura e tags).
    NotUtf8,
    /// Leitura indisponivel (permissao, bloqueio ou erro de I/O).
    Unreadable,
    /// Leitura ok, mas a extracao de tags falhou (ex.: excesso de tags).
    TagIndexFailure,
}

/// Um arquivo com falha parcial de leitura, identificado por caminho relativo
/// e motivo — sem dados sensiveis.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UnreadableFile {
    relative_path: String,
    reason: UnreadableReason,
}

/// Diagnosticos da varredura: falhas parciais de leitura que nunca devem ser
/// apresentadas silenciosamente como inventario completo. A parte valida do
/// inventario permanece disponivel; o usuario e avisado do que nao foi lido e
/// pode tentar novamente.
#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ScanDiagnostics {
    unreadable_directories: Vec<String>,
    unreadable_files: Vec<UnreadableFile>,
    /// Notas cuja renomeacao interrompida nao pode ser concluida porque
    /// receberam edicao concorrente (nada foi sobrescrito).
    rename_recovery_conflicts: Vec<String>,
    /// O inventario de anexos excedeu o limite seguro e foi truncado (nunca
    /// apresentado silenciosamente como lista completa).
    attachments_truncated: bool,
}

/// Inventario completo de UMA varredura unificada do Vault (notas, pastas,
/// anexos e arquivos especiais classificados em uma unica passagem).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInventory {
    notes: Vec<NotePreview>,
    folders: Vec<String>,
    attachments: Vec<String>,
    special_files: SpecialVaultInventory,
    diagnostics: ScanDiagnostics,
}

/// Resultado bruto (caminhos) da varredura unificada, antes de montar os
/// previews/caminhos relativos da resposta IPC.
#[derive(Clone)]
struct VaultScan {
    notes: Vec<PathBuf>,
    folders: Vec<PathBuf>,
    attachments: Vec<PathBuf>,
    special_files: Vec<SpecialVaultFile>,
    special_files_truncated: bool,
    diagnostics: ScanDiagnostics,
}

/// Varredura UNIFICADA do Vault: uma unica passagem recursiva classifica cada
/// arquivo uma unica vez (nota Markdown, anexo suportado, arquivo especial ou
/// ignorado) e coleta as pastas — em vez das quatro varreduras independentes
/// anteriores. Preserva exatamente os limites de seguranca (protecao contra
/// loops de symlink, exclusao de diretorios internos `.mirmind`/dot) e a
/// responsividade (cap de arquivos especiais durante o walk).
fn scan_vault_unified(root: &Path) -> Result<VaultScan> {
    let canonical_root = canonicalize_directory(root)?;
    let mut scan = VaultScan {
        notes: Vec::new(),
        folders: Vec::new(),
        attachments: Vec::new(),
        special_files: Vec::new(),
        special_files_truncated: false,
        diagnostics: ScanDiagnostics::default(),
    };
    let mut visited_directories = HashSet::new();
    visit_unified_vault_directory(
        &canonical_root,
        &canonical_root,
        &mut visited_directories,
        &mut scan,
    );
    scan.notes.sort();
    scan.folders.sort();
    scan.attachments.sort();
    scan.special_files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    if scan.special_files.len() > MAX_SPECIAL_VAULT_FILES {
        scan.special_files.truncate(MAX_SPECIAL_VAULT_FILES);
        scan.special_files_truncated = true;
    }
    Ok(scan)
}

/// Passo recursivo da varredura unificada. Classifica cada arquivo em uma
/// unica categoria, com a mesma precedencia das varreduras originais:
/// 1) nota `.md` (exceto `.excalidraw.md`, que e arquivo especial);
/// 2) anexo com extensao suportada (incluindo dotfiles, como antes);
/// 3) arquivo especial (nunca dotfile) — canvas/excalidraw por nome, o resto
///    como Unknown. Diretorios internos sao excluidos; symlinks sao ignorados.
fn visit_unified_vault_directory(
    directory: &Path,
    canonical_root: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    scan: &mut VaultScan,
) {
    let canonical_directory = match directory.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            log::warn!(
                "skipping unreadable directory '{}': {error}",
                directory.display()
            );
            scan.diagnostics
                .unreadable_directories
                .push(to_relative_display(canonical_root, directory));
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
            scan.diagnostics
                .unreadable_directories
                .push(to_relative_display(canonical_root, directory));
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
            scan.folders.push(path.clone());
            visit_unified_vault_directory(&path, canonical_root, visited_directories, scan);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_lowercase);
        let is_attachment = extension.as_deref().is_some_and(|extension| {
            SUPPORTED_ATTACHMENT_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        });
        if extension.as_deref() == Some("md")
            && !file_name.to_lowercase().ends_with(".excalidraw.md")
        {
            scan.notes.push(path);
        } else if is_attachment {
            scan.attachments.push(path);
        } else if let Some(kind) = special_vault_file_kind(&path) {
            // Cap durante o walk (mesmo limite de antes): pastas/notas continuam
            // sendo visitadas, mas arquivos especiais alem do limite nao entram.
            if scan.special_files.len() < MAX_SPECIAL_VAULT_FILES {
                scan.special_files.push(SpecialVaultFile {
                    name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    relative_path: to_relative_display(canonical_root, &path),
                    kind,
                });
            } else {
                scan.special_files_truncated = true;
            }
        }
    }
}

pub(crate) fn collect_markdown_files(root: &Path) -> Result<Vec<PathBuf>> {
    Ok(scan_vault_unified(root)?.notes)
}

pub(crate) fn collect_markdown_files_strict(root: &Path) -> Result<Vec<PathBuf>> {
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

pub(crate) fn collect_attachment_files(root: &Path) -> Result<Vec<PathBuf>> {
    Ok(scan_vault_unified(root)?.attachments)
}

fn collect_special_vault_files(root: &Path) -> Result<SpecialVaultInventory> {
    let scan = scan_vault_unified(root)?;
    Ok(SpecialVaultInventory {
        files: scan.special_files,
        truncated: scan.special_files_truncated,
    })
}

fn collect_folders(root: &Path) -> Result<Vec<PathBuf>> {
    Ok(scan_vault_unified(root)?.folders)
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
    if candidate.is_absolute() || candidate.has_root() {
        bail!("A nota precisa usar um caminho relativo ao vault.");
    }

    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("Nao e permitido navegar para fora do vault.");
    }
    validate_relative_path_components(candidate)?;

    if candidate.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(METADATA_DIR))
    }) {
        bail!("A pasta .mirmind e reservada para metadados do app.");
    }

    let normalized = if candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
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
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        bail!("Defina um nome para a pasta.");
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute()
        || candidate.has_root()
        || candidate
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("A pasta precisa usar um caminho relativo dentro do vault.");
    }
    validate_relative_path_components(candidate)?;
    if candidate.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(METADATA_DIR))
    }) {
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

// history_path/trash/history funcs vivem em vault_metadata.rs.
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

pub(crate) fn to_relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.display().to_string())
}

#[derive(Default)]
struct AuthorizedPaths {
    vault_roots: Mutex<HashSet<PathBuf>>,
    parent_directories: Mutex<HashSet<PathBuf>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum VaultFileSystemChangeKind {
    Create,
    Modify,
    Remove,
    Rename,
    Rescan,
}

impl VaultFileSystemChangeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Modify => "modify",
            Self::Remove => "remove",
            Self::Rename => "rename",
            Self::Rescan => "rescan",
        }
    }
}

impl PartialEq<&str> for VaultFileSystemChangeKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFileSystemChange {
    kind: VaultFileSystemChangeKind,
    paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScopedVaultFileSystemChange {
    request_id: u64,
    #[serde(flatten)]
    change: VaultFileSystemChange,
}

#[cfg(test)]
fn ipc_contract_fixture() -> serde_json::Value {
    fn vault_summary(
        name: &str,
        obsidian_preferences: Option<ObsidianPreferences>,
    ) -> VaultSummary {
        VaultSummary {
            name: name.to_string(),
            path: "C:\\Vaults\\Estudos".to_string(),
            note_count: 2,
            note_previews: vec![
                NotePreview {
                    name: "aula.md".to_string(),
                    relative_path: "notas/aula.md".to_string(),
                },
                NotePreview {
                    name: "projeto.md".to_string(),
                    relative_path: "projetos/projeto.md".to_string(),
                },
            ],
            is_obsidian_vault: true,
            obsidian_preferences,
            obsidian_appearance: None,
            obsidian_ignored_config_files: Vec::new(),
            metadata: VaultMetadata {
                is_initialized: true,
                root_path: "C:\\Vaults\\Estudos\\.mirmind".to_string(),
                missing: Vec::new(),
            },
        }
    }

    let preferences = ObsidianPreferences {
        new_file_location: Some("folder".to_string()),
        new_file_folder_path: Some("notas".to_string()),
        attachment_folder_path: Some("./media".to_string()),
        new_link_format: Some("relative".to_string()),
        use_markdown_links: Some(true),
        always_update_links: Some(false),
        show_unsupported_files: Some(true),
        prompt_delete: Some(false),
        trash_option: Some("local".to_string()),
        user_ignore_filters: vec!["Arquivo/".to_string()],
        ignored_preference_fields: Vec::new(),
    };
    let current_vault_summary = vault_summary("Estudos", Some(preferences));
    let partially_nullable_vault_summary = vault_summary(
        "Estudos com preferencias parciais",
        Some(ObsidianPreferences {
            new_file_location: None,
            new_file_folder_path: None,
            attachment_folder_path: None,
            new_link_format: None,
            use_markdown_links: None,
            always_update_links: None,
            show_unsupported_files: None,
            prompt_delete: None,
            trash_option: None,
            user_ignore_filters: Vec::new(),
            ignored_preference_fields: Vec::new(),
        }),
    );
    let nullable_vault_summary = vault_summary("Estudos sem preferencias", None);
    let mut legacy_vault_summary = serde_json::to_value(vault_summary("Vault legado", None))
        .expect("serialize legacy vault summary");
    legacy_vault_summary
        .as_object_mut()
        .expect("vault summary must serialize as an object")
        .remove("obsidianPreferences");

    json!({
        "version": 1,
        "limits": {
            "obsidianPreferenceUtf16Units": MAX_OBSIDIAN_PREFERENCE_UTF16_UNITS,
            "obsidianIgnoreFilters": MAX_OBSIDIAN_IGNORE_FILTERS,
            "specialVaultFiles": MAX_SPECIAL_VAULT_FILES,
        },
        "current": {
            "vaultSummary": current_vault_summary,
            "partiallyNullableVaultSummary": partially_nullable_vault_summary,
            "nullableVaultSummary": nullable_vault_summary,
            "noteDocument": NoteDocument {
                name: "aula.md".to_string(),
                relative_path: "notas/aula.md".to_string(),
                content: "# Aula\n\nConteudo".to_string(),
            },
            "noteList": vec![
                NotePreview {
                    name: "aula.md".to_string(),
                    relative_path: "notas/aula.md".to_string(),
                },
                NotePreview {
                    name: "projeto.md".to_string(),
                    relative_path: "projetos/projeto.md".to_string(),
                },
            ],
            "specialVaultInventory": SpecialVaultInventory {
                files: vec![SpecialVaultFile {
                    name: "Mapa.canvas".to_string(),
                    relative_path: "diagramas/Mapa.canvas".to_string(),
                    kind: SpecialVaultFileKind::Canvas,
                }],
                truncated: false,
            },
            "recentVaultPreference": RecentVaultPreference {
                last_vault_path: Some("C:\\Vaults\\Estudos".to_string()),
                ask_before_reopen: true,
            },
            "nullableRecentVaultPreference": RecentVaultPreference::default(),
            "historyStatus": HistoryStatus {
                can_undo: true,
                can_redo: false,
            },
            "watcherEvents": [
                ScopedVaultFileSystemChange {
                    request_id: 7,
                    change: VaultFileSystemChange {
                        kind: VaultFileSystemChangeKind::Create,
                        paths: vec!["notas/nova.md".to_string()],
                    },
                },
                ScopedVaultFileSystemChange {
                    request_id: 7,
                    change: VaultFileSystemChange {
                        kind: VaultFileSystemChangeKind::Modify,
                        paths: vec!["notas/aula.md".to_string()],
                    },
                },
                ScopedVaultFileSystemChange {
                    request_id: 7,
                    change: VaultFileSystemChange {
                        kind: VaultFileSystemChangeKind::Remove,
                        paths: vec!["notas/antiga.md".to_string()],
                    },
                },
                ScopedVaultFileSystemChange {
                    request_id: 7,
                    change: VaultFileSystemChange {
                        kind: VaultFileSystemChangeKind::Rename,
                        paths: vec!["notas/origem.md".to_string(), "notas/destino.md".to_string()],
                    },
                },
                ScopedVaultFileSystemChange {
                    request_id: 7,
                    change: VaultFileSystemChange {
                        kind: VaultFileSystemChangeKind::Rescan,
                        paths: Vec::new(),
                    },
                },
            ],
        },
        "legacy": {
            "vaultSummaryWithoutObsidianPreferences": legacy_vault_summary,
        },
    })
}

struct RunningVaultWatcher {
    watcher: Option<RecommendedWatcher>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Drop for RunningVaultWatcher {
    fn drop(&mut self) {
        self.watcher.take();
        if self
            .worker
            .take()
            .is_some_and(|worker| worker.join().is_err())
        {
            log::warn!("O processador do watcher terminou inesperadamente.");
        }
    }
}

struct ActiveVaultWatcher {
    id: u64,
    _watcher: RunningVaultWatcher,
}

/// Progresso da (re)construcao do indice de wikilinks (notas processadas /
/// total), emitido ao frontend durante uma renomeacao/movimentacao.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WikiLinkIndexProgress {
    processed: usize,
    total: usize,
}

/// Estado em memoria do indice de wikilinks de renomeacao, por Vault:
/// - `cache`: indice atualizado incrementalmente em salvamentos, criacoes,
///   exclusoes e renomeacoes — evita reconstruir o indice inteiro quando ha
///   edicoes entre renomeacoes (o frescor continua validado por stat no uso);
///   `Some(None)` significa indisponivel por limites e pula reconstrucoes
///   repetidas dentro da sessao.
/// - `cancel_flags`: cancelamento da (re)construcao em andamento, acionado pelo
///   usuario no frontend; o rebuild abortado faz a renomeacao cair para a
///   varredura completa (comportamento anterior).
#[derive(Default)]
pub struct WikilinkIndexState {
    cache: Mutex<HashMap<String, Option<review::wikilink_index::WikilinkIndex>>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl WikilinkIndexState {
    fn root_key(root: &Path) -> String {
        root.to_string_lossy().into_owned()
    }

    fn cancel_flag(&self, root: &Path) -> Arc<AtomicBool> {
        let key = Self::root_key(root);
        let mut flags = self
            .cancel_flags
            .lock()
            .expect("wikilink cancel flags poisoned");
        flags.entry(key).or_default().clone()
    }

    fn set_cancel(&self, root: &Path, cancelled: bool) {
        let flag = self.cancel_flag(root);
        flag.store(cancelled, Ordering::Release);
    }

    fn cached(&self, root: &Path) -> Option<Option<review::wikilink_index::WikilinkIndex>> {
        let key = Self::root_key(root);
        let cache = self.cache.lock().expect("wikilink cache poisoned");
        cache.get(&key).cloned()
    }

    fn store(&self, root: &Path, index: Option<review::wikilink_index::WikilinkIndex>) {
        let key = Self::root_key(root);
        let mut cache = self.cache.lock().expect("wikilink cache poisoned");
        cache.insert(key, index);
    }

    /// Caminhos relativos das notas sob uma pasta (para remover do cache ao
    /// excluir a pasta), lidos do proprio indice quando disponivel — sem varredura.
    fn notes_under(&self, root: &Path, folder_relative: &str) -> Vec<String> {
        let key = Self::root_key(root);
        let prefix = format!("{}/", folder_relative.trim_end_matches('/'));
        let cache = self.cache.lock().expect("wikilink cache poisoned");
        match cache.get(&key) {
            Some(Some(index)) => review::wikilink_index::note_paths(index)
                .filter(|path| path.starts_with(&prefix))
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// Ultimo inventario bruto por Vault, mantido para a aplicacao INCREMENTAL de
/// mudancas do watcher (criacao, remocao ou renomeacao de anexos/pastas sem
/// nota envolvida), evitando re-varrer o Vault inteiro a cada evento. A
/// reconciliacao periodica e manual continua fazendo a varredura completa.
#[derive(Default)]
pub struct VaultInventoryState {
    latest: Mutex<HashMap<String, VaultScan>>,
}

impl VaultInventoryState {
    fn store(&self, root: &Path, scan: VaultScan) {
        let key = root.to_string_lossy().into_owned();
        let mut latest = self.latest.lock().expect("vault inventory state poisoned");
        latest.insert(key, scan);
    }
}

#[derive(Default)]
struct VaultWatcherState {
    active: Mutex<Option<ActiveVaultWatcher>>,
    latest_request_id: AtomicU64,
}

impl VaultWatcherState {
    fn register_request(&self, request_id: u64) -> bool {
        request_id
            >= self
                .latest_request_id
                .fetch_max(request_id, Ordering::AcqRel)
    }

    fn is_current_request(&self, request_id: u64) -> bool {
        self.latest_request_id.load(Ordering::Acquire) == request_id
    }
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
        NotifyEventKind::Create(_) => VaultFileSystemChangeKind::Create,
        NotifyEventKind::Remove(_) => VaultFileSystemChangeKind::Remove,
        NotifyEventKind::Modify(ModifyKind::Name(_)) if paths.len() >= 2 => {
            VaultFileSystemChangeKind::Rename
        }
        NotifyEventKind::Modify(ModifyKind::Name(_)) if all_paths.len() >= 2 => {
            let first_is_internal = is_internal_vault_path(&all_paths[0]);
            if first_is_internal {
                VaultFileSystemChangeKind::Create
            } else {
                VaultFileSystemChangeKind::Remove
            }
        }
        NotifyEventKind::Modify(ModifyKind::Name(_)) => VaultFileSystemChangeKind::Rescan,
        NotifyEventKind::Modify(_) => VaultFileSystemChangeKind::Modify,
        _ => VaultFileSystemChangeKind::Rescan,
    };
    let paths = match kind {
        VaultFileSystemChangeKind::Rescan => Vec::new(),
        VaultFileSystemChangeKind::Rename => vec![
            paths.first().expect("rename source must exist").clone(),
            paths.last().expect("rename destination must exist").clone(),
        ],
        _ => paths,
    };

    Some(VaultFileSystemChange { kind, paths })
}

enum VaultWatcherInput {
    Event(NotifyEvent),
    Rescan(String),
}

fn emit_vault_watcher_change<F>(change: VaultFileSystemChange, on_change: &mut F)
where
    F: FnMut(VaultFileSystemChange),
{
    on_change(change);
}

fn flush_pending_watcher_modifications<F>(
    pending: &mut HashMap<
        (VaultFileSystemChangeKind, Vec<String>),
        (VaultFileSystemChange, Instant),
    >,
    force: bool,
    on_change: &mut F,
) where
    F: FnMut(VaultFileSystemChange),
{
    let now = Instant::now();
    let mut ready = pending
        .iter()
        .filter(|(_, (_, received_at))| {
            force || now.duration_since(*received_at) >= WATCHER_DUPLICATE_WINDOW
        })
        .map(|(key, (_, received_at))| (key.clone(), *received_at))
        .collect::<Vec<_>>();
    ready.sort_by_key(|(_, received_at)| *received_at);
    for (key, _) in ready {
        if let Some((change, _)) = pending.remove(&key) {
            emit_vault_watcher_change(change, on_change);
        }
    }
}

fn orphaned_rename_change(
    root: &Path,
    path: PathBuf,
    kind: NotifyEventKind,
) -> Option<VaultFileSystemChange> {
    classify_vault_file_system_change(root, &NotifyEvent::new(kind).add_path(path))
}

fn queue_pending_watcher_modification(
    pending_modifications: &mut HashMap<
        (VaultFileSystemChangeKind, Vec<String>),
        (VaultFileSystemChange, Instant),
    >,
    change: VaultFileSystemChange,
    capacity: usize,
) -> bool {
    let key = (change.kind.clone(), change.paths.clone());
    if !pending_modifications.contains_key(&key) && pending_modifications.len() >= capacity.max(1) {
        return false;
    }
    pending_modifications.insert(key, (change, Instant::now()));
    true
}

/// Buffer de renames fragmentados do watcher nativo.
///
/// No Windows, o notify entrega `RenameMode::From` e `RenameMode::To` como
/// eventos soltos e adjacentes. Este buffer segura o lado de origem por uma
/// janela curta para que o lado de destino possa emparelha-lo em um unico
/// `VaultFileSystemChangeKind::Rename` com os dois caminhos, em vez de emitir
/// `Remove` + `Create` (que o frontend nao consegue correlacionar com seguranca
/// para remapear abas, rascunhos e favoritos). A identidade nunca e adivinhada:
/// so ha emparelhamento quando existe EXATAMENTE um From pendente dentro da
/// janela; com zero ou mais de um, o To vira `Create` e os Froms expiram como
/// `Remove`, preservando o comportamento seguro anterior.
#[derive(Default)]
struct PendingRenameBuffer {
    from_paths: HashMap<String, Instant>,
}

impl PendingRenameBuffer {
    /// Registra o lado de origem de um rename potencial, deduplicando por caminho.
    fn record_from(&mut self, from: String, received_at: Instant) {
        self.from_paths.insert(from, received_at);
    }

    /// Devolve o From emparelhavel somente quando ha exatamente um pendente
    /// dentro da janela; remove-o do buffer nesse caso.
    fn take_pair(&mut self, now: Instant, window: Duration) -> Option<String> {
        let within: Vec<(String, Instant)> = self
            .from_paths
            .iter()
            .filter(|(_, received_at)| now.duration_since(**received_at) <= window)
            .map(|(from, received_at)| (from.clone(), *received_at))
            .collect();
        if within.len() != 1 {
            return None;
        }
        let (from, _) = within.into_iter().next().expect("single pending rename");
        self.from_paths.remove(&from);
        Some(from)
    }

    /// Remove e devolve os Froms cuja janela expirou (devem virar `Remove`).
    fn drain_expired(&mut self, now: Instant, window: Duration) -> Vec<String> {
        let expired: Vec<String> = self
            .from_paths
            .iter()
            .filter(|(_, received_at)| now.duration_since(**received_at) >= window)
            .map(|(from, _)| from.clone())
            .collect();
        for from in &expired {
            self.from_paths.remove(from);
        }
        expired
    }

    /// Remove e devolve todos os Froms pendentes (encerramento do watcher).
    fn drain_all(&mut self) -> Vec<String> {
        self.from_paths.drain().map(|(from, _)| from).collect()
    }

    /// Descartar todos os Froms pendentes sem emitir nada (rescan invalida os
    /// eventos incrementais; a releitura completa do vault substitui todos).
    fn clear(&mut self) {
        self.from_paths.clear();
    }

    /// Proximo instante em que um From pendente expira, para acordar o loop.
    fn earliest_deadline(&self, window: Duration) -> Option<Instant> {
        self.from_paths
            .values()
            .map(|received_at| *received_at + window)
            .min()
    }
}

fn start_vault_watcher_with_capacity<F>(
    root: &Path,
    queue_capacity: usize,
    mut on_change: F,
) -> Result<RunningVaultWatcher, String>
where
    F: FnMut(VaultFileSystemChange) + Send + 'static,
{
    let callback_root = root.to_path_buf();
    let queue_capacity = queue_capacity.max(1);
    let (event_sender, event_receiver) = mpsc::sync_channel(queue_capacity);
    let queue_overflowed = Arc::new(AtomicBool::new(false));
    let callback_overflowed = Arc::clone(&queue_overflowed);
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<NotifyEvent>| {
        let input = match result {
            Ok(event) => VaultWatcherInput::Event(event),
            Err(error) => VaultWatcherInput::Rescan(error.to_string()),
        };
        match event_sender.try_send(input) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                callback_overflowed.store(true, Ordering::Release);
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {}
        }
    })
    .map_err(|error| format!("Nao foi possivel iniciar a observacao do vault: {error}"))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("Nao foi possivel observar '{}': {error}", root.display()))?;

    let worker = thread::Builder::new()
        .name("mirrormind-vault-watcher".to_string())
        .spawn(move || {
            let mut pending_modifications: HashMap<
                (VaultFileSystemChangeKind, Vec<String>),
                (VaultFileSystemChange, Instant),
            > = HashMap::new();
            let mut pending_renames: PendingRenameBuffer = PendingRenameBuffer::default();
            let mut overflow_dirty = false;
            let mut last_overflow_rescan = None;

            loop {
                let next_deadline = pending_modifications
                    .values()
                    .map(|(_, received_at)| *received_at + WATCHER_DUPLICATE_WINDOW)
                    .chain(pending_renames.earliest_deadline(WATCHER_DUPLICATE_WINDOW))
                    .min();
                let timeout = next_deadline
                    .map(|deadline| deadline.saturating_duration_since(Instant::now()))
                    .unwrap_or(WATCHER_DUPLICATE_WINDOW);
                let received = event_receiver.recv_timeout(timeout);

                if queue_overflowed.swap(false, Ordering::AcqRel) && !overflow_dirty {
                    overflow_dirty = true;
                    pending_modifications.clear();
                    pending_renames.clear();
                    log::warn!(
                        "A fila do watcher atingiu o limite; solicitando uma nova leitura do vault."
                    );
                    emit_vault_watcher_change(
                        VaultFileSystemChange {
                            kind: VaultFileSystemChangeKind::Rescan,
                            paths: Vec::new(),
                        },
                        &mut on_change,
                    );
                    last_overflow_rescan = Some(Instant::now());
                }
                if overflow_dirty {
                    match received {
                        Ok(_) => {
                            if last_overflow_rescan.is_none_or(|last_rescan| {
                                last_rescan.elapsed() >= WATCHER_RESCAN_MAX_INTERVAL
                            }) {
                                emit_vault_watcher_change(
                                    VaultFileSystemChange {
                                        kind: VaultFileSystemChangeKind::Rescan,
                                        paths: Vec::new(),
                                    },
                                    &mut on_change,
                                );
                                last_overflow_rescan = Some(Instant::now());
                            }
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            emit_vault_watcher_change(
                                VaultFileSystemChange {
                                    kind: VaultFileSystemChangeKind::Rescan,
                                    paths: Vec::new(),
                                },
                                &mut on_change,
                            );
                            overflow_dirty = false;
                            last_overflow_rescan = None;
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            emit_vault_watcher_change(
                                VaultFileSystemChange {
                                    kind: VaultFileSystemChangeKind::Rescan,
                                    paths: Vec::new(),
                                },
                                &mut on_change,
                            );
                            break;
                        }
                    }
                }

                flush_pending_watcher_modifications(
                    &mut pending_modifications,
                    false,
                    &mut on_change,
                );
                let now = Instant::now();
                for from in pending_renames.drain_expired(now, WATCHER_DUPLICATE_WINDOW) {
                    if let Some(change) = orphaned_rename_change(
                        &callback_root,
                        from.into(),
                        NotifyEventKind::Remove(RemoveKind::Any),
                    ) {
                        emit_vault_watcher_change(change, &mut on_change);
                    }
                }
                let input = match received {
                    Ok(input) => input,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        flush_pending_watcher_modifications(
                            &mut pending_modifications,
                            true,
                            &mut on_change,
                        );
                        for from in pending_renames.drain_all() {
                            if let Some(change) = orphaned_rename_change(
                                &callback_root,
                                from.into(),
                                NotifyEventKind::Remove(RemoveKind::Any),
                            ) {
                                emit_vault_watcher_change(change, &mut on_change);
                            }
                        }
                        break;
                    }
                };
                let event = match input {
                    VaultWatcherInput::Event(event) => event,
                    VaultWatcherInput::Rescan(error) => {
                        pending_modifications.clear();
                        pending_renames.clear();
                        log::warn!("O backend do watcher solicitou rescan: {error}");
                        emit_vault_watcher_change(
                            VaultFileSystemChange {
                                kind: VaultFileSystemChangeKind::Rescan,
                                paths: Vec::new(),
                            },
                            &mut on_change,
                        );
                        continue;
                    }
                };

                match event.kind {
                    NotifyEventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                        flush_pending_watcher_modifications(
                            &mut pending_modifications,
                            true,
                            &mut on_change,
                        );
                        if let Some(from) = event.paths.first().cloned() {
                            // So registra o From se ele for um caminho publico valido
                            // (caminhos internos do .mirmind retornam None aqui).
                            if orphaned_rename_change(
                                &callback_root,
                                from.clone(),
                                NotifyEventKind::Remove(RemoveKind::Any),
                            )
                            .is_some()
                            {
                                pending_renames.record_from(
                                    from.to_string_lossy().into_owned(),
                                    Instant::now(),
                                );
                            }
                        }
                        continue;
                    }
                    NotifyEventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                        flush_pending_watcher_modifications(
                            &mut pending_modifications,
                            true,
                            &mut on_change,
                        );
                        if let Some(to) = event.paths.first().cloned() {
                            let Some(change) = orphaned_rename_change(
                                &callback_root,
                                to,
                                NotifyEventKind::Create(CreateKind::Any),
                            ) else {
                                continue;
                            };
                            let to_path = change.paths.first().cloned().unwrap_or_default();
                            if let Some(from) =
                                pending_renames.take_pair(Instant::now(), WATCHER_DUPLICATE_WINDOW)
                            {
                                let from_path = orphaned_rename_change(
                                    &callback_root,
                                    from.into(),
                                    NotifyEventKind::Remove(RemoveKind::Any),
                                )
                                .and_then(|change| change.paths.into_iter().next())
                                .unwrap_or_default();
                                if !from_path.is_empty() {
                                    emit_vault_watcher_change(
                                        VaultFileSystemChange {
                                            kind: VaultFileSystemChangeKind::Rename,
                                            paths: vec![from_path, to_path],
                                        },
                                        &mut on_change,
                                    );
                                    continue;
                                }
                            }
                            emit_vault_watcher_change(change, &mut on_change);
                        }
                        continue;
                    }
                    _ => {}
                }

                let Some(change) = classify_vault_file_system_change(&callback_root, &event) else {
                    continue;
                };
                if change.kind == VaultFileSystemChangeKind::Modify {
                    if !queue_pending_watcher_modification(
                        &mut pending_modifications,
                        change,
                        queue_capacity,
                    ) {
                        pending_modifications.clear();
                        pending_renames.clear();
                        overflow_dirty = true;
                        emit_vault_watcher_change(
                            VaultFileSystemChange {
                                kind: VaultFileSystemChangeKind::Rescan,
                                paths: Vec::new(),
                            },
                            &mut on_change,
                        );
                        last_overflow_rescan = Some(Instant::now());
                    }
                    continue;
                }
                flush_pending_watcher_modifications(
                    &mut pending_modifications,
                    true,
                    &mut on_change,
                );
                emit_vault_watcher_change(change, &mut on_change);
            }
        })
        .map_err(|error| format!("Nao foi possivel iniciar o processador do watcher: {error}"))?;

    Ok(RunningVaultWatcher {
        watcher: Some(watcher),
        worker: Some(worker),
    })
}

fn start_vault_watcher<F>(root: &Path, on_change: F) -> Result<RunningVaultWatcher, String>
where
    F: FnMut(VaultFileSystemChange) + Send + 'static,
{
    start_vault_watcher_with_capacity(root, WATCHER_EVENT_QUEUE_CAPACITY, on_change)
}
#[tauri::command]
fn watch_vault(
    path: String,
    request_id: u64,
    app: AppHandle,
    authorized_paths: State<AuthorizedPaths>,
    watcher_state: State<VaultWatcherState>,
) -> Result<u64, String> {
    if !watcher_state.register_request(request_id) {
        return Err("Solicitacao obsoleta para observar o vault.".to_string());
    }
    let root = canonicalize_directory(Path::new(&path)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;

    let watcher = start_vault_watcher(&root, move |change| {
        let scoped_change = ScopedVaultFileSystemChange { request_id, change };
        if let Err(error) = app.emit("vault-file-system-change", scoped_change) {
            log::warn!("Nao foi possivel emitir uma mudanca do vault: {error}");
        }
    })?;

    let mut active = watcher_state
        .active
        .lock()
        .map_err(|_| "Nao foi possivel atualizar o observador do vault.".to_string())?;
    if !watcher_state.is_current_request(request_id) {
        return Err("Solicitacao obsoleta para observar o vault.".to_string());
    }
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(AuthorizedPaths::default())
        .manage(VaultWatcherState::default())
        .manage(WikilinkIndexState::default())
        .manage(VaultInventoryState::default())
        .invoke_handler(tauri::generate_handler![
            select_existing_vault,
            get_recent_vault_preference,
            reopen_recent_vault,
            set_recent_vault_prompt_preference,
            select_vault_parent,
            initialize_vault_metadata,
            create_vault,
            list_notes,
            read_vault_notes,
            scan_vault_inventory,
            apply_vault_inventory_changes,
            list_templates,
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
            read_special_vault_file,
            list_special_files,
            rename_vault_item,
            move_vault_item,
            delete_vault_item,
            cancel_wikilink_index_build,
            list_trash,
            restore_trash_item,
            permanently_delete_trash_item,
            import_attachment,
            get_backlinks,
            get_broken_links,
            get_tag_index,
            tag_management::preview_tag_management_change,
            tag_management::apply_tag_management_change,
            undo_last_command,
            redo_last_command,
            get_history_status,
            watch_vault,
            unwatch_vault,
            append_knowledge_suggestion_to_note,
            review::ipc::get_review_ai_configuration,
            review::ipc::configure_gemini_api_key,
            review::ipc::set_gemini_data_consent,
            review::ipc::confirm_gemini_data_consent,
            review::ipc::remove_gemini_api_key,
            review::ipc::configure_openai_compatible_provider,
            review::ipc::remove_openai_compatible_provider,
            review::ipc::check_ollama_review_status,
            review::ipc::run_provider_comparability,
            review::ipc::assess_note_readiness,
            review::ipc::assess_note_synthesis,
            review::ipc::note_session_sources,
            review::ipc::verify_note_facts,
            review::ipc::audit_note_structure,
            review::ipc::get_note_review_state,
            review::ipc::list_due_review_queue,
            review::ipc::list_review_reports,
            review::ipc::get_retention_report,
            review::ipc::reset_note_learning,
            review::ipc::set_note_unit_classification,
            review::ipc::set_note_review_enrollment,
            review::ipc::get_vault_review_policy_config,
            review::ipc::estimate_review_workload,
            review::ipc::preview_vault_review_policy_defaults,
            review::ipc::preview_vault_review_policy_tag_rules,
            review::ipc::preview_vault_deadline_change,
            review::ipc::apply_vault_deadline_change,
            review::ipc::set_vault_review_policy_defaults,
            review::ipc::set_vault_review_policy_tag_rules,
            review::ipc::set_vault_review_policy_segmentation,
            review::ipc::get_note_review_policy,
            review::ipc::set_note_review_policy,
            review::ipc::set_note_review_priority,
            review::ipc::get_vault_review_dashboard,
            review::ipc::get_note_review_gaps,
            review::ipc::get_note_review_units,
            review::ipc::get_unrecoverable_learning_documents,
            review::ipc::export_unrecoverable_learning_document,
            review::ipc::discard_unrecoverable_learning_document,
            review::ipc::get_review_notification_settings,
            review::ipc::set_review_notification_settings,
            review::ipc::check_review_notifications,
            review::ipc::send_review_test_notification,
            review::ipc::reconcile_external_learning_paths,
            review::ipc::preview_review_session_plan,
            review::ipc::start_note_review_session,
            review::ipc::continue_note_review_conversation,
            review::ipc::complete_note_review_session,
            review::ipc::review_usage_status,
            review::ipc::seed_e2e_review_state
        ])
        .setup(|_app| {
            #[cfg(all(debug_assertions, not(feature = "e2e")))]
            {
                _app.handle().plugin(
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
        append_knowledge_suggestion_in_root, apply_history_command, apply_vault_scan_change,
        attachment_directory_for_note, classify_vault_file_system_change, collect_attachment_files,
        collect_folders, collect_markdown_files, collect_special_vault_files, copy_file_synced,
        delete_vault_item_in_root, diagnose_unreadable_notes, ensure_metadata_layout, extract_tags,
        extract_wiki_links, get_backlinks_in_root, get_broken_links_in_root, get_tag_index_in_root,
        hard_link_or_copy, import_attachment_in_root, inspect_metadata, inspect_vault_path,
        list_trash_in_root, move_vault_item_in_root, move_vault_path_without_overwrite,
        obsidian_attachment_directory, permanently_delete_trash_item_in_root,
        prepare_wiki_link_updates, read_history, read_pdf_attachment_in_root,
        read_special_vault_file_in_root, read_trash_entries, read_vault_notes_in_root,
        record_history, recover_note_in_root, rename_vault_item_in_root,
        rename_vault_item_in_root_with_state, resolve_folder_path, resolve_note_path,
        restore_trash_item_in_root, save_note_in_root, scan_vault_unified, search_notes_in_root,
        to_relative_display, truncate_attachment_inventory, update_wiki_links_for_note_path_change,
        update_wiki_links_for_note_path_change_with_hook,
        update_wiki_links_for_note_path_change_with_hooks, update_wikilink_index_after_save,
        validate_vault_name, write_file_regular_no_follow, write_new_file, write_trash_entries,
        HistoryCommand, PendingRenameBuffer, PlannedWikiLinkUpdate, RecentVaultPreference,
        SpecialVaultFileKind, UnreadableReason, VaultFileSystemChange, VaultFileSystemChangeKind,
        WikilinkIndexState, ASSESSMENTS_DIR, ATTACHMENTS_DIR, CONFIG_FILE,
        MAX_ATTACHMENT_INVENTORY_FILES, MAX_PDF_ATTACHMENT_BYTES, MAX_SPECIAL_VAULT_FILES,
        METADATA_DIR, REVIEW_PLANS_DIR, SESSIONS_DIR, TRASH_DIR,
    };
    use crate::review::{
        evaluation::{ReadinessReport, ReadinessStatus},
        policy::load_note_review_policy,
        state::{load_note_review_state, persist_readiness_assessment, set_manual_enrollment},
        storage::load_learning_document,
    };
    use notify::{
        event::{CreateKind, ModifyKind, RenameMode},
        Event as NotifyEvent, EventKind as NotifyEventKind,
    };
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[cfg(windows)]
    use super::{
        queue_pending_watcher_modification, start_vault_watcher, start_vault_watcher_with_capacity,
        VaultWatcherState,
    };
    #[cfg(windows)]
    use std::{
        collections::{HashMap, HashSet},
        sync::mpsc::{self, Receiver},
        thread,
        time::{Duration, Instant},
    };
    // O watcher em si e cross-platform (notify: inotify no Linux); os helpers
    // de teste do Windows (fila, modelo, janelas) nao existem em unix, entao
    // o teste unix usa um canal mpsc direto.
    #[cfg(unix)]
    use super::{start_vault_watcher, start_vault_watcher_with_capacity};
    #[cfg(unix)]
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };

    struct ObsidianRegressionScenario {
        name: &'static str,
        fixture_directory: &'static str,
        indexed_notes: &'static [&'static str],
        editable_note: &'static str,
    }

    #[cfg(windows)]
    fn create_windows_junction(target: &Path, junction: &Path) {
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(junction)
            .arg(target)
            .output()
            .expect("run Windows mklink junction command");
        assert!(
            output.status.success(),
            "create NTFS junction: stdout={}, stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(windows)]
    fn create_windows_file_symlink_if_available(
        target: &Path,
        link: &Path,
        scenario: &str,
    ) -> bool {
        match std::os::windows::fs::symlink_file(target, link) {
            Ok(()) => true,
            Err(error) if error.raw_os_error() == Some(1314) => {
                eprintln!(
                    "NTFS_CAPABILITY_UNAVAILABLE: {scenario} requires Developer Mode or SeCreateSymbolicLinkPrivilege: {error}"
                );
                false
            }
            Err(error) => panic!(
                "{scenario}: create file symlink {} -> {}: {error}",
                link.display(),
                target.display()
            ),
        }
    }

    #[cfg(windows)]
    fn create_windows_directory_symlink_if_available(
        target: &Path,
        link: &Path,
        scenario: &str,
    ) -> bool {
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => true,
            Err(error) if error.raw_os_error() == Some(1314) => {
                eprintln!(
                    "NTFS_CAPABILITY_UNAVAILABLE: {scenario} requires Developer Mode or SeCreateSymbolicLinkPrivilege: {error}"
                );
                false
            }
            Err(error) => panic!(
                "{scenario}: create directory symlink {} -> {}: {error}",
                link.display(),
                target.display()
            ),
        }
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

    #[cfg(windows)]
    fn observe_watcher_operation<F>(
        receiver: &Receiver<VaultFileSystemChange>,
        description: &str,
        expected: F,
    ) -> Vec<VaultFileSystemChange>
    where
        F: Fn(&VaultFileSystemChange) -> bool,
    {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut changes = Vec::new();
        let mut matched = false;

        while Instant::now() < deadline {
            let timeout = if matched {
                Duration::from_millis(350)
            } else {
                deadline.saturating_duration_since(Instant::now())
            };
            match receiver.recv_timeout(timeout) {
                Ok(change) => {
                    matched |= expected(&change);
                    changes.push(change);
                }
                Err(mpsc::RecvTimeoutError::Timeout) if matched => break,
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(error) => panic!("{description}: watcher channel disconnected: {error}"),
            }
        }

        assert!(
            matched,
            "{description}: expected change not observed; received {changes:?}"
        );
        let matching_count = changes.iter().filter(|change| expected(change)).count();
        assert_eq!(
            matching_count, 1,
            "{description}: logical change was emitted more than once; received {changes:?}"
        );
        changes
    }

    #[cfg(windows)]
    fn apply_watcher_changes_to_model(
        model: &mut HashSet<String>,
        changes: &[VaultFileSystemChange],
    ) {
        for change in changes {
            match change.kind {
                VaultFileSystemChangeKind::Create => model.extend(change.paths.iter().cloned()),
                VaultFileSystemChangeKind::Remove => {
                    for path in &change.paths {
                        model.remove(path);
                    }
                }
                VaultFileSystemChangeKind::Rename if change.paths.len() >= 2 => {
                    model.remove(&change.paths[0]);
                    if let Some(destination) = change.paths.last() {
                        model.insert(destination.clone());
                    }
                }
                _ => {}
            }
        }
    }

    #[cfg(windows)]
    fn wait_for_watcher_channel_to_close(
        receiver: &Receiver<VaultFileSystemChange>,
        description: &str,
    ) -> Vec<VaultFileSystemChange> {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut remaining = Vec::new();
        loop {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(change) => remaining.push(change),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {}
                Err(error) => panic!("{description}: watcher did not stop cleanly: {error}"),
            }
        }
        remaining
    }

    #[cfg(windows)]
    #[test]
    fn windows_watcher_reports_external_lifecycle_once_and_preserves_final_state() {
        let temporary_directory = tempdir().expect("watcher temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical watcher root");
        let (sender, receiver) = mpsc::channel();
        let watcher = start_vault_watcher(&root, move |change| {
            let _ = sender.send(change);
        })
        .expect("start real Windows watcher");
        let mut observed = Vec::new();
        let mut event_model = HashSet::new();

        let original = root.join("entrada.md");
        fs::write(&original, "primeira versao").expect("create note outside app");
        observed.extend(observe_watcher_operation(
            &receiver,
            "external create",
            |change| change.kind == "create" && change.paths == ["entrada.md"],
        ));

        fs::write(&original, "segunda versao").expect("first rapid external edit");
        fs::write(&original, "terceira versao").expect("second rapid external edit");
        observed.extend(observe_watcher_operation(
            &receiver,
            "rapid external edits",
            |change| change.kind == "modify" && change.paths == ["entrada.md"],
        ));
        assert_eq!(
            fs::read_to_string(&original).expect("read latest external edit"),
            "terceira versao"
        );

        let renamed = root.join("renomeada.md");
        fs::rename(&original, &renamed).expect("rename note outside app");
        let rename_changes =
            observe_watcher_operation(&receiver, "external rename pairing", |change| {
                change.kind == "rename" && change.paths == ["entrada.md", "renomeada.md"]
            });
        assert_eq!(
            rename_changes
                .iter()
                .filter(|change| change.kind == "rename")
                .count(),
            1,
            "a single unambiguous From/To pair must produce exactly one rename: {rename_changes:?}"
        );
        observed.extend(rename_changes);

        let destination_directory = root.join("arquivo");
        fs::create_dir(&destination_directory).expect("create destination outside app");
        observed.extend(observe_watcher_operation(
            &receiver,
            "external folder create",
            |change| change.kind == "create" && change.paths == ["arquivo"],
        ));

        let moved = destination_directory.join("renomeada.md");
        fs::rename(&renamed, &moved).expect("move note outside app");
        // Movimentos entre pastas sao reportados nativamente como Remove + Create
        // (nao ha From/To para emparelhar): permanecem conservadores.
        let movement_changes =
            observe_watcher_operation(&receiver, "external move removal", |change| {
                change.kind == "remove" && change.paths == ["renomeada.md"]
            });
        assert_eq!(
            movement_changes
                .iter()
                .filter(|change| {
                    change.kind == "create" && change.paths == ["arquivo/renomeada.md"]
                })
                .count(),
            1,
            "external move must produce exactly one destination creation: {movement_changes:?}"
        );
        assert!(
            movement_changes.iter().all(|change| change.kind != "rename"),
            "cross-directory remove/create without native identity must not be promoted to rename: {movement_changes:?}"
        );
        observed.extend(movement_changes);

        fs::remove_file(&moved).expect("delete note outside app");
        observed.extend(observe_watcher_operation(
            &receiver,
            "external delete",
            |change| change.kind == "remove" && change.paths == ["arquivo/renomeada.md"],
        ));

        drop(watcher);
        observed.extend(wait_for_watcher_channel_to_close(
            &receiver,
            "external lifecycle shutdown",
        ));

        for (expected_count, kind, paths) in [
            (1, "create", vec!["entrada.md"]),
            (2, "modify", vec!["entrada.md"]),
            (1, "rename", vec!["entrada.md", "renomeada.md"]),
            (1, "create", vec!["arquivo"]),
            (1, "remove", vec!["renomeada.md"]),
            (1, "create", vec!["arquivo/renomeada.md"]),
            (1, "remove", vec!["arquivo/renomeada.md"]),
        ] {
            assert_eq!(
                observed
                    .iter()
                    .filter(|change| change.kind == kind && change.paths == paths)
                    .count(),
                expected_count,
                "logical change {kind} {paths:?} must occur {expected_count} time(s): {observed:?}"
            );
        }
        assert_eq!(
            observed
                .iter()
                .filter(|change| change.kind == "rename")
                .count(),
            1,
            "only the unambiguous same-directory From/To pair may become a rename: {observed:?}"
        );

        apply_watcher_changes_to_model(&mut event_model, &observed);
        assert_eq!(event_model, HashSet::from(["arquivo".to_string()]));
        assert!(!original.exists(), "original path must remain absent");
        assert!(
            !renamed.exists(),
            "renamed path must remain absent after move"
        );
        assert!(!moved.exists(), "deleted note must remain absent");
        assert!(
            destination_directory.is_dir(),
            "unrelated folder state was lost"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_watcher_replacement_and_close_finish_each_worker() {
        let first_directory = tempdir().expect("first watcher temp dir");
        let second_directory = tempdir().expect("second watcher temp dir");
        let first_root = first_directory
            .path()
            .canonicalize()
            .expect("first canonical root");
        let second_root = second_directory
            .path()
            .canonicalize()
            .expect("second canonical root");
        let (first_sender, first_receiver) = mpsc::channel();
        let (second_sender, second_receiver) = mpsc::channel();
        let mut active = Some(
            start_vault_watcher(&first_root, move |change| {
                let _ = first_sender.send(change);
            })
            .expect("start first watcher"),
        );

        let replacement = start_vault_watcher(&second_root, move |change| {
            let _ = second_sender.send(change);
        })
        .expect("start replacement watcher");
        drop(active.replace(replacement));
        wait_for_watcher_channel_to_close(&first_receiver, "replaced watcher");

        drop(active.take());
        wait_for_watcher_channel_to_close(&second_receiver, "closed watcher");
    }

    #[cfg(windows)]
    #[test]
    fn windows_watcher_uses_rescan_instead_of_an_unbounded_overflow_queue() {
        let temporary_directory = tempdir().expect("overflow watcher temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("overflow canonical root");
        let (sender, receiver) = mpsc::channel();
        let watcher = start_vault_watcher_with_capacity(&root, 1, move |change| {
            thread::sleep(Duration::from_millis(15));
            let _ = sender.send(change);
        })
        .expect("start capacity-limited watcher");

        let (stop_sender, stop_receiver) = mpsc::channel();
        let producer_root = root.clone();
        let producer = thread::spawn(move || {
            let mut index = 0_u64;
            while stop_receiver.try_recv().is_err() {
                fs::write(
                    producer_root.join(format!("storm-{}.md", index % 16)),
                    index.to_string(),
                )
                .expect("write continuous event storm file");
                index += 1;
            }
        });
        let changes = observe_watcher_operation(&receiver, "overflow rescan", |change| {
            change.kind == "rescan" && change.paths.is_empty()
        });
        stop_sender.send(()).expect("stop event storm producer");
        producer.join().expect("join event storm producer");
        assert!(
            changes.len() < 64,
            "overflow must collapse the event storm instead of forwarding an unbounded queue: {} events",
            changes.len()
        );

        drop(watcher);
        wait_for_watcher_channel_to_close(&receiver, "overflow watcher shutdown");
    }
    #[cfg(windows)]
    #[test]
    fn windows_watcher_bounds_distinct_pending_modifications() {
        let mut pending = HashMap::new();
        for index in 0..2 {
            assert!(queue_pending_watcher_modification(
                &mut pending,
                VaultFileSystemChange {
                    kind: VaultFileSystemChangeKind::Modify,
                    paths: vec![format!("note-{index}.md")],
                },
                2,
            ));
        }
        assert!(!queue_pending_watcher_modification(
            &mut pending,
            VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Modify,
                paths: vec!["note-2.md".to_string()],
            },
            2,
        ));
        assert_eq!(pending.len(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn windows_watcher_rejects_an_out_of_order_activation_request() {
        let state = VaultWatcherState::default();

        assert!(state.register_request(1));
        assert!(state.register_request(3));
        assert!(!state.register_request(2));
        assert!(state.is_current_request(3));
        assert!(!state.is_current_request(1));
    }

    #[test]
    fn vault_watcher_event_serializes_its_activation_scope() {
        let payload = super::ScopedVaultFileSystemChange {
            request_id: 42,
            change: super::VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Modify,
                paths: vec!["nota.md".to_string()],
            },
        };

        assert_eq!(
            serde_json::to_value(payload).expect("serialize scoped watcher payload"),
            serde_json::json!({
                "requestId": 42,
                "kind": "modify",
                "paths": ["nota.md"],
            })
        );
    }

    #[test]
    fn ipc_contract_fixture_matches_backend_serialization() {
        let fixture_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ipc-contract-v1.json");
        let fixture_source = fs::read_to_string(&fixture_path)
            .unwrap_or_else(|error| panic!("read IPC contract fixture {fixture_path:?}: {error}"));
        let committed_fixture: serde_json::Value = serde_json::from_str(&fixture_source)
            .unwrap_or_else(|error| panic!("parse IPC contract fixture {fixture_path:?}: {error}"));

        assert_eq!(committed_fixture, super::ipc_contract_fixture());
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
    fn pending_rename_buffer_pairs_a_single_from_and_to() {
        let window = std::time::Duration::from_millis(250);
        let t0 = std::time::Instant::now();
        let mut buffer = PendingRenameBuffer::default();
        buffer.record_from("pasta/nota.md".to_string(), t0);

        let from = buffer.take_pair(t0 + std::time::Duration::from_millis(100), window);

        assert_eq!(from.as_deref(), Some("pasta/nota.md"));
        assert!(buffer.drain_all().is_empty());
    }

    #[test]
    fn pending_rename_buffer_expires_an_orphaned_from_as_removal() {
        let window = std::time::Duration::from_millis(250);
        let t0 = std::time::Instant::now();
        let mut buffer = PendingRenameBuffer::default();
        buffer.record_from("nota.md".to_string(), t0);

        let expired =
            buffer.drain_expired(t0 + window + std::time::Duration::from_millis(10), window);

        assert_eq!(expired, vec!["nota.md".to_string()]);
        // O From expirado nao pode mais ser emparelhado por um To tardio.
        assert_eq!(
            buffer.take_pair(t0 + window + std::time::Duration::from_millis(10), window),
            None
        );
    }

    #[test]
    fn pending_rename_buffer_refuses_to_pair_when_multiple_renames_are_in_flight() {
        let window = std::time::Duration::from_millis(250);
        let t0 = std::time::Instant::now();
        let mut buffer = PendingRenameBuffer::default();
        buffer.record_from("a.md".to_string(), t0);
        buffer.record_from(
            "b.md".to_string(),
            t0 + std::time::Duration::from_millis(10),
        );

        // Com dois Froms em voo, nao ha como saber qual To pertence a qual:
        // nunca adivinhar identidade.
        assert_eq!(
            buffer.take_pair(t0 + std::time::Duration::from_millis(50), window),
            None
        );
        let mut drained = buffer.drain_all();
        drained.sort();
        assert_eq!(drained, vec!["a.md".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn pending_rename_buffer_dedups_same_source_and_drains_all() {
        let window = std::time::Duration::from_millis(250);
        let t0 = std::time::Instant::now();
        let mut buffer = PendingRenameBuffer::default();
        buffer.record_from("nota.md".to_string(), t0);
        buffer.record_from(
            "nota.md".to_string(),
            t0 + std::time::Duration::from_millis(5),
        );
        buffer.record_from("outra.md".to_string(), t0);

        assert_eq!(buffer.drain_all().len(), 2);
        assert!(buffer.drain_all().is_empty());
        let _ = window;
    }

    #[test]
    fn pending_rename_buffer_ignores_entries_outside_the_window_for_pairing() {
        let window = std::time::Duration::from_millis(250);
        let t0 = std::time::Instant::now();
        let mut buffer = PendingRenameBuffer::default();
        buffer.record_from("velha.md".to_string(), t0);

        assert_eq!(
            buffer.take_pair(t0 + window + std::time::Duration::from_millis(1), window),
            None
        );
        assert_eq!(buffer.drain_all(), vec!["velha.md".to_string()]);
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
    fn read_vault_notes_returns_all_note_contents_in_one_pass() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("Notas")).expect("create notas folder");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian folder");
        fs::create_dir_all(root.join(".mirmind")).expect("create mirmind folder");
        fs::write(root.join("Notas").join("a.md"), "# A\n\nConteudo A").expect("write a");
        fs::write(root.join("b.md"), "# B").expect("write b");
        fs::write(
            root.join(".obsidian").join("interna.md"),
            "# Obsidian interna",
        )
        .expect("write obsidian note");
        fs::write(root.join(".mirmind").join("meta.md"), "# Meta").expect("write meta note");
        fs::write(root.join("anexo.txt"), "nao e nota").expect("write txt");

        let note_paths = collect_markdown_files(&root).expect("collect");
        let mut progress_calls = Vec::new();
        let documents = read_vault_notes_in_root(&root, &note_paths, |processed, total| {
            progress_calls.push((processed, total));
        })
        .expect("read all notes");

        let mut by_path = documents
            .iter()
            .map(|document| (document.relative_path.clone(), document.content.clone()))
            .collect::<Vec<_>>();
        by_path.sort();
        assert_eq!(
            by_path,
            vec![
                ("Notas/a.md".to_string(), "# A\n\nConteudo A".to_string()),
                ("b.md".to_string(), "# B".to_string()),
            ]
        );
        // Progresso final emitido (total == quantidade de notas; as pastas
        // internas (.obsidian/.mirmind) ficam de fora da leitura unificada).
        assert_eq!(progress_calls, vec![(2, 2)]);
    }

    #[test]
    fn read_vault_notes_handles_empty_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let note_paths = collect_markdown_files(root).expect("collect");
        let documents = read_vault_notes_in_root(root, &note_paths, |_, _| {}).expect("read all");
        assert!(documents.is_empty());
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

    /// Matriz de regressao Obsidian: CRLF e BOM preservados byte a byte.
    /// A leitura nunca converte quebras de linha nem remove o marcador BOM, e o
    /// salvamento grava EXATAMENTE os bytes do conteudo (sem normalizar, sem
    /// injetar quebra final, sem adicionar BOM). Tags e frontmatter sao
    /// detectados com CRLF e com BOM na mesma nota.
    #[test]
    fn obsidian_matrix_crlf_and_bom_are_byte_faithful() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");

        // BOM UTF-8 (EF BB BF) + frontmatter com CRLF + corpo com CRLF.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\xef\xbb\xbf---\r\n");
        bytes.extend_from_slice(b"tags:\r\n  - estudo/quimica\r\n  - provas\r\n---\r\n\r\n");
        bytes.extend_from_slice(
            b"# Liga\xc3\xa7\xc3\xb5es Qu\xc3\xadmicas\r\n\r\nTexto com \r\nquebras CRLF.\r\n",
        );
        let note = root.join("quimica.md");
        fs::write(&note, &bytes).expect("write CRLF+BOM note");

        // Leitura bruta: bytes intactos (BOM, CRLF, acentos NFC).
        assert_eq!(fs::read(&note).expect("read raw"), bytes);
        // Leitura como nota: o conteudo carrega com BOM e CRLF preservados.
        let content = fs::read_to_string(&note).expect("read as note");
        assert!(content.starts_with('\u{feff}'));
        assert!(content.contains("\r\nquebras CRLF."));
        // Tags com CRLF + BOM no mesmo arquivo.
        assert_eq!(
            extract_tags(&content).expect("extract tags"),
            vec!["estudo/quimica", "provas"]
        );

        // Salvamento: exatamente os bytes dados, sem normalizacao.
        let appended = format!("{content}\r\nObservacao final.\r\n");
        save_note_in_root(&root, "quimica.md", &appended).expect("save CRLF note");
        let mut expected = bytes.clone();
        expected.extend_from_slice(b"\r\nObservacao final.\r\n");
        assert_eq!(
            fs::read(&note).expect("read saved bytes"),
            expected,
            "save must write exactly the given bytes (CRLF preserved, no BOM change)"
        );
        // Reabertura como nota devolve o conteudo exato.
        assert_eq!(
            fs::read_to_string(&note).expect("reopen note"),
            appended,
            "reopening must return the exact edited Markdown"
        );

        // Controle: nota com quebras LF continua LF apos salvar (nada vira CRLF).
        let lf_only = root.join("lf.md");
        let lf_bytes = b"# Titulo\n\nCorpo com LF.\n".to_vec();
        fs::write(&lf_only, &lf_bytes).expect("write LF note");
        let lf_content = fs::read_to_string(&lf_only).expect("read LF note");
        save_note_in_root(&root, "lf.md", &lf_content).expect("save LF note");
        assert_eq!(
            fs::read(&lf_only).expect("read LF bytes"),
            lf_bytes,
            "save must not convert LF to CRLF"
        );
    }

    #[test]
    fn append_knowledge_suggestion_adds_a_confirmed_quote_at_the_end() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let note = root.join("quimica.md");
        fs::write(&note, "# Quimica\n\nA agua e H2O.\n").expect("write note");

        let document = append_knowledge_suggestion_in_root(
            &root,
            "quimica.md",
            "O usuario relacionou a agua com a tensao superficial.",
        )
        .expect("append suggestion");
        let content = fs::read_to_string(&note).expect("reopen note");
        assert!(content.contains("> O usuario relacionou a agua com a tensao superficial."));
        // O texto vai ao final, como citacao, sem tocar no corpo existente.
        assert!(content.starts_with("# Quimica\n\nA agua e H2O."));
        assert!(document.content.ends_with("tensao superficial.\n"));
        // O documento devolvido reflete o conteudo gravado.
        assert_eq!(document.content, content);
        // O historico registra o append como um save.
        let history = read_history(&root).expect("read history");
        let has_save =
            |commands: &[HistoryCommand]| {
                commands.iter().any(|command| matches!(
                command,
                HistoryCommand::SaveNote { relative_path, .. } if relative_path == "quimica.md"
            ))
            };
        assert!(has_save(&history.undo) || has_save(&history.redo));

        // Texto vazio ou acima do limite e rejeitado sem tocar o arquivo.
        let before = fs::read_to_string(&note).expect("read before");
        assert!(append_knowledge_suggestion_in_root(&root, "quimica.md", "   ").is_err());
        assert!(
            append_knowledge_suggestion_in_root(&root, "quimica.md", &"x".repeat(9_000)).is_err()
        );
        assert_eq!(fs::read_to_string(&note).expect("read after"), before);
    }

    /// Unicode NFC/NFD no conteudo e nos nomes: acentos compostos e decompostos
    /// sao bytes distintos e permanecem exatos apos salvar; uma nota NFD
    /// resolve, salva e relê pelo proprio caminho NFD; um wikilink NFC resolve
    /// para a nota NFC (comparacao e por forma normalizada a minusculas).
    #[test]
    fn obsidian_matrix_unicode_nfc_nfd_round_trips() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");

        // Conteudo NFD: 'a' + U+0301 (acento agudo combinante) no lugar de 'a'.
        let nfd_content = "# Aula de Qu\u{69}\u{301}mica\n\nF\u{6f}\u{301}rmula de prova\n";
        let nfd_note = root.join("aula-\u{69}\u{301}mica.md");
        fs::write(&nfd_note, nfd_content).expect("write NFD note");
        save_note_in_root(&root, "aula-\u{69}\u{301}mica.md", nfd_content)
            .expect("save NFD note by its own name");
        assert_eq!(
            fs::read(&nfd_note).expect("read NFD bytes"),
            nfd_content.as_bytes(),
            "NFD content must round-trip byte for byte"
        );

        // Conteudo NFC (acento precomposto) e um byte diferente do NFD.
        let nfc_content = "# Aula de Qu\u{ed}mica\n";
        assert_ne!(nfd_content.as_bytes(), nfc_content.as_bytes());
        let nfc_note = root.join("quimica-nfc.md");
        fs::write(&nfc_note, nfc_content).expect("write NFC note");
        save_note_in_root(&root, "quimica-nfc.md", nfc_content).expect("save NFC note");
        assert_eq!(
            fs::read(&nfc_note).expect("read NFC bytes"),
            nfc_content.as_bytes(),
            "NFC content must round-trip byte for byte"
        );

        // Wikilink NFC resolvendo para a nota NFC de nome NFC.
        let linked = root.join("indice.md");
        fs::write(&linked, "[[quimica-nfc]]\n").expect("write index note");
        let backlinks = get_backlinks_in_root(&root, "quimica-nfc.md").expect("backlinks");
        assert_eq!(
            backlinks
                .iter()
                .map(|link| link.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["indice.md"]
        );
    }

    /// Volumes Unix (ext4/btrfs) sao CASE-SENSITIVE por padrao: `Nota.md` e
    /// `nota.md` sao dois arquivos distintos. O espelho do Windows (NTFS,
    /// case-insensitive) vive em `windows_path_suite_preserves_unicode_and_ntfs_case_insensitivity`.
    #[cfg(unix)]
    #[test]
    fn unix_path_suite_is_case_sensitive_and_keeps_distinct_files() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");

        // Dois arquivos cuja unica diferenca e a caixa do nome: coexistem e
        // sao indexados separadamente no inventario.
        let upper = root.join("Estudos.md");
        let lower = root.join("estudos.md");
        fs::write(&upper, "caixa alta").expect("write uppercase note");
        fs::write(&lower, "caixa baixa").expect("write lowercase note");

        let indexed = collect_markdown_files(&root)
            .expect("collect")
            .into_iter()
            .map(|path| to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        assert!(
            indexed.contains(&"Estudos.md".to_string())
                && indexed.contains(&"estudos.md".to_string()),
            "case-sensitive volume must index both files separately: {indexed:?}"
        );

        // A resolucao por caminho tambem e case-sensitive: cada nome resolve
        // para o SEU proprio arquivo e le o conteudo certo — nunca o do outro.
        assert_eq!(
            fs::read_to_string(resolve_note_path(&root, "Estudos.md").expect("exact case"))
                .expect("read uppercase"),
            "caixa alta"
        );
        assert_eq!(
            fs::read_to_string(resolve_note_path(&root, "estudos.md").expect("lowercase"))
                .expect("read lowercase"),
            "caixa baixa"
        );
    }

    /// Permissoes Unix: um arquivo sem permissao de leitura deve falhar com
    /// erro claro (nunca devolver conteudo vazio como se fosse valido) e a
    /// falha nao corrompe nem sobrescreve bytes.
    #[cfg(unix)]
    #[test]
    fn unix_readonly_note_fails_with_a_clear_error_and_keeps_bytes() {
        use std::os::unix::fs::PermissionsExt as _;

        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let note_path = root.join("restrita.md");
        fs::write(&note_path, "conteudo protegido").expect("write note");
        fs::set_permissions(&note_path, fs::Permissions::from_mode(0o000))
            .expect("make note unreadable");

        // A leitura pelo app falha com erro (nunca devolve conteudo vazio
        // como se fosse valido) — mesmo com o arquivo existindo no disco.
        let read_result = fs::read(&note_path);
        assert!(
            read_result.is_err(),
            "unreadable file must fail loudly instead of returning empty content"
        );

        // A escrita via save tambem reporta erro e nao corrompe bytes.
        assert!(
            save_note_in_root(&root, "restrita.md", "tentativa").is_err(),
            "saving over an unwritable note must fail"
        );
    }

    /// Watcher Linux (inotify via `notify`): uma criacao externa dentro do
    /// Vault e observada como `create`; uma edicao rapida e coalescida como
    /// `modify`. O espelho Windows vive em `windows_watcher_reports_external_lifecycle_once_and_preserves_final_state`.
    #[cfg(unix)]
    #[test]
    fn unix_watcher_reports_external_create_and_modify() {
        let temporary_directory = tempdir().expect("watcher temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical watcher root");
        let (sender, receiver) = mpsc::channel();
        let watcher = start_vault_watcher(&root, move |change| {
            let _ = sender.send(change);
        })
        .expect("start real Unix watcher");

        let original = root.join("entrada.md");
        fs::write(&original, "primeira versao").expect("create note outside app");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut saw_create = false;
        while Instant::now() < deadline && !saw_create {
            if let Ok(change) = receiver.recv_timeout(Duration::from_millis(200)) {
                saw_create = change.kind == "create" && change.paths == ["entrada.md"];
            }
        }
        assert!(saw_create, "external create must be observed on Unix");

        fs::write(&original, "segunda versao").expect("external edit");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut saw_modify = false;
        while Instant::now() < deadline && !saw_modify {
            if let Ok(change) = receiver.recv_timeout(Duration::from_millis(200)) {
                saw_modify = change.kind == "modify" && change.paths == ["entrada.md"];
            }
        }
        assert!(saw_modify, "external modify must be observed on Unix");
        assert_eq!(
            fs::read_to_string(&original).expect("read latest external edit"),
            "segunda versao"
        );
        drop(watcher);
    }

    /// Nomes com espacos: resolvem, salvam, indexam e aparecem em backlinks
    /// (o wikilink usa o caminho com espacos, sem normalizacao de espacos).
    #[test]
    fn obsidian_matrix_names_with_spaces_resolve_save_and_backlink() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");

        let folder = "Minhas Notas 2026";
        let note_relative = "Minhas Notas 2026/nota importante (final).md";
        let note_path = root.join(note_relative);
        fs::create_dir_all(note_path.parent().expect("parent")).expect("create folder");
        fs::write(&note_path, "# Nota Importante\n\nConteudo da nota.\n")
            .expect("write note with spaces");

        assert!(resolve_note_path(&root, note_relative).is_ok());
        save_note_in_root(&root, note_relative, "# Nota Importante\n\nEditada.\n")
            .expect("save note with spaces");
        assert_eq!(
            fs::read_to_string(&note_path).expect("reopen note"),
            "# Nota Importante\n\nEditada.\n"
        );

        let indexed = collect_markdown_files(&root)
            .expect("collect")
            .into_iter()
            .map(|path| to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        assert!(indexed.iter().any(|path| path == note_relative));
        assert!(collect_folders(&root)
            .expect("folders")
            .iter()
            .any(|path| { to_relative_display(&root, path) == folder }));

        let source = root.join("indice.md");
        fs::write(&source, "[[Minhas Notas 2026/nota importante (final)]]\n")
            .expect("write index note");
        let backlinks = get_backlinks_in_root(&root, note_relative).expect("backlinks");
        assert_eq!(
            backlinks
                .iter()
                .map(|link| link.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["indice.md"]
        );
    }

    /// Symlink de diretorio dentro do Vault apontando para fora: a varredura
    /// ignora o diretorio inteiro (o conteudo externo nunca entra no inventario
    /// nem em loops), e o salvamento atraves do diretorio simbolico e rejeitado
    /// pelo confinamento — nada e escrito fora do Vault.
    #[cfg(any(unix, windows))]
    #[test]
    fn obsidian_matrix_symlinked_directory_never_escapes_the_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");
        let outside = tempdir().expect("outside temp dir");
        fs::write(outside.path().join("segredo.md"), "# Segredo\n").expect("write outside note");

        let link = root.join("link-externo");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).expect("create directory symlink");
        #[cfg(windows)]
        if !create_windows_directory_symlink_if_available(
            outside.path(),
            &link,
            "matrix symlinked directory",
        ) {
            return;
        }

        // A varredura nao enxerga nada fora do Vault.
        let indexed = collect_markdown_files(&root)
            .expect("collect")
            .into_iter()
            .map(|path| to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        assert_eq!(indexed, Vec::<String>::new());

        // Resolver e salvar atraves do symlink e rejeitado pelo confinamento.
        assert!(resolve_note_path(&root, "link-externo/segredo.md").is_err());
        assert!(save_note_in_root(&root, "link-externo/novo.md", "# Novo\n").is_err());
        assert!(!outside.path().join("novo.md").exists());
        assert_eq!(
            fs::read_to_string(outside.path().join("segredo.md")).expect("outside intact"),
            "# Segredo\n",
            "the external file must never be touched"
        );
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
        fs::write(root.join("Notas").join("rascunho.xyz"), "unsupported")
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
    fn scan_vault_unified_classifies_everything_in_one_pass() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");
        fs::create_dir_all(root.join("projetos").join("vazios")).expect("create folders");
        fs::create_dir_all(root.join(METADATA_DIR)).expect("create metadata dir");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian dir");
        fs::write(root.join("nota.md"), "# Nota").expect("write note");
        fs::write(root.join("projetos").join("nested.md"), "# Nested").expect("write nested");
        fs::write(root.join("imagem.png"), "png").expect("write attachment");
        fs::write(root.join("projetos").join("diagrama.canvas"), "{}").expect("write canvas");
        fs::write(root.join("quadro.excalidraw.md"), "{}").expect("write excalidraw");
        fs::write(root.join("arquivo.xyz"), "{}").expect("write unknown special");
        fs::write(root.join(".escondida.md"), "# Hidden").expect("write hidden note");
        fs::write(root.join(".segredo.png"), "png").expect("write hidden attachment");
        fs::write(root.join(".privado.canvas"), "{}").expect("write hidden canvas");
        fs::write(root.join(METADATA_DIR).join("interno.md"), "# Interno")
            .expect("write internal note");
        fs::write(root.join(METADATA_DIR).join("interno.png"), "png")
            .expect("write internal attachment");

        let scan = scan_vault_unified(root).expect("scan vault");
        let relative = |path: &std::path::Path| {
            path.strip_prefix(&canonical_root)
                .expect("relative path")
                .to_string_lossy()
                .replace('\\', "/")
        };
        assert_eq!(
            scan.notes
                .iter()
                .map(|path| relative(path))
                .collect::<Vec<_>>(),
            vec![".escondida.md", "nota.md", "projetos/nested.md"]
        );
        assert_eq!(
            scan.attachments
                .iter()
                .map(|path| relative(path))
                .collect::<Vec<_>>(),
            vec![".segredo.png", "imagem.png"]
        );
        assert_eq!(
            scan.folders
                .iter()
                .map(|path| relative(path))
                .collect::<Vec<_>>(),
            vec!["projetos", "projetos/vazios"]
        );
        let specials = scan
            .special_files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            specials,
            vec![
                "arquivo.xyz",
                "projetos/diagrama.canvas",
                "quadro.excalidraw.md"
            ]
        );
        assert!(!scan.special_files_truncated);
        // As colecoes pontuais delegam para a MESMA varredura unificada.
        assert_eq!(collect_markdown_files(root).expect("notes"), scan.notes);
        assert_eq!(
            collect_attachment_files(root).expect("attachments"),
            scan.attachments
        );
        assert_eq!(collect_folders(root).expect("folders"), scan.folders);
        // Vault saudavel: nenhum diagnostico de falha parcial.
        assert!(scan.diagnostics.unreadable_directories.is_empty());
        assert!(scan.diagnostics.unreadable_files.is_empty());
    }

    #[test]
    fn diagnose_unreadable_notes_flags_non_utf8_and_tag_failures() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");
        fs::write(root.join("ok.md"), "# Ok\n").expect("write ok note");
        // Markdown com bytes invalidos para UTF-8 (ex.: legado em outra
        // codificacao) — legivel como arquivo, inacessivel como conteudo.
        fs::write(root.join("legado.md"), [0xC3, 0x28, 0x41, 0x42]).expect("write legacy note");

        let mut diagnostics = scan_vault_unified(&canonical_root)
            .expect("scan vault")
            .diagnostics;
        let notes = scan_vault_unified(&canonical_root)
            .expect("scan notes")
            .notes;
        diagnose_unreadable_notes(&canonical_root, &notes, &mut diagnostics);

        assert!(diagnostics.unreadable_directories.is_empty());
        assert_eq!(
            diagnostics.unreadable_files,
            vec![super::UnreadableFile {
                relative_path: "legado.md".to_string(),
                reason: UnreadableReason::NotUtf8,
            }]
        );
    }

    #[test]
    fn write_file_regular_no_follow_rejects_symlink_as_final_component() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let target = tempdir().expect("outside temp dir");
        let outside_file = target.path().join("fora.md");
        fs::write(&outside_file, "conteudo externo").expect("write outside");
        let link = root.join("nota-link.md");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_file, &link).expect("create file symlink");
        #[cfg(windows)]
        if !create_windows_file_symlink_if_available(&outside_file, &link, "no-follow write") {
            return;
        }

        // O helper com no-follow nunca escreve atraves do symlink.
        assert!(
            write_file_regular_no_follow(&link, &root, b"conteudo novo").is_err(),
            "writing through a symlink must be rejected"
        );
        assert_eq!(
            fs::read_to_string(&outside_file).expect("outside intact"),
            "conteudo externo",
            "the external file must never be touched"
        );
    }

    #[test]
    fn hard_link_or_copy_falls_back_to_synced_copy_when_hard_link_fails() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let source = root.join("origem.bin");
        let target = root.join("destino.bin");
        fs::write(&source, b"bytes exatos 1\x00\x02\x03").expect("write source");

        // Fallback por copia quando o filesystem nao oferece hard links.
        let used_copy = hard_link_or_copy(&source, &target, |_, _| {
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "filesystem sem hard links",
            ))
        })
        .expect("copy fallback");
        assert!(used_copy);
        assert_eq!(
            fs::read(&target).expect("read target"),
            b"bytes exatos 1\x00\x02\x03",
            "the copy must be byte faithful"
        );
        assert!(source.exists(), "the source must remain intact");

        // Caminho normal (hard link) continua reservando sem copiar.
        let other = root.join("outro.bin");
        let used_copy =
            hard_link_or_copy(&source, &other, |a, b| fs::hard_link(a, b)).expect("hard link");
        assert!(!used_copy);
        assert_eq!(
            fs::read(&other).expect("read other"),
            b"bytes exatos 1\x00\x02\x03"
        );
    }

    #[test]
    fn copy_file_synced_preserves_bytes_exactly() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let source = root.join("origem.bin");
        let target = root.join("destino.bin");
        let bytes = (0_u8..=255).collect::<Vec<_>>();
        fs::write(&source, &bytes).expect("write source");
        copy_file_synced(&source, &target).expect("copy");
        assert_eq!(fs::read(&target).expect("read target"), bytes);
    }

    #[test]
    fn expanded_attachment_formats_are_inventoried_with_case_and_unicode_tolerance() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");
        // Formatos ampliados (armazenados ou delegados a plugins pelo Obsidian),
        // com extensao em maiusculas e nomes Unicode com espacos.
        for name in [
            "relatorio.docx",
            "planilha.CSV",
            "audio.OPUS",
            "capa.epub",
            "arquivo - copia.png",
            "apresentacao - conferencia.pptx",
            "dados - copia.json",
            "legenda.srt",
            "fonte - light.ttf",
            "backup - 2026.zip",
        ] {
            fs::write(root.join(name), "conteudo").expect("write attachment");
        }
        let scan = scan_vault_unified(&canonical_root).expect("scan vault");
        let relative = |path: &std::path::Path| {
            path.strip_prefix(&canonical_root)
                .expect("relative path")
                .to_string_lossy()
                .replace('\\', "/")
        };
        let mut names = scan
            .attachments
            .iter()
            .map(|path| relative(path))
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "apresentacao - conferencia.pptx",
                "arquivo - copia.png",
                "audio.OPUS",
                "backup - 2026.zip",
                "capa.epub",
                "dados - copia.json",
                "fonte - light.ttf",
                "legenda.srt",
                "planilha.CSV",
                "relatorio.docx",
            ]
        );
    }

    #[test]
    fn inventory_truncates_attachments_over_the_explicit_limit() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let canonical_root = root.canonicalize().expect("canonical root");
        for index in 0..MAX_ATTACHMENT_INVENTORY_FILES + 3 {
            fs::write(root.join(format!("anexo-{index:05}.bin")), "conteudo")
                .expect("write attachment");
        }
        let mut scan = scan_vault_unified(&canonical_root).expect("scan vault");
        let truncated =
            truncate_attachment_inventory(&mut scan.attachments, MAX_ATTACHMENT_INVENTORY_FILES);
        assert!(truncated);
        assert_eq!(scan.attachments.len(), MAX_ATTACHMENT_INVENTORY_FILES);

        // Abaixo do limite, nada e cortado.
        let mut small = scan.attachments.iter().take(2).cloned().collect::<Vec<_>>();
        assert!(!truncate_attachment_inventory(
            &mut small,
            MAX_ATTACHMENT_INVENTORY_FILES
        ));
        assert_eq!(small.len(), 2);
    }

    #[test]
    fn draft_attachments_with_note_relative_folder_resolve_against_vault_root() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{ "attachmentFolderPath": "./pasta" }"#,
        )
        .expect("write obsidian config");

        // Rascunho (nota ainda nao salva, caminho vazio): `./pasta` resolve
        // contra a raiz do Vault.
        let draft = obsidian_attachment_directory(&root, "").expect("draft folder");
        assert_eq!(draft, Some(root.join("pasta")));

        // Nota salva em subpasta: `./pasta` resolve relativo a pasta da nota.
        fs::create_dir_all(root.join("materias")).expect("create note folder");
        fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write note");
        let note = obsidian_attachment_directory(&root, "materias/aula.md").expect("note folder");
        assert_eq!(note, Some(root.join("materias").join("pasta")));
    }

    #[test]
    fn obsidian_attachment_directory_handles_all_documented_forms() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::create_dir_all(root.join("materias")).expect("create note folder");
        fs::write(root.join("materias").join("aula.md"), "# Aula").expect("write note");

        let configure = |value: &str| {
            fs::write(
                root.join(".obsidian").join("app.json"),
                format!(r#"{{ "attachmentFolderPath": {value:?} }}"#),
            )
            .expect("write app.json");
        };

        // Raiz do Vault: vazio e "/".
        for value in ["", "/"] {
            configure(value);
            assert_eq!(
                obsidian_attachment_directory(&root, "materias/aula.md").expect("root"),
                Some(root.to_path_buf()),
                "value {value:?} must resolve to the vault root"
            );
        }

        // Mesma pasta da nota: "." e "./".
        for value in [".", "./"] {
            configure(value);
            assert_eq!(
                obsidian_attachment_directory(&root, "materias/aula.md").expect("note folder"),
                Some(root.join("materias")),
                "value {value:?} must resolve to the note folder"
            );
        }

        // Subpasta da nota: "./pasta", barra final normalizada e caixa preservada.
        for value in ["./pasta", "./pasta/"] {
            configure(value);
            assert_eq!(
                obsidian_attachment_directory(&root, "materias/aula.md").expect("note subfolder"),
                Some(root.join("materias").join("pasta")),
                "value {value:?} must resolve relative to the note folder"
            );
        }
        configure("./Pasta");
        assert_eq!(
            obsidian_attachment_directory(&root, "materias/aula.md").expect("note subfolder case"),
            Some(root.join("materias").join("Pasta"))
        );

        // Pasta fixa relativa a raiz: "media" e "media/".
        for value in ["media", "media/"] {
            configure(value);
            assert_eq!(
                obsidian_attachment_directory(&root, "materias/aula.md").expect("fixed folder"),
                Some(root.join("media")),
                "value {value:?} must resolve against the vault root"
            );
        }

        // Rascunho (nota ainda nao salva): "./pasta" resolve contra a raiz.
        configure("./pasta");
        assert_eq!(
            obsidian_attachment_directory(&root, "").expect("draft"),
            Some(root.join("pasta"))
        );

        // Rejeicoes: absoluto, parent, segmentos com ponto e diretorios internos.
        for value in [
            "/abs",
            "../fora",
            "media/../fora",
            ".obsidian",
            "./.obsidian",
            "./../fora",
        ] {
            configure(value);
            assert!(
                obsidian_attachment_directory(&root, "materias/aula.md").is_err(),
                "value {value:?} must be rejected as unsafe"
            );
        }
    }

    #[test]
    fn obsidian_matrix_attachments_case_unicode_spaces_and_dotfiles() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("midia")).expect("create media folder");
        let supported = [
            ("Foto.PNG", "midia/Foto.PNG"),
            ("Fotografia.JPEG", "midia/Fotografia.JPEG"),
            ("caf\u{e9} (especial).png", "midia/caf\u{e9} (especial).png"),
            (
                "aula-\u{69}\u{301}mica.png",
                "midia/aula-\u{69}\u{301}mica.png",
            ),
            ("v1.2.3.png", "midia/v1.2.3.png"),
            (".oculto.png", "midia/.oculto.png"),
        ];
        for (name, _) in supported {
            fs::write(root.join("midia").join(name), "attachment").expect("write attachment");
        }
        // Nao anexos: sem extensao, extensao desconhecida e nota Markdown.
        fs::write(root.join("midia").join("sem-extensao"), "text").expect("write no extension");
        fs::write(root.join("midia").join("rascunho.xyz"), "text").expect("write unsupported");
        fs::write(root.join("midia").join("plano.md"), "# Plano").expect("write note");

        let mut collected = collect_attachment_files(&root)
            .expect("collect attachments")
            .into_iter()
            .map(|path| to_relative_display(&root, &path))
            .collect::<Vec<_>>();
        let mut expected = supported
            .iter()
            .map(|(_, relative)| relative.to_string())
            .collect::<Vec<_>>();
        collected.sort();
        expected.sort();
        assert_eq!(collected, expected);
    }

    #[test]
    fn incremental_inventory_matches_a_full_scan_after_watcher_changes() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("media")).expect("create media folder");
        fs::write(root.join("media").join("a.png"), "img").expect("write a");
        fs::write(root.join("media").join("b.png"), "img").expect("write b");
        fs::write(root.join("nota.md"), "# Nota").expect("write note");
        fs::create_dir_all(root.join("pastas")).expect("create pastas folder");

        let mut scan = scan_vault_unified(&root).expect("base scan");

        // Cria um anexo fora do app.
        fs::write(root.join("media").join("c.png"), "img").expect("write c");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Create,
                paths: vec!["media/c.png".to_string()],
            },
        );

        // Remove um anexo fora do app.
        fs::remove_file(root.join("media").join("a.png")).expect("remove a");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Remove,
                paths: vec!["media/a.png".to_string()],
            },
        );

        // Renomeia um anexo fora do app.
        fs::rename(
            root.join("media").join("b.png"),
            root.join("media").join("b2.png"),
        )
        .expect("rename b");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Rename,
                paths: vec!["media/b.png".to_string(), "media/b2.png".to_string()],
            },
        );

        // Cria pasta e nota dentro dela (fora do app).
        fs::create_dir_all(root.join("novas")).expect("create novas folder");
        fs::write(root.join("novas").join("x.md"), "# X").expect("write x");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Create,
                paths: vec!["novas".to_string(), "novas/x.md".to_string()],
            },
        );

        // Renomeia uma pasta com conteudo (fora do app).
        fs::create_dir_all(root.join("movida")).expect("create movida folder");
        fs::write(root.join("movida").join("d.png"), "img").expect("write d");
        fs::write(root.join("movida").join("y.md"), "# Y").expect("write y");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Create,
                paths: vec![
                    "movida".to_string(),
                    "movida/d.png".to_string(),
                    "movida/y.md".to_string(),
                ],
            },
        );
        fs::rename(root.join("movida"), root.join("renomeada")).expect("rename folder");
        apply_vault_scan_change(
            &mut scan,
            &root,
            &VaultFileSystemChange {
                kind: VaultFileSystemChangeKind::Rename,
                paths: vec!["movida".to_string(), "renomeada".to_string()],
            },
        );

        // O inventario incremental coincide com uma varredura completa fresca.
        scan.notes.sort();
        scan.folders.sort();
        scan.attachments.sort();
        let fresh = scan_vault_unified(&root).expect("fresh scan");
        let mut fresh_notes = fresh.notes;
        fresh_notes.sort();
        let mut fresh_folders = fresh.folders;
        fresh_folders.sort();
        let mut fresh_attachments = fresh.attachments;
        fresh_attachments.sort();
        assert_eq!(scan.notes, fresh_notes);
        assert_eq!(scan.folders, fresh_folders);
        assert_eq!(scan.attachments, fresh_attachments);
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

    #[cfg(windows)]
    #[test]
    fn windows_path_suite_accepts_forward_and_backslash_separators() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        assert_eq!(
            resolve_note_path(&root, "area/subarea/nota").expect("forward slash note"),
            resolve_note_path(&root, r"area\subarea\nota").expect("backslash note")
        );
        assert_eq!(
            resolve_folder_path(&root, "area/subarea").expect("forward slash folder"),
            resolve_folder_path(&root, r"area\subarea").expect("backslash folder")
        );
        assert_eq!(
            resolve_note_path(&root, "README.MD").expect("uppercase markdown extension"),
            root.join("README.MD")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_suite_rejects_drive_unc_rooted_and_device_paths() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");

        for unsafe_path in [
            r"C:\Windows\system32",
            r"\Windows\system32",
            r"\\server\share\escape",
            r"\\?\C:\escape",
            r"\\.\C:\escape",
        ] {
            assert!(
                resolve_note_path(&root, unsafe_path).is_err(),
                "note path should reject {unsafe_path}"
            );
            assert!(
                resolve_folder_path(&root, unsafe_path).is_err(),
                "folder path should reject {unsafe_path}"
            );
        }

        for metadata_alias in [".MIRMIND/nota", "area/.Mirmind/nota", ".mirmind /nota"] {
            assert!(
                resolve_note_path(&root, metadata_alias).is_err(),
                "note path should reject metadata alias {metadata_alias}"
            );
            assert!(
                resolve_folder_path(&root, metadata_alias).is_err(),
                "folder path should reject metadata alias {metadata_alias}"
            );
        }
    }

    #[test]
    fn windows_path_suite_rejects_reserved_device_names_and_extensions() {
        for reserved in [
            "CON",
            "con.txt",
            "NUL.tar.gz",
            "PRN",
            "AUX.md",
            "COM1",
            "com9.log",
            "LPT1",
            "lpt9.txt",
            "COM\u{00B9}",
            "COM\u{00B2}.log",
            "COM\u{00B3}",
            "LPT\u{00B9}",
            "LPT\u{00B2}.txt",
            "LPT\u{00B3}",
        ] {
            assert!(
                validate_vault_name(reserved).is_err(),
                "reserved Windows device name should be rejected: {reserved}"
            );
        }

        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        for reserved_path in ["CON", "area/AUX", "LPT1.txt", "area/NUL.md"] {
            assert!(
                resolve_note_path(&root, reserved_path).is_err(),
                "reserved note segment should be rejected: {reserved_path}"
            );
            assert!(
                resolve_folder_path(&root, reserved_path).is_err(),
                "reserved folder segment should be rejected: {reserved_path}"
            );
        }

        for invalid_name in ["nome ", "nome."] {
            assert!(
                validate_vault_name(invalid_name).is_err(),
                "trailing dot or space should be rejected: {invalid_name:?}"
            );
        }
        for invalid_path in ["area/nome /nota", "area/nome./nota"] {
            assert!(
                resolve_note_path(&root, invalid_path).is_err(),
                "invalid note segment should be rejected: {invalid_path}"
            );
            assert!(
                resolve_folder_path(&root, invalid_path).is_err(),
                "invalid folder segment should be rejected: {invalid_path}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_suite_preserves_unicode_and_ntfs_case_insensitivity() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let original = root
            .join("Estudos")
            .join("\u{00C1}rvore_\u{65E5}\u{672C}.md");
        fs::create_dir_all(original.parent().expect("unicode note parent"))
            .expect("create unicode directory");
        fs::write(&original, "conteudo unicode").unwrap_or_else(|error| {
            panic!(
                "write unicode note {} ({original:?}): {error}",
                original.display()
            )
        });

        let differently_cased =
            resolve_note_path(&root, "estudos/\u{00C1}RVORE_\u{65E5}\u{672C}.md")
                .expect("resolve unicode note");
        assert_eq!(
            differently_cased
                .canonicalize()
                .expect("canonical case variant"),
            original.canonicalize().expect("canonical unicode note")
        );
        assert_eq!(
            fs::read_to_string(differently_cased).expect("read unicode case variant"),
            "conteudo unicode"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_suite_writes_and_reopens_a_path_longer_than_max_path() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let segment = "caminho-longo-".repeat(4);
        let relative = format!("{segment}/{segment}/{segment}/{segment}/nota-final.md");
        let note = resolve_note_path(&root, &relative).expect("resolve long note path");
        assert!(
            note.as_os_str().len() > 260,
            "test path must exceed MAX_PATH"
        );

        fs::create_dir_all(note.parent().expect("long note parent"))
            .expect("create long directory tree");
        fs::write(&note, "conteudo em caminho longo").expect("write long note");
        assert_eq!(
            fs::read_to_string(&note).expect("reopen long note"),
            "conteudo em caminho longo"
        );
    }

    /// NTFS: uma nota mantida aberta por OUTRO processo (share mode sem
    /// FILE_SHARE_WRITE) deve fazer o save falhar com erro claro, sem gravar
    /// bytes parciais e sem corromper o conteudo existente — a falha de
    /// concorrencia nunca pode produzir uma escrita pela metade.
    #[cfg(windows)]
    #[test]
    fn save_never_truncates_a_note_locked_by_another_process() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ};
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_SHARE_READ, OPEN_EXISTING,
        };

        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let note = root.join("concorrencia.md");
        fs::write(&note, "conteudo original intacto").expect("write note");

        // Abre o arquivo como outro processo faria, SEM compartilhar escrita:
        // enquanto o handle existir, qualquer gravacao concorrente falha.
        let wide = note
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        assert!(!handle.is_null(), "abrir o arquivo como outro processo");

        let error = save_note_in_root(&root, "concorrencia.md", "escrita concorrente")
            .err()
            .expect("save sob lock de outro processo");
        assert!(
            error.to_string().contains("Nao foi possivel salvar"),
            "a falha deve ser clara, nao generica: {error}"
        );
        // Nenhuma escrita parcial: os bytes originais permanecem exatos.
        assert_eq!(
            fs::read_to_string(&note).expect("reopen note"),
            "conteudo original intacto"
        );

        unsafe { CloseHandle(handle) };
        // Depois que o outro processo libera o arquivo, o mesmo save funciona.
        save_note_in_root(&root, "concorrencia.md", "escrita concorrente")
            .expect("save apos liberar o lock");
        assert_eq!(
            fs::read_to_string(&note).expect("reopen saved note"),
            "escrita concorrente"
        );
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
        if !create_windows_file_symlink_if_available(&outside, &link, "note path confinement") {
            return;
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

    #[cfg(windows)]
    #[test]
    fn ntfs_security_suite_preserves_a_locked_note_until_the_handle_is_released() {
        use std::os::windows::fs::OpenOptionsExt as _;

        const FILE_SHARE_READ: u32 = 0x00000001;

        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        ensure_metadata_layout(&root).expect("initialize metadata");
        let note = root.join("bloqueada.md");
        fs::write(&note, "original").expect("write original note");
        let locked_handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&note)
            .expect("open note without write/delete sharing");

        assert!(save_note_in_root(&root, "bloqueada.md", "substituida").is_err());
        assert_eq!(
            fs::read_to_string(&note).expect("read locked note"),
            "original"
        );

        drop(locked_handle);
        let saved =
            save_note_in_root(&root, "bloqueada.md", "substituida").expect("save after unlock");
        assert_eq!(saved.content, "substituida");
        assert_eq!(
            fs::read_to_string(&note).expect("read updated note"),
            "substituida"
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
    fn consecutive_renames_use_the_wikilink_index_and_keep_links_consistent() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(root.join("alvo.md"), "# Alvo").expect("write target");
        fs::write(root.join("a.md"), "# A\n[[alvo]]\n").expect("write referrer");
        fs::write(root.join("isolada.md"), "# Isolada").expect("write unrelated note");

        // Primeira renomeacao: sem indice no disco, reconstrói e persiste.
        rename_vault_item_in_root(&root, "alvo.md", "alvo-2", "note").expect("first rename");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read referrer"),
            "# A\n[[alvo-2]]\n"
        );

        // Segunda renomeacao: o indice persistido esta fresco (nada mudou por
        // fora) e e usado para ler apenas as notas candidatas.
        rename_vault_item_in_root(&root, "alvo-2.md", "alvo-3", "note").expect("second rename");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read referrer"),
            "# A\n[[alvo-3]]\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("isolada.md")).expect("unrelated note intact"),
            "# Isolada"
        );
        // O indice foi persistido durante a segunda renomeacao.
        assert!(root
            .join(METADATA_DIR)
            .join(".wikilink-index.json")
            .is_file());
    }

    #[test]
    fn saves_between_renames_keep_the_index_cache_fresh() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(root.join("alvo.md"), "# Alvo").expect("write target");
        fs::write(root.join("a.md"), "# A\n[[alvo]]\n").expect("write referrer");
        fs::write(root.join("isolada.md"), "# Isolada").expect("write unrelated note");

        let state = WikilinkIndexState::default();
        let rebuild_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let rebuild_count_capture = rebuild_count.clone();
        let hooks = crate::review::wikilink_index::BuildHooks {
            on_progress: Some(Box::new(move |_processed, _total| {
                rebuild_count_capture.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            })),
            should_cancel: None,
        };

        // Primeira renomeacao: sem indice, reconstroi (progresso reportado).
        rename_vault_item_in_root_with_state(
            &root,
            "alvo.md",
            "alvo-2",
            "note",
            &hooks,
            Some(&state),
        )
        .expect("first rename");
        assert!(
            rebuild_count.load(std::sync::atomic::Ordering::Relaxed) > 0,
            "first rename must rebuild the index"
        );

        // Edicao normal (salvamento) entre renomeacoes: o cache em memoria e
        // atualizado sem tocar o disco.
        fs::write(root.join("a.md"), "# A\n[[alvo-2]] e mais texto\n").expect("edit note");
        update_wikilink_index_after_save(&root, "a.md", "# A\n[[alvo-2]] e mais texto\n", &state);

        // Segunda renomeacao: o cache esta fresco (validado por stat) e a
        // reconstrucao NAO acontece.
        let before = rebuild_count.load(std::sync::atomic::Ordering::Relaxed);
        rename_vault_item_in_root_with_state(
            &root,
            "alvo-2.md",
            "alvo-3",
            "note",
            &hooks,
            Some(&state),
        )
        .expect("second rename");
        assert_eq!(
            rebuild_count.load(std::sync::atomic::Ordering::Relaxed),
            before,
            "a fresh cache must not rebuild the index"
        );
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read referrer"),
            "# A\n[[alvo-3]] e mais texto\n"
        );
    }

    #[test]
    fn cancelling_the_index_rebuild_falls_back_to_the_full_scan() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::write(root.join("alvo.md"), "# Alvo").expect("write target");
        fs::write(root.join("a.md"), "# A\n[[alvo]]\n").expect("write referrer");
        fs::write(root.join("isolada.md"), "# Isolada").expect("write unrelated note");

        let state = WikilinkIndexState::default();
        state.set_cancel(&root, true);
        let cancel_flag = state.cancel_flag(&root);
        let hooks = crate::review::wikilink_index::BuildHooks {
            on_progress: None,
            should_cancel: Some(Box::new(move || {
                cancel_flag.load(std::sync::atomic::Ordering::Acquire)
            })),
        };

        // A reconstrucao do indice e cancelada: a renomeacao cai para a
        // varredura completa (comportamento anterior) e conclui com os links
        // consistentes, sem persistir indice parcial.
        rename_vault_item_in_root_with_state(
            &root,
            "alvo.md",
            "alvo-2",
            "note",
            &hooks,
            Some(&state),
        )
        .expect("rename with cancelled index");
        assert_eq!(
            fs::read_to_string(root.join("a.md")).expect("read referrer"),
            "# A\n[[alvo-2]]\n"
        );
        assert!(
            !root
                .join(METADATA_DIR)
                .join(".wikilink-index.json")
                .exists(),
            "a cancelled rebuild must not persist a partial index"
        );
    }

    #[test]
    fn renaming_a_note_preserves_its_learning_identity_and_schedule() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let original_path = "materias/aula.md";
        let renamed_path = "materias/resumo.md";
        let markdown = "# Aula\n\nPrimeiro ponto.\n\nSegundo ponto.\n\nTerceiro ponto.";
        let ready_at = 1_720_000_000_000;
        fs::create_dir_all(root.join("materias")).expect("create source folder");
        fs::write(root.join(original_path), markdown).expect("write source note");

        let ready = persist_readiness_assessment(
            &root,
            original_path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            ready_at,
        )
        .expect("persist readiness");
        let enrolled = set_manual_enrollment(&root, original_path, markdown, true, ready_at)
            .expect("enable review");
        let original_note_id = ready.note_id;
        let original_next_review = enrolled.next_review_at_unix_ms;

        rename_vault_item_in_root(&root, original_path, "resumo", "note").expect("rename note");

        let renamed = load_note_review_state(&root, renamed_path, markdown, ready_at)
            .expect("load renamed note state")
            .expect("renamed note keeps learning state");
        assert_eq!(renamed.note_id, original_note_id);
        assert!(renamed.enrolled);
        assert_eq!(renamed.next_review_at_unix_ms, original_next_review);
        let stored = load_learning_document(&root, &renamed.note_id)
            .expect("load learning document")
            .expect("learning document");
        assert_eq!(stored.document.note.relative_path, renamed_path);
    }
    #[test]
    fn a_renamed_note_keeps_its_review_policy_controls() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let original_path = "aula.md";
        let renamed_path = "resumo.md";
        let markdown = "# Aula\n\nPrimeiro ponto.\n\nSegundo ponto.\n\nTerceiro ponto.";
        let now = 1_720_000_000_000;
        fs::write(root.join(original_path), markdown).expect("write source note");
        persist_readiness_assessment(
            &root,
            original_path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            now,
        )
        .expect("persist readiness");

        rename_vault_item_in_root(&root, original_path, "resumo", "note").expect("rename note");

        let policy = load_note_review_policy(&root, renamed_path, markdown, now)
            .expect("load policy")
            .expect("renamed note keeps policy controls");
        assert_eq!(policy.first_review_interval_days, 2);
    }
    #[test]
    fn renaming_a_folder_preserves_learning_identity_for_every_note_inside_it() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let report = ReadinessReport {
            status: ReadinessStatus::Ready,
            explanation: "Pronta.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: Vec::new(),
        };
        let notes = [
            ("curso/aula.md", "# Aula\n\nUm.\n\nDois.\n\nTres."),
            (
                "curso/modulo/resumo.md",
                "# Resumo\n\nUm.\n\nDois.\n\nTres.",
            ),
        ];
        fs::create_dir_all(root.join("curso/modulo")).expect("create source folders");
        let mut original_ids = Vec::new();
        for (path, markdown) in notes {
            fs::write(root.join(path), markdown).expect("write source note");
            original_ids.push(
                persist_readiness_assessment(&root, path, markdown, &report, 1_720_000_000_000)
                    .expect("persist readiness")
                    .note_id,
            );
        }

        rename_vault_item_in_root(&root, "curso", "estudos", "folder").expect("rename folder");

        for ((_, markdown), (renamed_path, original_id)) in notes.into_iter().zip([
            ("estudos/aula.md", &original_ids[0]),
            ("estudos/modulo/resumo.md", &original_ids[1]),
        ]) {
            let state = load_note_review_state(&root, renamed_path, markdown, 1_720_000_000_000)
                .expect("load moved state")
                .expect("moved note keeps state");
            assert_eq!(&state.note_id, original_id);
        }
    }
    #[test]
    fn moving_a_note_preserves_its_learning_identity() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let original_path = "origem/aula.md";
        let moved_path = "destino/aula.md";
        let markdown = "# Aula\n\nUm.\n\nDois.\n\nTres.";
        fs::create_dir_all(root.join("origem")).expect("create source folder");
        fs::create_dir_all(root.join("destino")).expect("create destination folder");
        fs::write(root.join(original_path), markdown).expect("write source note");
        let original = persist_readiness_assessment(
            &root,
            original_path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            1_720_000_000_000,
        )
        .expect("persist readiness");

        move_vault_item_in_root(&root, original_path, "destino", "note").expect("move note");

        let moved = load_note_review_state(&root, moved_path, markdown, 1_720_000_000_000)
            .expect("load moved state")
            .expect("moved note keeps state");
        assert_eq!(moved.note_id, original.note_id);
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

    #[cfg(windows)]
    #[test]
    fn ntfs_security_suite_rolls_back_after_a_concurrent_junction_swap() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path().join("vault");
        let outside = temporary_directory.path().join("outside");
        fs::create_dir(&root).expect("create vault");
        fs::create_dir(&outside).expect("create outside directory");
        let root = root.canonicalize().expect("canonical vault");
        fs::write(root.join("primeira.md"), "original 1").expect("write first note");
        fs::write(root.join("segunda.md"), "original 2").expect("write second note");
        fs::write(outside.join("segredo.md"), "segredo externo").expect("write outside note");
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
        let second = root.join("segunda.md");

        let result =
            update_wiki_links_for_note_path_change_with_hook(&root, &updates, |committed_index| {
                if committed_index == 0 {
                    fs::remove_file(&second).expect("remove second note for concurrent swap");
                    create_windows_junction(&outside, &second);
                }
                Ok(())
            });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("primeira.md")).expect("read rolled back first note"),
            "original 1"
        );
        assert_eq!(
            fs::read_to_string(outside.join("segredo.md")).expect("read untouched outside note"),
            "segredo externo"
        );
        assert_eq!(
            second.canonicalize().expect("canonical swapped junction"),
            outside.canonicalize().expect("canonical outside directory")
        );
        assert!(fs::read_dir(&root)
            .expect("list transaction artifacts")
            .all(|entry| {
                !entry
                    .expect("read transaction artifact")
                    .file_name()
                    .to_string_lossy()
                    .contains(".mirmind-")
            }));
    }

    #[cfg(windows)]
    #[test]
    fn ntfs_security_suite_blocks_an_ancestor_swap_between_check_and_replace() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path().join("vault");
        let outside = temporary_directory.path().join("outside");
        fs::create_dir_all(root.join("area")).expect("create vault tree");
        fs::create_dir(&outside).expect("create outside directory");
        let root = root.canonicalize().expect("canonical vault");
        let area = root.join("area");
        let moved_area = root.join("area-movida");
        let note = area.join("nota.md");
        fs::write(&note, "conteudo original").expect("write original note");
        fs::write(outside.join("segredo.md"), "segredo externo").expect("write outside note");
        let updates = vec![PlannedWikiLinkUpdate {
            original_content: b"conteudo original".to_vec(),
            path_after_change: note,
            updated_content: b"conteudo atualizado".to_vec(),
        }];
        let mut swap_attempted = false;

        let result = update_wiki_links_for_note_path_change_with_hooks(
            &root,
            &updates,
            |_| {
                swap_attempted = true;
                fs::rename(&area, &moved_area).expect("swap ancestor after validation");
                create_windows_junction(&outside, &area);
                Ok(())
            },
            |_| Ok(()),
        );

        assert!(result.is_err());
        assert!(swap_attempted);
        assert_eq!(
            area.canonicalize().expect("canonical swapped ancestor"),
            outside.canonicalize().expect("canonical outside directory")
        );
        assert_eq!(
            fs::read_to_string(moved_area.join("nota.md")).expect("read untouched original note"),
            "conteudo original"
        );
        let mut outside_entries = fs::read_dir(&outside)
            .expect("list outside directory")
            .map(|entry| entry.expect("read outside entry").file_name())
            .collect::<Vec<_>>();
        outside_entries.sort();
        assert_eq!(
            outside_entries,
            vec![std::ffi::OsString::from("segredo.md")]
        );
        assert!(fs::read_dir(&root)
            .expect("list transaction artifacts")
            .all(|entry| {
                !entry
                    .expect("read transaction artifact")
                    .file_name()
                    .to_string_lossy()
                    .contains(".mirmind-")
            }));
    }

    #[cfg(windows)]
    #[test]
    fn ntfs_security_suite_replaces_a_note_atomically_without_artifacts() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Barrier, Mutex,
        };

        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        let note = root.join("atomica.md");
        fs::write(&note, "versao-000").expect("write original note");
        let stop = Arc::new(AtomicBool::new(false));
        let failure = Arc::new(Mutex::new(None::<String>));
        let barrier = Arc::new(Barrier::new(2));
        let reader_note = note.clone();
        let reader_stop = Arc::clone(&stop);
        let reader_failure = Arc::clone(&failure);
        let reader_barrier = Arc::clone(&barrier);
        let reader = std::thread::spawn(move || {
            reader_barrier.wait();
            while !reader_stop.load(Ordering::Acquire) {
                if !reader_note.exists() {
                    *reader_failure.lock().expect("lock observer failure") =
                        Some("caminho ausente durante replace".to_string());
                    break;
                }
                std::thread::yield_now();
            }
        });

        barrier.wait();
        let mut current = "versao-000".to_string();
        for index in 1..=128 {
            let next = format!("versao-{index:03}");
            let updates = vec![PlannedWikiLinkUpdate {
                original_content: current.as_bytes().to_vec(),
                path_after_change: note.clone(),
                updated_content: next.as_bytes().to_vec(),
            }];
            update_wiki_links_for_note_path_change(&root, &updates)
                .expect("commit atomic replacement");
            assert_eq!(
                fs::read_to_string(&note).expect("read complete committed version"),
                next
            );
            current = next;
        }
        stop.store(true, Ordering::Release);
        reader.join().expect("join atomic observer");

        assert_eq!(
            failure.lock().expect("read observer failure").as_ref(),
            None,
            "a concurrent reader observed a non-atomic state"
        );
        assert_eq!(
            fs::read_to_string(&note).expect("read final replacement"),
            "versao-128"
        );
        assert!(fs::read_dir(&root)
            .expect("list transaction artifacts")
            .all(|entry| {
                !entry
                    .expect("read transaction artifact")
                    .file_name()
                    .to_string_lossy()
                    .contains(".mirmind-")
            }));
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
    fn obsidian_preferences_ignore_invalid_typed_fields_without_discarding_valid_ones() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::write(
            root.join(".obsidian").join("app.json"),
            r#"{
              "newFileLocation": "folder",
              "attachmentFolderPath": 123,
              "useMarkdownLinks": true,
              "promptDelete": "sim",
              "userIgnoreFilters": ["Arquivo/", 42]
            }"#,
        )
        .expect("write obsidian config");

        let preferences = inspect_vault_path(&root)
            .expect("inspect obsidian vault")
            .obsidian_preferences
            .expect("preferences");
        assert_eq!(preferences.new_file_location.as_deref(), Some("folder"));
        assert_eq!(preferences.use_markdown_links, Some(true));
        assert_eq!(preferences.attachment_folder_path, None);
        assert_eq!(preferences.prompt_delete, None);
        assert_eq!(
            preferences.user_ignore_filters,
            vec!["Arquivo/".to_string()]
        );
        assert_eq!(
            preferences.ignored_preference_fields,
            vec!["attachmentFolderPath", "promptDelete", "userIgnoreFilters"]
        );
    }

    #[test]
    fn ignored_obsidian_config_files_list_names_without_exposing_plugin_data() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian").join("plugins")).expect("create obsidian dir");
        fs::write(
            root.join(".obsidian").join("appearance.json"),
            "{ \"theme\": \"obsidian\" }",
        )
        .expect("write appearance config");
        fs::write(root.join(".obsidian").join("workspace.json"), "{ invalido")
            .expect("write workspace config");
        // Dados de plugins jamais sao listados nem expostos.
        fs::write(
            root.join(".obsidian").join("plugins").join("data.json"),
            "segredo-do-plugin",
        )
        .expect("write plugin data");

        let summary = inspect_vault_path(&root).expect("inspect obsidian vault");
        assert_eq!(
            summary.obsidian_ignored_config_files,
            vec!["appearance.json", "workspace.json"]
        );
        assert!(
            !summary
                .obsidian_ignored_config_files
                .iter()
                .any(|name| name.contains("plugins")),
            "plugin data must never be exposed"
        );
    }

    #[test]
    fn vault_summary_reads_obsidian_appearance_without_modifying_it() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian dir");
        let appearance_json = br##"{
  "theme": "obsidian",
  "accentColor": "#c46a2b",
  "baseFontSize": 18,
  "cssTheme": "Minimal",
  "textFontFamily": "Georgia",
  "monospaceFontFamily": "Cascadia Code"
}"##;
        let config_path = root.join(".obsidian").join("appearance.json");
        fs::write(&config_path, appearance_json).expect("write appearance config");

        let summary = inspect_vault_path(&root).expect("inspect vault");
        let appearance = summary
            .obsidian_appearance
            .expect("read supported obsidian appearance");
        assert_eq!(appearance.theme.as_deref(), Some("obsidian"));
        assert_eq!(appearance.accent_color.as_deref(), Some("#c46a2b"));
        assert_eq!(appearance.base_font_size, Some(18.0));
        assert_eq!(appearance.css_theme.as_deref(), Some("Minimal"));
        assert_eq!(appearance.text_font_family.as_deref(), Some("Georgia"));
        assert_eq!(
            appearance.monospace_font_family.as_deref(),
            Some("Cascadia Code")
        );
        assert!(appearance.ignored_appearance_fields.is_empty());
        // O arquivo nunca e sobrescrito.
        assert_eq!(
            fs::read(&config_path).expect("reread appearance config"),
            appearance_json
        );
    }

    #[test]
    fn obsidian_appearance_tolerates_invalid_field_types_and_missing_file() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian dir");
        // Campos com tipo invalido sao ignorados sem descartar os validos.
        fs::write(
            root.join(".obsidian").join("appearance.json"),
            "{ \"theme\": 7, \"accentColor\": \"#123456\", \"baseFontSize\": \"grande\" }",
        )
        .expect("write appearance config");

        let summary = inspect_vault_path(&root).expect("inspect vault");
        let appearance = summary
            .obsidian_appearance
            .expect("read tolerant obsidian appearance");
        assert_eq!(appearance.theme, None);
        assert_eq!(appearance.accent_color.as_deref(), Some("#123456"));
        assert_eq!(appearance.base_font_size, None);
        assert_eq!(
            appearance.ignored_appearance_fields,
            vec!["baseFontSize", "theme"]
        );

        // Vault sem appearance.json: campo ausente, sem falha.
        let empty_root = tempdir().expect("empty temp dir");
        let empty_summary = inspect_vault_path(empty_root.path()).expect("inspect empty vault");
        assert!(empty_summary.obsidian_appearance.is_none());
    }

    #[test]
    fn read_special_vault_file_reads_canvas_and_excalidraw_within_the_vault_only() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical root");
        fs::create_dir_all(root.join("desenhos")).expect("create folder");
        let canvas = br#"{ "nodes": [ { "id": "a", "type": "text" } ], "edges": [] }"#;
        let excalidraw = br#"{ "type": "excalidraw", "elements": [] }"#;
        fs::write(root.join("Planejamento.canvas"), canvas).expect("write canvas");
        fs::write(root.join("desenhos").join("Quadro.excalidraw"), excalidraw)
            .expect("write excalidraw");

        assert_eq!(
            read_special_vault_file_in_root(&root, "Planejamento.canvas").expect("read canvas"),
            canvas
        );
        assert_eq!(
            read_special_vault_file_in_root(&root, "desenhos/Quadro.excalidraw")
                .expect("read excalidraw"),
            excalidraw
        );
        // Fora do conjunto permitido: notas, PDFs, dotfiles, absolutos e..
        assert!(read_special_vault_file_in_root(&root, "Planejamento.canvas.md").is_err());
        assert!(read_special_vault_file_in_root(&root, ".obsidian/appearance.json").is_err());
        assert!(read_special_vault_file_in_root(&root, "/absoluto.canvas").is_err());
        assert!(read_special_vault_file_in_root(&root, "../fora.canvas").is_err());
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
        if !create_windows_file_symlink_if_available(&outside, &link, "Obsidian config confinement")
        {
            return;
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
        if !create_windows_directory_symlink_if_available(
            &outside,
            &root.join("media"),
            "attachment directory confinement",
        ) {
            return;
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

    #[cfg(windows)]
    #[test]
    fn ntfs_security_suite_rejects_a_junction_that_escapes_the_vault() {
        let temporary_directory = tempdir().expect("temp dir");
        let source_directory = tempdir().expect("source dir");
        let root = temporary_directory.path().join("vault");
        let outside = temporary_directory.path().join("outside");
        fs::create_dir_all(root.join(".obsidian")).expect("create obsidian config folder");
        fs::create_dir_all(&outside).expect("create outside folder");
        create_windows_junction(&outside, &root.join("media"));
        assert_eq!(
            root.join("media")
                .canonicalize()
                .expect("canonical junction"),
            outside.canonicalize().expect("canonical outside folder")
        );
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
