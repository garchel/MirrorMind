//! Medicao real do motor calibrado contra o caminho legado (F1).
//!
//! Este arquivo e o unico lugar do repositorio que chama um modelo de verdade
//! para purposes de *medicao*. Ele e `#[ignore]` por padrao e so roda com
//! `MIRRORMIND_JEV_EVAL=1`, no mesmo padrao de `integration.rs`
//! (`MIRRORMIND_REAL_AI_TESTS`).
//!
//! Por que `#[ignore]` e nao apenas uma variavel: sem isso, um `cargo test`
//! no CI sem credencial gastaria chamada real, ou falharia por falta de rede.
//! `#[ignore]` deixa o custo sempre opt-in.
//!
//! O relatorio sai em `docs/jev-eval-report.json` e **deve ser commitado**:
//! ele e o baseline contra o qual a proxima rodada se compara.
//!
//! ```bash
//! MIRRORMIND_JEV_EVAL=1 cargo test --test jev_eval -- --ignored --nocapture
//! ```

use mirrormind_lib::review::calibrated::assertions::{
    classify_assertions, measure_order_bias as measure_order_bias_for, PendingAssertion,
};
use mirrormind_lib::review::calibrated::eval::golden::{
    resolve_note_path, CaseFailure, EngineReport, ExpectedDefinition, GoldenSet,
};
use mirrormind_lib::review::calibrated::eval::metrics::{Prediction, ScoredCase};
use mirrormind_lib::review::calibrated::eval::{ComparisonReport, DEFAULT_THRESHOLDS};
use mirrormind_lib::review::calibrated::improvements::confirm_definition_proposals;
use mirrormind_lib::review::calibrated::proposals::{propose_improvements, ImprovementScope};
use mirrormind_lib::review::calibrated::readiness::{
    candidates_from_report, classify_readiness, merge_with_prose,
};
use mirrormind_lib::review::calibrated::TypeSafeProvider;
use mirrormind_lib::review::contract::AssertionStatus;
use mirrormind_lib::review::credentials::{
    has_typesafe_consent, load_typesafe_api_key, NativeCredentialStore,
};
use mirrormind_lib::review::evaluation::{evaluate_readiness, ReadinessAttempt, ReadinessStatus};
use mirrormind_lib::review::provider::{OllamaProvider, OLLAMA_MODEL};
use mirrormind_lib::review::segmentation::DEFAULT_MAX_WHOLE_NOTE_WORDS;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

const ENV_EVAL: &str = "MIRRORMIND_JEV_EVAL";

/// Limiar de ECE acima do qual a confianca nao pode aparecer na UI.
const MAX_ECE: f64 = 0.10;

fn set_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("jev-golden")
}

fn report_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("docs")
        .join("jev-eval-report.json")
}

fn load_set() -> GoldenSet {
    let raw = std::fs::read_to_string(set_root().join("golden.json"))
        .expect("tests/fixtures/jev-golden/golden.json deve existir");
    serde_json::from_str(&raw).expect("golden.json deve seguir o formato declarado")
}

fn note_of(case_note: &str) -> String {
    std::fs::read_to_string(resolve_note_path(&set_root(), case_note).expect("caminho valido"))
        .unwrap_or_else(|error| panic!("nota `{case_note}` ilegivel: {error}"))
}

fn readiness_label(attempt: &ReadinessAttempt) -> Option<&'static str> {
    match attempt {
        ReadinessAttempt::Valid { report, .. } => Some(match report.status {
            ReadinessStatus::Ready => "ready",
            ReadinessStatus::Ambiguous => "ambiguous",
            ReadinessStatus::Insufficient => "insufficient",
        }),
        ReadinessAttempt::Invalid { .. } => None,
    }
}

/// Resumo do vies de ordem.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OrderBiasSummary {
    cases_measured: usize,
    mean_disagreement_rate: f64,
    favoured_options: BTreeMap<String, usize>,
    failures: Vec<String>,
}

/// Mede o vies de ordem das afirmacoes (D12).
///
/// Criterio do gate: se rotacionar as opcoes muda o veredito, o Caminho A esta
/// contaminado — o status que o motor devolve dependeria da **posicao** da
/// opcao, e nao do conteudo.
fn measure_order_bias(set: &GoldenSet, provider: &TypeSafeProvider) -> OrderBiasSummary {
    let mut summary = OrderBiasSummary::default();
    let mut total = 0.0;
    for case in &set.cases {
        if case.exchanges.is_empty() {
            continue;
        }
        let assertions: Vec<PendingAssertion> = case
            .exchanges
            .iter()
            .map(|exchange| PendingAssertion {
                text: exchange.answer.clone(),
                source_quote: exchange.answer.clone(),
            })
            .collect();
        let transcript = serde_json::json!(case
            .exchanges
            .iter()
            .map(|exchange| json!({
                "prompt": exchange.prompt,
                "answer": exchange.answer,
            }))
            .collect::<Vec<_>>());
        match measure_order_bias_for(provider, &note_of(&case.note), &transcript, &assertions, 3) {
            Ok(report) => {
                summary.cases_measured += 1;
                total += report.disagreement_rate;
                if let Some(favoured) = &report.favoured_option {
                    *summary
                        .favoured_options
                        .entry(favoured.clone())
                        .or_default() += 1;
                }
            }
            Err(failure) => {
                summary
                    .failures
                    .push(format!("{}: {}", case.id, failure.message));
            }
        }
    }
    if summary.cases_measured > 0 {
        summary.mean_disagreement_rate = total / summary.cases_measured as f64;
    }
    summary
}

/// Roda o pipeline JEV.
fn run_jev(set: &GoldenSet, legacy_provider: &OllamaProvider) -> (EngineReport, Vec<ScoredCase>) {
    let mut report = EngineReport::new("jev", "jev-latest");
    let mut cases = Vec::new();

    let store = NativeCredentialStore::new();
    let api_key = load_typesafe_api_key(&store)
        .expect("chave legivel")
        .expect("a chave da TypeSafe AI precisa estar no cofre antes de medir");
    let provider = TypeSafeProvider::new(api_key).expect("provider JEV");

    for case in &set.cases {
        let markdown = note_of(&case.note);

        // O caminho **de producao**, e nao um proxy.
        //
        // A primeira versao deste harness media uma pergunta de status
        // simplificada, feita aqui. O app nao usa essa pergunta: ele usa
        // `calibrated::readiness::classify_readiness`, que faz a pergunta de
        // status **e** uma pergunta de issue por candidato, e depois funde o
        // veredito com a prosa do legado (`merge_with_prose`).
        //
        // Medir o proxy produziu 19 de 23. O caminho de producao produz 22 de
        // 23 nos mesmos casos. Todo o relatório — ECE, "4 erros", gate — mediu
        // a coisa errada.
        let legacy_report = legacy_readiness_report(legacy_provider, &markdown);
        let (status, confidence, distribution) = match &legacy_report {
            Some(legacy_report) => {
                let candidates = candidates_from_report(legacy_report);
                match classify_readiness(&provider, &markdown, &candidates) {
                    Ok(calibrated) => {
                        // O status final e o **mesclado**, nao o bruto.
                        //
                        // `adopt_status` muda o veredito de forma
                        // consequente: se o JEV diz que nao esta pronta mas o
                        // legado nao propoe nenhum issue, o app volta ao status
                        // do legado — porque rebaixar a nota sem ter o que
                        // dizer por que e pior do que nao rebaixar. Medir o
                        // status bruto mediria uma opiniao que o usuario
                        // nunca ve.
                        let merged = merge_with_prose(&calibrated, legacy_report);
                        (
                            merged.status.as_str().to_string(),
                            calibrated.confidence,
                            calibrated.status_probabilities.clone(),
                        )
                    }
                    Err(failure) => {
                        report.failures.push(CaseFailure {
                            case_id: case.id.clone(),
                            dimension: "readiness".to_string(),
                            message: failure.message,
                        });
                        continue;
                    }
                }
            }
            None => {
                // Sem relatorio legado nao ha candidatos: a mesma coisa que
                // acontece no app.
                match classify_readiness(&provider, &markdown, &[]) {
                    Ok(calibrated) => (
                        calibrated.status.as_str().to_string(),
                        calibrated.confidence,
                        calibrated.status_probabilities.clone(),
                    ),
                    Err(failure) => {
                        report.failures.push(CaseFailure {
                            case_id: case.id.clone(),
                            dimension: "readiness".to_string(),
                            message: failure.message,
                        });
                        continue;
                    }
                }
            }
        };

        cases.push(ScoredCase {
            id: case.id.clone(),
            expected: case.readiness.value().to_string(),
            provenance: case.readiness.provenance(),
            prediction: Prediction {
                label: status,
                distribution,
                confidence: Some(confidence),
                latency_ms: 0,
                estimated_cost_usd: 0.0,
            },
            note: case.readiness.why().map(str::to_string),
        });
    }
    (report, cases)
}

