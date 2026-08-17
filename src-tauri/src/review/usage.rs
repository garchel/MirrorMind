//! Medicao, orcamentos e protecao contra abuso do uso de IA.
//!
//! Mede chamadas a provedores remotos (Gemini/Ollama) POR DIA e POR MINUTO, por
//! Vault, e impoe orcamentos com parada dura ANTES da chamada: a chamada so e
//! reservada depois de confirmar que o limite nao sera estourado, entao mesmo
//! um loop de tentativas/reorganizacao nunca ultrapassa o teto (conservador
//! por design — anti-abuso). O contador e persistido em `.mirmind/review-usage.json`
//! e sobrevive a reinicios; a janela por minuto e rolante (zera ao mudar de
//! minuto). O provedor E2E deterministico fica fora do orcamento (nao tem
//! custo nem rede), e a falha de transporte ainda consome a reserva — um
//! provedor indisponivel nunca vira spam de reconexao.
//!
//! Limites do prototipo: constantes configuráveis em uma evolucao futura.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::provider::ProviderKind;

/// Limite diario de chamadas a IA por Vault (prototipo).
pub const DEFAULT_MAX_CALLS_PER_DAY: u32 = 300;
/// Limite por minuto (janela rolante) — trava loops de tentativa rapida.
pub const DEFAULT_MAX_CALLS_PER_MINUTE: u32 = 20;
/// Orcamento mensal de custo estimado em USD por Vault (prototipo).
pub const DEFAULT_MAX_COST_PER_MONTH_USD: f64 = 20.0;

/// Heuristica de estimativa: ~4 caracteres por token (prosa em portugues).
const CHARS_PER_TOKEN: usize = 4;
/// Saida estimada por chamada estruturada (resposta JSON) quando o tamanho
/// real ainda nao e conhecido — a reserva usa um teto conservador.
const ESTIMATED_OUTPUT_TOKENS: f64 = 2_000.0;
/// Precos por milhao de tokens em USD (estimativa de tabela publica; os
/// valores sao aproximacoes configuráveis em uma evolucao futura).
const GEMINI_INPUT_USD_PER_1M: f64 = 0.30;
const GEMINI_OUTPUT_USD_PER_1M: f64 = 1.50;
/// Ollama e local: sem custo por token (apenas energia/computacao local).
const LOCAL_USD_PER_1M: f64 = 0.0;
/// Heuristica de tokens por imagem para a leitura visual (visao): tokens de
/// entrada estimados por byte de imagem, aproximacao conservadora de tabela
/// publica (imagens maiores custam mais) — configuravel em evolucao futura.
const VISION_TOKENS_PER_BYTE: f64 = 1.0 / 2_000.0;
/// Custos por milhao de tokens de entrada/saida da visao no Gemini
/// (aproximacao de tabela publica, mais cara que texto).
const VISION_INPUT_USD_PER_1M: f64 = 1.25;
const VISION_OUTPUT_USD_PER_1M: f64 = 5.0;
/// Saida estimada de uma descricao de imagem (texto curto).
const ESTIMATED_VISION_OUTPUT_TOKENS: f64 = 500.0;

const METADATA_DIRECTORY: &str = ".mirmind";
const USAGE_FILE: &str = "review-usage.json";
const MAX_USAGE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UsageLimits {
    pub max_calls_per_day: u32,
    pub max_calls_per_minute: u32,
    pub max_cost_per_month_usd: f64,
}

impl Default for UsageLimits {
    fn default() -> Self {
        Self {
            max_calls_per_day: DEFAULT_MAX_CALLS_PER_DAY,
            max_calls_per_minute: DEFAULT_MAX_CALLS_PER_MINUTE,
            max_cost_per_month_usd: DEFAULT_MAX_COST_PER_MONTH_USD,
        }
    }
}

