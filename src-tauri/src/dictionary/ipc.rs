//! Comandos IPC do dicionario de conceitos.
//!
//! Tres comandos, porque sao tres acoes distintas do usuario:
//!
//! - `list_dictionary_entries`: le o dicionario do Vault aberto;
//! - `save_dictionary_entry`: registra ou atualiza um verbete;
//! - `remove_dictionary_entry`: apaga um verbete.
//!
//! Todos resolvem a raiz do Vault pelo caminho **autorizado**. Sem isto, um
//! comando que grava em `.mirmind/` receberia um caminho arbitrario da
//! interface e escreveria fora do Vault que o usuario abriu.

use crate::dictionary::{
    load_dictionary, save_dictionary, DictionaryEntry, MAX_CONCEPT_CHARS, MAX_TERM_CHARS,
};
use crate::AuthorizedPaths;
use std::path::{Path, PathBuf};
use tauri::State;

/// O dicionario de um Vault, para a interface montar a pagina.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionarySnapshot {
    /// Os verbetes, ordenados por termo.
    pub entries: Vec<DictionaryEntry>,
}

/// Le o dicionario do Vault aberto.
#[tauri::command]
pub(crate) fn list_dictionary_entries(
    vault_root: String,
    authorized_paths: State<'_, AuthorizedPaths>,
) -> Result<DictionarySnapshot, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    let dictionary = load_dictionary(&root).map_err(|error| error.to_string())?;
    Ok(DictionarySnapshot {
        entries: dictionary.entries,
    })
}

/// Registra ou atualiza um verbete.
///
/// `created_at` e `updated_at` sao decididos **aqui**, e nao pelo
/// chamador: a interface nao tem relogio confiavel, e um timestamp errado
/// nao mudaria o comportamento — mas registraria uma mentira no arquivo.
#[tauri::command]
pub(crate) fn save_dictionary_entry(
    vault_root: String,
    term: String,
    concept: String,
    authorized_paths: State<'_, AuthorizedPaths>,
) -> Result<DictionarySnapshot, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    let mut dictionary = load_dictionary(&root).map_err(|error| error.to_string())?;
    let now = now_unix_ms();
    dictionary
        .upsert(DictionaryEntry {
            term: term.clone(),
            concept: concept.clone(),
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        })
        .map_err(|error| error.to_string())?;
    save_dictionary(&root, &dictionary).map_err(|error| error.to_string())?;
    Ok(DictionarySnapshot {
        entries: dictionary.entries,
    })
}

/// Apaga um verbete pelo termo.
#[tauri::command]
pub(crate) fn remove_dictionary_entry(
    vault_root: String,
    term: String,
    authorized_paths: State<'_, AuthorizedPaths>,
) -> Result<DictionarySnapshot, String> {
    let root = authorized_vault_root(&vault_root, &authorized_paths)?;
    let mut dictionary = load_dictionary(&root).map_err(|error| error.to_string())?;
    dictionary.remove(&term);
    save_dictionary(&root, &dictionary).map_err(|error| error.to_string())?;
    Ok(DictionarySnapshot {
        entries: dictionary.entries,
    })
}

/// Resolve e **autoriza** a raiz do Vault.
///
/// Sem isto, `vault_root` seria um caminho arbitrario vindo da interface: os
/// comandos gravam e leem `.mirmind/` a partir dele, e uma interface
/// comprometida conseguiria escrever fora do Vault autorizado — ou ler o
/// dicionario de um Vault que o usuario nao abriu.
fn authorized_vault_root(
    vault_root: &str,
    authorized_paths: &AuthorizedPaths,
) -> Result<PathBuf, String> {
    let root =
        crate::canonicalize_directory(Path::new(vault_root)).map_err(|error| error.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|error| error.to_string())?;
    Ok(root)
}

/// O agora, em milissegundos desde a epoch.
fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Os limites, expostos para a interface.
///
/// A interface valida antes de enviar, para o usuario ver o erro no campo
/// e nao num alert depois do envio.
#[tauri::command]
pub(crate) fn dictionary_limits() -> DictionaryLimits {
    DictionaryLimits {
        max_term_chars: MAX_TERM_CHARS,
        max_concept_chars: MAX_CONCEPT_CHARS,
    }
}

/// Os limites do dicionario.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryLimits {
    pub max_term_chars: usize,
    pub max_concept_chars: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_snapshot_carries_the_entries() {
        let snapshot = DictionarySnapshot {
            entries: vec![DictionaryEntry {
                term: "rubisco".to_string(),
                concept: "Enzima.".to_string(),
                created_at_unix_ms: 0,
                updated_at_unix_ms: 0,
            }],
        };
        let json = serde_json::to_string(&snapshot).expect("serializa");
        assert!(json.contains("\"entries\""));
        assert!(json.contains("rubisco"));
    }

    #[test]
    fn the_limits_are_the_ones_the_module_declares() {
        let limits = dictionary_limits();
        assert_eq!(limits.max_term_chars, MAX_TERM_CHARS);
        assert_eq!(limits.max_concept_chars, MAX_CONCEPT_CHARS);
    }

    #[test]
    fn the_clock_moves_forward() {
        let first = now_unix_ms();
        assert!(first > 0);
    }
}
