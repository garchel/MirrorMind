//! Indice escalavel de wikilinks para renomeacao.
//!
//! Renomear hoje rel e prepara TODA a arvore Markdown para descobrir quais
//! notas referenciam o item movido. Este modulo mantem um indice invertido
//! (chave de link normalizada -> notas que a contem) persistido em
//! `.mirmind/.wikilink-index.json`, permitindo que uma renomeacao leia APENAS
//! as notas candidatas — um superconjunto seguro das notas que a reescrita
//! poderia alterar.
//!
//! Correcao: o indice e tratado como CACHE com validacao. Antes de usar, a
//! varredura confere, por stat (sem ler conteudo), se o conjunto de notas e
//! os fingerprints (tamanho + mtime) coincidem com o indice. Qualquer
//! divergencia (nota editada/criada/removida fora do app) provoca RECONSTRUCAO
//! do indice — nunca uma selecao incompleta de candidatos. O unico residuo
//! aceito e documentado: uma edicao externa com o MESMO tamanho de bytes e o
//! mesmo mtime (granularidade do filesystem) poderia nao invalidar o indice;
//! a selecao continua sendo apenas um filtro, e as notas selecionadas passam
//! pelo mesmo preflight de conteudo de sempre.
//!
//! Limites: notas e links indexados sao limitados (como o indice de tags);
//! acima dos limites o indice e considerado indisponivel e a renomeacao cai
//! para a varredura completa (comportamento anterior).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read as _, Write as _};
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

const METADATA_DIRECTORY: &str = ".mirmind";
const INDEX_FILE: &str = ".wikilink-index.json";
const SCHEMA_VERSION: u32 = 1;
const MAX_INDEX_BYTES: usize = 32 * 1024 * 1024;
const MAX_INDEXED_NOTES: usize = 10_000;
const MAX_INDEXED_LINKS: usize = 200_000;
const MAX_NOTE_READ_BYTES: u64 = 2 * 1024 * 1024;

/// Hooks opcionais da (re)construcao do indice: progresso (notas processadas /
/// total) e cancelamento. Quando ausentes, a reconstrucao roda sem reportar
/// nada e sem possibilidade de abortar (comportamento anterior).
pub struct BuildHooks {
    pub on_progress: Option<Box<dyn Fn(usize, usize) + Send + Sync>>,
    pub should_cancel: Option<Box<dyn Fn() -> bool + Send + Sync>>,
}

impl Default for BuildHooks {
    fn default() -> Self {
        Self {
            on_progress: None,
            should_cancel: None,
        }
    }
}

/// Fingerprint de uma nota para validacao de frescor do cache (sem ler conteudo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteFingerprint {
    pub len: u64,
    pub modified_secs: i64,
    pub modified_nanos: u32,
}

/// Indice invertido: chave de link normalizada -> notas (caminhos relativos).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikilinkIndex {
    schema_version: u32,
    notes: BTreeMap<String, NoteFingerprint>,
    inverted: BTreeMap<String, Vec<String>>,
}

fn metadata_directory(vault_root: &Path) -> std::path::PathBuf {
    vault_root.join(METADATA_DIRECTORY)
}

fn index_path(vault_root: &Path) -> std::path::PathBuf {
    metadata_directory(vault_root).join(INDEX_FILE)
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

/// Normaliza o alvo bruto de um wikilink para uma chave de indice: remove
/// alias (`|`), fragmento (`#`), barras iniciais e `./`, normaliza separadores
/// e remove a extensao `.md` (comparacao insensivel a maiusculas).
pub fn normalize_link_key(raw: &str) -> String {
    let without_alias = raw.split('|').next().unwrap_or(raw);
    let without_fragment = without_alias.split('#').next().unwrap_or(without_alias);
    let trimmed = without_fragment.trim();
    let mut value = trimmed.replace('\\', "/");
    while value.starts_with('/') {
        value = value[1..].to_string();
    }
    // Colapsa segmentos relativos (`.`, `..`, `x/..`) como a resolucao faz:
    // `[[../antiga]]` de uma subpasta resolve para a nota na raiz.
    let mut stack: Vec<&str> = Vec::new();
    for segment in value.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            segment => stack.push(segment),
        }
    }
    let lower = stack.join("/").to_lowercase();
    if lower.ends_with(".md") {
        lower[..lower.len() - 3].to_string()
    } else {
        lower
    }
}