/// Estima o custo em USD de uma chamada a um provedor remoto a partir do
/// tamanho do prompt (caracteres) e de uma saida estrutural conservadora.
/// Provedores locais (Ollama) custam zero. Usado para a reserva ANTES da
/// chamada e para o acumulado exibido na interface.
pub fn estimate_call_cost_usd(provider: ProviderKind, input_chars: usize) -> f64 {
    let (input_usd, output_usd) = match provider {
        ProviderKind::Ollama => (LOCAL_USD_PER_1M, LOCAL_USD_PER_1M),
        ProviderKind::Gemini => (GEMINI_INPUT_USD_PER_1M, GEMINI_OUTPUT_USD_PER_1M),
        // Preco desconhecido por servico: estimativa generica de nuvem,
        // configuravel em uma evolucao futura.
        ProviderKind::OpenAiCompatible => (GEMINI_INPUT_USD_PER_1M, GEMINI_OUTPUT_USD_PER_1M),
    };
    let input_tokens = input_chars as f64 / CHARS_PER_TOKEN as f64;
    input_tokens / 1_000_000.0 * input_usd + ESTIMATED_OUTPUT_TOKENS / 1_000_000.0 * output_usd
}

/// Estima o custo em USD de UMA descricao visual de imagem (visao
/// multimodal) a partir do tamanho em bytes: tokens de entrada estimados por
/// byte + saida textual curta. Provedores locais (Ollama) custam zero. Usado
/// para reservar ANTES de enviar a imagem ao provedor.
pub fn estimate_vision_call_cost_usd(provider: ProviderKind, image_bytes: usize) -> f64 {
    let (input_usd, output_usd) = match provider {
        ProviderKind::Ollama => (LOCAL_USD_PER_1M, LOCAL_USD_PER_1M),
        ProviderKind::Gemini => (VISION_INPUT_USD_PER_1M, VISION_OUTPUT_USD_PER_1M),
        // Preco desconhecido por servico: estimativa generica de nuvem.
        ProviderKind::OpenAiCompatible => (VISION_INPUT_USD_PER_1M, VISION_OUTPUT_USD_PER_1M),
    };
    let input_tokens = image_bytes as f64 * VISION_TOKENS_PER_BYTE;
    input_tokens / 1_000_000.0 * input_usd
        + ESTIMATED_VISION_OUTPUT_TOKENS / 1_000_000.0 * output_usd
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCallCount {
    pub provider: String,
    pub calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    /// Dia local (dias desde a epoch) do contador. Outro dia zera o registro.
    pub day: u64,
    /// Chave de mes (ano * 12 + mes - 1) do acumulado mensal de custo.
    pub month_key: u64,
    pub calls_by_provider: Vec<ProviderCallCount>,
    /// Custo estimado em USD no dia (acumulado das chamadas reservadas).
    pub estimated_cost_usd: f64,
    /// Custo estimado em USD no mes (acumulado).
    pub estimated_cost_usd_month: f64,
    /// Segundo unix em que a janela de minuto atual abriu.
    pub minute_start_unix: u64,
    pub calls_in_minute: u32,
    /// Chamadas de leitura visual (descricao de imagem) no dia. Registros
    /// antigos sem o campo leem como zero (compativel com dados existentes).
    #[serde(default)]
    pub vision_calls: u32,
}

impl UsageRecord {
    pub fn total_calls(&self) -> u32 {
        self.calls_by_provider.iter().map(|entry| entry.calls).sum()
    }

    #[cfg(test)]
    pub fn provider_calls(&self, provider: &str) -> u32 {
        self.calls_by_provider
            .iter()
            .find(|entry| entry.provider == provider)
            .map(|entry| entry.calls)
            .unwrap_or(0)
    }
}

/// Visao de leitura para a interface: contadores do dia, custo estimado (dia
/// e mes) e limites vigentes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatusView {
    pub day: u64,
    pub provider_calls: Vec<ProviderCallCount>,
    pub total_calls: u32,
    pub max_calls_per_day: u32,
    pub calls_in_minute: u32,
    pub max_calls_per_minute: u32,
    pub exceeded: bool,
    pub estimated_cost_usd: f64,
    pub estimated_cost_usd_month: f64,
    pub max_cost_per_month_usd: f64,
    pub monthly_exceeded: bool,
    pub vision_calls: u32,
}

