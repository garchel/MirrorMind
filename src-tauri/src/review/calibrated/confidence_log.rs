//! Registro local de confianca das classificacoes calibradas (C11 / D10).
//!
//! Existe por causa de uma decisao do usuario: **exibir a confianca desde a
//! primeira implementacao e decidir depois, com dado**. Isso so funciona se o
//! dado for acumulado localmente — nem a UI nem o relatorio de F1 dao a
//! frequencia real de distribuicoes.
//!
//! O arquivo e JSON Lines: uma classificacao por linha. Escolhido porque o
//! formato tolera escrita em vez de reescrever um documento inteiro, e porque
//! uma linha corrompida por um corte de energia nao invalida o historico
//! inteiro.
//!
//! Cada linha carrega **o veredito humano nunca**. O log e telemetria do
//! motor, nao rotulo — misturar as duas coisas seria o caminho curto para um
//! numero que se confirma sozinho.

use crate::review::evaluation::ReadinessStatus;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const METADATA_DIRECTORY: &str = ".mirmind";
const CONFIDENCE_FILE: &str = "review-confidence.jsonl";
/// Teto do arquivo. Acima disso as linhas MAIS ANTIGAS sao descartadas: o
/// histograma interessa para responder "com que frequencia da baixa
/// confianca", e a recencia e o que importa.
const MAX_CONFIDENCE_BYTES: u64 = 1024 * 1024;

/// Uma classificacao registrada.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceSample {
    /// Unix em milissegundos.
    pub at_unix_ms: u64,
    /// `readiness` por enquanto; outras dimensoes entram depois.
    pub dimension: String,
    /// Confianca declarada pelo motor.
    pub confidence: f64,
    /// Probabilidade por status.
    pub probabilities: BTreeMap<String, f64>,
    /// O status que o motor escolheu, antes do portao.
    pub chosen: String,
    /// O status final depois do portao.
    pub effective: String,
    /// `true` se o portao de confianca alterou o resultado.
    pub degraded: bool,
    /// `sha256:...` da nota avaliada. Permite comparar a mesma nota ao longo do
    /// tempo sem guardar o conteudo.
    pub source_hash: String,
}

pub fn confidence_log_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(CONFIDENCE_FILE)
}

/// Acrescenta uma amostra ao log.
///
/// Falha de log **nao** derruba a classificacao: perder telemetria e melhor do
/// que o usuario perder o relatorio de prontidao por causa disso. O erro volta
/// como `warn` para o log da aplicacao.
pub fn record_confidence(vault_root: &Path, sample: &ConfidenceSample) -> Result<()> {
    let path = confidence_log_path(vault_root);
    let directory = path
        .parent()
        .context("O registro de confianca precisa ter um diretorio pai.")?;
    fs::create_dir_all(directory)?;

    // Um symlink aqui permitiria escrever fora do Vault com uma chamada de IA.
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
            anyhow::bail!("O registro de confianca da IA nao e um arquivo regular.");
        }
        if metadata.len() > MAX_CONFIDENCE_BYTES {
            truncate_to_budget(&path)?;
        }
    }

    let mut line =
        serde_json::to_string(sample).context("Amostra de confianca nao serializavel.")?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .context("Nao foi possivel abrir o registro de confianca da IA.")?;
    file.write_all(line.as_bytes())
        .context("Nao foi possivel gravar no registro de confianca da IA.")?;
    Ok(())
}

