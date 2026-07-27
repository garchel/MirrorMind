use super::contract::{PolicySource, PolicySourceKind, PolicySources, ReviewPolicy};
use super::evaluation::source_hash;
use super::policy::reschedule;
use super::storage::{
    list_learning_storage_keys, load_learning_document, recover_learning_policy_transaction,
    write_learning_documents_with_commit, LearningDocumentUpdate,
};
use super::tag_policy::{
    apply_inherited_review_policy, default_tag_review_rules, resolve_inherited_review_policy,
    InheritedReviewPolicy, TagReviewPolicyRule,
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const SCHEMA_VERSION: u32 = 2;
const MAX_CONFIG_BYTES: u64 = 32 * 1024;
const MAX_POLICY_BATCH_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const METADATA_DIRECTORY: &str = ".mirmind";
const CONFIG_FILE: &str = "review-policy.json";
const DEFAULT_FIRST_REVIEW_INTERVAL_DAYS: u64 = 2;
const DEFAULT_TARGET_RETENTION: f64 = 0.80;
const DEFAULT_PRIORITY_WEIGHT: f64 = 1.0;
const DEFAULT_MIN_INTERVAL_DAYS: u64 = 1;
const DEFAULT_MAX_INTERVAL_DAYS: u64 = 365;
static NEXT_CONFIG_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);
static CONFIG_ACCESS: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultReviewDefaultsInput {
    pub first_review_interval_days: u64,
    pub target_retention: f64,
    pub priority_weight: f64,
    pub min_interval_days: u64,
    pub max_interval_days: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReviewDefaultsPreview {
    pub affected_note_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReviewPolicyConfigView {
    pub revision: u64,
    pub defaults: VaultReviewDefaultsInput,
    pub tag_rules: Vec<TagReviewPolicyRule>,
    pub updated_at_unix_ms: Option<u64>,
    pub affected_note_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredVaultReviewPolicyConfig {
    schema_version: u32,
    revision: u64,
    defaults: VaultReviewDefaultsInput,

    tag_rules: Vec<TagReviewPolicyRule>,

    updated_at_unix_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawStoredVaultReviewPolicyConfig {
    schema_version: u32,
    revision: u64,
    defaults: VaultReviewDefaultsInput,
    #[serde(default)]
    tag_rules: Option<Vec<TagReviewPolicyRule>>,
    updated_at_unix_ms: Option<u64>,
}
impl Default for StoredVaultReviewPolicyConfig {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            defaults: VaultReviewDefaultsInput {
                first_review_interval_days: DEFAULT_FIRST_REVIEW_INTERVAL_DAYS,
                target_retention: DEFAULT_TARGET_RETENTION,
                priority_weight: DEFAULT_PRIORITY_WEIGHT,
                min_interval_days: DEFAULT_MIN_INTERVAL_DAYS,
                max_interval_days: DEFAULT_MAX_INTERVAL_DAYS,
            },
            tag_rules: default_tag_review_rules(),
            updated_at_unix_ms: None,
        }
    }
}

pub fn load_vault_review_policy_config(vault_root: &Path) -> Result<VaultReviewPolicyConfigView> {
    let _guard = CONFIG_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("A configuracao de revisao esta indisponivel."))?;
    let stored = load_config_unlocked(vault_root)?;
    Ok(view_from_stored(&stored, 0))
}

pub fn preview_vault_review_defaults(
    vault_root: &Path,
    defaults: VaultReviewDefaultsInput,
) -> Result<VaultReviewDefaultsPreview> {
    validate_defaults(&defaults)?;
    let mut affected_note_count = 0;
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        if would_change_inherited_defaults(&loaded.document.effective_policy, defaults) {
            affected_note_count += 1;
        }
    }
    Ok(VaultReviewDefaultsPreview {
        affected_note_count,
    })
}

pub fn set_vault_review_defaults(
    vault_root: &Path,
    expected_revision: u64,
    defaults: VaultReviewDefaultsInput,
    now_unix_ms: u64,
) -> Result<VaultReviewPolicyConfigView> {
    validate_defaults(&defaults)?;
    let _guard = CONFIG_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("A configuracao de revisao esta indisponivel."))?;
    let current = load_config_unlocked(vault_root)?;
    if current.revision != expected_revision {
        bail!("A configuracao de revisao foi alterada por outra operacao.");
    }
    let next = StoredVaultReviewPolicyConfig {
        schema_version: SCHEMA_VERSION,
        revision: current.revision.saturating_add(1),
        defaults,
        tag_rules: current.tag_rules,
        updated_at_unix_ms: Some(now_unix_ms),
    };
    let prepared =
        prepare_default_learning_document_updates(vault_root, next.defaults, now_unix_ms)?;
    let next_bytes = serialize_config(&next)?;
    let affected_note_count = write_learning_documents_with_commit(
        vault_root,
        next.revision,
        &next_bytes,
        prepared,
        || publish_config(vault_root, &next_bytes),
    )?;
    Ok(view_from_stored(&next, affected_note_count))
}