/// O relatorio de prontidao que o caminho legado produz, para servir de
/// candidatos ao JEV — exatamente como o app faz.
fn legacy_readiness_report(
    provider: &OllamaProvider,
    markdown: &str,
) -> Option<mirrormind_lib::review::evaluation::ReadinessReport> {
    let attempt =
        evaluate_readiness(provider, markdown, DEFAULT_MAX_WHOLE_NOTE_WORDS, None).ok()?;
    match attempt {
        ReadinessAttempt::Valid { report, .. } => Some(report),
        ReadinessAttempt::Invalid { .. } => None,
    }
}

/// Roda o pipeline legado pelo mesmo caminho de producao.
///
/// `OllamaProvider` e local e de graca, o que torna o baseline reproduzivel
/// em qualquer maquina sem credencial. Quando o Ollama nao esta de pe, a
/// rodada registra a falha em vez de comparar contra vazio — um baseline
/// ausente se disfarca de baseline perfeito.
fn run_legacy(set: &GoldenSet) -> (EngineReport, Vec<ScoredCase>) {
    let mut report = EngineReport::new("legacy", OLLAMA_MODEL);
    let mut cases = Vec::new();

    let provider = match OllamaProvider::new() {
        Ok(provider) => provider,
        Err(error) => {
            report.failures.push(CaseFailure {
                case_id: "-".to_string(),
                dimension: "setup".to_string(),
                message: format!("Ollama indisponivel: {error}"),
            });
            return (report, cases);
        }
    };

    for case in &set.cases {
        let markdown = note_of(&case.note);
        let started = std::time::Instant::now();
        let attempt = evaluate_readiness(&provider, &markdown, DEFAULT_MAX_WHOLE_NOTE_WORDS, None);
        let latency = started.elapsed().as_millis() as u64;
        let attempt = match attempt {
            Ok(attempt) => attempt,
            Err(error) => {
                report.failures.push(CaseFailure {
                    case_id: case.id.clone(),
                    dimension: "readiness".to_string(),
                    message: error.to_string(),
                });
                continue;
            }
        };
        let Some(label) = readiness_label(&attempt) else {
            report.failures.push(CaseFailure {
                case_id: case.id.clone(),
                dimension: "readiness".to_string(),
                message: "avaliacao invalida: o parse ou o grounding falhou".to_string(),
            });
            continue;
        };
        cases.push(ScoredCase {
            id: case.id.clone(),
            expected: case.readiness.value().to_string(),
            provenance: case.readiness.provenance(),
            prediction: Prediction {
                label: label.to_string(),
                // O legado nao produz distribuicao nem confianca. Vazio e o
                // que marca `carries_uncertainty() == false` e mantem o ECE
                // fora do comparativo.
                distribution: BTreeMap::new(),
                confidence: None,
                latency_ms: latency,
                estimated_cost_usd: 0.0,
            },
            note: case.readiness.why().map(str::to_string),
        });
    }
    (report, cases)
}