/// Descarta as linhas mais antigas ate o arquivo caber no orcamento.
fn truncate_to_budget(path: &Path) -> Result<()> {
    let content = fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<&str> = content.lines().collect();
    // Metade do arquivo: sobra espaco para varias appends antes da proxima
    // truncagem, em vez de truncar a cada avaliacao.
    while lines.len() > 1 && joined_length(&lines) > (MAX_CONFIDENCE_BYTES / 2) as usize {
        lines.remove(0);
    }
    let mut rebuilt = lines.join("\n");
    rebuilt.push('\n');
    // Escrita direta, sem arquivo temporario. Aqui o arquivo e reescrito apenas
    // na truncagem, que e rara; o padrao temp+rename de `usage.rs` custaria um
    // arquivo extra para trocar algo que ja esta no lugar certo. A leitura ja
    // pula linha malformada, entao uma escrita parcial degrada para "perdeu a
    // amostra mais antiga", nunca para historico ilegivel.
    //
    // CORRECAO: uma versao anterior deste comentario afirmava que `fs::rename`
    // falha no Windows quando o destino existe, e foi por isso que a escrita
    // direta foi adotada. **A afirmacao e falsa**: o std usa `MoveFileExW` com
    // `MOVEFILE_REPLACE_EXISTING`, medido nesta plataforma. A escrita direta e
    // correcta mesmo assim, mas pelo motivo acima.
    fs::write(path, rebuilt).context("Nao foi possivel reescrever o registro de confianca.")?;
    Ok(())
}

fn joined_length(lines: &[&str]) -> usize {
    lines.iter().map(|line| line.len() + 1).sum()
}

/// Le todas as amostras validas.
///
/// Linha malformada e **pulada**, nao fatal: um corte de energia no meio de
/// uma escrita nao pode tornar o historico inteiro ilegivel.
pub fn read_confidence_log(vault_root: &Path) -> Vec<ConfidenceSample> {
    let Ok(content) = fs::read_to_string(confidence_log_path(vault_root)) else {
        return Vec::new();
    };
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

/// Resumo do que o usuario pediu para poder decidir.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceHistogram {
    pub samples: usize,
    /// Fracao de classificacoes abaixo de cada limiar.
    pub below_0_50: f64,
    pub below_0_70: f64,
    pub below_0_85: f64,
    /// Quantas vezes o portao alterou o status.
    pub degraded: usize,
    /// Contagem por status efetivo.
    pub by_status: BTreeMap<String, usize>,
}

/// Resumo do log para a tela de medicao.
///
/// Esta e a resposta direta a "com que frequencia ele solta resultados de baixa
/// confianca" — mas o numero que decide se a confianca e confiavel NAO e este:
/// e a taxa de acerto entre as classificacoes de alta confianca, que so o
/// golden set da F1 mede. Contar frequencia e o passo 1; correlacionar com
/// acerto e o passo 2.
pub fn summarize(samples: &[ConfidenceSample]) -> ConfidenceHistogram {
    let total = samples.len();
    let ratio = |threshold: f64| {
        if total == 0 {
            0.0
        } else {
            samples
                .iter()
                .filter(|sample| sample.confidence < threshold)
                .count() as f64
                / total as f64
        }
    };
    let mut by_status: BTreeMap<String, usize> = BTreeMap::new();
    for sample in samples {
        *by_status.entry(sample.effective.clone()).or_default() += 1;
    }
    ConfidenceHistogram {
        samples: total,
        below_0_50: ratio(0.50),
        below_0_70: ratio(0.70),
        below_0_85: ratio(0.85),
        degraded: samples.iter().filter(|sample| sample.degraded).count(),
        by_status,
    }
}