pub fn preview_vault_review_tag_rules(
    vault_root: &Path,
    mut tag_rules: Vec<TagReviewPolicyRule>,
    now_unix_ms: u64,
) -> Result<VaultReviewDefaultsPreview> {
    validate_tag_rules(&mut tag_rules)?;
    let _guard = CONFIG_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("A configuracao de revisao esta indisponivel."))?;
    let current = load_config_unlocked(vault_root)?;
    let prepared = prepare_tag_learning_document_updates(
        vault_root,
        current.defaults,
        &tag_rules,
        now_unix_ms,
    )?;
    Ok(VaultReviewDefaultsPreview {
        affected_note_count: prepared.len(),
    })
}
pub fn set_vault_review_tag_rules(
    vault_root: &Path,
    expected_revision: u64,
    mut tag_rules: Vec<TagReviewPolicyRule>,
    now_unix_ms: u64,
) -> Result<VaultReviewPolicyConfigView> {
    validate_tag_rules(&mut tag_rules)?;
    let _guard = CONFIG_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("A configuracao de revisao esta indisponivel."))?;
    let current = load_config_unlocked(vault_root)?;
    if current.revision != expected_revision {
        bail!("A configuracao de revisao foi alterada por outra operacao.");
    }
    let next = StoredVaultReviewPolicyConfig {
        schema_version: SCHEMA_VERSION,
        revision: current.revision.saturating_add(1),
        defaults: current.defaults,
        tag_rules,
        updated_at_unix_ms: Some(now_unix_ms),
    };
    let prepared = prepare_tag_learning_document_updates(
        vault_root,
        next.defaults,
        &next.tag_rules,
        now_unix_ms,
    )?;
    let next_bytes = serialize_config(&next)?;
    let affected_note_count = write_learning_documents_with_commit(
        vault_root,
        next.revision,
        &next_bytes,
        prepared,
        || publish_config(vault_root, &next_bytes),
    )?;
    Ok(view_from_stored(&next, affected_note_count))
}
pub fn load_vault_default_review_policy(vault_root: &Path) -> Result<ReviewPolicy> {
    let config = load_vault_review_policy_config(vault_root)?;
    Ok(review_policy_from_defaults(config.defaults))
}

pub fn load_inherited_review_policy(
    vault_root: &Path,
    markdown: &str,
) -> Result<InheritedReviewPolicy> {
    let _guard = CONFIG_ACCESS
        .lock()
        .map_err(|_| anyhow::anyhow!("A configuracao de revisao esta indisponivel."))?;
    let stored = load_config_unlocked(vault_root)?;
    resolve_inherited_review_policy(
        review_policy_from_defaults(stored.defaults),
        &stored.tag_rules,
        markdown,
    )
}
pub(crate) fn review_policy_from_defaults(defaults: VaultReviewDefaultsInput) -> ReviewPolicy {
    let source = || PolicySource {
        kind: PolicySourceKind::VaultDefault,
        source_id: None,
    };
    ReviewPolicy {
        first_review_interval_days: defaults.first_review_interval_days,
        target_retention: defaults.target_retention,
        priority_weight: defaults.priority_weight,
        min_interval_days: defaults.min_interval_days,
        max_interval_days: defaults.max_interval_days,
        deadline_at_unix_ms: None,
        sources: PolicySources {
            first_review_interval_days: source(),
            target_retention: source(),
            priority_weight: source(),
            min_interval_days: source(),
            max_interval_days: source(),
            deadline_at_unix_ms: None,
            active_deadline: None,
        },
    }
}

fn validate_defaults(defaults: &VaultReviewDefaultsInput) -> Result<()> {
    if defaults.first_review_interval_days == 0 || defaults.first_review_interval_days > 3_650 {
        bail!("O intervalo da primeira revisao deve estar entre 1 e 3650 dias.");
    }
    if !defaults.target_retention.is_finite() || !(0.5..=0.99).contains(&defaults.target_retention)
    {
        bail!("A retencao desejada deve estar entre 50% e 99%.");
    }
    if !defaults.priority_weight.is_finite()
        || defaults.priority_weight <= 0.0
        || defaults.priority_weight > 100.0
    {
        bail!("A prioridade deve ser maior que zero e no maximo 100.");
    }
    if defaults.min_interval_days == 0
        || defaults.min_interval_days > 3_650
        || defaults.max_interval_days < defaults.min_interval_days
        || defaults.max_interval_days > 36_500
    {
        bail!("Os intervalos minimo e maximo sao invalidos.");
    }
    Ok(())
}