/// Resumo do **recall** das sugestoes de definicao.
///
/// ## Por que recall e nao precisao
///
/// A lista do revisor pode estar incompleta: um revisor pode deixar passar
/// um termo. Contar precisao contra uma lista incompleta seria injusto — uma
/// proposta fora da lista seria tratada como falso positivo mesmo que o
/// revisor apenas nao a viu.
///
/// O recall nao sofre disso: das definicoes que o revisor disse que
/// melhorariam a nota, quantas o pipeline encontrou? Essa pergunta tem
/// resposta certa mesmo com a lista incompleta.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DefinitionRecallSummary {
    /// Casos do conjunto que tem ground truth de definicoes.
    ///
    /// E o denominador honesto: um recall medido em 3 de 23 casos e um
    /// recall de 13%, nao um recall de 100%.
    cases_with_ground_truth: usize,
    /// Casos do conjunto no total.
    cases_total: usize,
    /// Casos efetivamente medidos (tinha ground truth e o pipeline rodou).
    cases_measured: usize,
    /// Casos que tinham ground truth e **nao** puderam ser medidos.
    ///
    /// Uma falha do provider ou do motor no meio do caso nao e um caso sem
    /// termos esperados: e um caso que nao foi medido. Separar os dois evita
    /// que a falha suma do relatorio.
    cases_failed: usize,
    /// Termos que o revisor disse que melhorariam a nota.
    expected_terms: usize,
    /// Termos que o pipeline encontrou, por **nome exato**.
    found_terms: usize,
    /// Termos que o pipeline encontrou quando o nome pode variar.
    ///
    /// `capacidade de suporte do meio` e `capacidade de suporte` sao o mesmo
    /// conhecimento que falta; contar so a igualdade penaliza o motor duas
    /// vezes (perde no recall e vira "extra" na mesma rodada). O numero exato
    /// continua ao lado para a serie historica seguir comparavel.
    found_terms_tolerant: usize,
    /// Termos que o pipeline propose e o revisor nao listou.
    ///
    /// **Nao e falso positivo**: a lista do revisor pode estar incompleta.
    /// E um numero de contexto.
    extra_terms: usize,
    /// Os mesmos extras, com o casamento tolerante a variacao de nome.
    extra_terms_tolerant: usize,
    /// Os casos em que o pipeline nao achou nenhum termo esperado.
    missed_cases: Vec<String>,
    /// Onde cada termo esperado (ausente no nome exato) morreu no funil.
    ///
    /// Quatro causas, quatro consertos: nunca proposto -> geracao; recusado
    /// pelo filtro -> ancora/citacao; recusado pelo motor -> julgamento;
    /// proposto com outro nome -> metrica. Sem essa separacao, "faltaram 23"
    /// e um numero que nao diz o que fazer.
    missed_terms: Vec<MissedTerm>,
    /// Ausentes que nunca foram oferecidos ao motor.
    missed_never_proposed: usize,
    /// Ausentes que o filtro deterministico recusou antes do motor.
    missed_rejected_by_filter: usize,
    /// Ausentes que chegaram ao motor e foram recusados por ele.
    missed_rejected_by_engine: usize,
    /// Ausentes que o pipeline achou com outro nome (prefixo/sufixo).
    missed_name_variant: usize,
    /// Ausentes cujo caso o provider nao conseguiu processar.
    ///
    /// Nao e "nunca proposto": o provider nem chegou a responder. O termo
    /// continua no denominador porque o revisor o listou, mas a causa e outra.
    missed_case_failed: usize,
    /// Ausentes cujo caso o motor nao conseguiu julgar.
    missed_judge_failed: usize,
    /// As definicoes aceitas, com o texto que o provider escreveu.
    ///
    /// O relatorio guarda os termos desde a rodada 3 e nunca o texto. Sem ele,
    /// a revisao julga se o termo precisava de definicao, nao se a definicao
    /// presta - e a qualidade textual fica sem ground truth.
    accepted_terms: Vec<AcceptedTerm>,
    failures: Vec<String>,
    /// Termos que o provider **propôs** e o JEV **recusou**.
    ///
    /// A distincao importa: um termo que nunca foi proposto e um termo que o
    /// motor disse "esse aqui nao precisa de definicao" sao problemas
    /// **diferentes**, com consertos diferentes. Sem essa contagem, o recall
    /// baixo nao diz onde esta a perda.
    rejected_by_engine: Vec<String>,
    /// Quantos termos o provider propôs (antes da confirmacao do motor).
    proposed_terms: usize,
    /// Quantas definicoes o provider **ofereceu**, antes do filtro determinista.
    ///
    /// E o topo do funil. Sem ele, "28 passaram" nao diz se o provider
    /// ofereceu 28 ou 300: a perda pode estar na geracao ou no filtro, e as
    /// duas tem consertos completamente diferentes.
    raw_proposals: usize,
    /// Quantas definicoes a passada de cobertura ofereceu (a segunda pergunta).
    ///
    /// A primeira passada pede "todos os termos" e entrega ~1,6; a segunda
    /// pergunta o que faltou. Sem esse numero, o funil nao diz se a cobertura
    /// funcionou ou se o modelo simplesmente repetiu o que ja tinha dito.
    coverage_proposals: usize,
    /// Propostas repetidas descartadas no merge das duas passadas.
    duplicates_dropped: usize,
    /// Propostas que o modelo ofereceu acima do limite e foram cortadas.
    ///
    /// Truncar e o preco de nao recusar a resposta inteira quando o modelo
    /// estoura o pedido. Se este numero crescer, o limite do prompt esta
    /// apertado demais para o modelo - e o recall medido e o do limite, nao o
    /// da capacidade dele.
    truncated_proposals: usize,
    /// Casos em que a passada de cobertura falhou (a primeira valeu sozinha).
    coverage_failed_cases: usize,
    /// Termos que o motor aceitou e que **nao** casaram com nenhum esperado.
    ///
    /// Nao sao falsos positivos automaticos: podem ser sinonimos do termo
    /// esperado (recall medido por nome exato subestima), ou termos extras que
    /// o revisor nao listou. Ficam visiveis para a revisao humana decidir.
    accepted_unmatched_terms: Vec<String>,
    /// Quantas definicoes o filtro determinista recusou, por motivo.
    ///
    /// O filtro e a **primeira** etapa: ele checa a ancora (a citacao existe
    /// na nota?) e a coerencia (o termo aparece?). Uma recusa aqui e um
    /// provider propondo mal, nao um erro do motor.
    filtered_out_terms: usize,
    /// As recusas do filtro, agrupadas por motivo.
    filtered_out_by_reason: std::collections::BTreeMap<String, usize>,
    /// As recusas do filtro **com o termo e o motivo**, para auditoria.
    ///
    /// A contagem por motivo diz que 5 propostas caíram em "a definicao ja
    /// aparece na nota"; nao diz **quais**. Sem os nomes nao ha como auditar
    /// se o filtro esta certo — e um filtro que recusa demais custa recall
    /// exatamente como uma geracao que propoe de menos.
    rejected_by_filter: Vec<String>,
}

/// Onde um termo esperado morreu no funil.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MissedTerm {
    case_id: String,
    term: String,
    /// `neverProposed`, `rejectedByFilter`, `rejectedByEngine` ou
    /// `nameVariant`.
    stage: &'static str,
    /// O nome que o pipeline propos, quando a causa foi variacao de nome.
    proposed_as: Option<String>,
}

/// Uma definicao aceita, com o texto que o provider escreveu.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedTerm {
    case_id: String,
    term: String,
    definition: String,
    /// Casou com um termo esperado (nome exato ou variacao tolerante)?
    matched_expected: bool,
}

impl DefinitionRecallSummary {
    /// O recall, ou `None` quando a dimensao nao foi medida.
    ///
    /// `0/0` nao e `0%` nem `100%`: e a ausencia de medida. Reportar um
    /// numero ali seria o mesmo erro de um relatorio que mostra `0` onde
    /// nao houve medicao.
    fn recall(&self) -> Option<f64> {
        if self.expected_terms == 0 {
            return None;
        }
        Some(self.found_terms as f64 / self.expected_terms as f64)
    }

    /// O recall quando o nome do termo pode variar (prefixo/sufixo).
    fn recall_tolerant(&self) -> Option<f64> {
        if self.expected_terms == 0 {
            return None;
        }
        Some(self.found_terms_tolerant as f64 / self.expected_terms as f64)
    }

    /// A dimensao foi medida?
    fn is_measured(&self) -> bool {
        self.recall().is_some()
    }
}

/// O que a medicao das melhorias produz: as definicoes e as expansoes.
///
/// As duas saem do **mesmo** `propose_improvements`, numa passada so. Separar
/// em duas funcoes chamaria o provider duas vezes por caso, e o custo da
/// rodada dobraria sem medir nada de novo.
#[derive(Debug, Default, Clone)]
struct ImprovementsMeasurement {
    definitions: DefinitionRecallSummary,
    expansions: ExpansionFunnel,
}

/// O funil das expansoes, em todos os casos do conjunto.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpansionFunnel {
    cases_total: usize,
    cases_measured: usize,
    raw_expansions: usize,
    expansions_accepted: usize,
    expansions_rejected: usize,
    failures: Vec<String>,
}

impl ExpansionFunnel {
    /// A taxa de aceitacao da ancora.
    ///
    /// `None` quando o provider nao ofereceu nenhuma expansao: `0/0` nao e
    /// `0%` — e a ausencia de medida.
    fn acceptance_rate(&self) -> Option<f64> {
        if self.raw_expansions == 0 {
            return None;
        }
        Some(self.expansions_accepted as f64 / self.raw_expansions as f64)
    }
}

/// A acuracia do status das trocas (C1/C2) contra o ground truth.
///
/// O ground truth das trocas ja existia, mas era usado so no vies de ordem:
/// media-se a **estabilidade** da resposta, nunca se ela estava **certa**. As
/// duas perguntas sao diferentes — um motor constante e consistentemente
/// errado teria vies de ordem zero.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeAccuracySummary {
    cases_total: usize,
    cases_measured: usize,
    exchanges_total: usize,
    exchanges_correct: usize,
    failures: Vec<String>,
    /// As trocas em que o status previsto diferiu do esperado.
    misses: Vec<String>,
}

impl ExchangeAccuracySummary {
    /// A fracao de trocas com o status certo, ou `None` sem trocas medidas.
    fn accuracy(&self) -> Option<f64> {
        if self.exchanges_total == 0 {
            return None;
        }
        Some(self.exchanges_correct as f64 / self.exchanges_total as f64)
    }
}

