//! Journal duravel para renomeacoes e movimentacoes de notas e pastas.
//!
//! A renomeacao de um item toca varios arquivos (o proprio item e as notas que
//! o referenciam via wikilinks). Um crash no meio da operacao deixaria o item
//! no destino sem os links atualizados, ou vice-versa. Este modulo grava a
//! transacao inteira (origem, destino e os bytes exatos antes/depois de cada
//! nota cujo conteudo muda) em um journal atomico e sincronizado ANTES de
//! qualquer mutacao. Na abertura do Vault (`recover_pending_rename_transaction`),
//! a transacao pendente e concluida (roll forward) quando o movimento ja
//! aconteceu, ou apenas limpa quando o movimento nunca comecou. Notas com
//! edicao concorrente nunca sao sobrescritas: sao reportadas como conflitos.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const METADATA_DIRECTORY: &str = ".mirmind";
const RENAME_TRANSACTION_FILE: &str = ".rename.transaction.json";
const MAX_RENAME_TRANSACTION_BYTES: usize = 8 * 1024 * 1024;

/// Entrada do journal: uma nota cujo conteudo muda durante a renomeacao.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameJournalEntry {
    /// Caminho relativo da nota (pos-renomeacao) cujo conteudo sera reescrito.
    pub relative_path: String,
    /// Bytes exatos antes da atualizacao de links.
    pub before_content: String,
    /// Bytes exatos depois da atualizacao de links.
    pub after_content: String,
}

/// Transacao de renomeacao persistida antes de qualquer mutacao no disco.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameTransactionJournal {
    pub transaction_id: String,
    pub is_note: bool,
    pub source_relative_path: String,
    pub destination_relative_path: String,
    pub entries: Vec<RenameJournalEntry>,
}

fn metadata_directory(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY)
}

fn journal_path(vault_root: &Path) -> PathBuf {
    metadata_directory(vault_root).join(RENAME_TRANSACTION_FILE)
}

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let random = std::process::id();
    format!("{nanos:x}-{random:x}")
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<()> {
    fs::File::open(directory)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> Result<()> {
    Ok(())
}

fn ensure_regular_file_if_present(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("O journal de renomeacao nao e um arquivo regular seguro.");
    }
    Ok(())
}

fn safe_relative_path(relative_path: &str) -> Result<String> {
    let candidate = Path::new(relative_path);
    if candidate.is_absolute() || candidate.has_root() {
        bail!("O caminho do journal de renomeacao precisa ser relativo.");
    }
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("O journal de renomeacao nao pode navegar para fora do Vault.");
    }
    if candidate.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(METADATA_DIRECTORY))
    }) {
        bail!("O journal de renomeacao nao pode apontar para os metadados do app.");
    }
    Ok(relative_path.to_string())
}

/// Registra a transacao de renomeacao de forma duravel (stage + rename + sync)
/// ANTES de qualquer mutacao. Se ja existir um journal pendente, tenta
/// recupera-lo primeiro (defensivo; a recuperacao normal roda na abertura).
pub fn begin_rename_transaction(
    vault_root: &Path,
    is_note: bool,
    source_relative_path: &str,
    destination_relative_path: &str,
    entries: &[RenameJournalEntry],
) -> Result<()> {
    let canonical_root = vault_root
        .canonicalize()
        .with_context(|| format!("O Vault '{}' nao existe.", vault_root.display()))?;
    let source = safe_relative_path(source_relative_path)?;
    let destination = safe_relative_path(destination_relative_path)?;
    for entry in entries {
        safe_relative_path(&entry.relative_path)?;
    }

    if journal_path(&canonical_root).exists() {
        let conflicts = recover_pending_rename_transaction(&canonical_root)
            .context("Nao foi possivel recuperar uma renomeacao pendente.")?;
        if !conflicts.is_empty() {
            log::warn!(
                "renomeacao pendente recuperada com conflitos: {:?}",
                conflicts
            );
        }
    }

    let directory = metadata_directory(&canonical_root);
    fs::create_dir_all(&directory)
        .with_context(|| format!("Nao foi possivel criar '{}'.", directory.display()))?;

    let journal = RenameTransactionJournal {
        transaction_id: unique_suffix(),
        is_note,
        source_relative_path: source,
        destination_relative_path: destination,
        entries: entries.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&journal)?;
    if bytes.len() > MAX_RENAME_TRANSACTION_BYTES {
        bail!("A transacao de renomeacao excede o limite seguro de journal.");
    }

    let target_path = journal_path(&canonical_root);
    let stage = directory.join(format!(
        "{RENAME_TRANSACTION_FILE}.stage-{}",
        unique_suffix()
    ));
    let publish = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&stage)
            .with_context(|| format!("Nao foi possivel preparar '{}'.", stage.display()))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&stage, &target_path)
            .with_context(|| format!("Nao foi possivel publicar '{}'.", target_path.display()))?;
        sync_directory(&directory)
    })();
    if publish.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    publish
}

