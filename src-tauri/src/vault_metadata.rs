//! Lixeira e historico (undo/redo) do vault, persistidos em `.mirmind/`.
//!
//! Extraidos de `lib.rs` sem mudanca de comportamento: as operacoes de
//! exclusao/restauracao movem itens reais para `.mirmind/trash` com manifesto
//! `trash.json` e retencao de 30 dias; o historico grava comandos de
//! criacao/salvamento em `.mirmind/history.json` para desfazer/refazer.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    resolve_folder_path, resolve_note_path, HISTORY_FILE, HISTORY_LIMIT, METADATA_DIR, TRASH_DIR,
    TRASH_FILE, TRASH_RETENTION_DAYS,
};

pub(crate) fn today_day() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryCommand {
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
pub(crate) struct HistoryState {
    pub(crate) undo: Vec<HistoryCommand>,
    pub(crate) redo: Vec<HistoryCommand>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryStatus {
    pub(crate) can_undo: bool,
    pub(crate) can_redo: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashEntry {
    pub(crate) id: String,
    pub(crate) original_relative_path: String,
    pub(crate) trashed_name: String,
    pub(crate) item_type: String,
    #[serde(default = "today_day")]
    pub(crate) deleted_at_day: u64,
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

pub(crate) fn read_trash_entries(root: &Path) -> Result<Vec<TrashEntry>> {
    let path = trash_manifest_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str::<Vec<TrashEntry>>(&fs::read_to_string(path)?).unwrap_or_default())
}

pub(crate) fn list_trash_in_root(root: &Path) -> Result<Vec<TrashEntry>> {
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

pub(crate) fn write_trash_entries(root: &Path, entries: &[TrashEntry]) -> Result<()> {
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

pub(crate) fn read_history(root: &Path) -> Result<HistoryState> {
    let path = history_path(root);
    if !path.exists() {
        return Ok(HistoryState::default());
    }
    Ok(serde_json::from_str::<HistoryState>(&fs::read_to_string(path)?).unwrap_or_default())
}

pub(crate) fn write_history(root: &Path, history: &HistoryState) -> Result<()> {
    fs::create_dir_all(root.join(METADATA_DIR))?;
    fs::write(history_path(root), serde_json::to_string(history)?)?;
    Ok(())
}

pub(crate) fn record_history(root: &Path, command: HistoryCommand) -> Result<()> {
    let mut history = read_history(root)?;
    history.undo.push(command);
    history.redo.clear();
    if history.undo.len() > HISTORY_LIMIT {
        history.undo.remove(0);
    }
    write_history(root, &history)
}

pub(crate) fn apply_history_command(
    root: &Path,
    command: &HistoryCommand,
    undo: bool,
) -> Result<()> {
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

pub(crate) fn history_status(history: &HistoryState) -> HistoryStatus {
    HistoryStatus {
        can_undo: !history.undo.is_empty(),
        can_redo: !history.redo.is_empty(),
    }
}

/// Move o item real do vault para a lixeira e registra a entrada no manifesto;
/// falha ao gravar o manifesto restaura o item ao local original.
pub(crate) fn delete_vault_item_in_root(
    root: &Path,
    relative_path: &str,
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
    let trash_directory = trash_root(root);
    fs::create_dir_all(&trash_directory)?;
    let trash_path = trash_directory.join(&trashed_name);
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

pub(crate) fn restore_trash_item_in_root(root: &Path, id: &str) -> Result<()> {
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

pub(crate) fn permanently_delete_trash_item_in_root(root: &Path, id: &str) -> Result<()> {
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