fn validate_tag_rules(rules: &mut Vec<TagReviewPolicyRule>) -> Result<()> {
    const MAX_TAG_RULES: usize = 100;
    if rules.len() > MAX_TAG_RULES {
        bail!("A configuracao excede o limite de regras de tag.");
    }
    let mut unique = HashSet::new();
    for rule in rules.iter() {
        let normalized = crate::normalize_tag(&rule.tag)
            .ok_or_else(|| anyhow::anyhow!("Uma regra possui tag invalida."))?;
        if normalized != rule.tag || !unique.insert(rule.tag.as_str()) {
            bail!("As tags das regras devem ser normalizadas e unicas.");
        }
        validate_defaults(&VaultReviewDefaultsInput {
            first_review_interval_days: rule.first_review_interval_days,
            target_retention: rule.target_retention,
            priority_weight: rule.priority_weight,
            min_interval_days: rule.min_interval_days,
            max_interval_days: rule.max_interval_days,
        })?;
    }
    rules.sort_by(|left, right| left.tag.cmp(&right.tag));
    Ok(())
}
fn load_config_unlocked(vault_root: &Path) -> Result<StoredVaultReviewPolicyConfig> {
    recover_learning_policy_transaction(vault_root)?;
    let path = config_path(vault_root);
    let backup = config_backup_path(vault_root);
    if path.exists() {
        match read_stored_config(&path) {
            Ok((stored, needs_migration)) => {
                return migrate_config_if_needed(vault_root, stored, needs_migration);
            }
            Err(primary_error) => {
                let (recovered, needs_migration) = read_stored_config(&backup).with_context(|| {
                    format!(
                        "A configuracao principal e seu backup sao invalidos. Erro principal: {primary_error}"
                    )
                })?;
                restore_config_primary(vault_root, &recovered)?;
                return migrate_config_if_needed(vault_root, recovered, needs_migration);
            }
        }
    }
    if backup.exists() {
        let (recovered, needs_migration) = read_stored_config(&backup)
            .context("A configuracao principal esta ausente e o backup e invalido.")?;
        restore_config_primary(vault_root, &recovered)?;
        return migrate_config_if_needed(vault_root, recovered, needs_migration);
    }
    Ok(StoredVaultReviewPolicyConfig::default())
}

fn read_stored_config(path: &Path) -> Result<(StoredVaultReviewPolicyConfig, bool)> {
    ensure_regular_file(path)?;
    let file = OpenOptions::new().read(true).open(path)?;
    let size = file.metadata()?.len();
    if size > MAX_CONFIG_BYTES {
        bail!("A configuracao de revisao excede o limite seguro.");
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_CONFIG_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        bail!("A configuracao de revisao excede o limite seguro.");
    }
    let raw: RawStoredVaultReviewPolicyConfig =
        serde_json::from_slice(&bytes).context("A configuracao de revisao e invalida.")?;
    if raw.schema_version != 1 && raw.schema_version != SCHEMA_VERSION {
        bail!("A versao da configuracao de revisao nao e suportada.");
    }
    if raw.schema_version == SCHEMA_VERSION && raw.tag_rules.is_none() {
        bail!("A configuracao de revisao nao possui regras de tag.");
    }
    validate_defaults(&raw.defaults)?;
    let needs_migration = raw.schema_version == 1;
    let mut stored = StoredVaultReviewPolicyConfig {
        schema_version: raw.schema_version,
        revision: raw.revision,
        defaults: raw.defaults,
        tag_rules: raw.tag_rules.unwrap_or_else(default_tag_review_rules),
        updated_at_unix_ms: raw.updated_at_unix_ms,
    };
    validate_tag_rules(&mut stored.tag_rules)?;
    Ok((stored, needs_migration))
}