/// Remove o journal apos a renomeacao concluir com sucesso (ou apos um rollback
/// em processo restaurar o estado original).
pub fn complete_rename_transaction(vault_root: &Path) -> Result<()> {
    let canonical_root = vault_root.canonicalize()?;
    let target_path = journal_path(&canonical_root);
    if !target_path.exists() {
        return Ok(());
    }
    ensure_regular_file_if_present(&target_path)?;
    fs::remove_file(&target_path)?;
    sync_directory(&metadata_directory(&canonical_root))?;
    Ok(())
}

fn safe_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Conclui uma renomeacao interrompida por crash. Retorna os caminhos relativos
/// das notas que receberam edicao concorrente e por isso NAO foram alteradas
/// (nada e sobrescrito nesses casos).
pub fn recover_pending_rename_transaction(vault_root: &Path) -> Result<Vec<String>> {
    let canonical_root = vault_root.canonicalize()?;
    let journal_file = journal_path(&canonical_root);
    if !journal_file.exists() {
        return Ok(Vec::new());
    }
    ensure_regular_file_if_present(&journal_file)?;
    let metadata = fs::metadata(&journal_file)?;
    if metadata.len() as usize > MAX_RENAME_TRANSACTION_BYTES {
        bail!("O journal de renomeacao excede o limite seguro.");
    }
    let bytes = fs::read(&journal_file)?;
    let journal: RenameTransactionJournal =
        serde_json::from_slice(&bytes).context("O journal de renomeacao e invalido.")?;
    let source_relative = safe_relative_path(&journal.source_relative_path)?;
    let destination_relative = safe_relative_path(&journal.destination_relative_path)?;
    for entry in &journal.entries {
        safe_relative_path(&entry.relative_path)?;
    }

    let source = canonical_root.join(&source_relative);
    let destination = canonical_root.join(&destination_relative);
    let source_exists = safe_exists(&source);
    let destination_exists = safe_exists(&destination);

    let mut conflicts = Vec::new();
    if source_exists && !destination_exists {
        // O movimento nunca comecou; nada ha a concluir.
    } else if !source_exists && destination_exists {
        // O movimento aconteceu; conclui a atualizacao de links (roll forward),
        // respeitando edicoes concorrentes.
        for entry in &journal.entries {
            let target = canonical_root.join(&entry.relative_path);
            let current = match read_bounded_utf8(&target) {
                Ok(content) => content,
                Err(_) => {
                    conflicts.push(entry.relative_path.clone());
                    continue;
                }
            };
            if current == entry.after_content {
                continue;
            }
            if current == entry.before_content {
                crate::write_file_regular_no_follow(
                    &target,
                    &canonical_root,
                    entry.after_content.as_bytes(),
                )
                .with_context(|| {
                    format!(
                        "Nao foi possivel concluir a renomeacao de '{}'.",
                        target.display()
                    )
                })?;
            } else {
                // Edicao concorrente: nunca sobrescrever o conteudo do usuario.
                conflicts.push(entry.relative_path.clone());
            }
        }
    } else {
        // Ambiguo (origem e destino presentes, ou ambos ausentes): interferencia
        // externa; nao tocar em nada. O usuario precisa decidir manualmente.
        conflicts.push(source_relative);
    }

    fs::remove_file(&journal_file)?;
    sync_directory(&metadata_directory(&canonical_root))?;
    Ok(conflicts)
}

