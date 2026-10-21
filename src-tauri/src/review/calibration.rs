//! Estrategia de calibracao: qual motor julga as funcionalidades calibradas.
//!
//! O toggle e **vault-scoped** e persistido em `.mirmind/review-calibration.json`,
//! e nao passado como parametro de comando IPC. Isso e deliberado: nenhum dos
//! 8 comandos que hoje recebem `provider: AiProviderSelection` muda de
//! assinatura, entao o toggle e retrocompativel e todos os caminhos passam a
//! resolver a estrategia internamente.
//!
//! Os dois seletores sao independentes porque respondem a perguntas diferentes:
//! `AiProviderSelection` decide quem **gera** texto; `CalibrationStrategy`
//! decide quem **julga**. JEV nao gera texto, entao ele nunca entra em
//! `AiProviderSelection`.

use crate::review::calibrated::{CalibratedProvider, CalibrationEngine};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const METADATA_DIRECTORY: &str = ".mirmind";
const CALIBRATION_FILE: &str = "review-calibration.json";
/// A config e pequena e deicaimebounded: um arquivo gigante aqui e sinal de
/// que algo escreveu no lugar errado.
const MAX_CALIBRATION_BYTES: u64 = 8 * 1024;

/// Qual motor produz as decisoes calibradas.
///
/// `Off` e o padrao e o unico valor que nao muda comportamento: enquanto
/// ninguem escolher outra coisa, o app se comporta exatamente como antes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CalibrationStrategy {
    /// Comportamento atual: `StructuredAiProvider` gera e o codigo valida.
    #[default]
    Off,
    /// So o caminho JEV. Falha explicita e legivel quando nao configurado —
    /// nunca fallback silencioso, que mascararia queda do servico e
    /// destruiria a comparacao.
    Jev,
    /// Executa os dois. O lado primario alimenta o FSRS; o outro vai para o
    /// sidecar de comparacao. Regra dura: **exatamente um lado escreve no
    /// `contract.rs`**, senao o historico de espacamento e contaminado.
    Dual,
}

impl CalibrationStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            CalibrationStrategy::Off => "off",
            CalibrationStrategy::Jev => "jev",
            CalibrationStrategy::Dual => "dual",
        }
    }

    /// O motor cujas decisoes alimentam o agendamento e a UI.
    ///
    /// Em `Dual`, a escolha segue o provider generativo: com Ollama local o
    /// legado e o primario (e o barato); com Gemini ou OpenAI-compatible o
    /// JEV e o primario (e o que se quer medir). Regra simples e documentada,
    /// sem configuracao extra.
    pub fn primary_engine(self, generative: Option<CalibrationEngine>) -> CalibrationEngine {
        match self {
            CalibrationStrategy::Off => CalibrationEngine::Legacy,
            CalibrationStrategy::Jev => CalibrationEngine::Jev,
            CalibrationStrategy::Dual => match generative {
                Some(CalibrationEngine::Jev) => CalibrationEngine::Jev,
                _ => CalibrationEngine::Legacy,
            },
        }
    }

    /// `true` quando o caminho JEV precisa estar configurado e autorizado.
    pub fn requires_jev(self) -> bool {
        matches!(self, CalibrationStrategy::Jev | CalibrationStrategy::Dual)
    }
}

/// Quem julgou uma avaliacao, e com que seguranca.
///
/// ## Por que isto fica na sessao e nao em `UnitEvaluation`
///
/// O plano previa um `provenance` por `UnitEvaluation::Evaluated`. Isso e
/// semanticamente errado e desnecessariamente caro: **uma sessao inteira sai do
/// mesmo motor**, entao 38 pontos de construcao passariam a gravar a mesma
/// informacao N vezes, e o `UnitEvaluation` tem o maior grafo de dependencia do
/// arquivo (71 referencias em 10 modulos). A sessao tem 16 pontos, ja carrega
/// `provider` — quem **escreveu** o texto — e e a unidade natural: um evento de
/// avaliacao, um motor.
///
/// Junto com `ReviewSession::provider`, os dois campos respondem a pergunta
/// completa: quem escreveu e quem julgou.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluationProvenance {
    /// Qual motor julgou.
    pub engine: CalibrationEngine,
    /// Modelo concreto, como reportado pela API (`"jev-1.13.0"`).
    pub model: String,
    /// Estrategia ativa no momento da avaliacao.
    pub strategy: CalibrationStrategy,
    /// Confianca informada pelo motor, de 0 a 1. `None` no caminho legado, que
    /// nao produz probabilidades — e nao `0`.
    #[serde(default)]
    pub confidence: Option<f64>,
    pub latency_ms: u64,
    #[serde(default)]
    pub input_tokens: Option<u64>,
    #[serde(default)]
    pub output_tokens: Option<u64>,
}