fn status_label(status: AssertionStatus) -> &'static str {
    match status {
        AssertionStatus::Remembered => "remembered",
        AssertionStatus::Partial => "partial",
        AssertionStatus::Missing => "missing",
        AssertionStatus::Contradicted => "contradicted",
    }
}

fn measure_exchange_accuracy(
    set: &GoldenSet,
    provider: &TypeSafeProvider,
) -> ExchangeAccuracySummary {
    let mut summary = ExchangeAccuracySummary {
        cases_total: set.cases.len(),
        ..Default::default()
    };
    for case in &set.cases {
        if case.exchanges.is_empty() {
            continue;
        }
        let markdown = note_of(&case.note);
        let transcript = serde_json::json!(case
            .exchanges
            .iter()
            .map(|exchange| json!({
                "prompt": exchange.prompt,
                "answer": exchange.answer,
            }))
            .collect::<Vec<_>>());
        let assertions: Vec<PendingAssertion> = case
            .exchanges
            .iter()
            .map(|exchange| PendingAssertion {
                text: exchange.answer.clone(),
                source_quote: exchange.answer.clone(),
            })
            .collect();
        let classified = match classify_assertions(provider, &markdown, &transcript, &assertions) {
            Ok(classified) => classified,
            Err(failure) => {
                summary
                    .failures
                    .push(format!("{}: {}", case.id, failure.message));
                continue;
            }
        };
        summary.cases_measured += 1;
        for (exchange, verdict) in case.exchanges.iter().zip(&classified) {
            if !exchange.status_provenance.is_scorable() {
                continue;
            }
            summary.exchanges_total += 1;
            let predicted = status_label(verdict.status);
            if predicted == exchange.status {
                summary.exchanges_correct += 1;
            } else {
                summary.misses.push(format!(
                    "{}: esperado {}, previsto {predicted}",
                    case.id, exchange.status
                ));
            }
        }
    }
    summary
}

/// Conta os termos esperados de um caso que nao pode ser medido.
///
/// O denominador do recall e a lista revisada inteira. Se um caso sai da conta
/// porque o provider falhou, falhar **aumenta** o recall: na rodada 6 o
/// relatorio mostrou 25/46 (54,3%) quando o numero honesto era 25/54 (46,3%),
/// porque os 8 termos dos dois casos que falharam sumiram junto com a falha.
///
/// O termo continua no denominador e entra no funil com a etapa que diz por que
/// nao foi medido. "Nao medido" e um resultado; zero silencioso nao e.
fn mark_case_unmeasured(
    summary: &mut DefinitionRecallSummary,
    case_id: &str,
    stage: &'static str,
    expected_terms: &[ExpectedDefinition],
) {
    summary.cases_failed += 1;
    match stage {
        "judgeFailed" => summary.missed_judge_failed += expected_terms.len(),
        _ => summary.missed_case_failed += expected_terms.len(),
    }
    for term in expected_terms {
        summary.missed_terms.push(MissedTerm {
            case_id: case_id.to_string(),
            term: term.term.clone(),
            stage,
            proposed_as: None,
        });
    }
}

/// Soma ao denominador os termos esperados de um caso.
///
/// Chamado **antes** de rodar o pipeline, para que uma falha nao encolha o
/// denominador. O recall e "quantos dos termos que o revisor listou o pipeline
/// encontrou", e o revisor listou os termos mesmo quando o provider caiu.
fn count_expected_terms(
    summary: &mut DefinitionRecallSummary,
    expected_terms: &[ExpectedDefinition],
) {
    summary.expected_terms += expected_terms.len();
}