fn read_bounded_utf8(path: &Path) -> Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("'{}' nao e um arquivo regular seguro.", path.display());
    }
    let bytes = fs::read(path)?;
    String::from_utf8(bytes).context("A nota nao esta codificada como UTF-8.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn journal_test_root() -> TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    fn vault_path(root: &TempDir) -> PathBuf {
        let path = root.path().join("vault");
        fs::create_dir_all(&path).expect("create vault");
        path
    }

    fn note(root: &TempDir, relative: &str, content: &str) -> PathBuf {
        let path = vault_path(root).join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(&path, content).expect("write note");
        path
    }

    #[test]
    fn journal_writes_and_removes_transaction() {
        let root = journal_test_root();
        let vault = vault_path(&root);
        let entries = vec![RenameJournalEntry {
            relative_path: "linking.md".to_string(),
            before_content: "antes [[antigo]]".to_string(),
            after_content: "depois [[novo]]".to_string(),
        }];
        begin_rename_transaction(&vault, true, "antigo.md", "novo.md", &entries).expect("begin");
        assert!(journal_path(&vault).exists());
        complete_rename_transaction(&vault).expect("complete");
        assert!(!journal_path(&vault).exists());
    }

    #[test]
    fn recovery_completes_link_updates_after_interruption() {
        let root = journal_test_root();
        let vault = vault_path(&root);
        let source = note(&root, "nota.md", "# Nota");
        let destination = vault.join("nota-renomeada.md");
        let linking = note(&root, "linking.md", "antes [[nota]]");
        // Simula o crash: o item ja foi movido, mas os links nao foram atualizados.
        fs::rename(&source, &destination).expect("move");
        let entries = vec![RenameJournalEntry {
            relative_path: "linking.md".to_string(),
            before_content: "antes [[nota]]".to_string(),
            after_content: "depois [[nota-renomeada]]".to_string(),
        }];
        begin_rename_transaction(&vault, true, "nota.md", "nota-renomeada.md", &entries)
            .expect("begin");

        let conflicts = recover_pending_rename_transaction(&vault).expect("recover");
        assert!(conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(&linking).expect("read linking"),
            "depois [[nota-renomeada]]"
        );
        assert!(destination.exists());
        assert!(!source.exists());
        assert!(!journal_path(&vault).exists());
    }

    #[test]
    fn recovery_cleans_journal_when_move_never_happened() {
        let root = journal_test_root();
        let vault = vault_path(&root);
        let _source = note(&root, "nota.md", "# Nota");
        let entries = vec![RenameJournalEntry {
            relative_path: "linking.md".to_string(),
            before_content: "antes".to_string(),
            after_content: "depois".to_string(),
        }];
        begin_rename_transaction(&vault, true, "nota.md", "outra.md", &entries).expect("begin");

        let conflicts = recover_pending_rename_transaction(&vault).expect("recover");
        assert!(conflicts.is_empty());
        assert!(vault.join("nota.md").exists());
        assert!(!vault.join("outra.md").exists());
        assert!(!journal_path(&vault).exists());
    }

    #[test]
    fn recovery_never_overwrites_concurrent_edits() {
        let root = journal_test_root();
        let vault = vault_path(&root);
        let source = note(&root, "nota.md", "# Nota");
        let destination = vault.join("nota-renomeada.md");
        let linking = note(&root, "linking.md", "edicao manual do usuario");
        fs::rename(&source, &destination).expect("move");
        let entries = vec![RenameJournalEntry {
            relative_path: "linking.md".to_string(),
            before_content: "antes [[nota]]".to_string(),
            after_content: "depois [[nota-renomeada]]".to_string(),
        }];
        begin_rename_transaction(&vault, true, "nota.md", "nota-renomeada.md", &entries)
            .expect("begin");

        let conflicts = recover_pending_rename_transaction(&vault).expect("recover");
        assert_eq!(conflicts, vec!["linking.md".to_string()]);
        assert_eq!(
            fs::read_to_string(&linking).expect("read linking"),
            "edicao manual do usuario"
        );
        assert!(!journal_path(&vault).exists());
    }

    #[test]
    fn recovery_rejects_journal_escaping_the_vault() {
        let root = journal_test_root();
        let vault = vault_path(&root);
        let metadata_dir = vault.join(METADATA_DIRECTORY);
        fs::create_dir_all(&metadata_dir).expect("metadata");
        let escape = serde_json::json!({
            "transaction_id": "x",
            "is_note": true,
            "source_relative_path": "nota.md",
            "destination_relative_path": "../fora.md",
            "entries": []
        });
        fs::write(
            metadata_dir.join(RENAME_TRANSACTION_FILE),
            serde_json::to_vec(&escape).expect("json"),
        )
        .expect("write journal");
        let error = recover_pending_rename_transaction(&vault).expect_err("must reject");
        assert!(error.to_string().contains("fora do Vault"));
    }
}