impl EvaluationProvenance {
    /// Proveniencia de um documento salvo antes desta feature.
    ///
    /// `None` no campo **nao** significa "desconhecido": significa "isto veio de
    /// um Vault anterior ao motor calibrado", e a resposta correta e
    /// `Legacy`/`Off`. Inventar `confidence: 0.0` aqui seria pior do que a
    /// ausencia — a confianca do legado nao e zero, ela nao existe.
    pub fn legacy() -> Self {
        Self {
            engine: CalibrationEngine::Legacy,
            model: "desconhecido".to_string(),
            strategy: CalibrationStrategy::Off,
            confidence: None,
            latency_ms: 0,
            input_tokens: None,
            output_tokens: None,
        }
    }
}

/// Proveniencia de uma avaliacao, dada a estrategia e o cliente calibrado.
///
/// Fica aqui, e nao no `ipc.rs`, porque a regra e da feature: **`None` de
/// cliente calibrado significa `Legacy`/`Off`, nunca "nao sei"**. Os dois
/// casos produzem a mesma avaliacao, entao gravar `None` seria afirmar que a
/// proveniencia esta desconhecida quando ela e conhecida com certeza.
pub fn provenance_for(
    strategy: CalibrationStrategy,
    calibrated: Option<&dyn CalibratedProvider>,
) -> EvaluationProvenance {
    match calibrated {
        None => EvaluationProvenance {
            // `Off` e `Legacy`: a avaliacao saiu inteiramente pelo caminho
            // legado, e e isso que o campo precisa dizer.
            strategy,
            ..EvaluationProvenance::legacy()
        },
        Some(provider) => EvaluationProvenance {
            engine: provider.engine(),
            model: provider.model().to_string(),
            strategy,
            // A confianca do julgamento calibrado ainda nao esta disponivel
            // neste ponto: ela vive no relatorio, e nao num escalar unico para
            // a sessao. `None` aqui significa "por avaliacao, no relatorio".
            confidence: None,
            latency_ms: 0,
            input_tokens: None,
            output_tokens: None,
        },
    }
}

/// Configuracao persistida do Vault.
///
/// Todo campo tem `default`, entao um arquivo de uma versao futura continua
/// sendo lido por uma versao antiga sem migrate.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalibrationConfig {
    pub strategy: CalibrationStrategy,
    /// Resultado do harness de calibracao, gravado em F1.
    ///
    /// Enquanto `false`, a UI nao exibe numeros de confianca: um numero que
    /// nunca foi validado contra rotulo humano e teatro, e theaterDisplayed
    /// como verdade e pior que a ausencia de numero.
    pub calibration_validated: bool,
    /// C10: peso da evidencia continuous, derivado das probabilidades do motor
    /// calibrado em vez da tabela estatica por tipo de pergunta.
    ///
    /// **Flag propria, nao o toggle principal**, como o plano exige (§4.6): ela
    /// muda o algoritmo de agendamento, e nao o motor que julga. Misturar as
    /// duas coisas faria um `Dual` experimentsar dois algoritmos de agendamento
    /// ao mesmo tempo, e a comparacao perderia o sentido.
    ///
    /// Desligada por padrao: o plano (§4.6) diz que C10 precisa de validacao
    /// propria contra o corpus de revisoes, e esse corpus nao existe.
    #[serde(default)]
    pub continuous_evidence_weight: bool,
}

