//! Sidecar de comparacao: o que o lado **inativo** do modo `Dual` produziu.
//!
//! ## A regra dura
//!
//! Em `Dual`, **exatamente um lado escreve no `contract.rs`**. O outro vai para
//! aqui. Sem isso o historico de espacamento de uma unidade teria duas
//! avaliacoes concorrentes, e o FSRS pressupoe que o criterio de avaliacao de
//! uma unidade permanece estavel.
//!
//! Por isso este arquivo e um **sidecar** e nao um segundo campo no documento:
//! grava-lo no `contract.rs` exigiria dobrar a unidade de estado do FSRS, que
//! e uma mudanca de formato muito mais invasiva.
//!
//! ## Por que nao JSON Lines como o log de confianca
//!
//! O log de confianca e append-only e nunca reescrito. Aqui o arquivo e
//! reescrito a cada avaliacao, porque e bounded por numero de registros, nao
//! por tamanho. Reescrever permite descartar os registros antigos sem o custo
//! de ler e reparsear o arquivo inteiro.
//!
//! ## A escrita e direta, e este arquivo E reescrito
//!
//! `usage.rs` usa temporario + `fs::rename`, que da atomicidade: uma falha no
//! meio da escrita deixa o arquivo anterior intacto. Aqui a leitura ja tolera
//! arquivo truncado (volta ao log vazio), e a perda real e a comparacao
//! daquele Vault — nao uma avaliacao. A escrita direta evita o arquivo extra.
//!
//! NOTA: uma versao anterior deste comentario afirmava que `fs::rename` falha no
//! Windows quando o destino existe, e usava isso como justificativa. **A
//! afirmacao e falsa** — o std usa `MoveFileExW` com `MOVEFILE_REPLACE_EXISTING`
//! e foi medido nesta plataforma. `usage.rs` esta correto; nao ha bug la.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const COMPARISON_FILE: &str = "review-comparison.json";
const METADATA_DIRECTORY: &str = ".mirmind";
/// Quantos registros sao mantidos. Cresce a cada avaliacao em `Dual`, entao o
/// teto e em numero, nao em bytes: e o que limita a memoria de leitura e o que
/// decide o que "antigo" significa.
const MAX_RECORDS: usize = 500;
/// Teto de bytes na leitura. Um arquivo maior nao e "registro grande": e sinal
/// de que algo escreveu no lugar errado.
const MAX_COMPARISON_BYTES: u64 = 512 * 1024;

const COMPARISON_VERSION: u16 = 1;

/// O veredito de um dos lados.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SideVerdict {
    pub engine: String,
    pub model: String,
    /// Rotulo categorico, quando o lado produz um (`"ready"`, `"confirmed"`).
    pub label: Option<String>,
    /// Probabilidades por rotulo, quando o lado produz uma distribuicao.
    /// O lado legado nao produz: e `None`, e nao um mapa com valor unico.
    #[serde(default)]
    pub distribution: Option<std::collections::BTreeMap<String, f64>>,
    #[serde(default)]
    pub confidence: Option<f64>,
}

impl SideVerdict {
    pub fn legacy(label: Option<String>) -> Self {
        Self {
            engine: "legacy".to_string(),
            model: "desconhecido".to_string(),
            label,
            distribution: None,
            confidence: None,
        }
    }
}

/// Um par de vereditos quecould ser comparado.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComparisonRecord {
    pub at_unix_ms: u64,
    /// `readiness`, `factStatus`, `assertionStatus`...
    pub dimension: String,
    /// `sha256:` da nota. Sem isto nao da para comparar a mesma nota ao longo
    /// do tempo.
    pub source_hash: String,
    /// O caminho da nota dentro do Vault.
    ///
    /// E o que permite mostrar a divergencia **junto da nota**: um hash
    /// identifica a nota, mas nao diz ao usuario qual arquivo divergiu.
    pub relative_path: String,
    pub primary: SideVerdict,
    pub secondary: SideVerdict,
    /// `true` quando os rotulos batem. Divergencia **nao** e erro: e o dado
    /// que o §11 usa para decidir se o motor novo pode substituir o antigo.
    pub agreed: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComparisonLog {
    pub version: u16,
    pub records: Vec<ComparisonRecord>,
}