/// Chaves de indice de todas as referencias de uma nota (deduplicadas e sem
/// chaves vazias). Reusa o extrator do backend (ignora fences, HTML, comentarios).
pub fn link_keys(content: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut seen = HashSet::new();
    for target in crate::extract_wiki_link_targets(content) {
        let key = normalize_link_key(&target.path);
        if !key.is_empty() && seen.insert(key.clone()) {
            keys.push(key);
        }
    }
    keys
}

pub fn fingerprint(path: &Path) -> Result<NoteFingerprint> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("Nao foi possivel inspecionar '{}'.", path.display()))?;
    if !metadata.is_file() {
        bail!("'{}' nao e um arquivo regular.", path.display());
    }
    let modified = metadata
        .modified()
        .with_context(|| format!("Nao foi possivel ler o mtime de '{}'.", path.display()))?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(NoteFingerprint {
        len: metadata.len(),
        modified_secs: duration.as_secs() as i64,
        modified_nanos: duration.subsec_nanos(),
    })
}

/// Mapa de fingerprints (stat) para um conjunto de notas relativas.
pub fn fingerprint_map(
    vault_root: &Path,
    note_relative_paths: &[String],
) -> Result<BTreeMap<String, NoteFingerprint>> {
    let mut map = BTreeMap::new();
    for relative in note_relative_paths {
        map.insert(relative.clone(), fingerprint(&vault_root.join(relative))?);
    }
    Ok(map)
}

pub fn load(vault_root: &Path) -> Result<Option<WikilinkIndex>> {
    let path = index_path(vault_root);
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() as usize > MAX_INDEX_BYTES {
        log::warn!("wikilink index exceeds the safe size; ignoring it");
        return Ok(None);
    }
    let bytes = fs::read(&path)?;
    let index: WikilinkIndex =
        serde_json::from_slice(&bytes).context("O indice de wikilinks e invalido.")?;
    if index.schema_version != SCHEMA_VERSION {
        return Ok(None);
    }
    Ok(Some(index))
}

pub fn persist(vault_root: &Path, index: &WikilinkIndex) -> Result<()> {
    let directory = metadata_directory(vault_root);
    fs::create_dir_all(&directory)
        .with_context(|| format!("Nao foi possivel criar '{}'.", directory.display()))?;
    let bytes = serde_json::to_vec_pretty(index)?;
    if bytes.len() > MAX_INDEX_BYTES {
        bail!("O indice de wikilinks excede o limite seguro.");
    }
    let target = index_path(vault_root);
    let stage = directory.join(format!("{INDEX_FILE}.stage-{}", unique_suffix()));
    let publish = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&stage)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&stage, &target)?;
        sync_directory(&directory)
    })();
    if publish.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    publish
}

/// Constrói o indice a partir dos conteudos (caminho relativo, conteudo UTF-8).
/// Retorna `None` quando os limites seguros sao excedidos (o chamador usa a
/// varredura completa como fallback).
pub fn build(vault_root: &Path, notes: &[(String, String)]) -> Result<Option<WikilinkIndex>> {
    let mut index = WikilinkIndex {
        schema_version: SCHEMA_VERSION,
        notes: BTreeMap::new(),
        inverted: BTreeMap::new(),
    };
    let mut total_links = 0_usize;
    for (relative, content) in notes {
        if index.notes.len() >= MAX_INDEXED_NOTES {
            log::warn!("wikilink index disabled: too many notes");
            return Ok(None);
        }
        index
            .notes
            .insert(relative.clone(), fingerprint(&vault_root.join(relative))?);
        for key in link_keys(content) {
            let entry = index.inverted.entry(key).or_default();
            if !entry.contains(relative) {
                entry.push(relative.clone());
            }
            total_links += 1;
            if total_links > MAX_INDEXED_LINKS {
                log::warn!("wikilink index disabled: too many links");
                return Ok(None);
            }
        }
    }
    for entry in index.inverted.values_mut() {
        entry.sort();
    }
    Ok(Some(index))
}