fn migrate_config_if_needed(
    vault_root: &Path,
    mut stored: StoredVaultReviewPolicyConfig,
    needs_migration: bool,
) -> Result<StoredVaultReviewPolicyConfig> {
    if !needs_migration {
        return Ok(stored);
    }
    let now_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("O relogio do sistema e invalido.")?
        .as_millis()
        .try_into()
        .context("A data atual excede o limite suportado.")?;
    stored.schema_version = SCHEMA_VERSION;
    stored.revision = stored.revision.saturating_add(1);
    stored.updated_at_unix_ms = Some(now_unix_ms);
    let prepared = prepare_tag_learning_document_updates(
        vault_root,
        stored.defaults,
        &stored.tag_rules,
        now_unix_ms,
    )?;
    let bytes = serialize_config(&stored)?;
    write_learning_documents_with_commit(vault_root, stored.revision, &bytes, prepared, || {
        publish_config(vault_root, &bytes)
    })?;
    Ok(stored)
}
fn restore_config_primary(vault_root: &Path, config: &StoredVaultReviewPolicyConfig) -> Result<()> {
    let directory = metadata_directory(vault_root)?;
    let target = directory.join(CONFIG_FILE);
    let transaction = NEXT_CONFIG_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    let stage = directory.join(format!(".{CONFIG_FILE}.recovery-{transaction}.tmp"));
    let quarantine = directory.join(format!("{CONFIG_FILE}.corrupt-{transaction}"));
    let bytes = serde_json::to_vec_pretty(config)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    let result = (|| -> Result<()> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        let quarantined = if target.exists() {
            ensure_regular_file(&target)?;
            fs::rename(&target, &quarantine)?;
            true
        } else {
            false
        };
        if let Err(error) = fs::rename(&stage, &target) {
            if quarantined && !target.exists() {
                let _ = fs::rename(&quarantine, &target);
            }
            return Err(error.into());
        }
        sync_directory(&directory)
    })();
    if result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    result.context("Nao foi possivel recuperar a configuracao de revisao.")
}

fn config_backup_path(vault_root: &Path) -> PathBuf {
    vault_root
        .join(METADATA_DIRECTORY)
        .join(format!("{CONFIG_FILE}.bak"))
}
fn serialize_config(config: &StoredVaultReviewPolicyConfig) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec_pretty(config)?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        bail!("A configuracao de revisao excede o limite seguro.");
    }
    Ok(bytes)
}

fn publish_config(vault_root: &Path, bytes: &[u8]) -> Result<()> {
    let directory = metadata_directory(vault_root)?;
    let target = directory.join(CONFIG_FILE);
    ensure_regular_file_if_present(&target)?;
    let transaction = NEXT_CONFIG_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    let stage = directory.join(format!(".{CONFIG_FILE}.{transaction}.tmp"));
    let backup = directory.join(format!("{CONFIG_FILE}.bak"));
    if bytes.is_empty() || bytes.len() as u64 > MAX_CONFIG_BYTES {
        bail!("A configuracao de revisao excede o limite seguro.");
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    if let Err(error) = (|| -> Result<()> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        if target.exists() {
            if backup.exists() {
                ensure_regular_file(&backup)?;
                fs::remove_file(&backup)?;
            }
            fs::rename(&target, &backup)?;
        }
        if let Err(error) = fs::rename(&stage, &target) {
            if !target.exists() && backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(error.into());
        }
        sync_directory(&directory)
    })() {
        let _ = fs::remove_file(&stage);
        return Err(error).context("Nao foi possivel publicar a configuracao de revisao.");
    }
    Ok(())
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

fn metadata_directory(vault_root: &Path) -> Result<PathBuf> {
    let directory = vault_root.join(METADATA_DIRECTORY);
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

fn config_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(CONFIG_FILE)
}

fn ensure_regular_file_if_present(path: &Path) -> Result<()> {
    if path.exists() {
        ensure_regular_file(path)?;
    }
    Ok(())
}

fn ensure_regular_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        bail!("A configuracao de revisao nao e um arquivo regular seguro.");
    }
    Ok(())
}