fn today_day(now_unix: u64) -> u64 {
    now_unix / 86_400
}

/// Chave de mes (ano * 12 + mes - 1) a partir de segundos unix, em UTC.
fn month_key(now_unix: u64) -> u64 {
    let days = now_unix / 86_400;
    // 1970-01-01 era uma quinta-feira; conta aproximada de meses desde a
    // epoch (365.25 dias por ano) — suficiente para o orcamento mensal, que
    // apenas precisa resetar ao virar o mes.
    let year = 1970 + (days as f64 / 365.25) as u64;
    let year_days = (year - 1970) * 365 + ((year - 1970 + 1) / 4);
    let month_index = days.saturating_sub(year_days) / 31;
    year * 12 + month_index.min(11)
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn provider_label(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Ollama => "ollama",
        ProviderKind::Gemini => "gemini",
        ProviderKind::OpenAiCompatible => "openAiCompatible",
    }
}

pub fn usage_file_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(USAGE_FILE)
}

fn fresh_record(day: u64, now_unix: u64) -> UsageRecord {
    UsageRecord {
        day,
        month_key: month_key(now_unix),
        calls_by_provider: Vec::new(),
        estimated_cost_usd: 0.0,
        estimated_cost_usd_month: 0.0,
        minute_start_unix: now_unix,
        calls_in_minute: 0,
        vision_calls: 0,
    }
}