/// Mede o recall das definicoes e o funil das expansoes, numa passada so.
///
/// A expansao nao tem ground truth — nao existe "a frase certa" para um
/// trecho que o aluno escreveu apressado. O que da para medir e a taxa de
/// **aceitacao da ancora**: quantas expansoes o provider ofereceu e quantas
/// apontam para um trecho real da nota. Por isso ela e medida em todos os
/// casos, e nao so nos que tem ground truth de definicoes.
fn measure_improvements(
    set: &GoldenSet,
    legacy_provider: &OllamaProvider,
    calibrated: &TypeSafeProvider,
) -> ImprovementsMeasurement {
    let mut measurement = ImprovementsMeasurement {
        definitions: DefinitionRecallSummary {
            cases_total: set.cases.len(),
            ..Default::default()
        },
        expansions: ExpansionFunnel {
            cases_total: set.cases.len(),
            ..Default::default()
        },
    };
    for case in &set.cases {
        let expected = case.expected_definitions.as_ref();
        let has_ground_truth = expected.is_some();
        let expected = expected.filter(|terms| !terms.is_empty());
        if has_ground_truth {
            // Um caso revisado sem nenhum termo esperado conta como ground
            // truth: o revisor olhou e nao achou. So nao ha recall a medir
            // **nele**, porque nao ha termo para encontrar.
            measurement.definitions.cases_with_ground_truth += 1;
        }
        // O denominador entra **antes** de rodar o pipeline: e a lista do
        // revisor, nao o que o pipeline conseguiu processar.
        let expected_terms: &[ExpectedDefinition] =
            expected.map(|terms| terms.as_slice()).unwrap_or(&[]);
        count_expected_terms(&mut measurement.definitions, expected_terms);

        let markdown = note_of(&case.note);
        let proposals =
            match propose_improvements(legacy_provider, &markdown, ImprovementScope::Both, &[]) {
                Ok(outcome) => outcome,
                Err(failure) => {
                    let message = format!("{}: {}", case.id, failure.message);
                    measurement.definitions.failures.push(message.clone());
                    measurement.expansions.failures.push(message);
                    mark_case_unmeasured(
                        &mut measurement.definitions,
                        &case.id,
                        "caseFailed",
                        expected_terms,
                    );
                    continue;
                }
            };
        // O funil das expansoes vale para **todo** caso com proposta.
        measurement.expansions.cases_measured += 1;
        measurement.expansions.raw_expansions += proposals.raw_expansions;
        measurement.expansions.expansions_accepted += proposals.expansions.len();
        measurement.expansions.expansions_rejected += proposals.expansions_rejected;
        measurement.definitions.truncated_proposals += proposals.truncated_proposals;

        let expected = match expected {
            Some(expected) => expected,
            None => continue,
        };
        let summary = &mut measurement.definitions;
        let confirmed =
            match confirm_definition_proposals(calibrated, &markdown, &proposals.proposals) {
                Ok(confirmed) => confirmed,
                Err(failure) => {
                    summary
                        .failures
                        .push(format!("{}: {}", case.id, failure.message));
                    mark_case_unmeasured(summary, &case.id, "judgeFailed", expected_terms);
                    continue;
                }
            };
        let found: Vec<&str> = proposals
            .proposals
            .iter()
            .zip(&confirmed)
            .filter(|(_, verdict)| verdict.needs_definition)
            .map(|(proposal, _)| proposal.term.as_str())
            .collect();

        // O provider propos, mas o motor recusou: e uma perda **diferente**
        // da perda de "nunca foi proposto". A recusa do motor e julgamento, e
        // o termo recusado nao entra nos extras logo abaixo.
        let mut engine_rejected: Vec<&str> = Vec::new();
        for (proposal, verdict) in proposals.proposals.iter().zip(&confirmed) {
            if verdict.needs_definition {
                let matched_expected = expected
                    .iter()
                    .any(|term| terms_match(&proposal.term, &term.term));
                summary.accepted_terms.push(AcceptedTerm {
                    case_id: case.id.clone(),
                    term: proposal.term.clone(),
                    definition: proposal.definition.clone(),
                    matched_expected,
                });
                let expected_hit = expected
                    .iter()
                    .any(|term| normalize_term(&term.term) == normalize_term(&proposal.term));
                if !expected_hit {
                    summary
                        .accepted_unmatched_terms
                        .push(format!("{}: {}", case.id, proposal.term));
                }
            } else {
                engine_rejected.push(proposal.term.as_str());
                summary
                    .rejected_by_engine
                    .push(format!("{}: {}", case.id, proposal.term));
            }
        }
        summary.proposed_terms += proposals.proposals.len();
        summary.raw_proposals += proposals.raw_proposals;
        summary.coverage_proposals += proposals.coverage_proposals;
        summary.duplicates_dropped += proposals.duplicates_dropped;
        if proposals.coverage_failed {
            summary.coverage_failed_cases += 1;
        }
        summary.filtered_out_terms += proposals.rejected.len();
        for problem in &proposals.rejected {
            *summary
                .filtered_out_by_reason
                .entry(problem.reason.clone())
                .or_insert(0) += 1;
            summary.rejected_by_filter.push(format!(
                "{}: {} ({})",
                case.id, problem.term, problem.reason
            ));
        }

        summary.cases_measured += 1;
        let filtered_terms: Vec<&str> = proposals
            .rejected
            .iter()
            .map(|problem| problem.term.as_str())
            .collect();
        let mut missed = Vec::new();
        for expected_term in expected {
            if found
                .iter()
                .any(|term| normalize_term(term) == normalize_term(&expected_term.term))
            {
                summary.found_terms += 1;
            } else {
                missed.push(expected_term.term.clone());
            }
            let tolerant_hit = found
                .iter()
                .find(|term| terms_match(term, &expected_term.term))
                .copied();
            if tolerant_hit.is_some() {
                summary.found_terms_tolerant += 1;
            }
            // So conta a etapa dos que nao foram achados pelo nome exato: e a
            // diferenca entre recall exato e tolerante (variacao de nome), ou
            // uma perda de verdade - e cada perda tem um conserto diferente.
            let exact_hit = found
                .iter()
                .any(|term| normalize_term(term) == normalize_term(&expected_term.term));
            if exact_hit {
                continue;
            }
            let (stage, proposed_as, counter) = if let Some(term) = tolerant_hit {
                (
                    "nameVariant",
                    Some(term.to_string()),
                    &mut summary.missed_name_variant,
                )
            } else if let Some(term) = engine_rejected
                .iter()
                .find(|term| terms_match(term, &expected_term.term))
            {
                (
                    "rejectedByEngine",
                    Some((*term).to_string()),
                    &mut summary.missed_rejected_by_engine,
                )
            } else if let Some(term) = filtered_terms
                .iter()
                .find(|term| terms_match(term, &expected_term.term))
            {
                (
                    "rejectedByFilter",
                    Some((*term).to_string()),
                    &mut summary.missed_rejected_by_filter,
                )
            } else {
                ("neverProposed", None, &mut summary.missed_never_proposed)
            };
            *counter += 1;
            summary.missed_terms.push(MissedTerm {
                case_id: case.id.clone(),
                term: expected_term.term.clone(),
                stage,
                proposed_as,
            });
        }
        // Extras sao os termos **aceitos** que nao casam com nenhum esperado.
        //
        // A formula antiga (`found.len() - expected.len()`, clampada em zero
        // por caso) subconta: um caso que achou 1 de 5 e propos 4 extras
        // contava zero. Como o numero existe para dizer se o motor aceita
        // demais, o denominador tem de ser o que foi aceito, nao a diferenca
        // entre duas listas de tamanhos diferentes.
        summary.extra_terms += found
            .iter()
            .filter(|term| {
                !expected.iter().any(|expected_term| {
                    normalize_term(&expected_term.term) == normalize_term(term)
                })
            })
            .count();
        summary.extra_terms_tolerant += found
            .iter()
            .filter(|term| {
                !expected
                    .iter()
                    .any(|expected_term| terms_match(term, &expected_term.term))
            })
            .count();
        if !missed.is_empty() {
            summary
                .missed_cases
                .push(format!("{}: {}", case.id, missed.join(", ")));
        }
    }
    measurement
}

/// Compara ignorando caixa e acentos, como o filtro deterministico.
fn normalize_term(text: &str) -> String {
    text.trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
        .nfd()
        .filter(|c| !matches!(c, '\u{0300}'..='\u{036f}'))
        .collect()
}

/// Casa dois termos quando um e prefixo ou sufixo do outro.
///
/// E o caso de `capacidade de suporte do meio` contra `capacidade de suporte`
/// (prefixo) e de `adiabatico` contra `recipiente adiabatico` (sufixo): o
/// conhecimento que falta e o mesmo, e a igualdade de nome penaliza duas
/// vezes — perde no recall e conta como extra.
///
/// Prefixo/sufixo e nao substring livre porque substring casaria `atp` dentro
/// de `adaptador`. O piso de 5 caracteres protege siglas: `ATP` so casa com
/// `ATP`.
fn terms_match(left: &str, right: &str) -> bool {
    let left = normalize_term(left);
    let right = normalize_term(right);
    if left == right {
        return true;
    }
    let (shorter, longer) = if left.chars().count() <= right.chars().count() {
        (left.as_str(), right.as_str())
    } else {
        (right.as_str(), left.as_str())
    };
    if shorter.chars().count() < 5 {
        return false;
    }
    if negates(shorter, longer) {
        return false;
    }
    longer.starts_with(shorter) || longer.ends_with(shorter)
}

/// Prefixos que invertem o sentido do termo.
///
/// A rodada 6 contou `inelastica` como acerto de `elastica` porque a regra so
/// olhava prefixo/sufixo. O recall tolerante subiu com um falso positivo, e o
/// mesmo erro no dicionario esconderia o verbete que falta.
const NEGATION_PREFIXES: &[&str] = &["in", "im", "i", "des", "anti", "nao", "sem"];

fn negates(shorter: &str, longer: &str) -> bool {
    NEGATION_PREFIXES.iter().any(|prefix| {
        longer
            .strip_suffix(shorter)
            .is_some_and(|head| head == *prefix)
            || longer
                .strip_prefix(shorter)
                .is_some_and(|tail| tail == *prefix)
    })
}

#[cfg(test)]
mod terms_match_tests {
    use super::terms_match;

    #[test]
    fn uma_variacao_de_nome_e_o_mesmo_termo() {
        assert!(terms_match(
            "capacidade de suporte do meio",
            "capacidade de suporte"
        ));
        assert!(terms_match("adiabatico", "recipiente adiabatico"));
        assert!(terms_match("Ciclo de Calvin", "ciclo de calvin"));
    }

    #[test]
    fn uma_sigla_curta_nao_casa_por_contencao() {
        assert!(terms_match("ATP", "ATP"));
        assert!(!terms_match("ATP", "3 ATP por molecula"));
        assert!(!terms_match("ATP", "adaptador"));
    }

    #[test]
    fn a_negacao_do_termo_nao_conta_como_acerto() {
        // A rodada 6 contou `inelastica` como acerto de `elastica`: um falso
        // positivo no recall tolerante.
        assert!(!terms_match("elastica", "inelastica"));
        assert!(!terms_match("possivel", "impossivel"));
        assert!(!terms_match("organizado", "desorganizado"));
        assert!(terms_match("estroma", "estroma dos cloroplastos"));
    }