fn would_change_inherited_defaults(
    policy: &ReviewPolicy,
    defaults: VaultReviewDefaultsInput,
) -> bool {
    (matches!(
        policy.sources.first_review_interval_days.kind,
        PolicySourceKind::VaultDefault
    ) && policy.first_review_interval_days != defaults.first_review_interval_days)
        || (matches!(
            policy.sources.target_retention.kind,
            PolicySourceKind::VaultDefault
        ) && policy.target_retention != defaults.target_retention)
        || (matches!(
            policy.sources.priority_weight.kind,
            PolicySourceKind::VaultDefault
        ) && policy.priority_weight != defaults.priority_weight)
        || (matches!(
            policy.sources.min_interval_days.kind,
            PolicySourceKind::VaultDefault
        ) && policy.min_interval_days != defaults.min_interval_days)
        || (matches!(
            policy.sources.max_interval_days.kind,
            PolicySourceKind::VaultDefault
        ) && policy.max_interval_days != defaults.max_interval_days)
}
fn add_policy_batch_document_bytes(current: usize, additional: usize) -> Result<usize> {
    let total = current
        .checked_add(additional)
        .ok_or_else(|| anyhow::anyhow!("O lote de politicas excede o limite seguro."))?;
    if total > MAX_POLICY_BATCH_DOCUMENT_BYTES {
        bail!("O lote de politicas excede o limite seguro de dados.");
    }
    Ok(total)
}
fn prepare_default_learning_document_updates(
    vault_root: &Path,
    defaults: VaultReviewDefaultsInput,
    now_unix_ms: u64,
) -> Result<Vec<LearningDocumentUpdate>> {
    let mut prepared = Vec::new();
    let mut prepared_bytes = 0usize;
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        let mut changed = false;
        if matches!(
            document
                .effective_policy
                .sources
                .first_review_interval_days
                .kind,
            PolicySourceKind::VaultDefault
        ) && document.effective_policy.first_review_interval_days
            != defaults.first_review_interval_days
        {
            document.effective_policy.first_review_interval_days =
                defaults.first_review_interval_days;
            changed = true;
        }
        if matches!(
            document.effective_policy.sources.target_retention.kind,
            PolicySourceKind::VaultDefault
        ) && document.effective_policy.target_retention != defaults.target_retention
        {
            document.effective_policy.target_retention = defaults.target_retention;
            changed = true;
        }
        if matches!(
            document.effective_policy.sources.priority_weight.kind,
            PolicySourceKind::VaultDefault
        ) && document.effective_policy.priority_weight != defaults.priority_weight
        {
            document.effective_policy.priority_weight = defaults.priority_weight;
            changed = true;
        }
        if matches!(
            document.effective_policy.sources.min_interval_days.kind,
            PolicySourceKind::VaultDefault
        ) && document.effective_policy.min_interval_days != defaults.min_interval_days
        {
            document.effective_policy.min_interval_days = defaults.min_interval_days;
            changed = true;
        }
        if matches!(
            document.effective_policy.sources.max_interval_days.kind,
            PolicySourceKind::VaultDefault
        ) && document.effective_policy.max_interval_days != defaults.max_interval_days
        {
            document.effective_policy.max_interval_days = defaults.max_interval_days;
            changed = true;
        }
        if !changed {
            continue;
        }
        document.effective_policy.validate()?;
        reschedule(&mut document, now_unix_ms)?;
        document.revision = expected_revision.saturating_add(1);
        prepared_bytes =
            add_policy_batch_document_bytes(prepared_bytes, serde_json::to_vec(&document)?.len())?;
        prepared.push(LearningDocumentUpdate {
            storage_key,
            expected_revision,
            document,
        });
    }
    Ok(prepared)
}

