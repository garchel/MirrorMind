use super::contract::{
    migrate_learning_document, parse_learning_document, LearningDocument,
    MAX_LEARNING_DOCUMENT_BYTES,
};
use super::evaluation::source_hash;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const METADATA_DIRECTORY: &str = ".mirmind";
const LEARNING_DIRECTORY: &str = "learning";
const BACKUP_COUNT: usize = 3;
const POLICY_TRANSACTION_FILE: &str = ".review-policy.transaction.json";
const RELOCATION_TRANSACTION_FILE: &str = ".learning-relocation.transaction.json";
const REVIEW_POLICY_CONFIG_FILE: &str = "review-policy.json";
const MAX_POLICY_TRANSACTION_BYTES: usize = 512 * 1024;
const MAX_RELOCATION_TRANSACTION_BYTES: usize = 2 * 1024 * 1024;
const MAX_RECONCILIATION_NOTE_BYTES: usize = 2 * 1024 * 1024;
static NEXT_STORAGE_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);
static STORAGE_ACCESS: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
pub enum LearningDocumentSource {
    Primary,
    MigratedPrimary,
    Backup(usize),
}

#[derive(Debug)]
pub struct LoadedLearningDocument {
    pub document: LearningDocument,
    pub source: LearningDocumentSource,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyTransactionJournal {
    target_config_revision: u64,
    target_config_hash: String,
    documents: Vec<PolicyTransactionDocument>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyTransactionDocument {
    storage_key: String,
    original_revision: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RelocationTransactionJournal {
    transaction_id: String,
    documents: Vec<RelocationTransactionDocument>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RelocationTransactionDocument {
    storage_key: String,
    original_revision: u64,
    source_relative_path: String,
    target_relative_path: String,
}

pub fn write_learning_document(
    vault_root: &Path,
    storage_key: &str,
    expected_revision: Option<u64>,
    document: &LearningDocument,
) -> Result<()> {
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;
    write_learning_document_unlocked(vault_root, storage_key, expected_revision, document)
}

fn write_learning_document_unlocked(
    vault_root: &Path,
    storage_key: &str,
    expected_revision: Option<u64>,
    document: &LearningDocument,
) -> Result<()> {
    validate_storage_key(storage_key)?;
    ensure_document_matches_key(storage_key, document)?;
    let directory = learning_directory(vault_root)?;
    let target = document_path(&directory, storage_key);
    ensure_regular_file_if_present(&target)?;

    if target.exists() {
        let (current, _) = read_and_migrate(&target)?;
        ensure_document_matches_key(storage_key, &current)?;
        if expected_revision != Some(current.revision)
            || document.revision != current.revision.saturating_add(1)
        {
            bail!("O documento de aprendizado foi alterado por outra operacao.");
        }
    } else if expected_revision.is_some() || document.revision != 1 {
        bail!("Um novo documento de aprendizado deve iniciar na revisao 1.");
    }

    publish_document(&directory, &target, storage_key, document)
}

pub struct LearningDocumentUpdate {
    pub storage_key: String,
    pub expected_revision: u64,
    pub document: LearningDocument,
}

pub fn write_learning_documents_with_commit<F>(
    vault_root: &Path,
    target_config_revision: u64,
    target_config_bytes: &[u8],
    updates: Vec<LearningDocumentUpdate>,
    commit: F,
) -> Result<usize>
where
    F: FnOnce() -> Result<()>,
{
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;
    if target_config_bytes.is_empty() || target_config_bytes.len() > 32 * 1024 {
        bail!("A configuracao alvo da transacao e invalida.");
    }

    let mut originals = Vec::with_capacity(updates.len());
    for update in &updates {
        validate_storage_key(&update.storage_key)?;
        ensure_document_matches_key(&update.storage_key, &update.document)?;
        let serialized = serde_json::to_string(&update.document)?;
        parse_learning_document(&serialized)
            .context("O documento precisa ser valido antes de iniciar a transacao.")?;
        let loaded = load_learning_document_unlocked(vault_root, &update.storage_key)?
            .ok_or_else(|| anyhow::anyhow!("Um documento do lote deixou de existir."))?;
        if loaded.document.revision != update.expected_revision
            || update.document.revision != update.expected_revision.saturating_add(1)
        {
            bail!("Um documento do lote foi alterado por outra operacao.");
        }
        originals.push((update.storage_key.clone(), loaded.document));
    }

    write_policy_transaction_journal_unlocked(
        vault_root,
        target_config_revision,
        target_config_bytes,
        &originals,
    )?;

    let mut written = 0;
    for update in &updates {
        if let Err(error) = write_learning_document_unlocked(
            vault_root,
            &update.storage_key,
            Some(update.expected_revision),
            &update.document,
        ) {
            return Err(rollback_batch_error(vault_root, &originals, written, error));
        }
        written += 1;
    }

    if let Err(error) = commit() {
        let target_hash = sha256_bytes(target_config_bytes);
        if read_matching_policy_config(vault_root, target_config_revision, &target_hash)?.is_some()
        {
            finalize_policy_config_commit_unlocked(vault_root, target_config_bytes).context(
                "A configuracao alvo foi publicada, mas sua recuperacao ainda precisa ser finalizada.",
            )?;
            remove_policy_transaction_journal_unlocked(vault_root)?;
            return Ok(written);
        }
        return Err(rollback_batch_error(vault_root, &originals, written, error));
    }

    finalize_policy_config_commit_unlocked(vault_root, target_config_bytes).context(
        "A configuracao foi publicada, mas sua recuperacao ainda precisa ser finalizada.",
    )?;
    remove_policy_transaction_journal_unlocked(vault_root)?;
    Ok(written)
}
fn rollback_batch_error(
    vault_root: &Path,
    originals: &[(String, LearningDocument)],
    written: usize,
    original_error: anyhow::Error,
) -> anyhow::Error {
    let rollback = (|| -> Result<()> {
        let directory = learning_directory(vault_root)?;
        for (storage_key, document) in originals.iter().take(written).rev() {
            let target = document_path(&directory, storage_key);
            ensure_regular_file_if_present(&target)?;
            publish_document(&directory, &target, storage_key, document)?;
        }
        remove_policy_transaction_journal_from_directory(&directory)?;
        Ok(())
    })();

    match rollback {
        Ok(()) => anyhow::anyhow!(
            "A transacao de politicas foi revertida: {original_error}"
        ),
        Err(rollback_error) => anyhow::anyhow!(
            "A transacao de politicas falhou e a recuperacao tambem falhou. Erro original: {original_error}. Erro de recuperacao: {rollback_error}"
        ),
    }
}
pub const MAX_LEARNING_DOCUMENTS: usize = 2_000;

pub fn list_learning_storage_keys(vault_root: &Path) -> Result<Vec<String>> {
    list_learning_storage_keys_with_limit(vault_root, MAX_LEARNING_DOCUMENTS)
}

fn list_learning_storage_keys_with_limit(
    vault_root: &Path,
    max_documents: usize,
) -> Result<Vec<String>> {
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;
    list_learning_storage_keys_unlocked(vault_root, max_documents)
}

fn list_learning_storage_keys_unlocked(
    vault_root: &Path,
    max_documents: usize,
) -> Result<Vec<String>> {
    let directory = learning_directory(vault_root)?;
    let mut storage_keys = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        ensure_regular_file_if_present(&path)?;
        let Some(storage_key) = path.file_stem().and_then(|stem| stem.to_str()) else {
            bail!("Um documento de aprendizado possui nome invalido.");
        };
        validate_storage_key(storage_key)?;
        storage_keys.push(storage_key.to_string());
        if storage_keys.len() > max_documents {
            bail!(
                "O Vault excede o limite de {} documentos de aprendizado.",
                max_documents
            );
        }
    }
    storage_keys.sort();
    Ok(storage_keys)
}
pub fn load_learning_document(
    vault_root: &Path,
    storage_key: &str,
) -> Result<Option<LoadedLearningDocument>> {
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;
    load_learning_document_unlocked(vault_root, storage_key)
}

pub fn load_learning_document_for_path(
    vault_root: &Path,
    relative_path: &str,
) -> Result<Option<LoadedLearningDocument>> {
    let normalized_path = normalize_learning_relative_path(relative_path)?;
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;
    load_learning_document_for_path_unlocked(vault_root, &normalized_path)
}

fn load_learning_document_for_path_unlocked(
    vault_root: &Path,
    normalized_path: &str,
) -> Result<Option<LoadedLearningDocument>> {
    let mut matched = None;
    for storage_key in list_learning_storage_keys_unlocked(vault_root, MAX_LEARNING_DOCUMENTS)? {
        let Some(loaded) = load_learning_document_unlocked(vault_root, &storage_key)? else {
            continue;
        };
        let stored_path = normalize_learning_relative_path(&loaded.document.note.relative_path)?;
        if !stored_path.eq_ignore_ascii_case(normalized_path) {
            continue;
        }
        if matched.is_some() {
            bail!("Mais de um documento de aprendizado referencia a mesma nota.");
        }
        matched = Some(loaded);
    }
    Ok(matched)
}

pub fn with_relocated_learning_documents<F>(
    vault_root: &Path,
    path_changes: &[(String, String)],
    commit: F,
) -> Result<usize>
where
    F: FnOnce() -> Result<()>,
{
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)?;

    let mut normalized_changes = Vec::with_capacity(path_changes.len());
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    for (source, target) in path_changes {
        let source = normalize_learning_relative_path(source)?;
        let target = normalize_learning_relative_path(target)?;
        let source_key = source.to_ascii_lowercase();
        let target_key = target.to_ascii_lowercase();
        if source_key == target_key || !sources.insert(source_key) || !targets.insert(target_key) {
            bail!("A alteracao de caminhos do aprendizado e ambigua.");
        }
        normalized_changes.push((source, target));
    }

    let mut originals = Vec::new();
    let mut updates = Vec::new();
    for storage_key in list_learning_storage_keys_unlocked(vault_root, MAX_LEARNING_DOCUMENTS)? {
        let Some(loaded) = load_learning_document_unlocked(vault_root, &storage_key)? else {
            continue;
        };
        let stored_path = normalize_learning_relative_path(&loaded.document.note.relative_path)?;
        let relocation = normalized_changes
            .iter()
            .find(|(source, _)| stored_path.eq_ignore_ascii_case(source));
        if relocation.is_none()
            && normalized_changes
                .iter()
                .any(|(_, target)| stored_path.eq_ignore_ascii_case(target))
        {
            bail!("O destino ja possui um documento de aprendizado diferente.");
        }
        let Some((source, target)) = relocation else {
            continue;
        };
        let mut updated = parse_learning_document(&serde_json::to_string(&loaded.document)?)?;
        updated.revision = updated.revision.saturating_add(1);
        updated.note.relative_path = target.clone();
        originals.push((
            storage_key.clone(),
            loaded.document,
            source.clone(),
            target.clone(),
        ));
        updates.push((storage_key, updated));
    }

    if originals.is_empty() {
        commit()?;
        return Ok(0);
    }

    write_relocation_transaction_journal_unlocked(vault_root, &originals)?;
    for ((storage_key, original, _, _), (_, updated)) in originals.iter().zip(&updates) {
        if let Err(error) = write_learning_document_unlocked(
            vault_root,
            storage_key,
            Some(original.revision),
            updated,
        ) {
            return Err(recover_failed_learning_relocation(vault_root, error));
        }
    }

    if let Err(error) = commit() {
        return Err(recover_failed_learning_relocation(vault_root, error));
    }
    recover_relocation_transaction_unlocked(vault_root)?;
    Ok(updates.len())
}

pub fn reconcile_external_learning_paths(
    vault_root: &Path,
    removed_paths: &[String],
    created_paths: &[String],
) -> Result<Vec<(String, String)>> {
    let pairs = external_reconciliation_pairs(vault_root, removed_paths, created_paths)?;
    if pairs.is_empty() {
        return Ok(Vec::new());
    }
    // O arquivo ja foi movido pela ferramenta externa; o commit nao precisa mover nada.
    // O diario transacional apenas conclui a realocacao dos metadados de aprendizado.
    // Os pares (origem, destino) confirmados por hash permitem ao frontend remapear
    // abas, rascunhos e favoritos sem nunca adivinhar identidade.
    with_relocated_learning_documents(vault_root, &pairs, || Ok(()))?;
    Ok(pairs)
}

fn external_reconciliation_pairs(
    vault_root: &Path,
    removed_paths: &[String],
    created_paths: &[String],
) -> Result<Vec<(String, String)>> {
    let mut removed = Vec::with_capacity(removed_paths.len());
    let mut removed_keys = HashSet::new();
    for path in removed_paths {
        let normalized = normalize_learning_relative_path(path)?;
        if removed_keys.insert(normalized.to_ascii_lowercase()) {
            removed.push(normalized);
        }
    }
    let mut created = Vec::with_capacity(created_paths.len());
    let mut created_keys = HashSet::new();
    for path in created_paths {
        let normalized = normalize_learning_relative_path(path)?;
        if created_keys.insert(normalized.to_ascii_lowercase()) {
            created.push(normalized);
        }
    }
    let removed_set: HashSet<String> = removed
        .iter()
        .map(|path| path.to_ascii_lowercase())
        .collect();

    let mut documents = Vec::new();
    for storage_key in list_learning_storage_keys(vault_root)? {
        if let Some(loaded) = load_learning_document(vault_root, &storage_key)? {
            documents.push((storage_key, loaded.document));
        }
    }
    let mut claimed = HashMap::new();
    for (storage_key, document) in &documents {
        if let Ok(stored) = normalize_learning_relative_path(&document.note.relative_path) {
            claimed.insert(stored.to_ascii_lowercase(), storage_key.clone());
        }
    }

    let mut pairs = Vec::new();
    for (storage_key, document) in &documents {
        let stored = normalize_learning_relative_path(&document.note.relative_path)?;
        if !removed_set.contains(&stored.to_ascii_lowercase()) {
            continue;
        }
        // Uma realocacao externa deixa a origem ausente; qualquer outro estado e inseguro.
        match safe_learning_note_exists(vault_root, &stored) {
            Ok(false) => {}
            Ok(true) => continue,
            Err(_) => continue,
        }
        let expected_hash = &document.note.content_hash;
        let mut matches = Vec::new();
        for candidate in &created {
            let Some(markdown) = read_external_note_markdown(vault_root, candidate)? else {
                continue;
            };
            if source_hash(&markdown) == *expected_hash {
                matches.push(candidate.clone());
            }
        }
        // Sem correspondencia ou ambigua: nunca adivinhar identidade.
        if matches.len() != 1 {
            continue;
        }
        let target = matches.remove(0);
        if target.eq_ignore_ascii_case(&stored)
            || claimed
                .get(&target.to_ascii_lowercase())
                .is_some_and(|owner| owner != storage_key)
            || pairs
                .iter()
                .any(|(_, existing): &(String, String)| existing.eq_ignore_ascii_case(&target))
        {
            continue;
        }
        pairs.push((stored, target));
    }
    Ok(pairs)
}

fn read_external_note_markdown(vault_root: &Path, relative_path: &str) -> Result<Option<String>> {
    let path = learning_note_path(vault_root, relative_path)?;
    if !path.exists() {
        return Ok(None);
    }
    ensure_learning_note_inside_vault(vault_root, &path)?;
    let bytes = read_bounded_bytes(&path, MAX_RECONCILIATION_NOTE_BYTES)?;
    match String::from_utf8(bytes) {
        Ok(markdown) => Ok(Some(markdown)),
        Err(_) => Ok(None),
    }
}

fn recover_failed_learning_relocation(
    vault_root: &Path,
    original_error: anyhow::Error,
) -> anyhow::Error {
    match recover_relocation_transaction_unlocked(vault_root) {
        Ok(()) => anyhow::anyhow!("A alteracao do caminho foi reconciliada: {original_error}"),
        Err(recovery_error) => anyhow::anyhow!(
            "A alteracao do caminho falhou e a recuperacao tambem falhou. Erro original: {original_error}. Erro de recuperacao: {recovery_error}"
        ),
    }
}

fn write_relocation_transaction_journal_unlocked(
    vault_root: &Path,
    originals: &[(String, LearningDocument, String, String)],
) -> Result<()> {
    let directory = learning_directory(vault_root)?;
    let journal_path = relocation_transaction_journal_path(&directory);
    ensure_regular_file_if_present(&journal_path)?;
    if journal_path.exists() {
        bail!("Existe uma realocacao de aprendizado pendente.");
    }

    let transaction_id = unique_suffix();
    let snapshot_directory = relocation_snapshot_directory(&directory, &transaction_id);
    fs::create_dir(&snapshot_directory)
        .context("Nao foi possivel criar os snapshots da realocacao.")?;
    let prepare_result = (|| -> Result<()> {
        for (storage_key, document, _, _) in originals {
            validate_storage_key(storage_key)?;
            let target = document_path(&directory, storage_key);
            let (current, _) = read_and_migrate_for_key(&target, storage_key)?;
            if current.revision != document.revision {
                bail!("Um documento mudou antes de iniciar a realocacao.");
            }
            snapshot_learning_file(
                &target,
                &relocation_snapshot_path(&snapshot_directory, storage_key, 0),
            )?;
            for index in 1..=BACKUP_COUNT {
                let backup = backup_path(&target, index);
                if backup.exists() {
                    snapshot_learning_file(
                        &backup,
                        &relocation_snapshot_path(&snapshot_directory, storage_key, index),
                    )?;
                }
            }
        }
        sync_directory(&snapshot_directory)?;

        let journal = RelocationTransactionJournal {
            transaction_id: transaction_id.clone(),
            documents: originals
                .iter()
                .map(
                    |(storage_key, document, source, target)| RelocationTransactionDocument {
                        storage_key: storage_key.clone(),
                        original_revision: document.revision,
                        source_relative_path: source.clone(),
                        target_relative_path: target.clone(),
                    },
                )
                .collect(),
        };
        let bytes = serde_json::to_vec_pretty(&journal)?;
        if bytes.len() > MAX_RELOCATION_TRANSACTION_BYTES {
            bail!("A transacao de realocacao excede o limite seguro.");
        }
        let stage = directory.join(format!(
            "{RELOCATION_TRANSACTION_FILE}.stage-{}",
            unique_suffix()
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
            sync_directory(&directory)
        })();
        if publish_result.is_err() && stage.exists() {
            let _ = fs::remove_file(&stage);
        }
        publish_result
    })();
    if let Err(error) = prepare_result {
        if !journal_path.exists() {
            let _ = remove_relocation_snapshot_directory(&snapshot_directory);
        }
        return Err(error).context("Nao foi possivel iniciar a realocacao do aprendizado.");
    }
    Ok(())
}

fn snapshot_learning_file(source: &Path, snapshot: &Path) -> Result<()> {
    ensure_regular_file_if_present(source)?;
    if !source.exists() {
        bail!("O arquivo necessario para o snapshot nao existe.");
    }
    fs::hard_link(source, snapshot)
        .with_context(|| format!("Nao foi possivel preservar '{}'.", source.display()))
}

fn recover_relocation_transaction_unlocked(vault_root: &Path) -> Result<()> {
    let directory = learning_directory(vault_root)?;
    let journal_path = relocation_transaction_journal_path(&directory);
    if !journal_path.exists() {
        return Ok(());
    }
    ensure_regular_file_if_present(&journal_path)?;
    let bytes = read_bounded_bytes(&journal_path, MAX_RELOCATION_TRANSACTION_BYTES)?;
    let journal: RelocationTransactionJournal = serde_json::from_slice(&bytes)
        .context("O diario da realocacao de aprendizado e invalido.")?;
    validate_relocation_journal(&journal)?;
    let snapshot_directory = relocation_snapshot_directory(&directory, &journal.transaction_id);
    ensure_relocation_snapshot_directory(&directory, &snapshot_directory)?;

    let mut sources_present = 0usize;
    let mut targets_present = 0usize;
    for entry in &journal.documents {
        if safe_learning_note_exists(vault_root, &entry.source_relative_path)? {
            sources_present += 1;
        }
        if safe_learning_note_exists(vault_root, &entry.target_relative_path)? {
            targets_present += 1;
        }
    }

    if sources_present == journal.documents.len()
        && relocation_targets_are_absent_or_matching(vault_root, &journal)?
    {
        remove_matching_relocation_targets(vault_root, &journal)?;
        restore_relocation_snapshots(&directory, &snapshot_directory, &journal)?;
    } else if targets_present == journal.documents.len() && sources_present == 0 {
        for entry in &journal.documents {
            let loaded = load_learning_document_unlocked(vault_root, &entry.storage_key)?
                .ok_or_else(|| anyhow::anyhow!("Um documento realocado nao foi encontrado."))?;
            if loaded.document.revision != entry.original_revision.saturating_add(1)
                || !normalize_learning_relative_path(&loaded.document.note.relative_path)?
                    .eq_ignore_ascii_case(&entry.target_relative_path)
            {
                bail!("Os metadados nao correspondem a realocacao concluida.");
            }
        }
    } else {
        bail!("O estado fisico da realocacao e ambiguo e exige recuperacao manual.");
    }

    fs::remove_file(&journal_path)?;
    sync_directory(&directory)?;
    let _ = remove_relocation_snapshot_directory(&snapshot_directory);
    Ok(())
}

fn relocation_targets_are_absent_or_matching(
    vault_root: &Path,
    journal: &RelocationTransactionJournal,
) -> Result<bool> {
    for entry in &journal.documents {
        let source = learning_note_path(vault_root, &entry.source_relative_path)?;
        let target = learning_note_path(vault_root, &entry.target_relative_path)?;
        ensure_learning_note_inside_vault(vault_root, &source)?;
        if target.exists() {
            ensure_learning_note_inside_vault(vault_root, &target)?;
        }
        if target.exists() && !files_have_same_content(&source, &target)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn remove_matching_relocation_targets(
    vault_root: &Path,
    journal: &RelocationTransactionJournal,
) -> Result<()> {
    let mut synchronized_directories = HashSet::new();
    for entry in &journal.documents {
        let target = learning_note_path(vault_root, &entry.target_relative_path)?;
        if !target.exists() {
            continue;
        }
        ensure_learning_note_inside_vault(vault_root, &target)?;
        fs::remove_file(&target)?;
        if let Some(parent) = target.parent() {
            synchronized_directories.insert(parent.to_path_buf());
        }
    }
    for directory in synchronized_directories {
        sync_directory(&directory)?;
    }
    Ok(())
}

fn files_have_same_content(left: &Path, right: &Path) -> Result<bool> {
    ensure_regular_file_if_present(left)?;
    ensure_regular_file_if_present(right)?;
    let left_metadata = fs::metadata(left)?;
    let right_metadata = fs::metadata(right)?;
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }
    let mut left_file = File::open(left)?;
    let mut right_file = File::open(right)?;
    let mut left_buffer = [0u8; 64 * 1024];
    let mut right_buffer = [0u8; 64 * 1024];
    loop {
        let left_read = left_file.read(&mut left_buffer)?;
        let right_read = right_file.read(&mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn learning_note_path(vault_root: &Path, relative_path: &str) -> Result<PathBuf> {
    let normalized = normalize_learning_relative_path(relative_path)?;
    Ok(vault_root.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

fn ensure_learning_note_inside_vault(vault_root: &Path, path: &Path) -> Result<()> {
    let canonical_root = vault_root
        .canonicalize()
        .context("O Vault da realocacao nao existe.")?;
    let canonical_path = path
        .canonicalize()
        .with_context(|| format!("Nao foi possivel validar '{}'.", path.display()))?;
    if !canonical_path.starts_with(&canonical_root) {
        bail!("Um caminho da realocacao aponta para fora do Vault.");
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Um caminho da realocacao nao e um arquivo regular seguro.");
    }
    Ok(())
}
fn validate_relocation_journal(journal: &RelocationTransactionJournal) -> Result<()> {
    if journal.transaction_id.is_empty()
        || journal.transaction_id.len() > 128
        || !journal
            .transaction_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || journal.documents.is_empty()
        || journal.documents.len() > MAX_LEARNING_DOCUMENTS
    {
        bail!("O diario da realocacao de aprendizado e invalido.");
    }
    let mut keys = HashSet::new();
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    for entry in &journal.documents {
        validate_storage_key(&entry.storage_key)?;
        let source = normalize_learning_relative_path(&entry.source_relative_path)?;
        let target = normalize_learning_relative_path(&entry.target_relative_path)?;
        if entry.original_revision == 0
            || !keys.insert(entry.storage_key.as_str())
            || !sources.insert(source.to_ascii_lowercase())
            || !targets.insert(target.to_ascii_lowercase())
        {
            bail!("O diario da realocacao de aprendizado e invalido.");
        }
    }
    Ok(())
}

fn safe_learning_note_exists(vault_root: &Path, relative_path: &str) -> Result<bool> {
    let path = learning_note_path(vault_root, relative_path)?;
    if !path.exists() {
        return Ok(false);
    }
    ensure_learning_note_inside_vault(vault_root, &path)?;
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Um caminho da realocacao nao e um arquivo regular seguro.");
    }
    Ok(true)
}

fn restore_relocation_snapshots(
    directory: &Path,
    snapshot_directory: &Path,
    journal: &RelocationTransactionJournal,
) -> Result<()> {
    for entry in &journal.documents {
        let target = document_path(directory, &entry.storage_key);
        let primary_snapshot = relocation_snapshot_path(snapshot_directory, &entry.storage_key, 0);
        ensure_regular_file_if_present(&primary_snapshot)?;
        let (original, _) = read_and_migrate_for_key(&primary_snapshot, &entry.storage_key)?;
        if original.revision != entry.original_revision {
            bail!("O snapshot primario possui revisao inesperada.");
        }
        for index in 0..=BACKUP_COUNT {
            let destination = if index == 0 {
                target.clone()
            } else {
                backup_path(&target, index)
            };
            ensure_regular_file_if_present(&destination)?;
            if destination.exists() {
                fs::remove_file(&destination)?;
            }
            let snapshot = relocation_snapshot_path(snapshot_directory, &entry.storage_key, index);
            ensure_regular_file_if_present(&snapshot)?;
            if snapshot.exists() {
                fs::hard_link(&snapshot, &destination)?;
            }
        }
    }
    sync_directory(directory)
}

fn ensure_relocation_snapshot_directory(directory: &Path, snapshot_directory: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(snapshot_directory)
        .context("Os snapshots da realocacao nao foram encontrados.")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("O diretorio de snapshots da realocacao e inseguro.");
    }
    let canonical_directory = directory.canonicalize()?;
    let canonical_snapshot = snapshot_directory.canonicalize()?;
    if !canonical_snapshot.starts_with(&canonical_directory) {
        bail!("Os snapshots da realocacao apontam para fora do armazenamento.");
    }
    Ok(())
}

fn remove_relocation_snapshot_directory(snapshot_directory: &Path) -> Result<()> {
    if !snapshot_directory.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(snapshot_directory)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("O diretorio de snapshots da realocacao e inseguro.");
    }
    for entry in fs::read_dir(snapshot_directory)? {
        let path = entry?.path();
        ensure_regular_file_if_present(&path)?;
        fs::remove_file(path)?;
    }
    fs::remove_dir(snapshot_directory)?;
    Ok(())
}

fn relocation_transaction_journal_path(directory: &Path) -> PathBuf {
    directory.join(RELOCATION_TRANSACTION_FILE)
}

fn relocation_snapshot_directory(directory: &Path, transaction_id: &str) -> PathBuf {
    directory.join(format!(".learning-relocation.snapshots-{transaction_id}"))
}

fn relocation_snapshot_path(snapshot_directory: &Path, storage_key: &str, index: usize) -> PathBuf {
    snapshot_directory.join(format!("{storage_key}.json.slot-{index}"))
}
fn normalize_learning_relative_path(relative_path: &str) -> Result<String> {
    let normalized = relative_path.replace('\\', "/");
    if normalized.is_empty()
        || normalized.len() > 4_096
        || normalized.starts_with('/')
        || !normalized.to_ascii_lowercase().ends_with(".md")
        || normalized
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
        || normalized
            .split('/')
            .next()
            .is_some_and(|segment| segment.eq_ignore_ascii_case(METADATA_DIRECTORY))
    {
        bail!("O caminho relativo do documento de aprendizado e invalido.");
    }
    Ok(normalized)
}
pub fn recover_learning_policy_transaction(vault_root: &Path) -> Result<()> {
    let _guard = STORAGE_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("O armazenamento de aprendizado esta indisponivel."))?;
    recover_storage_transactions_unlocked(vault_root)
}

fn recover_storage_transactions_unlocked(vault_root: &Path) -> Result<()> {
    recover_relocation_transaction_unlocked(vault_root)?;
    recover_policy_transaction_unlocked(vault_root)
}

fn write_policy_transaction_journal_unlocked(
    vault_root: &Path,
    target_config_revision: u64,
    target_config_bytes: &[u8],
    originals: &[(String, LearningDocument)],
) -> Result<()> {
    let directory = learning_directory(vault_root)?;
    let journal = PolicyTransactionJournal {
        target_config_revision,
        target_config_hash: sha256_bytes(target_config_bytes),
        documents: originals
            .iter()
            .map(|(storage_key, document)| PolicyTransactionDocument {
                storage_key: storage_key.clone(),
                original_revision: document.revision,
            })
            .collect(),
    };
    let bytes = serde_json::to_vec_pretty(&journal)?;
    if bytes.len() > MAX_POLICY_TRANSACTION_BYTES {
        bail!("A transacao de politicas excede o limite seguro.");
    }
    let target = policy_transaction_journal_path(&directory);
    ensure_regular_file_if_present(&target)?;
    if target.exists() {
        bail!("Existe uma transacao de politicas pendente.");
    }
    let stage = directory.join(format!(
        "{POLICY_TRANSACTION_FILE}.stage-{}",
        unique_suffix()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    let result = (|| -> Result<()> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&stage, &target)?;
        sync_directory(&directory)
    })();
    if result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    result.context("Nao foi possivel iniciar a transacao de politicas.")
}

fn recover_policy_transaction_unlocked(vault_root: &Path) -> Result<()> {
    let directory = learning_directory(vault_root)?;
    let journal_path = policy_transaction_journal_path(&directory);
    if !journal_path.exists() {
        return Ok(());
    }
    ensure_regular_file_if_present(&journal_path)?;
    let bytes = read_bounded_bytes(&journal_path, MAX_POLICY_TRANSACTION_BYTES)?;
    let journal: PolicyTransactionJournal =
        serde_json::from_slice(&bytes).context("O diario da transacao de politicas e invalido.")?;
    if journal.target_config_revision == 0
        || !is_sha256_hash(&journal.target_config_hash)
        || journal.documents.len() > MAX_LEARNING_DOCUMENTS
    {
        bail!("O diario da transacao de politicas e invalido.");
    }
    let mut unique_keys = HashSet::new();
    for entry in &journal.documents {
        validate_storage_key(&entry.storage_key)?;
        if entry.original_revision == 0 || !unique_keys.insert(entry.storage_key.as_str()) {
            bail!("O diario da transacao de politicas e invalido.");
        }
    }

    if let Some(config_bytes) = read_matching_policy_config(
        vault_root,
        journal.target_config_revision,
        &journal.target_config_hash,
    )? {
        finalize_policy_config_commit_unlocked(vault_root, &config_bytes)?;
        remove_policy_transaction_journal_from_directory(&directory)?;
        return Ok(());
    }

    for entry in journal.documents.iter().rev() {
        let target = document_path(&directory, &entry.storage_key);
        if target.exists() {
            ensure_regular_file_if_present(&target)?;
            let (current, _) = read_and_migrate_for_key(&target, &entry.storage_key)?;
            if current.revision == entry.original_revision {
                continue;
            }
            if current.revision != entry.original_revision.saturating_add(1) {
                bail!("Um documento mudou durante a recuperacao da transacao.");
            }
        }

        let backup = backup_path(&target, 1);
        ensure_regular_file_if_present(&backup)?;
        if !backup.exists() {
            bail!("O backup necessario para recuperar a transacao nao existe.");
        }
        let (original, _) = read_and_migrate_for_key(&backup, &entry.storage_key)?;
        if original.revision != entry.original_revision {
            bail!("O backup da transacao possui revisao inesperada.");
        }
        publish_document(&directory, &target, &entry.storage_key, &original)?;
    }

    remove_policy_transaction_journal_from_directory(&directory)
}

fn read_matching_policy_config(
    vault_root: &Path,
    target_revision: u64,
    target_hash: &str,
) -> Result<Option<Vec<u8>>> {
    let path = vault_root
        .join(METADATA_DIRECTORY)
        .join(REVIEW_POLICY_CONFIG_FILE);
    if !path.exists() {
        return Ok(None);
    }
    ensure_regular_file_if_present(&path)?;
    let bytes = read_bounded_bytes(&path, 32 * 1024)?;
    if sha256_bytes(&bytes) != target_hash {
        return Ok(None);
    }
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if value.get("revision").and_then(serde_json::Value::as_u64) != Some(target_revision) {
        return Ok(None);
    }
    Ok(Some(bytes))
}
fn finalize_policy_config_commit_unlocked(
    vault_root: &Path,
    expected_config_bytes: &[u8],
) -> Result<()> {
    let directory = vault_root.join(METADATA_DIRECTORY);
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            bail!("O diretorio interno de configuracao e inseguro.");
        }
    } else {
        fs::create_dir(&directory)?;
    }
    let target = directory.join(REVIEW_POLICY_CONFIG_FILE);
    ensure_regular_file_if_present(&target)?;
    if !target.exists() {
        bail!("A configuracao publicada nao existe.");
    }
    let published = read_bounded_bytes(&target, 32 * 1024)?;
    if published != expected_config_bytes {
        bail!("A configuracao publicada nao corresponde a transacao.");
    }

    let backup = directory.join(format!("{REVIEW_POLICY_CONFIG_FILE}.bak"));
    ensure_regular_file_if_present(&backup)?;
    let stage = directory.join(format!(
        ".{REVIEW_POLICY_CONFIG_FILE}.backup-stage-{}",
        unique_suffix()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    let result = (|| -> Result<()> {
        file.write_all(&published)?;
        file.sync_all()?;
        drop(file);
        if backup.exists() {
            atomic_replace(&backup, &stage, None)?;
        } else {
            fs::rename(&stage, &backup)?;
        }
        sync_directory(&directory)
    })();
    if result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    result.context("Nao foi possivel sincronizar o backup da configuracao de revisao.")
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

fn is_sha256_hash(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_bounded_bytes(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        bail!("Um arquivo interno excede o limite seguro.");
    }
    Ok(bytes)
}

fn remove_policy_transaction_journal_unlocked(vault_root: &Path) -> Result<()> {
    let directory = learning_directory(vault_root)?;
    remove_policy_transaction_journal_from_directory(&directory)
}

fn remove_policy_transaction_journal_from_directory(directory: &Path) -> Result<()> {
    let journal = policy_transaction_journal_path(directory);
    if journal.exists() {
        ensure_regular_file_if_present(&journal)?;
        fs::remove_file(&journal)?;
        sync_directory(directory)?;
    }
    Ok(())
}

fn policy_transaction_journal_path(directory: &Path) -> PathBuf {
    directory.join(POLICY_TRANSACTION_FILE)
}
fn load_learning_document_unlocked(
    vault_root: &Path,
    storage_key: &str,
) -> Result<Option<LoadedLearningDocument>> {
    validate_storage_key(storage_key)?;
    let directory = learning_directory(vault_root)?;
    let target = document_path(&directory, storage_key);

    if !target.exists() {
        return recover_from_backups(
            &directory,
            &target,
            storage_key,
            anyhow::anyhow!("O documento principal esta ausente."),
        );
    }

    ensure_regular_file_if_present(&target)?;
    match read_and_migrate_for_key(&target, storage_key) {
        Ok((document, false)) => Ok(Some(LoadedLearningDocument {
            document,
            source: LearningDocumentSource::Primary,
        })),
        Ok((document, true)) => {
            publish_document(&directory, &target, storage_key, &document)?;
            Ok(Some(LoadedLearningDocument {
                document,
                source: LearningDocumentSource::MigratedPrimary,
            }))
        }
        Err(primary_error) => {
            let recovered = find_valid_backup(&target, storage_key)?;
            let Some((document, backup_index)) = recovered else {
                return Err(primary_error).context(
                    "O documento principal esta corrompido e nenhum backup valido foi encontrado.",
                );
            };

            let quarantine = quarantine_target(&directory, &target, storage_key)?;
            if let Err(error) = publish_document(&directory, &target, storage_key, &document) {
                if !target.exists() {
                    let _ = fs::rename(&quarantine, &target);
                }
                return Err(error)
                    .context("A recuperacao falhou e o arquivo corrompido foi preservado.");
            }
            Ok(Some(LoadedLearningDocument {
                document,
                source: LearningDocumentSource::Backup(backup_index),
            }))
        }
    }
}

fn recover_from_backups(
    directory: &Path,
    target: &Path,
    storage_key: &str,
    missing_error: anyhow::Error,
) -> Result<Option<LoadedLearningDocument>> {
    let Some((document, backup_index)) = find_valid_backup(target, storage_key)? else {
        return if (1..=BACKUP_COUNT).any(|index| backup_path(target, index).exists()) {
            Err(missing_error).context("Nenhum backup valido foi encontrado.")
        } else {
            Ok(None)
        };
    };
    publish_document(directory, target, storage_key, &document)?;
    Ok(Some(LoadedLearningDocument {
        document,
        source: LearningDocumentSource::Backup(backup_index),
    }))
}

fn find_valid_backup(
    target: &Path,
    storage_key: &str,
) -> Result<Option<(LearningDocument, usize)>> {
    for backup_index in 1..=BACKUP_COUNT {
        let backup = backup_path(target, backup_index);
        if !backup.exists() {
            continue;
        }
        ensure_regular_file_if_present(&backup)?;
        if let Ok((document, _)) = read_and_migrate_for_key(&backup, storage_key) {
            return Ok(Some((document, backup_index)));
        }
    }
    Ok(None)
}

fn publish_document(
    directory: &Path,
    target: &Path,
    storage_key: &str,
    document: &LearningDocument,
) -> Result<()> {
    ensure_document_matches_key(storage_key, document)?;
    let serialized = serde_json::to_vec_pretty(document)?;
    if serialized.len() > MAX_LEARNING_DOCUMENT_BYTES {
        bail!("O documento de aprendizado excede o tamanho maximo.");
    }
    let serialized_text =
        std::str::from_utf8(&serialized).context("O documento serializado nao e UTF-8.")?;
    parse_learning_document(serialized_text)
        .context("O documento precisa ser valido antes de ser persistido.")?;

    let (stage, mut file) = create_stage_file(directory, storage_key)?;
    let publish_result = (|| -> Result<()> {
        file.write_all(&serialized)?;
        file.sync_all()?;
        drop(file);

        if target.exists() {
            rotate_backups(target)?;
            atomic_replace(target, &stage, Some(&backup_path(target, 1)))?;
        } else {
            fs::rename(&stage, target).with_context(|| {
                format!(
                    "Nao foi possivel publicar o documento '{}'.",
                    target.display()
                )
            })?;
        }
        sync_directory(directory)?;
        Ok(())
    })();

    if publish_result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    publish_result
}

fn ensure_document_matches_key(storage_key: &str, document: &LearningDocument) -> Result<()> {
    if document.note.id != storage_key {
        bail!("A chave de armazenamento nao corresponde a identidade da nota.");
    }
    Ok(())
}
fn learning_directory(vault_root: &Path) -> Result<PathBuf> {
    let canonical_root = vault_root
        .canonicalize()
        .with_context(|| "O Vault de aprendizado nao existe.")?;
    if !canonical_root.is_dir() {
        bail!("O caminho do Vault nao e uma pasta.");
    }

    let metadata = canonical_root.join(METADATA_DIRECTORY);
    ensure_directory(&canonical_root, &metadata)?;
    let learning = metadata.join(LEARNING_DIRECTORY);
    ensure_directory(&canonical_root, &learning)?;
    Ok(learning)
}

fn ensure_directory(canonical_root: &Path, path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            bail!("O armazenamento de aprendizado nao e uma pasta segura.");
        }
    } else {
        fs::create_dir(path)
            .with_context(|| format!("Nao foi possivel criar '{}'.", path.display()))?;
    }
    let canonical = path
        .canonicalize()
        .with_context(|| format!("Nao foi possivel validar '{}'.", path.display()))?;
    if !canonical.starts_with(canonical_root) {
        bail!("O armazenamento de aprendizado aponta para fora do Vault.");
    }
    Ok(())
}

fn validate_storage_key(storage_key: &str) -> Result<()> {
    if storage_key.is_empty()
        || storage_key.len() > 128
        || !storage_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        bail!("A chave de armazenamento da nota e invalida.");
    }
    Ok(())
}

fn document_path(directory: &Path, storage_key: &str) -> PathBuf {
    directory.join(format!("{storage_key}.json"))
}

fn backup_path(target: &Path, index: usize) -> PathBuf {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("learning.json");
    target.with_file_name(format!("{file_name}.bak.{index}"))
}

fn unique_suffix() -> String {
    let id = NEXT_STORAGE_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{timestamp}-{id}", std::process::id())
}

fn staged_path(directory: &Path, storage_key: &str) -> PathBuf {
    directory.join(format!(".{storage_key}.json.stage-{}", unique_suffix()))
}

fn create_stage_file(directory: &Path, storage_key: &str) -> Result<(PathBuf, File)> {
    for _ in 0..128 {
        let path = staged_path(directory, storage_key);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).context("Nao foi possivel criar o arquivo temporario.")
            }
        }
    }
    bail!("Nao foi possivel reservar um nome temporario exclusivo.")
}