impl Default for ComparisonLog {
    fn default() -> Self {
        Self {
            version: COMPARISON_VERSION,
            records: Vec::new(),
        }
    }
}

pub fn comparison_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(COMPARISON_FILE)
}

/// Acrescenta um registro, descartando os mais antigos.
///
/// Falha aqui **nao** derruba a avaliacao: perder a comparabilidade e melhor do
/// que o usuario perder o relatorio de prontidao.
pub fn append_comparison(vault_root: &Path, record: ComparisonRecord) -> Result<()> {
    let mut log = load_comparison(vault_root);
    log.records.push(record);
    // Descarta os mais antigos. `drain` pela frente preserva a ordem temporal.
    if log.records.len() > MAX_RECORDS {
        let excess = log.records.len() - MAX_RECORDS;
        log.records.drain(0..excess);
    }
    write_comparison(vault_root, &log)
}

/// Le o log. Ausente, corrompido ou grande demais viram log vazio.
///
/// Medicao nunca bloqueia o uso: um sidecar ilegivel custa a comparabilidade
/// daquele Vault, e nao a avaliacao.
pub fn load_comparison(vault_root: &Path) -> ComparisonLog {
    let path = comparison_path(vault_root);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return ComparisonLog::default();
    };
    // Um symlink aqui permitiria escrever fora do Vault com uma chamada de IA.
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return ComparisonLog::default();
    }
    if metadata.len() > MAX_COMPARISON_BYTES {
        return ComparisonLog::default();
    }
    let Ok(bytes) = fs::read(&path) else {
        return ComparisonLog::default();
    };
    match serde_json::from_slice::<ComparisonLog>(&bytes) {
        Ok(log) if log.version == COMPARISON_VERSION => log,
        _ => ComparisonLog::default(),
    }
}

fn write_comparison(vault_root: &Path, log: &ComparisonLog) -> Result<()> {
    let path = comparison_path(vault_root);
    let directory = path
        .parent()
        .context("O sidecar de comparacao precisa ter um diretorio pai.")?;
    fs::create_dir_all(directory)?;
    // A leitura acima ja recusou symlink; recusar aqui tambem evita transformar
    // o arquivo em link depois da leitura.
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            bail!("O sidecar de comparacao nao e um arquivo regular.");
        }
    }
    let bytes = serde_json::to_vec_pretty(log).context("Sidecar nao serializavel.")?;
    fs::write(&path, bytes).context("Nao foi possivel gravar o sidecar de comparacao.")?;
    Ok(())
}