/// Superconjunto seguro das notas cuja reescrita de links poderia mudar com os
/// `path_changes` dados. Uma nota e candidata quando alguma de suas chaves de
/// link (a) e o basename de um caminho alterado ou (b) e sufixo (com fronteira
/// de segmento) de um caminho alterado — cobrindo resolucao exata, relativa ao
/// diretorio da nota e por basename usadas por `resolve_wiki_link_target`.
pub fn candidates(index: &WikilinkIndex, path_changes: &[(String, String)]) -> HashSet<String> {
    let mut full_keys: Vec<String> = Vec::new();
    let mut basenames: HashSet<String> = HashSet::new();
    for (source, target) in path_changes {
        for value in [source, target] {
            let key = normalize_link_key(value);
            if key.is_empty() {
                continue;
            }
            full_keys.push(key.clone());
            if let Some(base) = key.rsplit('/').next() {
                if !base.is_empty() {
                    basenames.insert(base.to_string());
                }
            }
        }
    }
    let mut selected = HashSet::new();
    for (key, notes) in &index.inverted {
        let is_suffix = basenames.contains(key)
            || full_keys
                .iter()
                .any(|full| full == key || full.ends_with(&format!("/{key}")));
        if is_suffix {
            selected.extend(notes.iter().cloned());
        }
    }
    // As notas cujo proprio caminho mudou sempre participam (auto-referencias e
    // referencias relativas dentro de pastas movidas).
    for (source, target) in path_changes {
        selected.insert(source.clone());
        selected.insert(target.clone());
    }
    selected
}

/// Caminhos relativos das notas indexadas (para consultas do chamador sem
/// expor a estrutura interna).
pub fn note_paths(index: &WikilinkIndex) -> impl Iterator<Item = &str> {
    index.notes.keys().map(|path| path.as_str())
}

/// Fingerprints das notas indexadas (para validacao de frescor pelo chamador
/// sem expor a estrutura interna).
pub fn notes_fingerprints(index: &WikilinkIndex) -> &BTreeMap<String, NoteFingerprint> {
    &index.notes
}

/// Remove uma nota do indice (e das listas invertidas).
pub fn remove_note(index: &mut WikilinkIndex, relative_path: &str) {
    index.notes.remove(relative_path);
    let mut empty_keys = Vec::new();
    for (key, notes) in index.inverted.iter_mut() {
        notes.retain(|note| note != relative_path);
        if notes.is_empty() {
            empty_keys.push(key.clone());
        }
    }
    for key in empty_keys {
        index.inverted.remove(&key);
    }
}

/// Atualiza a entrada de uma nota (fingerprint + chaves) apos um salvamento.
pub fn refresh_note(
    index: &mut WikilinkIndex,
    vault_root: &Path,
    relative_path: &str,
    content: &str,
) -> Result<()> {
    remove_note(index, relative_path);
    index.notes.insert(
        relative_path.to_string(),
        fingerprint(&vault_root.join(relative_path))?,
    );
    let mut seen = HashSet::new();
    for key in link_keys(content) {
        if seen.insert(key.clone()) {
            index
                .inverted
                .entry(key)
                .or_default()
                .push(relative_path.to_string());
        }
    }
    Ok(())
}

/// Aplica uma renomeacao ao indice: notas movidas reutilizam as mesmas chaves
/// (o conteudo nao muda), notas atualizadas recebem as novas chaves.
pub fn apply_rename(
    index: &mut WikilinkIndex,
    vault_root: &Path,
    path_changes: &[(String, String)],
    updated: &[(String, String)],
) -> Result<()> {
    let mut moved_keys: HashMap<String, Vec<String>> = HashMap::new();
    for (source, _) in path_changes {
        let keys = index
            .inverted
            .iter()
            .filter_map(|(key, notes)| notes.contains(source).then_some(key.clone()))
            .collect::<Vec<_>>();
        moved_keys.insert(source.clone(), keys);
        remove_note(index, source);
    }
    for (source, target) in path_changes {
        index
            .notes
            .insert(target.clone(), fingerprint(&vault_root.join(target))?);
        for key in moved_keys.get(source).cloned().unwrap_or_default() {
            let entry = index.inverted.entry(key).or_default();
            if !entry.contains(target) {
                entry.push(target.clone());
            }
        }
    }
    for (relative, content) in updated {
        refresh_note(index, vault_root, relative, content)?;
    }
    for entry in index.inverted.values_mut() {
        entry.sort();
    }
    Ok(())
}