fn quarantine_target(directory: &Path, target: &Path, storage_key: &str) -> Result<PathBuf> {
    for _ in 0..128 {
        let quarantine = directory.join(format!("{storage_key}.json.corrupt-{}", unique_suffix()));
        match fs::hard_link(target, &quarantine) {
            Ok(()) => {
                if let Err(error) = fs::remove_file(target) {
                    let _ = fs::remove_file(&quarantine);
                    return Err(error).context("Nao foi possivel isolar o arquivo corrompido.");
                }
                return Ok(quarantine);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).context("Nao foi possivel preservar o arquivo corrompido.")
            }
        }
    }
    bail!("Nao foi possivel reservar um nome de quarentena exclusivo.")
}

fn rotate_backups(target: &Path) -> Result<()> {
    let oldest = backup_path(target, BACKUP_COUNT);
    if oldest.exists() {
        ensure_regular_file_if_present(&oldest)?;
        fs::remove_file(&oldest)?;
    }
    for index in (1..BACKUP_COUNT).rev() {
        let current = backup_path(target, index);
        if !current.exists() {
            continue;
        }
        ensure_regular_file_if_present(&current)?;
        fs::rename(&current, backup_path(target, index + 1))?;
    }
    Ok(())
}

fn ensure_regular_file_if_present(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("O arquivo de aprendizado nao e um arquivo regular seguro.");
    }
    Ok(())
}