pub fn calibration_file_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(CALIBRATION_FILE)
}

/// Le a configuracao. Arquivo ausente, ilegivel ou corrompido devolve o
/// padrao: configuracao de motor **nunca** bloqueia o app.
pub fn load_calibration_config(vault_root: &Path) -> Result<CalibrationConfig> {
    let path = calibration_file_path(vault_root);
    if !path.exists() {
        return Ok(CalibrationConfig::default());
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Ok(CalibrationConfig::default());
    }
    if metadata.len() > MAX_CALIBRATION_BYTES {
        return Ok(CalibrationConfig::default());
    }
    let bytes = fs::read(&path)?;
    Ok(serde_json::from_slice(&bytes).unwrap_or_default())
}

pub fn save_calibration_config(vault_root: &Path, config: &CalibrationConfig) -> Result<()> {
    write_atomic(&calibration_file_path(vault_root), config)
}

pub fn set_calibration_strategy(
    vault_root: &Path,
    strategy: CalibrationStrategy,
) -> Result<CalibrationConfig> {
    let mut config = load_calibration_config(vault_root)?;
    config.strategy = strategy;
    save_calibration_config(vault_root, &config)?;
    Ok(config)
}

/// Grava a calibracao medida, liberando (ou nao) a exibicao da confianca.
///
/// Chamar com `false` esconde o numero sem reverter nenhuma decisao: o
/// portao de confianca continua usando `probabilities`, que vem da mesma
/// resposta.
pub fn set_calibration_validated(vault_root: &Path, validated: bool) -> Result<CalibrationConfig> {
    let mut config = load_calibration_config(vault_root)?;
    config.calibration_validated = validated;
    save_calibration_config(vault_root, &config)?;
    Ok(config)
}

