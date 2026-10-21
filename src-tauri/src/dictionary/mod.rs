//! Dicionario de conceitos por Vault.
//!
//! O problema que ele resolve: uma definicao que ja foi escrita em uma nota
//! nao precisa ser reescrita em todas as outras. O usuario registra o
//! conceito uma vez, e passa a ver a definicao ao passar o mouse sobre a
//! palavra, em qualquer nota do Vault.
//!
//! ## Onde fica
//!
//! `.mirmind/dictionary.json`, **por Vault** — o mesmo lugar do
//! `review-calibration.json`. Um dicionario e do Vault: o conceito de
//! "rubisco" na biologia nao e o conceito de "rubisco" na fisica, e um
//! dicionario global seria pior que nenhum.
//!
//! ## Como a palavra e casada
//!
//! A busca ignora **caixa e acentos** ("Glicólise" casa "glicolise"). E a
//! mesma regra do filtro determinstico de `improvements.rs`: sem ela, o
//! usuario teria que registrar a palavra exatamente como ela aparece em cada
//! nota, e o dicionario deixaria de servir para o que existe.
//!
//! A palavra e casada por **palavra inteira**, nunca por substring: o
//! termo "arte" nao pode casar com "partido". Sem essa regra, registrar
//! "os" marcaria metade das frases.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

pub mod ipc;

const METADATA_DIRECTORY: &str = ".mirmind";
const DICTIONARY_FILE: &str = "dictionary.json";

/// O dicionario inteiro cabe num arquivo pequeno. Um arquivo gigante aqui e
/// sinal de que algo escreveu no lugar errado.
const MAX_DICTIONARY_BYTES: u64 = 4 * 1024 * 1024;

/// Quantos verbos o dicionario aceita.
///
/// O limite existe porque o hover roda a cada movimento do mouse sobre uma
/// nota, e um dicionario com 50 mil verbos transformaria o hover em uma
/// busca lenta. Mil verbos ja e mais do que uma pessoa registra a mao.
pub const MAX_ENTRIES: usize = 5_000;

/// Quantos caracteres o conceito aceita.
///
/// Um conceito e uma frase, nao um capitulo. O limite tambem protege o
/// arquivo: mil verbos de 4 KB cada seriam 4 MB.
pub const MAX_CONCEPT_CHARS: usize = 2_000;

/// Quantos caracteres o termo aceita.
pub const MAX_TERM_CHARS: usize = 120;

/// Um termo do dicionario e o conceito registrado para ele.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    /// A palavra, como o usuario escreveu.
    pub term: String,
    /// A definicao que aparece no hover.
    pub concept: String,
    /// Quando o registro foi criado (epoch em milissegundos).
    #[serde(default)]
    pub created_at_unix_ms: i64,
    /// Quando o registro foi alterado pela ultima vez.
    #[serde(default)]
    pub updated_at_unix_ms: i64,
}

impl DictionaryEntry {
    /// A chave de comparacao do termo.
    ///
    /// Ignora caixa e acentos, e e a mesma regra do filtro determinstico de
    /// `improvements.rs`. Um termo e um termo independentemente de como
    /// alguem o escreveu.
    pub fn key(&self) -> String {
        normalize_term(&self.term)
    }
}

/// O dicionario de um Vault.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictionary {
    #[serde(default)]
    pub entries: Vec<DictionaryEntry>,
}