    #[test]
    fn termos_diferentes_nao_casam() {
        assert!(!terms_match("estroma", "citoplasma"));
        assert!(!terms_match("fase escura", "fase clara"));
        assert!(!terms_match("protease", "pepsina"));
    }
}

#[test]
#[ignore = "chama modelos reais; rode com MIRRORMIND_JEV_EVAL=1"]
fn jev_is_measured_against_the_legacy_path() {
    if std::env::var_os(ENV_EVAL).is_none() {
        panic!(
            "esta medicao custa chamada real. Defina {ENV_EVAL}=1 e rode \
             `cargo test --test jev_eval -- --ignored --nocapture`."
        );
    }

    let set = load_set();
    let store = NativeCredentialStore::new();
    assert!(
        has_typesafe_consent(&store).expect("consentimento legivel"),
        "a egresso para a TypeSafe AI precisa de autorizacao previa"
    );

    // O JEV e repetido, e o gate decide pelo **pior** ECE.
    //
    // A acuracia do JEV e estavel entre rodadas (0.826 em todas, com os
    // rotulos revisados). O que varia e a **confianca** que ele anexa as
    // respostas — e o ECE e penalizado justamente por excesso de confianca.
    // Uma unica rodada transformava a decisao numa moeda: o ECE observado foi
    // 0.142, 0.073 e 0.067 em tres rodadas seguidas, e o gate de 0.10 fica no
    // meio dessa faixa.
    //
    // Decidir pelo pior e o lado conservador: uma unica rodada ruim impede a
    // flag, em vez de a flag depender de qual rodada rodou por ultimo. O
    // legado NAO e repetido: ele e lento (8 s por caso) e nao e a fonte do
    // ruido.
    const JEV_REPEATS: usize = 3;
    let mut ece_by_run = Vec::new();
    let mut worst_comparison: Option<ComparisonReport> = None;
    let mut jev_report = EngineReport::new("jev", "jev-latest");
    let mut jev_cases = Vec::new();

    // O legado roda **uma** vez: e lento (8 s por caso) e nao e a fonte do
    // ruido — o que varia entre rodadas e a confianca do JEV.
    let legacy_provider = OllamaProvider::new().expect("ollama");
    let (mut legacy_report, legacy_cases) = run_legacy(&set);
    legacy_report.score(&legacy_cases, DEFAULT_THRESHOLDS);

    for run in 0..JEV_REPEATS {
        let (mut report, cases) = run_jev(&set, &legacy_provider);
        report.score(&cases, DEFAULT_THRESHOLDS);
        let ece = report
            .metrics
            .get("0.00")
            .and_then(|metric| metric.expected_calibration_error);
        ece_by_run.push(ece);
        let comparison =
            ComparisonReport::build(&set, report.clone(), legacy_report.clone(), MAX_ECE);
        // Guarda a rodada com o **pior** ECE.
        let is_worse = match &worst_comparison {
            None => true,
            Some(current) => {
                let current_ece = current
                    .candidate
                    .metrics
                    .get("0.00")
                    .and_then(|metric| metric.expected_calibration_error)
                    .unwrap_or(f64::INFINITY);
                comparison
                    .candidate
                    .metrics
                    .get("0.00")
                    .and_then(|metric| metric.expected_calibration_error)
                    .unwrap_or(f64::INFINITY)
                    > current_ece
            }
        };
        if is_worse {
            worst_comparison = Some(comparison);
        }
        if run == 0 {
            jev_report = report;
            jev_cases = cases;
        }
    }

    assert!(
        !jev_cases.is_empty(),
        "nenhum caso produziu previsao do JEV: {:?}",
        jev_report.failures
    );

    let mut comparison = worst_comparison.expect("pelo menos uma rodada");
    comparison.ece_by_run = ece_by_run.clone();

    eprintln!(
        "ECE por repeticao: {:?} (o gate decide pelo pior)",
        comparison
            .ece_by_run
            .iter()
            .map(|ece| ece
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "-".into()))
            .collect::<Vec<_>>()
    );

    // O gate tambem precisa do vies de ordem (D12). A medicao e separada
    // porque exige chamadas extras: rotacionar as opcoes e repetir a
    // classificacao das afirmacoes.
    let store = NativeCredentialStore::new();
    let api_key = load_typesafe_api_key(&store)
        .expect("chave legivel")
        .expect("a chave precisa estar no cofre");
    let provider = TypeSafeProvider::new(api_key).expect("provider JEV");
    // O recall das sugestoes de definicao, contra o ground truth da feature.
    // So e medido nos casos que o revisor marcou — sem ele nao ha o que medir.
    let improvements = measure_improvements(&set, &legacy_provider, &provider);
    let definition_recall = &improvements.definitions;
    let expansion_funnel = &improvements.expansions;
    match definition_recall.recall() {
        Some(recall) => eprintln!(
            "recall de definicoes: {}/{} termos encontrados ({}%) em {} de {} casos com \
             ground truth | {} termos extras (a lista do revisor pode estar incompleta)",
            definition_recall.found_terms,
            definition_recall.expected_terms,
            (recall * 100.0).round(),
            definition_recall.cases_measured,
            definition_recall.cases_with_ground_truth,
            definition_recall.extra_terms
        ),
        None => {
            // A causa importa: "ninguem revisou" e "o provider generativo
            // estava fora do ar" sao situacoes completamente diferentes, e a
            // mensagem anterior dizia "nenhum caso tem ground truth" mesmo
            // com os 23 casos revisados. Uma falha do provider que aparece
            // como "nao medido" esconde que **nada foi medido porque nada
            // pode ser medido**.
            let sem_ground_truth = definition_recall.cases_with_ground_truth == 0;
            if sem_ground_truth {
                eprintln!(
                    "recall de definicoes: NAO MEDIDO — nenhum caso tem ground truth de \
                     definicoes (0 de {} casos revisados). Isso nao e 0%: e ausencia de medida.",
                    definition_recall.cases_total
                );
            } else {
                eprintln!(
                    "recall de definicoes: NAO MEDIDO — ha ground truth ({} casos, {} termos \
                     esperados), mas nada foi medido: {} falha(s) do provider. Ver as falhas \
                     abaixo.",
                    definition_recall.cases_with_ground_truth,
                    definition_recall.expected_terms,
                    definition_recall.failures.len()
                );
            }
        }
    }
    if let Some(tolerant) = definition_recall.recall_tolerant() {
        eprintln!(
            "  recall tolerante a variacao de nome: {}/{} ({:.1}%) | {} extras",
            definition_recall.found_terms_tolerant,
            definition_recall.expected_terms,
            tolerant * 100.0,
            definition_recall.extra_terms_tolerant
        );
    }
    // Onde os ausentes morreram. Cada etapa tem um conserto diferente, e sem
    // esta linha "faltaram 23" nao diz o que fazer.
    eprintln!(
        "  ausentes no nome exato por etapa: {} variacao de nome | {} recusados pelo motor | \
         {} recusados pelo filtro | {} nunca propostos | {} caso sem medicao | \
         {} motor sem medicao",
        definition_recall.missed_name_variant,
        definition_recall.missed_rejected_by_engine,
        definition_recall.missed_rejected_by_filter,
        definition_recall.missed_never_proposed,
        definition_recall.missed_case_failed,
        definition_recall.missed_judge_failed
    );
    // A soma das etapas tem de fechar com os ausentes, e os ausentes com o
    // denominador. Na rodada 7 os contadores de falha nunca foram
    // incrementados: 8 termos `caseFailed` ficaram fora de toda etapa e o
    // relatorio explicava 41 de 49 ausentes sem avisar. Zero silencioso nao e
    // resultado.
    let soma_etapas = definition_recall.missed_name_variant
        + definition_recall.missed_rejected_by_engine
        + definition_recall.missed_rejected_by_filter
        + definition_recall.missed_never_proposed
        + definition_recall.missed_case_failed
        + definition_recall.missed_judge_failed;
    if soma_etapas != definition_recall.missed_terms.len() {
        eprintln!(
            "  AVISO: as etapas somam {soma_etapas}, mas ha {} termo(s) ausente(s) - \
             alguma etapa nao esta sendo contada",
            definition_recall.missed_terms.len()
        );
    }
    if definition_recall.found_terms + definition_recall.missed_terms.len()
        != definition_recall.expected_terms
    {
        eprintln!(
            "  AVISO: encontrados ({}) + ausentes ({}) != esperados ({}) - o denominador \
             nao fecha",
            definition_recall.found_terms,
            definition_recall.missed_terms.len(),
            definition_recall.expected_terms
        );
    }
    for failure in &definition_recall.failures {
        eprintln!("  falha: {failure}");
    }
    // Onde a perda acontece: o provider propos poucos termos, ou propos e o
    // motor recusou? Sem esta separacao, um recall baixo nao diz o que
    // consertar.
    eprintln!(
        "  funil das definicoes: {} oferecidas ({} na 1a passada + {} na cobertura) \
         -> {} repetidas -> {} recusadas pelo filtro -> {} chegaram ao motor -> \
         {} recusadas pelo motor -> {} encontradas | {} cortadas pelo limite",
        definition_recall.raw_proposals + definition_recall.coverage_proposals,
        definition_recall.raw_proposals,
        definition_recall.coverage_proposals,
        definition_recall.duplicates_dropped,
        definition_recall.filtered_out_terms,
        definition_recall.proposed_terms,
        definition_recall.rejected_by_engine.len(),
        definition_recall.found_terms,
        definition_recall.truncated_proposals
    );
    if definition_recall.coverage_failed_cases > 0 {
        eprintln!(
            "  cobertura falhou em {} caso(s): a 1a passada valeu sozinha",
            definition_recall.coverage_failed_cases
        );
    }
    for term in &definition_recall.accepted_unmatched_terms {
        eprintln!("  aceita sem casar com o esperado: {term}");
    }
    for (reason, count) in &definition_recall.filtered_out_by_reason {
        eprintln!("  recusada pelo filtro ({count}x): {reason}");
    }
    for rejected in &definition_recall.rejected_by_filter {
        eprintln!("  recusada pelo filtro: {rejected}");
    }
    eprintln!(
        "  expansoes, em todos os {} casos: {} oferecidas -> {} aceitas na ancora \
         -> {} recusadas (taxa de aceitacao: {})",
        expansion_funnel.cases_total,
        expansion_funnel.raw_expansions,
        expansion_funnel.expansions_accepted,
        expansion_funnel.expansions_rejected,
        match expansion_funnel.acceptance_rate() {
            Some(rate) => format!("{:.0}%", rate * 100.0),
            None => "nao medido".to_string(),
        }
    );
    eprintln!(
        "  termos propostos pelo provider: {} | recusados pelo motor: {}",
        definition_recall.proposed_terms,
        definition_recall.rejected_by_engine.len()
    );
    for rejected in &definition_recall.rejected_by_engine {
        eprintln!("  recusado pelo motor: {rejected}");
    }
    for missed in &definition_recall.missed_cases {
        eprintln!("  nao encontrado: {missed}");
    }

    let order_bias = measure_order_bias(&set, &provider);
    // A acuracia do status das trocas: o ground truth existia e nunca era
    // comparado com a resposta.
    let exchange_accuracy = measure_exchange_accuracy(&set, &provider);
    match exchange_accuracy.accuracy() {
        Some(accuracy) => eprintln!(
            "  trocas (C1/C2): {}/{} com o status certo ({}%) em {} caso(s)",
            exchange_accuracy.exchanges_correct,
            exchange_accuracy.exchanges_total,
            (accuracy * 100.0).round() as i64,
            exchange_accuracy.cases_measured
        ),
        None => eprintln!(
            "  trocas (C1/C2): NAO MEDIDO - {} falha(s)",
            exchange_accuracy.failures.len()
        ),
    }
    for miss in &exchange_accuracy.misses {
        eprintln!("  troca com status errado: {miss}");
    }
    for failure in &exchange_accuracy.failures {
        eprintln!("  falha nas trocas: {failure}");
    }
    let path = report_path();
    let runs_dir = path.parent().expect("docs").join("jev-eval-runs");
    std::fs::create_dir_all(&runs_dir).expect("cria diretorio das rodadas");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("cria diretorio do relatorio");
    }
    let mut payload = serde_json::to_value(&comparison).expect("serializa o relatorio");
    payload["orderBias"] = serde_json::to_value(&order_bias).expect("serializa o vies de ordem");
    payload["definitionRecall"] =
        serde_json::to_value(definition_recall).expect("serializa o recall de definicoes");
    payload["definitionRecall"]["recall"] = match definition_recall.recall() {
        Some(recall) => serde_json::Value::from(recall),
        None => serde_json::Value::Null,
    };
    payload["definitionRecall"]["recallTolerant"] = match definition_recall.recall_tolerant() {
        Some(recall) => serde_json::Value::from(recall),
        None => serde_json::Value::Null,
    };
    payload["definitionRecall"]["measured"] =
        serde_json::Value::from(definition_recall.is_measured());
    payload["expansionFunnel"] =
        serde_json::to_value(expansion_funnel).expect("serializa o funil das expansoes");
    payload["expansionFunnel"]["acceptanceRate"] = match expansion_funnel.acceptance_rate() {
        Some(rate) => serde_json::Value::from(rate),
        None => serde_json::Value::Null,
    };
    payload["exchangeAccuracy"] =
        serde_json::to_value(&exchange_accuracy).expect("serializa a acuracia das trocas");
    payload["exchangeAccuracy"]["accuracy"] = match exchange_accuracy.accuracy() {
        Some(rate) => serde_json::Value::from(rate),
        None => serde_json::Value::Null,
    };

    // Uma rodada so vale como baseline se **todas** as dimensoes foram
    // medidas. Uma rodada com o Ollama fora do ar produz um relatorio em que
    // `definitionRecall.measured == false`; gravar isso por cima do ultimo
    // relatorio bom apagaria a unica medicao valida que existia. A
    // arquivada guarda tudo; o `jev-eval-report.json` (o baseline) so e
    // trocado quando a rodada esta completa.
    let complete = definition_recall.is_measured()
        && expansion_funnel.acceptance_rate().is_some()
        && exchange_accuracy.accuracy().is_some()
        && comparison.candidate.cases.len() == set.cases.len();
    let run_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    payload["runId"] = serde_json::Value::from(run_id);
    payload["complete"] = serde_json::Value::from(complete);
    let serialized = serde_json::to_string_pretty(&payload).expect("serializa");
    let archived = runs_dir.join(format!(
        "{}{run_id}.json",
        if complete { "run-" } else { "incomplete-" }
    ));
    std::fs::write(&archived, &serialized).expect("grava a rodada arquivada");

    if complete {
        std::fs::write(&path, &serialized).expect("grava o relatorio");
        eprintln!(
            "relatorio em {}\nrodada arquivada em {}\nveredito: {}",
            path.display(),
            archived.display(),
            comparison.verdict
        );
    } else {
        // O baseline anterior fica intacto de proposito. O aviso e alto
        // porque a rodada incompleta **nao** e um resultado: e um defeito de
        // ambiente (provider fora do ar), e ler os zeros dela como medicao
        // seria pior do que nao ter rodado.
        eprintln!(
            "RODADA INCOMPLETA: o baseline em {} NAO foi sobrescrito.\n\
             rodada arquivada em {}\n\
             motivo: definicoes medidas = {}, expansoes medidas = {}, trocas \
             medidas = {}, casos de prontidao = {} de {}\nveredito (nao publicado): {}",
            path.display(),
            archived.display(),
            definition_recall.is_measured(),
            expansion_funnel.acceptance_rate().is_some(),
            exchange_accuracy.accuracy().is_some(),
            comparison.candidate.cases.len(),
            set.cases.len(),
            comparison.verdict
        );
    }

    // O caminho que marca o Vault como "calibrado".
    //
    // A flag `calibration_validated` diz que o numero de confianca foi
    // validado contra veredito humano. Isso so vale se **os dois** criterios
    // passarem: o gate do ECE e a revisao dos rotulos. Marcar por causa de um
    // deles so seria metade da verdade — e a metade que engana.
    //
    // O Vault e opcional: sem `MIRRORMIND_JEV_EVAL_VAULT`, a rodada so mede.
    if let Ok(vault) = std::env::var("MIRRORMIND_JEV_EVAL_VAULT") {
        let validated = comparison.confidence_is_actionable && comparison.labels_reviewed;
        match mirrormind_lib::review::calibration::set_calibration_validated(
            std::path::Path::new(&vault),
            validated,
        ) {
            Ok(_) => eprintln!(
                "calibration_validated = {validated} em {vault} \
                 (ECE no gate: {}, rotulos revisados: {})",
                comparison.confidence_is_actionable, comparison.labels_reviewed
            ),
            Err(error) => eprintln!("nao foi possivel marcar a calibracao: {error}"),
        }
    } else {
        eprintln!(
            "MIRRORMIND_JEV_EVAL_VAULT nao definido: a rodada mediu, mas nao marcou \
             nenhum Vault."
        );
    }
    for unscoreable in &comparison.unscoreable {
        eprintln!(
            "fora da metrica: {} / {} ({:?})",
            unscoreable.case_id, unscoreable.dimension, unscoreable.provenance
        );
    }

    // O teste **nao** aprova nem reprova a migracao. Ele so falha se o
    // relatorio nao foi produzido: a decisao e de quem le o JSON, e o
    // resultado depende do golden set, que ainda esta em revisao humana.
    assert!(
        path.is_file(),
        "o relatorio precisa existir para servir de baseline"
    );
}