fn write_atomic(path: &Path, config: &CalibrationConfig) -> Result<()> {
    let directory = path
        .parent()
        .context("A configuracao de calibracao precisa ter um diretorio pai.")?;
    fs::create_dir_all(directory)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("calibration");
    let temporary = directory.join(format!("{file_name}.tmp"));
    let bytes = serde_json::to_vec_pretty(config)?;
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_off_which_changes_nothing() {
        assert_eq!(CalibrationStrategy::default(), CalibrationStrategy::Off);
        assert_eq!(
            CalibrationConfig::default().strategy,
            CalibrationStrategy::Off
        );
        assert!(!CalibrationConfig::default().calibration_validated);
    }

    #[test]
    fn strategy_names_are_stable() {
        assert_eq!(CalibrationStrategy::Off.as_str(), "off");
        assert_eq!(CalibrationStrategy::Jev.as_str(), "jev");
        assert_eq!(CalibrationStrategy::Dual.as_str(), "dual");
    }

    #[test]
    fn strategy_serialization_is_camel_case() {
        let json = serde_json::to_value(CalibrationStrategy::Jev).expect("serializa");
        assert_eq!(json, serde_json::json!("jev"));
        let parsed: CalibrationStrategy = serde_json::from_value(json).expect("desserializa");
        assert_eq!(parsed, CalibrationStrategy::Jev);
    }

    #[test]
    fn off_never_reaches_for_the_jev() {
        assert!(!CalibrationStrategy::Off.requires_jev());
        assert!(CalibrationStrategy::Jev.requires_jev());
        assert!(CalibrationStrategy::Dual.requires_jev());
    }

    #[test]
    fn off_always_keeps_the_legacy_as_primary() {
        assert_eq!(
            CalibrationStrategy::Off.primary_engine(None),
            CalibrationEngine::Legacy
        );
        assert_eq!(
            CalibrationStrategy::Off.primary_engine(Some(CalibrationEngine::Jev)),
            CalibrationEngine::Legacy
        );
    }

    #[test]
    fn jev_is_always_primary_in_jev_mode() {
        assert_eq!(
            CalibrationStrategy::Jev.primary_engine(None),
            CalibrationEngine::Jev
        );
        assert_eq!(
            CalibrationStrategy::Jev.primary_engine(Some(CalibrationEngine::Legacy)),
            CalibrationEngine::Jev
        );
    }

    #[test]
    fn dual_follows_the_generative_provider() {
        assert_eq!(
            CalibrationStrategy::Dual.primary_engine(Some(CalibrationEngine::Legacy)),
            CalibrationEngine::Legacy,
            "com Ollama local o legado e o primario: e o barato"
        );
        assert_eq!(
            CalibrationStrategy::Dual.primary_engine(Some(CalibrationEngine::Jev)),
            CalibrationEngine::Jev,
            "com provedor remoto o JEV e o primario: e o que se quer medir"
        );
        assert_eq!(
            CalibrationStrategy::Dual.primary_engine(None),
            CalibrationEngine::Legacy
        );
    }

    #[test]
    fn an_absent_file_reads_as_the_default() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let config = load_calibration_config(vault.path()).expect("le a config");
        assert_eq!(config, CalibrationConfig::default());
    }

    #[test]
    fn a_saved_strategy_survives_a_round_trip() {
        let vault = tempfile::tempdir().expect("vault temporario");
        for strategy in [
            CalibrationStrategy::Off,
            CalibrationStrategy::Jev,
            CalibrationStrategy::Dual,
        ] {
            set_calibration_strategy(vault.path(), strategy).expect("salva");
            let config = load_calibration_config(vault.path()).expect("le");
            assert_eq!(config.strategy, strategy);
        }
    }

    #[test]
    fn setting_the_strategy_preserves_the_other_fields() {
        let vault = tempfile::tempdir().expect("vault temporario");
        set_calibration_validated(vault.path(), true).expect("marca validado");
        set_calibration_strategy(vault.path(), CalibrationStrategy::Jev).expect("muda estrategia");
        let config = load_calibration_config(vault.path()).expect("le");
        assert!(config.calibration_validated, "o flag nao pode ser perdido");
        assert_eq!(config.strategy, CalibrationStrategy::Jev);
    }

    #[test]
    fn validation_can_be_revoked_to_hide_the_number_again() {
        let vault = tempfile::tempdir().expect("vault temporario");
        set_calibration_validated(vault.path(), true).expect("valida");
        set_calibration_validated(vault.path(), false).expect("revoga");
        assert!(
            !load_calibration_config(vault.path())
                .expect("le")
                .calibration_validated
        );
    }

    #[test]
    fn the_file_lives_under_the_metadata_directory() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let path = calibration_file_path(vault.path());
        assert!(path.ends_with(Path::new(".mirmind").join("review-calibration.json")));
    }

    #[test]
    fn a_corrupted_file_does_not_block_the_app() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let path = calibration_file_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        fs::write(&path, b"{ isso nao e json").expect("escreve lixo");
        let config = load_calibration_config(vault.path()).expect("le sem falhar");
        assert_eq!(config.strategy, CalibrationStrategy::Off);
    }

    #[test]
    fn a_future_file_with_unknown_fields_still_loads() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let path = calibration_file_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        fs::write(&path, br#"{"strategy":"jev","campoDoFuturo":123}"#).expect("escreve");
        let config = load_calibration_config(vault.path()).expect("le");
        assert_eq!(config.strategy, CalibrationStrategy::Jev);
    }

    #[test]
    fn an_oversized_file_reads_as_the_default() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let path = calibration_file_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        fs::write(&path, vec![b'x'; (MAX_CALIBRATION_BYTES + 1) as usize]).expect("escreve");
        let config = load_calibration_config(vault.path()).expect("le sem falhar");
        assert_eq!(config.strategy, CalibrationStrategy::Off);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_file_reads_as_the_default() {
        let vault = tempfile::tempdir().expect("vault temporario");
        let outside = tempfile::NamedTempFile::new().expect("arquivo externo");
        let path = calibration_file_path(vault.path());
        fs::create_dir_all(path.parent().expect("diretorio")).expect("cria");
        std::os::unix::fs::symlink(outside.path(), &path).expect("cria symlink");
        let config = load_calibration_config(vault.path()).expect("le sem falhar");
        assert_eq!(config.strategy, CalibrationStrategy::Off);
    }
}