impl Dictionary {
    /// Insere ou substitui um verbete.
    ///
    /// Substitui pelo que casa: registrar "Glicólise" depois de "glicolise"
    /// atualiza o verbete existente, em vez de criar dois que competingem
    /// no hover.
    pub fn upsert(&mut self, entry: DictionaryEntry) -> Result<DictionaryEntry> {
        let key = entry.key();
        if key.is_empty() {
            anyhow::bail!("O termo precisa ter pelo menos uma letra ou numero.");
        }
        if entry.term.trim().is_empty() {
            anyhow::bail!("O termo nao pode ser vazio.");
        }
        if entry.concept.trim().is_empty() {
            anyhow::bail!("O conceito nao pode ser vazio.");
        }
        if entry.term.chars().count() > MAX_TERM_CHARS {
            anyhow::bail!(
                "O termo tem {} caracteres; o limite e {MAX_TERM_CHARS}.",
                entry.term.chars().count()
            );
        }
        if entry.concept.chars().count() > MAX_CONCEPT_CHARS {
            anyhow::bail!(
                "O conceito tem {} caracteres; o limite e {MAX_CONCEPT_CHARS}.",
                entry.concept.chars().count()
            );
        }
        if self.entries.len() >= MAX_ENTRIES && !self.entries.iter().any(|item| item.key() == key) {
            anyhow::bail!("O dicionario ja tem {MAX_ENTRIES} verbetes; o limite e por Vault.");
        }

        let mut stored = entry;
        stored.term = stored.term.trim().to_string();
        stored.concept = stored.concept.trim().to_string();

        match self.entries.iter_mut().find(|item| item.key() == key) {
            Some(existing) => {
                let created_at = existing.created_at_unix_ms;
                existing.concept = stored.concept;
                existing.updated_at_unix_ms = stored.updated_at_unix_ms;
                existing.created_at_unix_ms = created_at;
                Ok(existing.clone())
            }
            None => {
                self.entries.push(stored.clone());
                // Ordenar por termo deixa o arquivo legivel e a pagina
                // estavel entre recargas.
                self.entries
                    .sort_by(|left, right| left.term.cmp(&right.term));
                Ok(stored)
            }
        }
    }

    /// Remove um verbete pelo termo.
    pub fn remove(&mut self, term: &str) -> bool {
        let key = normalize_term(term);
        if key.is_empty() {
            return false;
        }
        let before = self.entries.len();
        self.entries.retain(|entry| entry.key() != key);
        self.entries.len() != before
    }
}

/// Normaliza um termo para comparacao: minusculas, sem acentos, sem
/// pontuacao nas pontas.
///
/// A mesma regra do filtro determinstico de `improvements.rs`, e pelo mesmo
/// motivo: um dicionario que exige digitacao exata nao e um dicionario.
pub fn normalize_term(text: &str) -> String {
    text.trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
        .nfd()
        .filter(|c| !matches!(c, '\u{0300}'..='\u{036f}'))
        .collect()
}

/// O caminho do arquivo do dicionario.
fn dictionary_file_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(DICTIONARY_FILE)
}

/// Le o dicionario do Vault.
///
/// Um arquivo ausente, ilegivel ou corrompido devolve um dicionario vazio
/// em vez de erro: um dicionario quebrado nao pode impedir o usuario de
/// abrir o app. O que estava la antes e responsabilidade do backup.
pub fn load_dictionary(vault_root: &Path) -> Result<Dictionary> {
    let path = dictionary_file_path(vault_root);
    if !path.exists() {
        return Ok(Dictionary::default());
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Ok(Dictionary::default());
    }
    if metadata.len() > MAX_DICTIONARY_BYTES {
        return Ok(Dictionary::default());
    }
    let bytes = fs::read(&path)?;
    Ok(serde_json::from_slice(&bytes).unwrap_or_default())
}

/// Grava o dicionario do Vault.
pub fn save_dictionary(vault_root: &Path, dictionary: &Dictionary) -> Result<()> {
    write_atomic(&dictionary_file_path(vault_root), dictionary)
}