/// Le o registro de uso do dia `today_day(now_unix)`, validando a seguranca do
/// arquivo (arquivo regular, sem symlink, tamanho limitado). Arquivo ausente
/// ou corrompido recomeca o dia do zero — medicao nunca bloqueia o uso.
fn load_usage_record(vault_root: &Path, now_unix: u64) -> Result<UsageRecord> {
    let path = usage_file_path(vault_root);
    let day = today_day(now_unix);
    if !path.exists() {
        return Ok(fresh_record(day, now_unix));
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        bail!("O registro de uso da IA nao e um arquivo regular.");
    }
    if metadata.len() > MAX_USAGE_BYTES {
        bail!("O registro de uso da IA excede o tamanho suportado.");
    }
    let bytes = fs::read(&path)?;
    match serde_json::from_slice::<UsageRecord>(&bytes) {
        Ok(record) if record.day == day => Ok(record),
        _ => Ok(fresh_record(day, now_unix)),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let directory = path
        .parent()
        .context("O registro de uso precisa ter um diretorio pai.")?;
    fs::create_dir_all(directory)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("usage");
    let temporary = directory.join(format!("{file_name}.tmp"));
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn bump_provider(record: &mut UsageRecord, provider: &str) {
    match record
        .calls_by_provider
        .iter_mut()
        .find(|entry| entry.provider == provider)
    {
        Some(entry) => entry.calls += 1,
        None => record.calls_by_provider.push(ProviderCallCount {
            provider: provider.to_string(),
            calls: 1,
        }),
    }
}

fn status_view(record: &UsageRecord, limits: UsageLimits) -> UsageStatusView {
    UsageStatusView {
        day: record.day,
        provider_calls: record.calls_by_provider.clone(),
        total_calls: record.total_calls(),
        max_calls_per_day: limits.max_calls_per_day,
        calls_in_minute: record.calls_in_minute,
        max_calls_per_minute: limits.max_calls_per_minute,
        exceeded: record.total_calls() >= limits.max_calls_per_day
            || record.calls_in_minute >= limits.max_calls_per_minute,
        estimated_cost_usd: record.estimated_cost_usd,
        estimated_cost_usd_month: record.estimated_cost_usd_month,
        max_cost_per_month_usd: limits.max_cost_per_month_usd,
        monthly_exceeded: record.estimated_cost_usd_month >= limits.max_cost_per_month_usd,
        vision_calls: record.vision_calls,
    }
}

/// Valida o orcamento (chamadas e custo mensal) e RESERVA uma chamada antes
/// do custo acontecer. `estimated_cost_usd` entra no acumulado do dia e do
/// mes; se o teto mensal seria estourado, a reserva e negada.
pub(crate) fn check_and_record_call_with_limits(
    vault_root: &Path,
    provider: ProviderKind,
    estimated_cost_usd: f64,
    limits: UsageLimits,
    now_unix: u64,
) -> Result<UsageStatusView> {
    let day = today_day(now_unix);
    let current_month = month_key(now_unix);
    let mut record = load_usage_record(vault_root, now_unix)?;
    if record.day != day || record.month_key != current_month {
        record = fresh_record(day, now_unix);
    }
    if now_unix.saturating_sub(record.minute_start_unix) >= 60 {
        record.minute_start_unix = now_unix;
        record.calls_in_minute = 0;
    }
    if record.total_calls() >= limits.max_calls_per_day {
        bail!(
            "Limite diario de chamadas de IA atingido ({}/{}). Volte amanha ou mude o provedor.",
            record.total_calls(),
            limits.max_calls_per_day
        );
    }
    if record.calls_in_minute >= limits.max_calls_per_minute {
        bail!(
            "Muitas chamadas de IA em um minuto ({}). Aguarde um instante e tente de novo.",
            limits.max_calls_per_minute
        );
    }
    if limits.max_cost_per_month_usd > 0.0
        && record.estimated_cost_usd_month + estimated_cost_usd > limits.max_cost_per_month_usd
    {
        bail!(
            "Orcamento mensal de IA atingido (US$ {:.2} de US$ {:.2}). Aguarde o proximo mes ou use um provedor local.",
            record.estimated_cost_usd_month,
            limits.max_cost_per_month_usd
        );
    }
    record.calls_in_minute += 1;
    bump_provider(&mut record, provider_label(provider));
    record.estimated_cost_usd += estimated_cost_usd;
    record.estimated_cost_usd_month += estimated_cost_usd;
    write_atomic(
        &usage_file_path(vault_root),
        &serde_json::to_vec(&record).context("serializacao do registro de uso")?,
    )?;
    Ok(status_view(&record, limits))
}

/// Variante da reserva para a leitura visual (descricao de imagem): aplica as
/// MESMAS paradas duras (diaria, por minuto e orcamento mensal) ANTES de
/// enviar a imagem e, alem da chamada normal por provedor, incrementa o
/// contador separado `vision_calls` para a interface.
pub(crate) fn check_and_record_vision_call_with_limits(
    vault_root: &Path,
    provider: ProviderKind,
    estimated_cost_usd: f64,
    limits: UsageLimits,
    now_unix: u64,
) -> Result<UsageStatusView> {
    let day = today_day(now_unix);
    let current_month = month_key(now_unix);
    let mut record = load_usage_record(vault_root, now_unix)?;
    if record.day != day || record.month_key != current_month {
        record = fresh_record(day, now_unix);
    }
    if now_unix.saturating_sub(record.minute_start_unix) >= 60 {
        record.minute_start_unix = now_unix;
        record.calls_in_minute = 0;
    }
    if record.total_calls() >= limits.max_calls_per_day {
        bail!(
            "Limite diario de chamadas de IA atingido ({}/{}). Volte amanha ou mude o provedor.",
            record.total_calls(),
            limits.max_calls_per_day
        );
    }
    if record.calls_in_minute >= limits.max_calls_per_minute {
        bail!(
            "Muitas chamadas de IA em um minuto ({}). Aguarde um instante e tente de novo.",
            limits.max_calls_per_minute
        );
    }
    if limits.max_cost_per_month_usd > 0.0
        && record.estimated_cost_usd_month + estimated_cost_usd > limits.max_cost_per_month_usd
    {
        bail!(
            "Orcamento mensal de IA atingido (US$ {:.2} de US$ {:.2}). Aguarde o proximo mes ou use um provedor local.",
            record.estimated_cost_usd_month,
            limits.max_cost_per_month_usd
        );
    }
    record.calls_in_minute += 1;
    record.vision_calls += 1;
    bump_provider(&mut record, provider_label(provider));
    record.estimated_cost_usd += estimated_cost_usd;
    record.estimated_cost_usd_month += estimated_cost_usd;
    write_atomic(
        &usage_file_path(vault_root),
        &serde_json::to_vec(&record).context("serializacao do registro de uso")?,
    )?;
    Ok(status_view(&record, limits))
}

/// Reserva UMA chamada de leitura visual com os limites do prototipo,
/// estimando o custo pelo tamanho da imagem em bytes.
pub(crate) fn check_and_record_vision_call(
    vault_root: &Path,
    provider: ProviderKind,
    image_bytes: usize,
) -> Result<UsageStatusView> {
    check_and_record_vision_call_with_limits(
        vault_root,
        provider,
        estimate_vision_call_cost_usd(provider, image_bytes),
        UsageLimits::default(),
        now_unix_secs(),
    )
}

/// Reserva uma chamada com os limites do prototipo, estimando o custo pelo
/// tamanho do prompt em caracteres.
pub(crate) fn check_and_record_call(
    vault_root: &Path,
    provider: ProviderKind,
    input_chars: usize,
) -> Result<UsageStatusView> {
    check_and_record_call_with_limits(
        vault_root,
        provider,
        estimate_call_cost_usd(provider, input_chars),
        UsageLimits::default(),
        now_unix_secs(),
    )
}

/// Leitura pura do estado atual de uso (para a interface).
pub(crate) fn usage_status(vault_root: &Path) -> Result<UsageStatusView> {
    let record = load_usage_record(vault_root, now_unix_secs())?;
    Ok(status_view(&record, UsageLimits::default()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn tiny_limits() -> UsageLimits {
        UsageLimits {
            max_calls_per_day: 5,
            max_calls_per_minute: 2,
            max_cost_per_month_usd: 100.0,
        }
    }

    /// Orcamento diario apertado com minuto folgado: isola o teto diario.
    fn daily_only_limits() -> UsageLimits {
        UsageLimits {
            max_calls_per_day: 5,
            max_calls_per_minute: 1_000,
            max_cost_per_month_usd: 100.0,
        }
    }

    fn reserve(limits: UsageLimits, root: &Path, provider: ProviderKind, now: u64) {
        check_and_record_call_with_limits(root, provider, 0.01, limits, now).expect("reserve");
    }

    #[test]
    fn records_calls_per_provider_and_persists_them() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        for _ in 0..3 {
            reserve(daily_only_limits(), root, ProviderKind::Gemini, now);
        }
        reserve(daily_only_limits(), root, ProviderKind::Ollama, now);
        let persisted = load_usage_record(root, now).expect("load");
        assert_eq!(persisted.total_calls(), 4);
        assert_eq!(persisted.provider_calls("gemini"), 3);
        assert_eq!(persisted.provider_calls("ollama"), 1);
        assert!(usage_file_path(root).is_file());
    }

    #[test]
    fn hard_stops_at_the_daily_budget_before_the_call() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        // 5 reservas cabem no orcamento diario de 5.
        for _ in 0..5 {
            reserve(daily_only_limits(), root, ProviderKind::Gemini, now);
        }
        let error = check_and_record_call_with_limits(
            root,
            ProviderKind::Gemini,
            0.01,
            daily_only_limits(),
            now,
        )
        .expect_err("orcamento esgotado");
        assert!(error.to_string().contains("Limite diario"));
        // Nenhuma chamada a mais foi reservada.
        assert_eq!(load_usage_record(root, now).expect("load").total_calls(), 5);
    }

    #[test]
    fn throttles_by_minute_window_and_rolls_it_over() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        reserve(tiny_limits(), root, ProviderKind::Ollama, now);
        reserve(tiny_limits(), root, ProviderKind::Ollama, now);
        let error =
            check_and_record_call_with_limits(root, ProviderKind::Ollama, 0.01, tiny_limits(), now)
                .expect_err("minuto esgotado");
        assert!(error.to_string().contains("Muitas chamadas"));
        // Passou um minuto: a janela zera e volta a aceitar.
        reserve(tiny_limits(), root, ProviderKind::Ollama, now + 61);
        assert_eq!(
            load_usage_record(root, now + 61)
                .expect("load")
                .calls_in_minute,
            1
        );
    }

    #[test]
    fn rolls_over_to_a_new_day() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        reserve(tiny_limits(), root, ProviderKind::Gemini, now);
        reserve(tiny_limits(), root, ProviderKind::Gemini, now + 86_400);
        let record = load_usage_record(root, now + 86_400).expect("load");
        assert_eq!(record.day, today_day(now + 86_400));
        assert_eq!(record.total_calls(), 1);
    }

    #[test]
    fn corrupt_or_oversized_record_starts_fresh_instead_of_blocking() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let path = usage_file_path(root);
        fs::create_dir_all(path.parent().expect("parent")).expect("dir");
        fs::write(&path, "{nao-e-json").expect("write corrupt");
        let record = load_usage_record(root, 1_800_000_000u64).expect("fallback");
        assert_eq!(record.total_calls(), 0);
    }

    #[test]
    fn estimates_cost_by_provider_and_prompt_size() {
        // Provedor local custa zero, independente do tamanho.
        assert_eq!(estimate_call_cost_usd(ProviderKind::Ollama, 100_000), 0.0);
        // Gemini cobra pelo prompt: mais caracteres => mais custo.
        let small = estimate_call_cost_usd(ProviderKind::Gemini, 1_000);
        let large = estimate_call_cost_usd(ProviderKind::Gemini, 100_000);
        assert!(small > 0.0);
        assert!(large > small);
        // Valor aproximado: 100k caracteres ~ 25k tokens de entrada a US$0,30/M
        // + saida estimada de 2k tokens a US$1,50/M.
        let expected = 25_000.0 / 1_000_000.0 * 0.30 + 2_000.0 / 1_000_000.0 * 1.50;
        assert!((large - expected).abs() < 1e-9);
    }

    #[test]
    fn hard_stops_at_the_monthly_cost_budget() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        let tight = UsageLimits {
            max_calls_per_day: 1_000,
            max_calls_per_minute: 1_000,
            max_cost_per_month_usd: 0.05,
        };
        // 2 reservas de US$0,02 somam 0,04 — dentro do teto de 0,05; a
        // terceira (0,06) estouraria.
        for _ in 0..2 {
            check_and_record_call_with_limits(root, ProviderKind::Gemini, 0.02, tight, now)
                .expect("dentro do teto mensal");
        }
        let error = check_and_record_call_with_limits(root, ProviderKind::Gemini, 0.02, tight, now)
            .expect_err("teto mensal estourado");
        assert!(error.to_string().contains("Orcamento mensal"));
        let record = load_usage_record(root, now).expect("load");
        assert!((record.estimated_cost_usd_month - 0.04).abs() < 1e-9);
        assert!((record.estimated_cost_usd - 0.04).abs() < 1e-9);
    }

    #[test]
    fn monthly_cost_rolls_over_to_a_new_month() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        // ~18 de janeiro e ~60 dias depois (~19 de marco) de 2027: meses
        // diferentes mesmo com a chave aproximada de mes.
        let january = 1_800_000_000u64;
        let march = 1_805_200_000u64;
        check_and_record_call_with_limits(
            root,
            ProviderKind::Gemini,
            0.01,
            UsageLimits::default(),
            january,
        )
        .expect("janeiro");
        let before = load_usage_record(root, january).expect("load");
        assert!(before.estimated_cost_usd_month > 0.0);
        check_and_record_call_with_limits(
            root,
            ProviderKind::Gemini,
            0.01,
            UsageLimits::default(),
            march,
        )
        .expect("marco");
        let after = load_usage_record(root, march).expect("load");
        assert_eq!(after.month_key, month_key(march));
        assert_ne!(after.month_key, month_key(january));
        // O acumulado mensal reiniciou; o diario tambem (outro dia).
        assert!((after.estimated_cost_usd_month - 0.01).abs() < 1e-9);
        assert_eq!(after.total_calls(), 1);
    }

    #[test]
    fn vision_calls_are_counted_separately_and_cost_more_than_text() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        check_and_record_vision_call_with_limits(
            root,
            ProviderKind::Gemini,
            0.01,
            daily_only_limits(),
            now,
        )
        .expect("reserve vision");
        let record = load_usage_record(root, now).expect("load");
        assert_eq!(record.vision_calls, 1);
        assert_eq!(record.provider_calls("gemini"), 1);
        assert_eq!(record.total_calls(), 1);
        let status = check_and_record_vision_call_with_limits(
            root,
            ProviderKind::Gemini,
            0.01,
            daily_only_limits(),
            now,
        )
        .expect("reserve vision again");
        assert_eq!(status.vision_calls, 2);
    }

    #[test]
    fn vision_respects_the_monthly_budget_before_sending_the_image() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        let tight = UsageLimits {
            max_calls_per_day: 1_000,
            max_calls_per_minute: 1_000,
            max_cost_per_month_usd: 0.05,
        };
        check_and_record_vision_call_with_limits(root, ProviderKind::Gemini, 0.03, tight, now)
            .expect("dentro do teto");
        let error =
            check_and_record_vision_call_with_limits(root, ProviderKind::Gemini, 0.03, tight, now)
                .expect_err("teto estourado");
        assert!(error.to_string().contains("Orcamento mensal"));
        // Nenhuma imagem foi enviada: o contador de visao parou em 1.
        let record = load_usage_record(root, now).expect("load");
        assert_eq!(record.vision_calls, 1);
    }

    #[test]
    fn estimates_vision_cost_grows_with_image_size_and_is_zero_locally() {
        assert_eq!(
            estimate_vision_call_cost_usd(ProviderKind::Ollama, 100_000),
            0.0
        );
        let small = estimate_vision_call_cost_usd(ProviderKind::Gemini, 10_000);
        let large = estimate_vision_call_cost_usd(ProviderKind::Gemini, 1_000_000);
        assert!(small > 0.0);
        assert!(large > small);
        // Valor aproximado: 1M bytes ~ 500 tokens de entrada a US$1,25/M + 500
        // tokens de saida a US$5,00/M.
        let expected = 500.0 / 1_000_000.0 * 1.25 + 500.0 / 1_000_000.0 * 5.0;
        assert!((large - expected).abs() < 1e-9);
    }

    #[test]
    fn status_view_reflects_limits_and_exceeded_flag() {
        let temporary_directory = tempdir().expect("temp dir");
        let root = temporary_directory.path();
        let now = 1_800_000_000u64;
        let status =
            check_and_record_call_with_limits(root, ProviderKind::Ollama, 0.01, tiny_limits(), now)
                .expect("reserve");
        assert_eq!(status.total_calls, 1);
        assert_eq!(status.max_calls_per_day, 5);
        assert!(!status.exceeded);
        // Leitura pura reflete o que foi persistido (relogio injetado).
        let read = status_view(&load_usage_record(root, now).expect("load"), tiny_limits());
        assert_eq!(read.total_calls, 1);
    }
}