/// Carrega o indice para uma renomeacao: valida o frescor por stat (sem ler
/// conteudo) e reconstrói + persiste quando divergente. Retorna `None` quando o
/// indice esta indisponivel (limites) — o chamador usa a varredura completa.
pub fn load_fresh_for_rename(
    vault_root: &Path,
    note_relative_paths: &[String],
) -> Result<Option<WikilinkIndex>> {
    load_fresh_for_rename_with_hooks(vault_root, note_relative_paths, &BuildHooks::default())
}

/// Variante de `load_fresh_for_rename` com progresso e cancelamento da
/// (re)construcao. O cancelamento aborta a reconstrucao e retorna `None` (o
/// chamador usa a varredura completa); o progresso e reportado por lotes
/// (a cada 25 notas e no final) para nao inundar o frontend com eventos.
pub fn load_fresh_for_rename_with_hooks(
    vault_root: &Path,
    note_relative_paths: &[String],
    hooks: &BuildHooks,
) -> Result<Option<WikilinkIndex>> {
    let current = fingerprint_map(vault_root, note_relative_paths)?;
    if let Some(index) = load(vault_root)? {
        if index.notes == current {
            return Ok(Some(index));
        }
        log::debug!("wikilink index stale; rebuilding");
    }
    let total = note_relative_paths.len();
    let mut notes = Vec::with_capacity(total);
    for (processed, relative) in note_relative_paths.iter().enumerate() {
        if let Some(should_cancel) = hooks.should_cancel.as_ref() {
            if should_cancel() {
                log::info!("wikilink index rebuild cancelled; falling back to the full scan");
                return Ok(None);
            }
        }
        if let Some(on_progress) = hooks.on_progress.as_ref() {
            let done = processed + 1;
            if done == total || done % 25 == 0 {
                on_progress(done, total);
            }
        }
        let path = vault_root.join(relative);
        let bytes = read_bounded(&path, MAX_NOTE_READ_BYTES)?;
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => {
                // Uma nota nao UTF-8 impede a indexacao segura: o indice cai
                // para a varredura completa (comportamento anterior).
                log::warn!("wikilink index disabled: note is not UTF-8: {relative}");
                return Ok(None);
            }
        };
        notes.push((relative.clone(), content));
    }
    let Some(index) = build(vault_root, &notes)? else {
        return Ok(None);
    };
    persist(vault_root, &index)?;
    Ok(Some(index))
}

fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        bail!("'{}' nao e um arquivo regular.", path.display());
    }
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(metadata.len().min(max) as usize);
    std::io::Read::by_ref(&mut file)
        .take(max + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        bail!("'{}' excede o limite seguro de leitura.", path.display());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn vault_path(root: &TempDir) -> std::path::PathBuf {
        let path = root.path().join("vault");
        fs::create_dir_all(&path).expect("create vault");
        path
    }

    fn write(vault: &std::path::Path, relative: &str, content: &str) {
        let path = vault.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(&path, content).expect("write");
    }

    #[test]
    fn normalize_key_strips_alias_fragment_extension_and_case() {
        assert_eq!(normalize_link_key("Nota"), "nota");
        assert_eq!(normalize_link_key("Nota.md"), "nota");
        assert_eq!(normalize_link_key("Sub/Nota#secao"), "sub/nota");
        assert_eq!(normalize_link_key("Sub\\Nota|alias"), "sub/nota");
        assert_eq!(normalize_link_key("./Sub/Nota"), "sub/nota");
        assert_eq!(normalize_link_key("/Sub/Nota"), "sub/nota");
        assert_eq!(normalize_link_key("imagem.png"), "imagem.png");
    }

    #[test]
    fn candidates_are_a_safe_superset_of_affected_notes() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        write(&vault, "a.md", "# A\n[[antiga]]\n");
        write(&vault, "b.md", "# B\n[[antiga.md|texto]]\n");
        write(&vault, "c.md", "# C\n[[outra]]\n");
        write(&vault, "d.md", "# D\n[[#secao]]\n");
        write(&vault, "e.md", "# E\n[[antiga#secao]]\n");
        write(&vault, "sub/nota.md", "# Rel\n[[../antiga]]\n");
        write(&vault, "sem-links.md", "# Sem links\n");

        let notes = vec![
            (
                "a.md".to_string(),
                fs::read_to_string(vault.join("a.md")).unwrap(),
            ),
            (
                "b.md".to_string(),
                fs::read_to_string(vault.join("b.md")).unwrap(),
            ),
            (
                "c.md".to_string(),
                fs::read_to_string(vault.join("c.md")).unwrap(),
            ),
            (
                "d.md".to_string(),
                fs::read_to_string(vault.join("d.md")).unwrap(),
            ),
            (
                "e.md".to_string(),
                fs::read_to_string(vault.join("e.md")).unwrap(),
            ),
            (
                "sub/nota.md".to_string(),
                fs::read_to_string(vault.join("sub/nota.md")).unwrap(),
            ),
            (
                "sem-links.md".to_string(),
                fs::read_to_string(vault.join("sem-links.md")).unwrap(),
            ),
        ];
        let index = build(&vault, &notes).expect("build").expect("index");
        let selected = candidates(&index, &[("antiga.md".to_string(), "nova.md".to_string())]);
        assert!(selected.contains("a.md"));
        assert!(selected.contains("b.md"));
        assert!(
            selected.contains("e.md"),
            "fragment on the renamed note must match"
        );
        assert!(
            selected.contains("sub/nota.md"),
            "relative ../ link must match"
        );
        assert!(selected.contains("antiga.md"));
        assert!(selected.contains("nova.md"));
        assert!(
            !selected.contains("c.md"),
            "unrelated note must not be selected"
        );
        assert!(
            !selected.contains("d.md"),
            "fragment-only link must not match"
        );
        assert!(!selected.contains("sem-links.md"));
    }

    #[test]
    fn folder_move_selects_notes_linking_by_basename_or_relative_path() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        write(&vault, "projetos/antiga.md", "# Antiga\n");
        write(&vault, "x.md", "# X\n[[antiga]]\n");
        write(&vault, "y.md", "# Y\n[[projetos/antiga]]\n");
        let notes = vec![
            ("projetos/antiga.md".to_string(), "# Antiga".to_string()),
            ("x.md".to_string(), "# X\n[[antiga]]".to_string()),
            ("y.md".to_string(), "# Y\n[[projetos/antiga]]".to_string()),
        ];
        let index = build(&vault, &notes).expect("build").expect("index");
        let changes = vec![(
            "projetos/antiga.md".to_string(),
            "arquivo/antiga.md".to_string(),
        )];
        let selected = candidates(&index, &changes);
        assert!(selected.contains("x.md"));
        assert!(selected.contains("y.md"));
    }

    #[test]
    fn stale_index_is_rebuilt_on_rename_load() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        write(&vault, "a.md", "# A\n[[alvo]]\n");
        write(&vault, "alvo.md", "# Alvo\n");
        let rel = vec!["a.md".to_string(), "alvo.md".to_string()];

        let fresh = load_fresh_for_rename(&vault, &rel)
            .expect("load")
            .expect("index");
        assert!(fresh.notes.len() == 2);
        assert!(
            candidates(&fresh, &[("alvo.md".to_string(), "novo.md".to_string())]).contains("a.md")
        );

        // Edicao externa: conteudo muda mas o tamanho continua igual.
        write(&vault, "a.md", "# A2\n[[alvo2]]\n");
        let reloaded = load_fresh_for_rename(&vault, &rel)
            .expect("load")
            .expect("index");
        let selected = candidates(&reloaded, &[("alvo.md".to_string(), "novo.md".to_string())]);
        assert!(
            !selected.contains("a.md"),
            "stale link must be gone after rebuild"
        );
    }

    #[test]
    fn apply_rename_keeps_index_fresh_for_consecutive_renames() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        write(&vault, "a.md", "# A\n[[antiga]]\n");
        write(&vault, "antiga.md", "# Antiga\n");
        let rel = vec!["a.md".to_string(), "antiga.md".to_string()];
        let mut index = load_fresh_for_rename(&vault, &rel)
            .expect("load")
            .expect("index");

        // Simula o movimento concluido (o arquivo ja esta no destino) e a
        // atualizacao de links aplicada, como faz a renomeacao real.
        fs::rename(vault.join("antiga.md"), vault.join("nova.md")).expect("move");
        let changes = vec![("antiga.md".to_string(), "nova.md".to_string())];
        let updated = vec![("a.md".to_string(), "# A\n[[nova]]\n".to_string())];
        write(&vault, "a.md", "# A\n[[nova]]\n");
        apply_rename(&mut index, &vault, &changes, &updated).expect("apply");
        persist(&vault, &index).expect("persist");

        // Apos a renomeacao o conjunto de notas mudou (antiga.md -> nova.md).
        let rel_after = vec!["a.md".to_string(), "nova.md".to_string()];
        let reloaded = load_fresh_for_rename(&vault, &rel_after)
            .expect("load")
            .expect("index");
        let selected = candidates(
            &reloaded,
            &[("nova.md".to_string(), "final.md".to_string())],
        );
        assert!(selected.contains("a.md"));
    }

    #[test]
    fn cancelled_rebuild_returns_none_without_persisting() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        write(&vault, "a.md", "# A\n[[alvo]]\n");
        write(&vault, "alvo.md", "# Alvo\n");
        let rel = vec!["a.md".to_string(), "alvo.md".to_string()];

        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let cancelled_flag = cancelled.clone();
        let hooks = BuildHooks {
            on_progress: None,
            should_cancel: Some(Box::new(move || {
                cancelled_flag.load(std::sync::atomic::Ordering::Acquire)
            })),
        };
        let index = load_fresh_for_rename_with_hooks(&vault, &rel, &hooks).expect("load");
        assert!(index.is_none(), "cancelled rebuild must be unavailable");
        assert!(
            !index_path(&vault).exists(),
            "partial build must not be persisted"
        );

        // Sem cancelamento, a reconstrucao conclui e persiste.
        cancelled.store(false, std::sync::atomic::Ordering::Release);
        let index = load_fresh_for_rename_with_hooks(&vault, &rel, &hooks)
            .expect("load")
            .expect("index");
        assert_eq!(index.notes.len(), 2);
        assert!(index_path(&vault).exists());
    }

    #[test]
    fn rebuild_reports_progress_in_batches() {
        let root = TempDir::new().expect("temp");
        let vault = vault_path(&root);
        for index in 0..60 {
            write(
                &vault,
                &format!("nota-{index:03}.md"),
                &format!("# Nota {index}\n[[alvo]]\n"),
            );
        }
        write(&vault, "alvo.md", "# Alvo\n");
        let rel = (0..60)
            .map(|index| format!("nota-{index:03}.md"))
            .chain(std::iter::once("alvo.md".to_string()))
            .collect::<Vec<_>>();

        let reports = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let reports_capture = reports.clone();
        let hooks = BuildHooks {
            on_progress: Some(Box::new(move |processed, total| {
                reports_capture
                    .lock()
                    .expect("reports")
                    .push((processed, total));
            })),
            should_cancel: None,
        };
        let index = load_fresh_for_rename_with_hooks(&vault, &rel, &hooks)
            .expect("load")
            .expect("index");
        assert_eq!(index.notes.len(), 61);
        let reports = reports.lock().expect("reports");
        assert!(
            reports.last() == Some(&(61, 61)),
            "final progress must be reported"
        );
        assert!(
            reports
                .iter()
                .all(|(processed, total)| *processed <= *total && *total == 61),
            "progress must stay within bounds"
        );
        assert!(reports.len() < 61, "progress must be batched, not per note");
    }
}