/// Grava um arquivo sem deixar metade escrita.
///
/// A escrita vai para um arquivo temporario e depois e renomeada: uma
/// queda no meio da escrita deixa o arquivo antigo intacto, em vez de um
/// dicionario truncado.
fn write_atomic(path: &Path, dictionary: &Dictionary) -> Result<()> {
    let directory = path
        .parent()
        .context("O dicionario precisa ter um diretorio pai.")?;
    fs::create_dir_all(directory)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("dictionary");
    let temporary = directory.join(format!("{file_name}.tmp"));
    let bytes = serde_json::to_vec_pretty(dictionary)?;
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(term: &str, concept: &str) -> DictionaryEntry {
        DictionaryEntry {
            term: term.to_string(),
            concept: concept.to_string(),
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
        }
    }

    #[test]
    fn a_term_is_found_ignoring_case_and_accents() {
        // A busca acontece no frontend (o hover), mas a **chave** e decideda
        // aqui: as duas pontas precisam usar a mesma regra, senao o hover
        // casa uma palavra e a pagina outra.
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("Glicólise", "Quebra da glicose."))
            .expect("insere");
        let key = dictionary.entries[0].key();
        assert_eq!(key, "glicolise");
        assert_eq!(normalize_term("GLICOLISE"), key);
    }

    #[test]
    fn a_term_that_does_not_exist_is_not_found() {
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("rubisco", "Enzima que fixa carbono."))
            .expect("insere");
        let keys: Vec<String> = dictionary.entries.iter().map(|entry| entry.key()).collect();
        assert_eq!(keys, vec!["rubisco"]);
    }

    #[test]
    fn registering_the_same_term_again_updates_it_instead_of_duplicating() {
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("rubisco", "Primeira definicao."))
            .expect("insere");
        dictionary
            .upsert(entry("RUBISCO", "Segunda definicao."))
            .expect("atualiza");
        assert_eq!(dictionary.entries.len(), 1);
        assert_eq!(dictionary.entries[0].concept, "Segunda definicao.");
    }

    #[test]
    fn removing_a_term_that_is_not_there_changes_nothing() {
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("rubisco", "Enzima."))
            .expect("insere");
        assert!(!dictionary.remove("nao-existe"));
        assert_eq!(dictionary.entries.len(), 1);
    }

    #[test]
    fn removing_a_term_takes_it_out() {
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("rubisco", "Enzima."))
            .expect("insere");
        assert!(dictionary.remove("RUBISCO"));
        assert!(dictionary.entries.is_empty());
    }

    #[test]
    fn an_empty_term_is_refused() {
        let mut dictionary = Dictionary::default();
        assert!(dictionary.upsert(entry("   ", "conceito")).is_err());
        assert!(dictionary.upsert(entry("termo", "   ")).is_err());
        assert!(dictionary.entries.is_empty());
    }

    #[test]
    fn a_term_longer_than_the_limit_is_refused() {
        let mut dictionary = Dictionary::default();
        let long = "a".repeat(MAX_TERM_CHARS + 1);
        assert!(dictionary.upsert(entry(&long, "conceito")).is_err());
    }

    #[test]
    fn a_concept_longer_than_the_limit_is_refused() {
        let mut dictionary = Dictionary::default();
        let long = "a".repeat(MAX_CONCEPT_CHARS + 1);
        assert!(dictionary.upsert(entry("termo", &long)).is_err());
    }

    #[test]
    fn the_entries_are_kept_in_a_stable_order() {
        let mut dictionary = Dictionary::default();
        dictionary.upsert(entry("zeta", "z")).expect("insere");
        dictionary.upsert(entry("alfa", "a")).expect("insere");
        let terms: Vec<&str> = dictionary
            .entries
            .iter()
            .map(|entry| entry.term.as_str())
            .collect();
        assert_eq!(terms, vec!["alfa", "zeta"]);
    }

    #[test]
    fn the_dictionary_survives_a_save_and_load_cycle() {
        let directory =
            std::env::temp_dir().join(format!("dictionary-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let mut dictionary = Dictionary::default();
        dictionary
            .upsert(entry("rubisco", "Enzima que fixa carbono."))
            .expect("insere");
        save_dictionary(&directory, &dictionary).expect("grava");
        let loaded = load_dictionary(&directory).expect("le");
        assert_eq!(loaded, dictionary);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_missing_file_reads_as_an_empty_dictionary() {
        let directory =
            std::env::temp_dir().join(format!("dictionary-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let loaded = load_dictionary(&directory).expect("le");
        assert!(loaded.entries.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_corrupted_file_reads_as_an_empty_dictionary() {
        // Um dicionario quebrado nao pode impedir o app de abrir.
        let directory =
            std::env::temp_dir().join(format!("dictionary-corrupt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let path = directory.join(METADATA_DIRECTORY).join(DICTIONARY_FILE);
        fs::create_dir_all(path.parent().expect("pai")).expect("cria");
        fs::write(&path, b"{isto nao e json").expect("escreve");
        let loaded = load_dictionary(&directory).expect("le");
        assert!(loaded.entries.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn the_normalization_strips_punctuation_and_accents() {
        assert_eq!(normalize_term("  Rubisco.  "), "rubisco");
        assert_eq!(normalize_term("Glicólise"), "glicolise");
        // O espaco interno e preservado: "pH ótimo" e um termo de duas
        // palavras, e o espaco faz parte da chave.
        assert_eq!(normalize_term("pH ótimo"), "ph otimo");
        assert_eq!(normalize_term("---"), "");
    }
}