#[test]
fn the_evaluation_test_is_ignored_by_default() {
    // Trava o padrao: uma suite que chama modelo sem `#[ignore]` quebraria o
    // CI de quem nao tem credencial configurada.
    let source = include_str!("jev_eval.rs");
    assert!(
        source.contains("#[ignore = \"chama modelos reais"),
        "a medicao real precisa continuar marcada como ignorada"
    );
}

#[test]
fn uma_falha_do_provider_nao_melhora_o_recall() {
    // O denominador e a lista do revisor, nao o que o pipeline alcancou. Sem
    // isso, falhar tira o caso da conta e o recall **sobe** justamente na
    // rodada em que nada foi medido: a rodada 6 reportou 25/46 (54,3%) quando
    // o numero honesto era 25/54 (46,3%).
    let esperados = vec![
        ExpectedDefinition {
            term: "estroma".to_string(),
            source_quote: None,
        },
        ExpectedDefinition {
            term: "rubisco".to_string(),
            source_quote: None,
        },
    ];
    let mut summary = DefinitionRecallSummary::default();
    count_expected_terms(&mut summary, &esperados);
    mark_case_unmeasured(&mut summary, "ciclo-calvin", "caseFailed", &esperados);

    assert_eq!(summary.expected_terms, 2, "o termo continua no denominador");
    assert_eq!(summary.found_terms, 0);
    assert_eq!(summary.cases_failed, 1);
    assert_eq!(summary.cases_measured, 0);
    assert_eq!(summary.missed_terms.len(), 2);
    assert_eq!(
        summary.missed_case_failed, 2,
        "a etapa `caseFailed` precisa contar os termos, senao o relatorio explica \
         menos ausentes do que o denominador"
    );
    assert!(summary
        .missed_terms
        .iter()
        .all(|term| term.stage == "caseFailed"));
    assert_eq!(summary.recall(), Some(0.0));

    // A soma dos contadores tem de fechar com a lista de ausentes, e a lista
    // com o denominador. Sem esta trava, um contador morto passa despercebido.
    count_expected_terms(&mut summary, &esperados);
    mark_case_unmeasured(&mut summary, "outro-caso", "judgeFailed", &esperados);
    let soma = summary.missed_name_variant
        + summary.missed_rejected_by_engine
        + summary.missed_rejected_by_filter
        + summary.missed_never_proposed
        + summary.missed_case_failed
        + summary.missed_judge_failed;
    assert_eq!(soma, summary.missed_terms.len(), "etapas != ausentes");
    assert_eq!(
        summary.found_terms + summary.missed_terms.len(),
        summary.expected_terms,
        "encontrados + ausentes != esperados"
    );
}