/// Monta a amostra a partir do resultado calibrado.
pub fn sample_from(
    at_unix_ms: u64,
    source_hash: &str,
    calibrated: &super::readiness::CalibratedReadiness,
    chosen: ReadinessStatus,
) -> ConfidenceSample {
    let label = |status: ReadinessStatus| match status {
        ReadinessStatus::Ready => "ready",
        ReadinessStatus::Ambiguous => "ambiguous",
        ReadinessStatus::Insufficient => "insufficient",
    };
    ConfidenceSample {
        at_unix_ms,
        dimension: "readiness".to_string(),
        confidence: calibrated.confidence,
        probabilities: calibrated.status_probabilities.clone(),
        chosen: label(chosen).to_string(),
        effective: label(calibrated.status).to_string(),
        degraded: calibrated.degraded,
        source_hash: source_hash.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(confidence: f64, effective: &str, degraded: bool) -> ConfidenceSample {
        ConfidenceSample {
            at_unix_ms: 1_700_000_000_000,
            dimension: "readiness".to_string(),
            confidence,
            probabilities: BTreeMap::from([("ready".to_string(), confidence)]),
            chosen: "ready".to_string(),
            effective: effective.to_string(),
            degraded,
            source_hash: "sha256:abc".to_string(),
        }
    }

    fn vault() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault temporario")
    }

    #[test]
    fn samples_round_trip_through_the_log() {
        let vault = vault();
        for index in 0..5 {
            let mut entry = sample(0.4 + index as f64 * 0.1, "ready", false);
            entry.at_unix_ms += index as u64;
            record_confidence(vault.path(), &entry).expect("grava");
        }
        let read = read_confidence_log(vault.path());
        assert_eq!(read.len(), 5);
        assert_eq!(read[0].confidence, 0.4);
        assert_eq!(read[4].confidence, 0.8);
    }

    #[test]
    fn an_absent_log_reads_as_empty() {
        let vault = vault();
        assert!(read_confidence_log(vault.path()).is_empty());
        assert_eq!(summarize(&[]).samples, 0);
    }

    #[test]
    fn a_corrupted_line_is_skipped_not_fatal() {
        let vault = vault();
        record_confidence(vault.path(), &sample(0.9, "ready", false)).expect("grava");
        let path = confidence_log_path(vault.path());
        let mut content = fs::read_to_string(&path).expect("le");
        content.push_str("{\"isto nao e json\n");
        content.push_str("{\"atUnixMs\":2,\"dimension\":\"readiness\",\"confidence\":0.7,\"probabilities\":{},\"chosen\":\"ready\",\"effective\":\"ready\",\"degraded\":false,\"sourceHash\":\"sha256:x\"}\n");
        fs::write(&path, content).expect("escreve");

        let read = read_confidence_log(vault.path());
        assert_eq!(read.len(), 2, "a linha boa e a posterior devem sobreviver");
        assert_eq!(read[1].confidence, 0.7);
    }

    #[test]
    fn the_histogram_answers_the_frequency_question() {
        let samples = vec![
            sample(0.3, "ambiguous", true),
            sample(0.4, "ambiguous", true),
            sample(0.8, "ready", false),
            sample(0.9, "ready", false),
        ];
        let summary = summarize(&samples);
        assert_eq!(summary.samples, 4);
        assert!((summary.below_0_50 - 0.5).abs() < 1e-9, "{summary:?}");
        assert!((summary.below_0_70 - 0.5).abs() < 1e-9);
        assert!((summary.below_0_85 - 0.75).abs() < 1e-9);
        assert_eq!(summary.degraded, 2);
        assert_eq!(summary.by_status.get("ready"), Some(&2));
    }

    #[test]
    fn the_histogram_does_not_lie_when_there_is_no_data() {
        let summary = summarize(&[]);
        assert_eq!(summary.below_0_50, 0.0);
        assert_eq!(summary.below_0_70, 0.0);
        assert_eq!(summary.degraded, 0);
    }

    #[test]
    fn the_log_never_stores_the_note_content() {
        let vault = vault();
        let mut entry = sample(0.9, "ready", false);
        entry.source_hash = "sha256:deadbeef".to_string();
        record_confidence(vault.path(), &entry).expect("grava");
        let raw = fs::read_to_string(confidence_log_path(vault.path())).expect("le");
        assert!(raw.contains("sha256:deadbeef"));
        assert!(
            !raw.to_lowercase().contains("markdown"),
            "so o hash da nota entra no log, nunca o conteudo"
        );
    }

    #[test]
    fn the_log_is_truncated_instead_of_growing_without_limit() {
        let vault = vault();
        let path = confidence_log_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        let fat: String = (0..40_000)
            .map(|index| {
                format!(
                    "{{\"atUnixMs\":{index},\"dimension\":\"readiness\",\"confidence\":0.5,\
                 \"probabilities\":{{\"ready\":1.0}},\"chosen\":\"ready\",\"effective\":\"ready\",\
                 \"degraded\":false,\"sourceHash\":\"sha256:x\"}}\n"
                )
            })
            .collect();
        fs::write(&path, fat).expect("escreve arquivo grande");
        let before = fs::metadata(&path).expect("metadata").len();

        record_confidence(vault.path(), &sample(0.9, "ready", false)).expect("grava");
        let after = fs::metadata(&path).expect("metadata").len();
        assert!(
            after < before,
            "o arquivo precisa encolher: antes {before}, depois {after}"
        );
        let remaining = read_confidence_log(vault.path());
        assert!(
            !remaining.is_empty(),
            "a truncagem preserva as linhas recentes"
        );
        assert!(
            remaining.iter().any(|entry| entry.confidence == 0.9),
            "a amostra recem-escrita tem de estar no log depois da truncagem"
        );
        assert_eq!(
            remaining.last().map(|entry| entry.confidence),
            Some(0.9),
            "e tem de ser a ultima: a truncagem descarta as mais antigas, nao as mais novas"
        );
    }

    #[test]
    fn truncation_leaves_no_temporary_file_behind() {
        let vault = vault();
        let path = confidence_log_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        let fat: String = (0..40_000)
            .map(|index| {
                format!(
                    "{{\"atUnixMs\":{index},\"dimension\":\"readiness\",\"confidence\":0.5,\
                 \"probabilities\":{{\"ready\":1.0}},\"chosen\":\"ready\",\"effective\":\"ready\",\
                 \"degraded\":false,\"sourceHash\":\"sha256:x\"}}\n"
                )
            })
            .collect();
        fs::write(&path, fat).expect("escreve arquivo grande");
        record_confidence(vault.path(), &sample(0.9, "ready", false)).expect("grava");

        let leftovers: Vec<String> = fs::read_dir(path.parent().expect("diretorio"))
            .expect("lista")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name != CONFIDENCE_FILE)
            .collect();
        assert!(
            leftovers.is_empty(),
            "so o log deve existir no diretorio de metadados: {leftovers:?}"
        );
    }

    #[test]
    fn a_symlinked_log_is_refused() {
        #[cfg(unix)]
        {
            let vault = vault();
            let outside = tempfile::NamedTempFile::new().expect("arquivo externo");
            let path = confidence_log_path(vault.path());
            fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
            std::os::unix::fs::symlink(outside.path(), &path).expect("symlink");
            assert!(
                record_confidence(vault.path(), &sample(0.9, "ready", false)).is_err(),
                "escrever atraves de symlink colocaria telemetria fora do Vault"
            );
        }
        #[cfg(not(unix))]
        {
            let vault = vault();
            assert!(record_confidence(vault.path(), &sample(0.9, "ready", false)).is_ok());
        }
    }

    #[test]
    fn the_sample_records_both_the_chosen_and_the_effective_status() {
        // Sem os dois, nao da para saber quantas vezes o portao agiu.
        let calibrated = super::super::readiness::CalibratedReadiness {
            status: ReadinessStatus::Ambiguous,
            confidence: 0.42,
            status_probabilities: BTreeMap::from([
                ("ready".to_string(), 0.45),
                ("ambiguous".to_string(), 0.40),
                ("insufficient".to_string(), 0.15),
            ]),
            degraded: true,
            issue_verdicts: Vec::new(),
        };
        let sample = sample_from(
            1_700_000_000_000,
            "sha256:abc",
            &calibrated,
            ReadinessStatus::Ready,
        );
        assert_eq!(sample.chosen, "ready", "o que o argmax disse");
        assert_eq!(sample.effective, "ambiguous", "o que o portao decidiu");
        assert!(sample.degraded);
    }
}