/// Quantas divergencias o log acumula, por dimensao.
///
/// E a leitura que a §11 pede: "a saida diverge do `Off` em mais de X%".
pub fn divergence_rate(log: &ComparisonLog, dimension: &str) -> Option<f64> {
    let considered: Vec<&ComparisonRecord> = log
        .records
        .iter()
        .filter(|record| record.dimension == dimension)
        .collect();
    if considered.is_empty() {
        return None;
    }
    let diverging = considered.iter().filter(|record| !record.agreed).count();
    Some(diverging as f64 / considered.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn vault() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault temporario")
    }

    fn record(dimension: &str, agreed: bool, index: u64) -> ComparisonRecord {
        ComparisonRecord {
            at_unix_ms: 1_700_000_000_000 + index,
            dimension: dimension.to_string(),
            source_hash: "sha256:abc".to_string(),
            relative_path: "nota.md".to_string(),
            primary: SideVerdict {
                engine: "jev".to_string(),
                model: "jev-1.13.0".to_string(),
                label: Some(if agreed { "ready" } else { "ambiguous" }.to_string()),
                distribution: Some(BTreeMap::from([("ready".to_string(), 0.8)])),
                confidence: Some(0.8),
            },
            secondary: SideVerdict::legacy(Some("ready".to_string())),
            agreed,
        }
    }

    #[test]
    fn an_absent_log_reads_as_empty() {
        let vault = vault();
        assert!(load_comparison(vault.path()).records.is_empty());
        assert_eq!(
            divergence_rate(&load_comparison(vault.path()), "readiness"),
            None
        );
    }

    #[test]
    fn a_record_round_trips() {
        let vault = vault();
        append_comparison(vault.path(), record("readiness", true, 0)).expect("grava");
        let log = load_comparison(vault.path());
        assert_eq!(log.records.len(), 1);
        assert_eq!(log.records[0].dimension, "readiness");
        assert!(log.records[0].agreed);
        assert_eq!(log.records[0].primary.engine, "jev");
    }

    #[test]
    fn the_side_side_does_not_invent_a_distribution() {
        // O legado nao produz probabilidades. Um mapa com valor unico seria uma
        // mentira que faria a comparacao parecer completa.
        let legacy = SideVerdict::legacy(Some("ready".to_string()));
        assert_eq!(legacy.distribution, None);
        assert_eq!(legacy.confidence, None);
    }

    #[test]
    fn the_log_keeps_only_the_newest_records() {
        // O teto e o que define "antigo". Descartar o mais novo seria o oposto
        // do que serve para comparar a nota ao longo do tempo.
        let vault = vault();
        for index in 0..(MAX_RECORDS as u64 + 20) {
            append_comparison(vault.path(), record("readiness", true, index)).expect("grava");
        }
        let log = load_comparison(vault.path());
        assert_eq!(log.records.len(), MAX_RECORDS);
        let last = log.records.last().expect("ha registros");
        assert_eq!(
            last.at_unix_ms,
            1_700_000_000_000 + MAX_RECORDS as u64 + 19,
            "o mais novo precisa sobreviver"
        );
    }

    #[test]
    fn the_second_write_replaces_the_first() {
        // O sidecar e reescrito a cada avaliacao. Este teste cobre a segunda
        // gravacao sobre um arquivo existente, que e o caminho comum.
        //
        // NOTA: a versao anterior deste teste citava `fs::rename` falhando no
        // Windows como justificativa. A afirmacao era falsa e foi corrigida; o
        // teste continua valido pelo caminho que exercita.
        let vault = vault();
        append_comparison(vault.path(), record("readiness", true, 0)).expect("primeira");
        append_comparison(vault.path(), record("readiness", false, 1))
            .expect("a segunda gravacao tem de funcionar");
        assert_eq!(load_comparison(vault.path()).records.len(), 2);
    }

    #[test]
    fn a_corrupted_log_does_not_break_comparison() {
        let vault = vault();
        append_comparison(vault.path(), record("readiness", true, 0)).expect("grava");
        fs::write(comparison_path(vault.path()), b"{ nao e json").expect("corrompe");
        assert!(load_comparison(vault.path()).records.is_empty());

        // E a proxima avaliacao continua funcionando.
        append_comparison(vault.path(), record("readiness", false, 1)).expect("recomeca");
        assert_eq!(load_comparison(vault.path()).records.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_sidecar_is_refused_and_ignored() {
        let vault = vault();
        let outside = tempfile::NamedTempFile::new().expect("arquivo externo");
        let path = comparison_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        std::os::unix::fs::symlink(outside.path(), &path).expect("symlink");

        // Ler nao segue o link.
        assert!(load_comparison(vault.path()).records.is_empty());
        // E escrever tambem nao.
        assert!(append_comparison(vault.path(), record("readiness", true, 0)).is_err());
    }

    #[test]
    fn the_divergence_rate_answers_the_question_the_gate_asks() {
        let mut log = ComparisonLog::default();
        for index in 0..4 {
            log.records.push(record("readiness", index < 3, index));
        }
        log.records.push(record("factStatus", false, 9));

        let readiness = divergence_rate(&log, "readiness").expect("tem dados");
        assert!((readiness - 0.25).abs() < 1e-9, "{readiness}");
        // Dimensao sem registros nao e 0%: e "sem dado".
        assert_eq!(divergence_rate(&log, "synthesis"), None);
    }

    #[test]
    fn an_empty_log_has_no_divergence_rate() {
        // 0% de divergencia com zero amostras e uma afirmacao falsa.
        assert_eq!(
            divergence_rate(&ComparisonLog::default(), "readiness"),
            None
        );
    }
}