/// Diagnostico: as notas em que o 7B devolve um relatorio fora do contrato.
///
/// O harness so imprime a mensagem ("nao corresponde ao contrato"), que nao
/// diz *qual* regra do schema falhou. Este teste imprime os erros de validacao
/// e o comeco da resposta bruta - o que falta para consertar o prompt.
///
/// Roda so com `MIRRORMIND_JEV_EVAL=1`, como o resto do arquivo: chama o
/// modelo de verdade.
#[test]
#[ignore = "chama o modelo real; rode com MIRRORMIND_JEV_EVAL=1"]
fn diagnostico_das_notas_que_quebram_o_contrato() {
    if std::env::var_os(ENV_EVAL).is_none() {
        return;
    }
    let provider = OllamaProvider::new().expect("Ollama local");
    let notas: Vec<String> = std::env::var("MIRRORMIND_JEV_EVAL_NOTES")
        .unwrap_or_else(|_| "termo-definido-inline.md,contexto-implicito.md".to_string())
        .split(',')
        .map(|note| note.trim().to_string())
        .collect();
    for note in notas {
        let markdown = note_of(&note);
        match propose_improvements(&provider, &markdown, ImprovementScope::Both, &[]) {
            Ok(outcome) => println!(
                "{note}: ok (invalid={}, propostas={}, expansoes={})",
                outcome.invalid,
                outcome.proposals.len(),
                outcome.expansions.len()
            ),
            Err(failure) => {
                println!("{note}: {}", failure.message);
                for error in &failure.validation_errors {
                    println!("  erro: {error}");
                }
                if let Some(raw) = &failure.raw_response {
                    let inicio: String = raw.chars().take(2000).collect();
                    println!("  bruto ({} bytes): {inicio}", raw.len());
                }
            }
        }
    }
}