fn read_bounded(path: &Path) -> Result<String> {
    ensure_regular_file_if_present(path)?;
    let mut file =
        File::open(path).with_context(|| format!("Nao foi possivel ler '{}'.", path.display()))?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take((MAX_LEARNING_DOCUMENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_LEARNING_DOCUMENT_BYTES {
        bail!("O documento de aprendizado excede o tamanho maximo.");
    }
    String::from_utf8(bytes).context("O documento de aprendizado nao e UTF-8.")
}

fn read_and_migrate(path: &Path) -> Result<(LearningDocument, bool)> {
    let input = read_bounded(path)?;
    let version = serde_json::from_str::<serde_json::Value>(&input)
        .ok()
        .and_then(|value| {
            value
                .get("schemaVersion")
                .and_then(serde_json::Value::as_u64)
        });
    let document = migrate_learning_document(&input)?;
    Ok((document, version == Some(0)))
}

fn read_and_migrate_for_key(path: &Path, storage_key: &str) -> Result<(LearningDocument, bool)> {
    let (document, migrated) = read_and_migrate(path)?;
    ensure_document_matches_key(storage_key, &document)?;
    Ok((document, migrated))
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
#[cfg(windows)]
fn atomic_replace(target: &Path, replacement: &Path, backup: Option<&Path>) -> Result<()> {
    crate::replace_file_atomically(target, replacement, backup)
}

#[cfg(not(windows))]
fn atomic_replace(target: &Path, replacement: &Path, backup: Option<&Path>) -> Result<()> {
    if let Some(backup) = backup {
        fs::hard_link(target, backup)?;
    }
    fs::rename(replacement, target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        backup_path, document_path, ensure_learning_note_inside_vault, learning_directory,
        list_learning_storage_keys_with_limit, load_learning_document,
        policy_transaction_journal_path, reconcile_external_learning_paths,
        recover_relocation_transaction_unlocked, relocation_snapshot_directory,
        relocation_transaction_journal_path, source_hash, staged_path,
        with_relocated_learning_documents, write_learning_document,
        write_learning_document_unlocked, write_learning_documents_with_commit,
        write_policy_transaction_journal_unlocked, write_relocation_transaction_journal_unlocked,
        LearningDocumentSource, LearningDocumentUpdate, MAX_LEARNING_DOCUMENT_BYTES,
    };
    use crate::review::contract::{
        migrate_learning_document, parse_learning_document, LearningDocument, ReadinessAssessment,
    };
    use std::fs;
    use tempfile::tempdir;

    const VALID_DOCUMENT: &str = include_str!("../../../tests/fixtures/review-learning-v1.json");
    const LEGACY_DOCUMENT: &str = include_str!("../../../tests/fixtures/review-learning-v0.json");

    fn document() -> LearningDocument {
        parse_learning_document(VALID_DOCUMENT).expect("valid fixture")
    }

    fn clone_document(document: &LearningDocument) -> LearningDocument {
        parse_learning_document(&serde_json::to_string(document).expect("serialize document"))
            .expect("clone document")
    }

    fn document_for_content(markdown: &str) -> LearningDocument {
        let mut stored = document();
        stored.note.content_hash = source_hash(markdown);
        match &mut stored.note.readiness {
            ReadinessAssessment::Ready {
                assessed_content_hash,
                ..
            }
            | ReadinessAssessment::Ambiguous {
                assessed_content_hash,
                ..
            }
            | ReadinessAssessment::Insufficient {
                assessed_content_hash,
                ..
            }
            | ReadinessAssessment::Modified {
                assessed_content_hash,
                ..
            } => *assessed_content_hash = source_hash(markdown),
            ReadinessAssessment::Unassessed { .. } => {}
        }
        stored
    }

    #[test]
    fn a_failed_note_move_restores_the_original_learning_path_and_revision() {
        let vault = tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::write(
            vault.path().join("Biologia/Fotossintese.md"),
            "# Fotossintese",
        )
        .expect("source note");
        write_learning_document(vault.path(), "note-1", None, &document())
            .expect("write learning document");
        let changes = vec![(
            "Biologia/Fotossintese.md".to_string(),
            "Arquivo/Fotossintese.md".to_string(),
        )];

        let error = with_relocated_learning_documents(vault.path(), &changes, || {
            anyhow::bail!("simulated note move failure")
        })
        .expect_err("relocation must roll back");

        assert!(error.to_string().contains("simulated note move failure"));
        let restored = load_learning_document(vault.path(), "note-1")
            .expect("load restored document")
            .expect("restored document");
        assert_eq!(restored.document.revision, 1);
        assert_eq!(
            restored.document.note.relative_path,
            "Biologia/Fotossintese.md"
        );
    }
    #[test]
    fn an_interrupted_relocation_restores_the_exact_backup_chain() {
        let vault = tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::write(
            vault.path().join("Biologia/Fotossintese.md"),
            "# Fotossintese",
        )
        .expect("source note");
        let first = document();
        write_learning_document(vault.path(), "note-1", None, &first)
            .expect("write first revision");
        let mut original = clone_document(&first);
        original.revision = 2;
        write_learning_document(vault.path(), "note-1", Some(1), &original)
            .expect("write original revision");
        let originals = vec![(
            "note-1".to_string(),
            clone_document(&original),
            "Biologia/Fotossintese.md".to_string(),
            "Arquivo/Fotossintese.md".to_string(),
        )];
        write_relocation_transaction_journal_unlocked(vault.path(), &originals)
            .expect("write relocation journal");
        let mut relocated = clone_document(&original);
        relocated.revision = 3;
        relocated.note.relative_path = "Arquivo/Fotossintese.md".to_string();
        write_learning_document_unlocked(vault.path(), "note-1", Some(2), &relocated)
            .expect("publish interrupted relocation");

        recover_relocation_transaction_unlocked(vault.path()).expect("recover relocation");
        let directory = learning_directory(vault.path()).expect("learning directory");
        assert!(!relocation_transaction_journal_path(&directory).exists());
        fs::write(document_path(&directory, "note-1"), b"corrupt")
            .expect("corrupt restored primary");
        let recovered = load_learning_document(vault.path(), "note-1")
            .expect("recover from original backup")
            .expect("recovered document");
        assert_eq!(recovered.document.revision, 1);
        assert_eq!(
            recovered.document.note.relative_path,
            "Biologia/Fotossintese.md"
        );
    }

    #[test]
    fn an_interrupted_relocation_finalizes_when_the_note_reached_the_target() {
        let vault = tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::create_dir_all(vault.path().join("Arquivo")).expect("target folder");
        fs::write(
            vault.path().join("Biologia/Fotossintese.md"),
            "# Fotossintese",
        )
        .expect("source note");
        let original = document();
        write_learning_document(vault.path(), "note-1", None, &original).expect("write original");
        let originals = vec![(
            "note-1".to_string(),
            clone_document(&original),
            "Biologia/Fotossintese.md".to_string(),
            "Arquivo/Fotossintese.md".to_string(),
        )];
        write_relocation_transaction_journal_unlocked(vault.path(), &originals)
            .expect("write relocation journal");
        let mut relocated = original;
        relocated.revision = 2;
        relocated.note.relative_path = "Arquivo/Fotossintese.md".to_string();
        write_learning_document_unlocked(vault.path(), "note-1", Some(1), &relocated)
            .expect("publish relocated metadata");
        fs::rename(
            vault.path().join("Biologia/Fotossintese.md"),
            vault.path().join("Arquivo/Fotossintese.md"),
        )
        .expect("move note");

        recover_relocation_transaction_unlocked(vault.path()).expect("finalize relocation");
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load relocated document")
            .expect("relocated document");
        assert_eq!(loaded.document.revision, 2);
        assert_eq!(
            loaded.document.note.relative_path,
            "Arquivo/Fotossintese.md"
        );
    }
    #[test]
    fn an_interrupted_hard_link_move_rolls_back_to_the_source() {
        let vault = tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::create_dir_all(vault.path().join("Arquivo")).expect("target folder");
        let source = vault.path().join("Biologia/Fotossintese.md");
        let target = vault.path().join("Arquivo/Fotossintese.md");
        fs::write(&source, "# Fotossintese").expect("source note");
        let original = document();
        write_learning_document(vault.path(), "note-1", None, &original).expect("write original");
        let originals = vec![(
            "note-1".to_string(),
            clone_document(&original),
            "Biologia/Fotossintese.md".to_string(),
            "Arquivo/Fotossintese.md".to_string(),
        )];
        write_relocation_transaction_journal_unlocked(vault.path(), &originals)
            .expect("write relocation journal");
        let mut relocated = original;
        relocated.revision = 2;
        relocated.note.relative_path = "Arquivo/Fotossintese.md".to_string();
        write_learning_document_unlocked(vault.path(), "note-1", Some(1), &relocated)
            .expect("publish relocated metadata");
        fs::hard_link(&source, &target).expect("create interrupted hard-link move");

        recover_relocation_transaction_unlocked(vault.path()).expect("recover hard-link move");
        assert!(source.is_file());
        assert!(!target.exists());
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load restored document")
            .expect("restored document");
        assert_eq!(loaded.document.revision, 1);
        assert_eq!(
            loaded.document.note.relative_path,
            "Biologia/Fotossintese.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn relocation_recovery_rejects_an_intermediate_junction_outside_the_vault() {
        let vault = tempdir().expect("vault");
        let outside = tempdir().expect("outside");
        let outside_note = outside.path().join("Fotossintese.md");
        fs::write(&outside_note, "# Fora do Vault").expect("outside note");
        let junction = vault.path().join("Arquivo");
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .expect("create junction");
        assert!(
            output.status.success(),
            "junction creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let error =
            ensure_learning_note_inside_vault(vault.path(), &junction.join("Fotossintese.md"))
                .expect_err("junction outside vault must be rejected");
        assert!(error.to_string().contains("fora do Vault"));
        assert!(outside_note.is_file());
    }
    #[test]
    fn a_learning_document_follows_an_external_rename_with_matching_content() {
        let vault = tempdir().expect("vault");
        let source_path = "Biologia/Fotossintese.md";
        let target_path = "Arquivo/Fotossintese.md";
        let markdown = "# Fotossintese\n\nPonto 1.\n\nPonto 2.";
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");

        fs::remove_file(vault.path().join(source_path)).expect("remove source");
        fs::create_dir_all(vault.path().join("Arquivo")).expect("target folder");
        fs::write(vault.path().join(target_path), markdown).expect("target note");

        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("reconcile external rename");
        assert_eq!(
            reconciled,
            vec![(source_path.to_string(), target_path.to_string())]
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, target_path);
        assert_eq!(loaded.document.note.id, "note-1");
        assert_eq!(loaded.document.revision, 2);
    }

    #[test]
    fn external_reconciliation_never_guesses_identity_when_content_changed() {
        let vault = tempdir().expect("vault");
        let source_path = "Biologia/Fotossintese.md";
        let target_path = "Arquivo/Fotossintese.md";
        let markdown = "# Fotossintese\n\nPonto 1.\n\nPonto 2.";
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");

        fs::remove_file(vault.path().join(source_path)).expect("remove source");
        fs::create_dir_all(vault.path().join("Arquivo")).expect("target folder");
        fs::write(
            vault.path().join(target_path),
            "# Conteudo completamente diferente",
        )
        .expect("target note");

        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("reconcile external rename");
        assert!(
            reconciled.is_empty(),
            "different content must not adopt the identity"
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, source_path);
        assert_eq!(loaded.document.revision, 1);
    }

    #[test]
    fn external_reconciliation_skips_ambiguous_candidates() {
        let vault = tempdir().expect("vault");
        let source_path = "Biologia/Fotossintese.md";
        let markdown = "# Fotossintese\n\nPonto 1.";
        fs::create_dir_all(vault.path().join("Biologia")).expect("source folder");
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");

        fs::remove_file(vault.path().join(source_path)).expect("remove source");
        for folder in ["Arquivo", "Outro"] {
            fs::create_dir_all(vault.path().join(folder)).expect("target folder");
            fs::write(vault.path().join(folder).join("Fotossintese.md"), markdown)
                .expect("duplicate target note");
        }

        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[
                "Arquivo/Fotossintese.md".to_string(),
                "Outro/Fotossintese.md".to_string(),
            ],
        )
        .expect("reconcile external rename");
        assert!(
            reconciled.is_empty(),
            "ambiguous candidates must not be guessed"
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, source_path);
    }

    #[test]
    fn external_reconciliation_is_idempotent() {
        let vault = tempdir().expect("vault");
        let source_path = "aula.md";
        let target_path = "resumo.md";
        let markdown = "# Aula\n\nConteudo.";
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");

        fs::remove_file(vault.path().join(source_path)).expect("remove source");
        fs::write(vault.path().join(target_path), markdown).expect("target note");
        let first = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("first reconciliation");
        let second = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("second reconciliation");
        assert_eq!(
            first,
            vec![(source_path.to_string(), target_path.to_string())]
        );
        assert!(
            second.is_empty(),
            "an already reconciled document must not move again"
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, target_path);
    }

    #[test]
    fn external_reconciliation_skips_a_copy_that_kept_the_source() {
        let vault = tempdir().expect("vault");
        let source_path = "aula.md";
        let target_path = "resumo.md";
        let markdown = "# Aula\n\nConteudo.";
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");
        fs::write(vault.path().join(target_path), markdown).expect("copied note");

        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("reconcile external copy");
        assert!(
            reconciled.is_empty(),
            "a copy with the source present must not move"
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, source_path);
    }

    #[test]
    fn external_reconciliation_ignores_paths_without_documents() {
        let vault = tempdir().expect("vault");
        fs::create_dir_all(vault.path().join("Arquivo")).expect("target folder");
        fs::write(vault.path().join("Arquivo/nova.md"), "# Nova").expect("new note");
        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &["removida.md".to_string()],
            &["Arquivo/nova.md".to_string()],
        )
        .expect("reconcile without documents");
        assert!(reconciled.is_empty());
    }

    #[test]
    fn external_reconciliation_never_overwrites_a_claimed_destination() {
        let vault = tempdir().expect("vault");
        let source_path = "aula.md";
        let target_path = "resumo.md";
        let markdown = "# Aula\n\nConteudo.";
        fs::write(vault.path().join(source_path), markdown).expect("source note");
        let mut stored = document_for_content(markdown);
        stored.note.relative_path = source_path.to_string();
        write_learning_document(vault.path(), "note-1", None, &stored).expect("write document");
        let mut claimed = document_for_content(markdown);
        claimed.note.id = "note-2".to_string();
        claimed.note.relative_path = target_path.to_string();
        write_learning_document(vault.path(), "note-2", None, &claimed)
            .expect("write claimed document");

        fs::remove_file(vault.path().join(source_path)).expect("remove source");
        fs::write(vault.path().join(target_path), markdown).expect("target note");
        let reconciled = reconcile_external_learning_paths(
            vault.path(),
            &[source_path.to_string()],
            &[target_path.to_string()],
        )
        .expect("reconcile external rename");
        assert!(
            reconciled.is_empty(),
            "a claimed destination must never be overwritten"
        );
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load document")
            .expect("document");
        assert_eq!(loaded.document.note.relative_path, source_path);
    }

    #[test]
    fn orphaned_relocation_snapshots_do_not_block_storage() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("write document");
        let directory = learning_directory(vault.path()).expect("learning directory");
        let orphan = relocation_snapshot_directory(&directory, "orphan-1");
        fs::create_dir(&orphan).expect("orphan snapshot directory");
        fs::write(orphan.join("note-1.json.slot-0"), b"orphan").expect("orphan snapshot");

        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load with orphan snapshots")
            .expect("document");
        assert_eq!(loaded.document.revision, 1);
    }
    #[test]
    fn rejects_a_learning_directory_above_the_configured_document_limit() {
        let vault = tempdir().expect("vault");
        let directory = learning_directory(vault.path()).expect("learning directory");
        fs::write(directory.join("note-1.json"), "{}").expect("first fixture");
        fs::write(directory.join("note-2.json"), "{}").expect("second fixture");
        fs::write(directory.join("note-3.json"), "{}").expect("third fixture");

        let error = list_learning_storage_keys_with_limit(vault.path(), 2)
            .expect_err("document count must be bounded");

        assert!(error.to_string().contains("limite de 2 documentos"));
    }

    #[test]
    fn returns_none_for_a_missing_document() {
        let vault = tempdir().expect("vault");
        assert!(load_learning_document(vault.path(), "note-1")
            .expect("missing document")
            .is_none());
    }

    #[test]
    fn writes_and_reads_a_valid_document_atomically() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("write");

        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load")
            .expect("document");
        assert_eq!(loaded.source, LearningDocumentSource::Primary);
        assert_eq!(loaded.document.note.id, "note-1");
    }

    #[test]
    fn a_failed_batch_commit_restores_every_learning_document() {
        let vault = tempdir().expect("vault");
        let first = document();
        let mut second_value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        second_value["note"]["id"] = serde_json::Value::String("note-2".to_string());
        second_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Segunda.md".to_string());
        let second = parse_learning_document(&second_value.to_string()).expect("second document");
        write_learning_document(vault.path(), "note-1", None, &first).expect("first write");
        write_learning_document(vault.path(), "note-2", None, &second).expect("second write");

        let mut first_update_value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        first_update_value["revision"] = serde_json::json!(2);
        first_update_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Primeira atualizada.md".to_string());
        let first_update =
            parse_learning_document(&first_update_value.to_string()).expect("first update");
        let mut second_update_value = second_value;
        second_update_value["revision"] = serde_json::json!(2);
        second_update_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Segunda atualizada.md".to_string());
        let second_update =
            parse_learning_document(&second_update_value.to_string()).expect("second update");

        let error = write_learning_documents_with_commit(
            vault.path(),
            2,
            br#"{"schemaVersion":1,"revision":2}"#,
            vec![
                LearningDocumentUpdate {
                    storage_key: "note-1".to_string(),
                    expected_revision: 1,
                    document: first_update,
                },
                LearningDocumentUpdate {
                    storage_key: "note-2".to_string(),
                    expected_revision: 1,
                    document: second_update,
                },
            ],
            || anyhow::bail!("simulated config failure"),
        )
        .expect_err("batch must roll back");

        assert!(error.to_string().contains("simulated config failure"));
        for storage_key in ["note-1", "note-2"] {
            let loaded = load_learning_document(vault.path(), storage_key)
                .expect("load restored document")
                .expect("restored document");
            assert_eq!(loaded.document.revision, 1);
        }
    }
    #[test]
    fn a_commit_error_after_publishing_the_exact_config_keeps_the_updated_documents() {
        let vault = tempdir().expect("vault");
        let original = document();
        write_learning_document(vault.path(), "note-1", None, &original).expect("initial write");

        let mut update_value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        update_value["revision"] = serde_json::json!(2);
        update_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Publicada.md".to_string());
        let update = parse_learning_document(&update_value.to_string()).expect("update");
        let config_bytes = br#"{"schemaVersion":1,"revision":2}"#;

        let written = write_learning_documents_with_commit(
            vault.path(),
            2,
            config_bytes,
            vec![LearningDocumentUpdate {
                storage_key: "note-1".to_string(),
                expected_revision: 1,
                document: update,
            }],
            || {
                fs::write(
                    vault.path().join(".mirmind").join("review-policy.json"),
                    config_bytes,
                )?;
                anyhow::bail!("simulated error after publication")
            },
        )
        .expect("visible target config completes the transaction");

        assert_eq!(written, 1);
        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load updated document")
            .expect("document");
        assert_eq!(loaded.document.revision, 2);
        assert_eq!(
            fs::read(vault.path().join(".mirmind").join("review-policy.json.bak"))
                .expect("synchronized config backup"),
            config_bytes
        );
    }

    #[test]
    fn a_same_revision_with_different_config_content_rolls_back_an_interrupted_batch() {
        let vault = tempdir().expect("vault");
        let original = document();
        write_learning_document(vault.path(), "note-1", None, &original).expect("initial write");

        let mut update_value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        update_value["revision"] = serde_json::json!(2);
        update_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Interrompida.md".to_string());
        let update = parse_learning_document(&update_value.to_string()).expect("update");

        write_policy_transaction_journal_unlocked(
            vault.path(),
            2,
            br#"{"schemaVersion":1,"revision":2}"#,
            &[("note-1".to_string(), original)],
        )
        .expect("journal");
        write_learning_document_unlocked(vault.path(), "note-1", Some(1), &update)
            .expect("partial write");
        fs::write(
            vault.path().join(".mirmind").join("review-policy.json"),
            br#"{"revision":2}"#,
        )
        .expect("malformed config with matching revision");

        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("recover on load")
            .expect("document");
        assert_eq!(loaded.document.revision, 1);
        assert!(!policy_transaction_journal_path(
            &learning_directory(vault.path()).expect("directory")
        )
        .exists());
    }
    #[test]
    fn rotates_three_backups_without_losing_the_current_document() {
        let vault = tempdir().expect("vault");
        let mut value: serde_json::Value = serde_json::from_str(VALID_DOCUMENT).expect("fixture");

        for revision in 0..5 {
            value["revision"] = serde_json::json!(revision + 1);
            value["note"]["relativePath"] =
                serde_json::Value::String(format!("Notas/Revisao-{revision}.md"));
            let current = parse_learning_document(&value.to_string()).expect("revision");
            write_learning_document(
                vault.path(),
                "note-1",
                (revision > 0).then_some(revision),
                &current,
            )
            .expect("write revision");
        }

        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "note-1");
        assert!(target.exists());
        assert!(backup_path(&target, 1).exists());
        assert!(backup_path(&target, 2).exists());
        assert!(backup_path(&target, 3).exists());
        assert!(!backup_path(&target, 4).exists());
    }

    #[test]
    fn recovers_a_corrupt_primary_from_the_latest_valid_backup() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("first write");

        let mut updated_value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        updated_value["revision"] = serde_json::json!(2);
        updated_value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Atualizada.md".to_string());
        let updated =
            parse_learning_document(&updated_value.to_string()).expect("updated document");
        write_learning_document(vault.path(), "note-1", Some(1), &updated).expect("second write");

        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "note-1");
        fs::write(&target, b"{invalid").expect("corrupt primary");

        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("recovery")
            .expect("document");
        assert_eq!(loaded.source, LearningDocumentSource::Backup(1));
        assert_eq!(
            loaded.document.note.relative_path,
            "Biologia/Fotossintese.md"
        );
        assert!(fs::read_dir(&directory)
            .expect("directory entries")
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
    }

    #[test]
    fn leaves_an_unrecoverable_corrupt_primary_untouched() {
        let vault = tempdir().expect("vault");
        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "note-1");
        fs::write(&target, b"{invalid").expect("corrupt primary");

        assert!(load_learning_document(vault.path(), "note-1").is_err());
        assert_eq!(fs::read(&target).expect("preserved primary"), b"{invalid");
    }

    #[test]
    fn migrates_a_legacy_primary_and_preserves_it_as_a_backup() {
        let vault = tempdir().expect("vault");
        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "legacy-note");
        fs::write(&target, LEGACY_DOCUMENT).expect("legacy primary");

        let loaded = load_learning_document(vault.path(), "legacy-note")
            .expect("migration")
            .expect("document");
        assert_eq!(loaded.source, LearningDocumentSource::MigratedPrimary);
        assert!(backup_path(&target, 1).exists());
        assert!(
            parse_learning_document(&fs::read_to_string(&target).expect("migrated primary"))
                .is_ok()
        );
        assert!(migrate_learning_document(
            &fs::read_to_string(backup_path(&target, 1)).expect("legacy backup")
        )
        .is_ok());
    }

    #[test]
    fn ignores_an_interrupted_stage_file_and_keeps_the_primary() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("write");
        let directory = learning_directory(vault.path()).expect("directory");
        let stage = staged_path(&directory, "note-1");
        fs::write(stage, b"{partial").expect("interrupted stage");

        let loaded = load_learning_document(vault.path(), "note-1")
            .expect("load")
            .expect("document");
        assert_eq!(loaded.source, LearningDocumentSource::Primary);
    }

    #[test]
    fn recovers_from_a_backup_when_the_primary_is_missing() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("first write");

        let mut value: serde_json::Value = serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        value["revision"] = serde_json::json!(2);
        value["note"]["relativePath"] =
            serde_json::Value::String("Biologia/Segunda.md".to_string());
        let second = parse_learning_document(&value.to_string()).expect("second revision");
        write_learning_document(vault.path(), "note-1", Some(1), &second).expect("second write");

        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "note-1");
        fs::remove_file(&target).expect("simulate crash after quarantine");

        let recovered = load_learning_document(vault.path(), "note-1")
            .expect("recover missing primary")
            .expect("recovered document");
        assert_eq!(recovered.source, LearningDocumentSource::Backup(1));
        assert_eq!(recovered.document.revision, 1);
        assert!(target.exists());
    }

    #[test]
    fn binds_every_primary_and_backup_to_its_storage_key() {
        let vault = tempdir().expect("vault");
        assert!(write_learning_document(vault.path(), "other-note", None, &document()).is_err());

        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "other-note");
        fs::write(&target, VALID_DOCUMENT).expect("cross-note primary");
        assert!(load_learning_document(vault.path(), "other-note").is_err());
    }

    #[test]
    fn rejects_a_stale_optimistic_revision() {
        let vault = tempdir().expect("vault");
        write_learning_document(vault.path(), "note-1", None, &document()).expect("first write");

        let mut value: serde_json::Value = serde_json::from_str(VALID_DOCUMENT).expect("fixture");
        value["revision"] = serde_json::json!(2);
        let second = parse_learning_document(&value.to_string()).expect("second revision");

        assert!(write_learning_document(vault.path(), "note-1", Some(0), &second).is_err());
        assert_eq!(
            load_learning_document(vault.path(), "note-1")
                .expect("load")
                .expect("document")
                .document
                .revision,
            1
        );
    }

    #[test]
    fn rejects_unsafe_keys_and_oversized_files() {
        let vault = tempdir().expect("vault");
        assert!(load_learning_document(vault.path(), "../escape").is_err());

        let directory = learning_directory(vault.path()).expect("directory");
        let target = document_path(&directory, "oversized");
        fs::write(&target, vec![b' '; MAX_LEARNING_DOCUMENT_BYTES + 1]).expect("oversized fixture");
        assert!(load_learning_document(vault.path(), "oversized").is_err());
    }
}