fn prepare_tag_learning_document_updates(
    vault_root: &Path,
    defaults: VaultReviewDefaultsInput,
    tag_rules: &[TagReviewPolicyRule],
    now_unix_ms: u64,
) -> Result<Vec<LearningDocumentUpdate>> {
    let canonical_root = vault_root.canonicalize()?;
    let mut prepared = Vec::new();
    let mut prepared_bytes = 0usize;
    for storage_key in list_learning_storage_keys(vault_root)? {
        let Some(loaded) = load_learning_document(vault_root, &storage_key)? else {
            continue;
        };
        let note_path =
            crate::resolve_note_path(&canonical_root, &loaded.document.note.relative_path)?;
        if !note_path.exists() {
            continue;
        }
        let markdown = super::ipc::read_bounded_markdown(&canonical_root, &note_path)?;
        if source_hash(&markdown) != loaded.document.note.content_hash {
            continue;
        }
        let inherited = resolve_inherited_review_policy(
            review_policy_from_defaults(defaults),
            tag_rules,
            &markdown,
        )?;
        let expected_revision = loaded.document.revision;
        let mut document = loaded.document;
        if !apply_inherited_review_policy(&mut document, inherited)? {
            continue;
        }
        reschedule(&mut document, now_unix_ms)?;
        document.revision = expected_revision.saturating_add(1);
        prepared_bytes =
            add_policy_batch_document_bytes(prepared_bytes, serde_json::to_vec(&document)?.len())?;
        prepared.push(LearningDocumentUpdate {
            storage_key,
            expected_revision,
            document,
        });
    }
    Ok(prepared)
}
fn view_from_stored(
    stored: &StoredVaultReviewPolicyConfig,
    affected_note_count: usize,
) -> VaultReviewPolicyConfigView {
    VaultReviewPolicyConfigView {
        revision: stored.revision,
        defaults: stored.defaults,
        tag_rules: stored.tag_rules.clone(),
        updated_at_unix_ms: stored.updated_at_unix_ms,
        affected_note_count,
    }
}
#[cfg(test)]
mod tests {
    use super::{
        config_path, load_vault_review_policy_config, set_vault_review_defaults,
        set_vault_review_tag_rules, VaultReviewDefaultsInput,
    };
    use crate::review::contract::{PolicySourceKind, ReviewMode};
    use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
    use crate::review::policy::{
        set_note_review_policy, NoteReviewPolicyField, NoteReviewPolicyInput,
    };
    use crate::review::state::{
        note_id_for_path, persist_readiness_assessment, set_manual_enrollment,
    };
    use crate::review::storage::load_learning_document;
    use crate::review::tag_policy::TagReviewPolicyRule;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn saving_a_custom_tag_rule_recalculates_and_auto_enrolls_existing_ready_notes() {
        let vault = tempdir().expect("vault");
        let path = "Faculdade/Calculo.md";
        let markdown = "# Calculo #faculdade\n\nDerivadas medem taxas de variacao.\n\nIntegrais acumulam quantidades.\n\nO teorema fundamental relaciona os dois conceitos.";
        fs::create_dir_all(vault.path().join("Faculdade")).expect("create note folder");
        fs::write(vault.path().join(path), markdown).expect("write note");
        let assessed_at = 1_720_000_000_000;
        let initial = persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist initial note");
        assert!(!initial.enrolled);
        set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 2,
                target_retention: 0.95,
                priority_weight: 1.0,
                min_interval_days: 1,
                max_interval_days: 365,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::TargetRetention],
                inherit_fields: Vec::new(),
            },
            assessed_at,
        )
        .expect("override note retention");

        let updated = set_vault_review_tag_rules(
            vault.path(),
            0,
            vec![TagReviewPolicyRule {
                tag: "faculdade".to_string(),
                auto_enroll: true,
                first_review_interval_days: 3,
                target_retention: 0.88,
                priority_weight: 4.0,
                min_interval_days: 1,
                max_interval_days: 120,
            }],
            assessed_at,
        )
        .expect("save custom tag rule");

        assert_eq!(updated.revision, 1);
        assert_eq!(updated.affected_note_count, 1);
        let document = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load updated note")
            .expect("note");
        assert_eq!(
            document.document.note.enrollment.inherited_from_tag_ids,
            vec!["faculdade"]
        );
        assert_eq!(document.document.effective_policy.target_retention, 0.95);
        assert!(matches!(
            document
                .document
                .effective_policy
                .sources
                .target_retention
                .kind,
            PolicySourceKind::Note
        ));
        assert_eq!(document.document.effective_policy.priority_weight, 4.0);
        assert_eq!(
            document.document.scheduling.next_review_at_unix_ms,
            Some(assessed_at + (3 * 86_400_000))
        );
    }

    #[test]
    fn multiple_regular_tags_compose_the_strictest_value_per_field() {
        let vault = tempdir().expect("vault");
        let assessed_at = 1_720_000_000_000;
        set_vault_review_tag_rules(
            vault.path(),
            0,
            vec![
                TagReviewPolicyRule {
                    tag: "curso/a".to_string(),
                    auto_enroll: true,
                    first_review_interval_days: 5,
                    target_retention: 0.9,
                    priority_weight: 2.0,
                    min_interval_days: 2,
                    max_interval_days: 200,
                },
                TagReviewPolicyRule {
                    tag: "curso/b".to_string(),
                    auto_enroll: false,
                    first_review_interval_days: 2,
                    target_retention: 0.8,
                    priority_weight: 5.0,
                    min_interval_days: 1,
                    max_interval_days: 120,
                },
            ],
            assessed_at,
        )
        .expect("save tag rules");
        let path = "Curso/Topico.md";
        let markdown = "# Topico #curso/a #curso/b\n\nO primeiro ponto e avaliavel.\n\nO segundo ponto complementa o primeiro.\n\nO terceiro ponto fecha o contexto.";
        let state = persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist composed note");

        assert!(state.enrolled);
        let document = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load note")
            .expect("note");
        let policy = document.document.effective_policy;
        assert_eq!(policy.first_review_interval_days, 2);
        assert_eq!(policy.target_retention, 0.9);
        assert_eq!(policy.priority_weight, 5.0);
        assert_eq!(policy.min_interval_days, 1);
        assert_eq!(policy.max_interval_days, 120);
        assert_eq!(
            policy.sources.target_retention.source_id.as_deref(),
            Some("curso/a")
        );
        assert_eq!(
            policy.sources.priority_weight.source_id.as_deref(),
            Some("curso/b")
        );
        assert_eq!(
            document.document.note.enrollment.inherited_from_tag_ids,
            vec!["curso/a"]
        );
    }

    #[test]
    fn a_new_learning_document_inherits_the_persisted_vault_defaults() {
        let vault = tempdir().expect("vault");
        set_vault_review_defaults(
            vault.path(),
            0,
            VaultReviewDefaultsInput {
                first_review_interval_days: 5,
                target_retention: 0.9,
                priority_weight: 2.5,
                min_interval_days: 2,
                max_interval_days: 180,
            },
            1_720_000_000_000,
        )
        .expect("save Vault defaults");

        let path = "Biologia/Celulas.md";
        let markdown = "# Celulas\n\nA membrana delimita a celula.\n\nO nucleo armazena DNA.\n\nMitocondrias participam da respiracao.";
        persist_readiness_assessment(
            vault.path(),
            path,
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

        let loaded = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load document")
            .expect("document exists");
        let policy = loaded.document.effective_policy;
        assert_eq!(policy.first_review_interval_days, 5);
        assert_eq!(policy.target_retention, 0.9);
        assert_eq!(policy.priority_weight, 2.5);
        assert_eq!(policy.min_interval_days, 2);
        assert_eq!(policy.max_interval_days, 180);
        assert!(matches!(
            policy.sources.target_retention.kind,
            PolicySourceKind::VaultDefault
        ));
    }
    #[test]
    fn changing_vault_defaults_updates_inherited_fields_without_erasing_note_overrides() {
        let vault = tempdir().expect("vault");
        let path = "Historia/Roma.md";
        let markdown = "# Roma\n\nA republica possuia magistraturas.\n\nO Senado tinha influencia politica.\n\nA expansao alterou a sociedade romana.";
        let assessed_at = 1_720_000_000_000;
        persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");
        set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 2,
                target_retention: 0.95,
                priority_weight: 1.0,
                min_interval_days: 1,
                max_interval_days: 365,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::TargetRetention],
                inherit_fields: Vec::new(),
            },
            assessed_at,
        )
        .expect("override note retention");

        let updated = set_vault_review_defaults(
            vault.path(),
            0,
            VaultReviewDefaultsInput {
                first_review_interval_days: 5,
                target_retention: 0.7,
                priority_weight: 2.5,
                min_interval_days: 2,
                max_interval_days: 180,
            },
            assessed_at,
        )
        .expect("update Vault defaults");

        assert_eq!(updated.affected_note_count, 1);
        let loaded = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load document")
            .expect("document exists");
        let policy = loaded.document.effective_policy;
        assert_eq!(policy.first_review_interval_days, 5);
        assert_eq!(policy.target_retention, 0.95);
        assert_eq!(policy.priority_weight, 2.5);
        assert_eq!(policy.min_interval_days, 2);
        assert_eq!(policy.max_interval_days, 180);
        assert!(matches!(
            policy.sources.target_retention.kind,
            PolicySourceKind::Note
        ));
        assert_eq!(
            loaded.document.scheduling.next_review_at_unix_ms,
            Some(assessed_at + (5 * 86_400_000))
        );
    }
    #[test]
    fn incompatible_vault_defaults_do_not_change_the_config_or_note() {
        let vault = tempdir().expect("vault");
        let path = "Matematica/Limites.md";
        let markdown = "# Limites\n\nUm limite descreve o comportamento de uma funcao.\n\nLimites laterais podem divergir.\n\nA continuidade exige que o limite coincida com o valor.";
        let assessed_at = 1_720_000_000_000;
        persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist readiness");
        set_manual_enrollment(vault.path(), path, markdown, true, assessed_at)
            .expect("enroll note");
        set_note_review_policy(
            vault.path(),
            path,
            markdown,
            NoteReviewPolicyInput {
                first_review_interval_days: 2,
                target_retention: 0.8,
                priority_weight: 1.0,
                min_interval_days: 1,
                max_interval_days: 5,
                preferred_mode: ReviewMode::Exam,
                override_fields: vec![NoteReviewPolicyField::MaxIntervalDays],
                inherit_fields: Vec::new(),
            },
            assessed_at,
        )
        .expect("override maximum interval");
        let note_id = note_id_for_path(path);
        let before_note = load_learning_document(vault.path(), &note_id)
            .expect("load note")
            .expect("note");

        let error = set_vault_review_defaults(
            vault.path(),
            0,
            VaultReviewDefaultsInput {
                first_review_interval_days: 2,
                target_retention: 0.8,
                priority_weight: 1.0,
                min_interval_days: 10,
                max_interval_days: 365,
            },
            assessed_at,
        )
        .expect_err("incompatible composed policy must be rejected");

        assert!(error
            .to_string()
            .contains("politica efetiva de revisao e invalida"));
        assert_eq!(
            load_vault_review_policy_config(vault.path())
                .expect("load config")
                .revision,
            0
        );
        let after_note = load_learning_document(vault.path(), &note_id)
            .expect("reload note")
            .expect("note");
        assert_eq!(after_note.document.revision, before_note.document.revision);
        assert_eq!(after_note.document.effective_policy.max_interval_days, 5);
        assert_eq!(after_note.document.effective_policy.min_interval_days, 1);
    }
    #[test]
    fn a_missing_config_primary_recovers_the_same_revision_as_updated_notes() {
        let vault = tempdir().expect("vault");
        let first = VaultReviewDefaultsInput {
            first_review_interval_days: 3,
            target_retention: 0.85,
            priority_weight: 2.0,
            min_interval_days: 1,
            max_interval_days: 180,
        };
        set_vault_review_defaults(vault.path(), 0, first, 1_720_000_000_000).expect("first config");

        let path = "Fisica/Cinematica.md";
        let markdown = "# Cinematica\n\nVelocidade mede a variacao da posicao.\n\nA aceleracao mede a variacao da velocidade.\n\nO referencial define como o movimento e descrito.";
        persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            1_720_000_050_000,
        )
        .expect("persist readiness");

        let second = VaultReviewDefaultsInput {
            first_review_interval_days: 4,
            target_retention: 0.9,
            priority_weight: 3.0,
            min_interval_days: 2,
            max_interval_days: 120,
        };
        set_vault_review_defaults(vault.path(), 1, second, 1_720_000_100_000)
            .expect("second config");

        fs::remove_file(config_path(vault.path())).expect("simulate missing primary");

        let recovered =
            load_vault_review_policy_config(vault.path()).expect("recover config backup");
        assert_eq!(recovered.revision, 2);
        assert_eq!(recovered.defaults.first_review_interval_days, 4);
        let note = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load note")
            .expect("note");
        assert_eq!(note.document.effective_policy.first_review_interval_days, 4);
        assert_eq!(note.document.effective_policy.target_retention, 0.9);
        assert!(config_path(vault.path()).exists());
    }

    #[test]
    fn loading_a_legacy_config_reconciles_default_tag_rules_atomically() {
        let vault = tempdir().expect("vault");
        let path = "Provas/Biologia.md";
        let markdown = "# Biologia\n\nPonto um.\n\nPonto dois.\n\nPonto tres.\n\n#revisao/prova";
        fs::create_dir_all(vault.path().join("Provas")).expect("create note folder");
        fs::write(vault.path().join(path), markdown).expect("write note");
        let assessed_at = 1_720_000_000_000;
        set_vault_review_tag_rules(vault.path(), 0, Vec::new(), assessed_at)
            .expect("start without tag rules");
        let initial = persist_readiness_assessment(
            vault.path(),
            path,
            markdown,
            &ReadinessReport {
                status: ReadinessStatus::Ready,
                explanation: "Pronta.".to_string(),
                central_idea: None,
                evaluable_points: Vec::new(),
                issues: Vec::new(),
            },
            assessed_at,
        )
        .expect("persist legacy note");
        assert!(!initial.enrolled);
        let legacy = serde_json::json!({
            "schemaVersion": 1,
            "revision": 1,
            "defaults": {
                "firstReviewIntervalDays": 2,
                "targetRetention": 0.8,
                "priorityWeight": 1.0,
                "minIntervalDays": 1,
                "maxIntervalDays": 365
            },
            "updatedAtUnixMs": assessed_at
        });
        fs::write(
            config_path(vault.path()),
            serde_json::to_vec(&legacy).expect("serialize legacy config"),
        )
        .expect("write legacy config");

        let migrated = load_vault_review_policy_config(vault.path()).expect("migrate config");

        assert_eq!(migrated.revision, 2);
        assert_eq!(migrated.tag_rules.len(), 3);
        let document = load_learning_document(vault.path(), &note_id_for_path(path))
            .expect("load migrated note")
            .expect("note");
        assert!(document.document.note.enrollment.is_enrolled());
        assert_eq!(
            document.document.note.enrollment.inherited_from_tag_ids,
            vec!["revisao/prova"]
        );
        let stored: serde_json::Value = serde_json::from_slice(
            &fs::read(config_path(vault.path())).expect("read migrated config"),
        )
        .expect("parse migrated config");
        assert_eq!(stored["schemaVersion"], 2);
    }

    #[test]
    fn policy_batches_reject_aggregate_data_above_the_safe_limit() {
        assert!(
            super::add_policy_batch_document_bytes(super::MAX_POLICY_BATCH_DOCUMENT_BYTES, 1,)
                .is_err()
        );
    }
}
