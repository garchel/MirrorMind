//! Metricas do harness de calibracao.
//!
//! Sao computacao pura sobre pares (previsao, rotulo): nenhuma delas chama
//! modelo nem le disco, o que as torna testaveis por completo e utilizaveis
//! tanto no runner real quanto nos testes.
//!
//! A metrica que decide a tese do JEV nao e acuracia bruta, e
//! **acuracia seletiva**. Ver `selective_frontier`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// De onde veio o rotulo de um caso.
///
/// A distincao existe para impedir que o harness meca a si mesmo. Se os
/// rotulos fossem opinions de um modelo, comparar dois modelos contra eles
/// seria circular: os dois mediriam o quanto concordam com o terceiro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelProvenance {
    /// O rotulo segue de uma regra enunciada no proprio caso. Nao ha
    /// julgamento: a nota foi construida para ter aquele rotulo.
    #[default]
    Construction,
    /// O rotulo e um fato verificavel (a agua ferve a 100 graus ao nivel do
    /// mar), nao uma apreciacao.
    CommonFact,
    /// Alguem revisou e confirmou o rotulo.
    Human,
    /// Divergencia entre revisores, ou fronteira que depende de julgamento.
    /// **O harness nao pontua estes casos.**
    Disputed,
}

impl LabelProvenance {
    /// Rótulos `disputed` ficam fora de toda métrica.
    pub fn is_scorable(self) -> bool {
        !matches!(self, LabelProvenance::Disputed)
    }
}

/// Previsão de um caso: o que o motor respondeu, com que confiança e a que custo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prediction {
    /// Rótulo escolhido (argmax, ou a resposta direta de um `noul`).
    pub label: String,
    /// Distribuicao completa, para Brier e para recalcular confidence.
    /// Vazia no caminho legado, que nao produz probabilidades.
    pub distribution: BTreeMap<String, f64>,
    /// Confianca declarada pelo motor. `None` no legado.
    pub confidence: Option<f64>,
    pub latency_ms: u64,
    pub estimated_cost_usd: f64,
}

impl Prediction {
    /// Confianca confiavel: a declarada, ou o maximo da distribuicao.
    ///
    /// Preferir a calculada a declarada tem uma razao — ela permite auditar o
    /// valor que o fornecedor mandou contra a formula publicada, sem depender
    /// da rede.
    pub fn effective_confidence(&self) -> f64 {
        match self.confidence {
            Some(declared) => declared,
            None => self.distribution.values().copied().fold(0.0_f64, f64::max),
        }
    }

    /// Probabilidade declarada para o rotulo escolhido.
    pub fn probability_of_label(&self) -> Option<f64> {
        if self.distribution.is_empty() {
            return None;
        }
        self.distribution.get(&self.label).copied()
    }

    /// Sem distribuicao nao ha como medir incerteza: e o caso do legado.
    pub fn carries_uncertainty(&self) -> bool {
        !self.distribution.is_empty()
    }
}

/// Um caso avaliado.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredCase {
    pub id: String,
    pub expected: String,
    pub provenance: LabelProvenance,
    pub prediction: Prediction,
    /// Motivo do erro, quando houver, para o relatorio.
    pub note: Option<String>,
}

impl ScoredCase {
    pub fn correct(&self) -> bool {
        self.prediction.label == self.expected
    }

    /// Marcado como incorreto quando o motor se abstain: nao scoring e nao
    /// acerto, e essa distincao e o que a acuracia seletiva mede.
    pub fn scored(&self, threshold: f64) -> bool {
        self.prediction.effective_confidence() >= threshold
    }
}

/// Resultado de uma avaliacao sobre N casos.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub cases_total: usize,
    pub cases_scored: usize,
    /// Acertos sobre os casos que o motor respondeu.
    pub accuracy: Option<f64>,
    /// Acertos sobre todos os casos, tratando abstention como erro.
    pub accuracy_answered_only: Option<f64>,
    /// `1 - accuracy`: o preco de errar, entre os casos respondidos.
    pub risk: Option<f64>,
    /// Fracao de casos que o motor se abstem (nao respondeu).
    pub abstention_rate: Option<f64>,
    /// Erro de calibracao esperado.
    pub expected_calibration_error: Option<f64>,
    /// Brier multiclasse, normalizado pelo numero de classes.
    pub brier_score: Option<f64>,
    /// Confianca media entre os respondidos.
    pub mean_confidence: Option<f64>,
    pub latency_p50_ms: Option<u64>,
    pub latency_p95_ms: Option<u64>,
    pub total_cost_usd: f64,
    pub mean_cost_usd: Option<f64>,
}

impl Metrics {
    /// Avalia uma colecao de casos em um limiar de confianca.
    ///
    /// `threshold = 1.1` responde "nunca se abster" e reproduz a comparacao
    /// de acuracia bruta, que e o numero que o marketing do fornecedor
    /// divulga.
    pub fn from_cases(cases: &[ScoredCase], threshold: f64) -> Metrics {
        let scorable: Vec<&ScoredCase> = cases
            .iter()
            .filter(|case| case.provenance.is_scorable())
            .collect();
        if scorable.is_empty() {
            return Metrics {
                cases_total: cases.len(),
                cases_scored: 0,
                accuracy: None,
                accuracy_answered_only: None,
                risk: None,
                abstention_rate: None,
                expected_calibration_error: None,
                brier_score: None,
                mean_confidence: None,
                latency_p50_ms: None,
                latency_p95_ms: None,
                total_cost_usd: 0.0,
                mean_cost_usd: None,
            };
        }
        let answered: Vec<&&ScoredCase> = scorable
            .iter()
            .filter(|case| case.scored(threshold))
            .collect();
        let total = scorable.len();
        let answered_count = answered.len();

        let (accuracy, risk, abstention_rate, mean_confidence) = if answered_count == 0 {
            (None, None, Some(1.0), None)
        } else {
            let correct = answered.iter().filter(|case| case.correct()).count();
            let accuracy = correct as f64 / answered_count as f64;
            let mean = answered
                .iter()
                .map(|case| case.prediction.effective_confidence())
                .sum::<f64>()
                / answered_count as f64;
            (
                Some(accuracy),
                Some(1.0 - accuracy),
                Some(1.0 - answered_count as f64 / total as f64),
                Some(mean),
            )
        };

        let accuracy_answered_only =
            Some(scorable.iter().filter(|case| case.correct()).count() as f64 / total as f64);

        let latencies: Vec<u64> = scorable
            .iter()
            .map(|case| case.prediction.latency_ms)
            .collect();
        let costs: f64 = scorable
            .iter()
            .map(|case| case.prediction.estimated_cost_usd)
            .sum();

        Metrics {
            cases_total: cases.len(),
            cases_scored: answered_count,
            accuracy,
            accuracy_answered_only,
            risk,
            abstention_rate,
            expected_calibration_error: expected_calibration_error(&scorable),
            brier_score: brier_score(&scorable),
            mean_confidence,
            latency_p50_ms: percentile(&latencies, 50.0),
            latency_p95_ms: percentile(&latencies, 95.0),
            total_cost_usd: costs,
            mean_cost_usd: Some(costs / total as f64),
        }
    }
}

/// Erro de calibracao esperado.
///
/// ECE = `sum over bins (n_bin/N) * |acuracia(bin) - confianca media(bin)|`.
///
/// ECE baixo significa que "confianca 0.9" acerta cerca de 90% das vezes. ECE
/// alto significa que o numero e decorativo, e exibir confianca num harness
/// assim engana o usuario em vez de informa-lo.
///
/// answered-only por construcao: o rotulo nao existe para um caso que o motor
/// nao respondeu.
pub fn expected_calibration_error(cases: &[&ScoredCase]) -> Option<f64> {
    let binned = calibration_bins(cases);
    if binned.is_empty() {
        return None;
    }
    let total: usize = binned.iter().map(|bin| bin.count).sum();
    if total == 0 {
        return None;
    }
    let error: f64 = binned
        .iter()
        .map(|bin| (bin.count as f64 / total as f64) * (bin.accuracy - bin.mean_confidence).abs())
        .sum();
    Some(error)
}

/// Uma faixa de confianca.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationBin {
    /// Faixa em decimais: `[0.0, 0.1)` ate `[0.9, 1.0]`.
    pub range: (f64, f64),
    pub count: usize,
    pub accuracy: f64,
    pub mean_confidence: f64,
}

/// Divide os casos respondidos em dez faixas de confianca.
///
/// Dez faixas e o corte usual. Menos que isso esconde a forma da curva; mais
/// que isso esvazia as faixas e o ECE vira ruido.
pub fn calibration_bins(cases: &[&ScoredCase]) -> Vec<CalibrationBin> {
    const BIN_COUNT: usize = 10;
    let mut counts = [0usize; BIN_COUNT];
    let mut correct = [0usize; BIN_COUNT];
    let mut confidence_sum = [0.0_f64; BIN_COUNT];

    for case in cases {
        let confidence = case.prediction.effective_confidence().clamp(0.0, 1.0);
        // Confianca 1.0 cai no ultimo bin, nao fora da tabela.
        let index = ((confidence * BIN_COUNT as f64) as usize).min(BIN_COUNT - 1);
        counts[index] += 1;
        confidence_sum[index] += confidence;
        if case.correct() {
            correct[index] += 1;
        }
    }

    (0..BIN_COUNT)
        .filter(|index| counts[*index] > 0)
        .map(|index| CalibrationBin {
            range: (
                index as f64 / BIN_COUNT as f64,
                (index + 1) as f64 / BIN_COUNT as f64,
            ),
            count: counts[index],
            accuracy: correct[index] as f64 / counts[index] as f64,
            mean_confidence: confidence_sum[index] / counts[index] as f64,
        })
        .collect()
}

/// Brier multiclasse, normalizado pelo numero de classes.
///
/// `mean( sum_c (p_c - y_c)^2 ) / n_classes`, o que coloca o resultado em
/// `[0, 1]`: 0 e perfeito, 1 e o pior possivel.
///
/// Devolve `None` quando algum caso nao tem distribuicao (o legado), porque
/// um Brier calculado sobre um subconjunto parcial seria enganoso.
pub fn brier_score(cases: &[&ScoredCase]) -> Option<f64> {
    let mut classes: BTreeMap<&str, ()> = BTreeMap::new();
    for case in cases {
        if case.prediction.distribution.is_empty() {
            return None;
        }
        classes.insert(case.expected.as_str(), ());
        for label in case.prediction.distribution.keys() {
            classes.insert(label.as_str(), ());
        }
    }
    let class_count = classes.len();
    if class_count == 0 {
        return None;
    }
    let total: f64 = cases
        .iter()
        .map(|case| {
            let mut sum = 0.0;
            for class in classes.keys() {
                let actual = if *class == case.expected { 1.0 } else { 0.0 };
                let predicted = case
                    .prediction
                    .distribution
                    .get(*class)
                    .copied()
                    .unwrap_or(0.0);
                sum += (predicted - actual).powi(2);
            }
            sum
        })
        .sum();
    Some(total / cases.len() as f64 / class_count as f64)
}

/// Um ponto da fronteira acuracia x cobertura.
///
/// A comparacao entre dois motores e feita sobre a CURVA inteira, nunca em
/// um ponto. Um motor que acerta muito se abstendo em 60% dos casos e um
/// trade-off legitimo, mas so quando o preco da verificacao humana e visivel.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontierPoint {
    pub threshold: f64,
    pub coverage: f64,
    pub accuracy: f64,
}

/// Varre limiares de 0 a 1 e devolve a fronteira.
///
/// Limiares discretos de 0.05 em 0.05 sao suficientes: a confianca do modelo e
/// um valor continuo, e o que interessa e a forma da curva, nao o valor
/// exato do limiar.
pub fn selective_frontier(cases: &[ScoredCase]) -> Vec<FrontierPoint> {
    let scorable: Vec<&ScoredCase> = cases
        .iter()
        .filter(|case| case.provenance.is_scorable())
        .collect();
    if scorable.is_empty() {
        return Vec::new();
    }
    let mut points = Vec::new();
    // Indice inteiro em vez de `threshold += 0.05`: acumular ponto flutuante
    // faz o numero de pontos variar entre execucoes, e um relatorio cuja
    // forma muda a cada rodada nao serve de baseline.
    for step in 0..=23 {
        let threshold = step as f64 * 0.05;
        let metrics = Metrics::from_cases(cases, threshold);
        if let (Some(accuracy), Some(abstention)) = (metrics.accuracy, metrics.abstention_rate) {
            points.push(FrontierPoint {
                threshold,
                coverage: 1.0 - abstention,
                accuracy,
            });
        }
    }
    points
}

/// `candidate` domina `baseline` se, em **todo** limiar em que ambos
/// respondem, `candidate` acerta pelo menos tanto.
///
/// Dominancia e o criterio forte: nao existe limiar em que o candidato seja
/// pior. UmaCurva que cruza a outra significa que e um trade-off, e a decisao
/// passa a ser de produto, nao de metrica.
pub fn dominates(candidate: &[FrontierPoint], baseline: &[FrontierPoint]) -> bool {
    if candidate.is_empty() || baseline.is_empty() {
        return false;
    }
    // Compara por cobertura: para o mesmo volume de casos respondidos, quem
    // acerta mais. E a leitura que importa para o usuario, que nao escolhe
    // limiar, e sim quanto trabalho wants fazer.
    for point in candidate {
        // A cobertura do candidato onde ele alcanca a cobertura do baseline.
        let Some(reference) = baseline
            .iter()
            .filter(|other| other.coverage <= point.coverage + f64::EPSILON)
            .max_by(|left, right| {
                left.coverage
                    .partial_cmp(&right.coverage)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        else {
            continue;
        };
        if point.accuracy + 1e-9 < reference.accuracy {
            return false;
        }
    }
    true
}

/// Percentil por nearest-rank acima da mediana, e mediana em p50.
///
/// Em amostras pequenas o percentil interpolado e enganoso, e no caso da cauda
/// ele subestima em vez de superestimar.
pub fn percentile(values: &[u64], p: f64) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let p = p.clamp(0.0, 100.0);
    // p = 0 e o minimo, nao a mediana: em duas amostras, a mediana e 15.
    if p == 0.0 {
        return Some(sorted[0]);
    }
    if p <= 50.0 {
        let middle = sorted.len() / 2;
        if sorted.len() % 2 == 1 {
            return Some(sorted[middle]);
        }
        let low = sorted[middle - 1];
        let high = sorted[middle];
        return Some((low + high) / 2);
    }
    // Nearest-rank: o menor valor tal que pelo menos p% das amostras caem nele.
    // Interpolacao daria 38.5 para o p95 de [10, 20, 30, 40], o que subestima a
    // cauda — e a cauda de latencia e o que interessa quando se pergunta "95% das
    // chamadas foram mais rapidas que quanto?".
    let rank = (p / 100.0 * sorted.len() as f64).ceil() as usize;
    let index = rank.saturating_sub(1).min(sorted.len() - 1);
    Some(sorted[index])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case(id: &str, expected: &str, predicted: &str, confidence: f64) -> ScoredCase {
        ScoredCase {
            id: id.to_string(),
            expected: expected.to_string(),
            provenance: LabelProvenance::Construction,
            prediction: Prediction {
                label: predicted.to_string(),
                // A distribuicao tem de ter o ARGMAX no rotulo previsto. Uma
                // distribuicao que diz "sim" com 1.0 enquanto o rotulo previsto
                // e "nao" faria o Brier mentir.
                distribution: BTreeMap::from([
                    (predicted.to_string(), confidence),
                    (opposite(predicted), 1.0 - confidence),
                ]),
                confidence: Some(confidence),
                latency_ms: 100,
                estimated_cost_usd: 0.001,
            },
            note: None,
        }
    }

    /// Uma segunda classe qualquer, distinta do rotulo previsto.
    fn opposite(label: &str) -> String {
        if label == "sim" {
            "nao".to_string()
        } else {
            "sim".to_string()
        }
    }

    fn legacy_case(id: &str, expected: &str, predicted: &str) -> ScoredCase {
        ScoredCase {
            id: id.to_string(),
            expected: expected.to_string(),
            provenance: LabelProvenance::Construction,
            prediction: Prediction {
                label: predicted.to_string(),
                distribution: BTreeMap::new(),
                confidence: None,
                latency_ms: 30_000,
                estimated_cost_usd: 0.02,
            },
            note: None,
        }
    }

    #[test]
    fn a_perfectly_calibrated_set_has_zero_ece() {
        // Calibracao nao e "sempre acertar": e "acertar 90% quando diz 0.9".
        // Dez casos com confianca 0.9, nove corretos, forma exata.
        let mut cases = Vec::new();
        for index in 0..9 {
            cases.push(case(&format!("a{index}"), "sim", "sim", 0.9));
        }
        cases.push(case("a9", "sim", "nao", 0.9));
        let metrics = Metrics::from_cases(&cases, 0.0);
        assert!(
            metrics.expected_calibration_error.expect("ece") < 0.01,
            "ece nao deveria penalizar um conjunto calibrado: {metrics:?}"
        );
        assert!((metrics.accuracy.expect("acc") - 0.9).abs() < 1e-9);
    }

    #[test]
    fn being_always_right_at_low_confidence_is_still_uncalibrated() {
        // O erro classico: 100% de acerto declarado com confianca 0.5. O
        // numero mente na direcao oposta e nenhum usuario nota.
        let mut cases = Vec::new();
        for index in 0..5 {
            cases.push(case(&format!("a{index}"), "sim", "sim", 0.5));
        }
        for index in 0..5 {
            cases.push(case(&format!("b{index}"), "sim", "nao", 0.5));
        }
        assert!(
            Metrics::from_cases(&cases, 0.0).accuracy.expect("acc") > 0.0,
            "sanidade: o conjunto tem acertos"
        );
        let flat = vec![case("a", "sim", "sim", 0.5); 1];
        assert!(
            Metrics::from_cases(&flat, 0.0)
                .expected_calibration_error
                .expect("ece")
                > 0.4,
            "acertar com confianca baixa demais e o mesmo erro, ao contrario"
        );
    }

    #[test]
    fn an_overconfident_set_has_a_large_ece() {
        // Confianca 0.95 em todos, mas so 50% de acerto.
        let mut cases = Vec::new();
        for index in 0..5 {
            cases.push(case(&format!("a{index}"), "sim", "sim", 0.95));
        }
        for index in 0..5 {
            cases.push(case(&format!("b{index}"), "sim", "nao", 0.95));
        }
        let ece = Metrics::from_cases(&cases, 0.0)
            .expected_calibration_error
            .expect("ece");
        assert!(ece > 0.4, "ece={ece}");
    }

    #[test]
    fn ece_is_none_without_any_case() {
        assert_eq!(expected_calibration_error(&[]), None);
    }

    #[test]
    fn confidence_of_one_lands_in_the_last_bin_not_outside_the_table() {
        let cases = [case("a", "sim", "sim", 1.0)];
        let bins = calibration_bins(&cases.iter().collect::<Vec<_>>());
        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].range, (0.9, 1.0));
    }

    #[test]
    fn a_raising_threshold_moves_cases_into_abstention() {
        let cases = vec![
            case("alta", "sim", "sim", 0.9),
            case("baixa", "sim", "nao", 0.3),
        ];
        let low = Metrics::from_cases(&cases, 0.0);
        let high = Metrics::from_cases(&cases, 0.8);
        assert_eq!(low.cases_scored, 2);
        assert_eq!(high.cases_scored, 1);
        assert_eq!(high.abstention_rate.expect("abstention"), 0.5);
        // Subir o limiar tira justamente o caso que estava errado.
        assert!((high.accuracy.expect("acc") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn abstaining_everything_yields_no_accuracy_rather_than_zero() {
        let cases = vec![case("a", "sim", "sim", 0.2)];
        let metrics = Metrics::from_cases(&cases, 0.9);
        assert_eq!(metrics.accuracy, None, "acuracia de nada nao e zero");
        assert_eq!(metrics.abstention_rate.expect("abstention"), 1.0);
    }

    #[test]
    fn the_legacy_path_reports_no_uncertainty() {
        assert!(!legacy_case("a", "sim", "sim")
            .prediction
            .carries_uncertainty());
        assert_eq!(
            legacy_case("a", "sim", "sim")
                .prediction
                .effective_confidence(),
            0.0
        );
    }

    #[test]
    fn brier_is_zero_for_a_certain_correct_answer() {
        let cases = [case("a", "sim", "sim", 1.0)];
        let score = brier_score(&cases.iter().collect::<Vec<_>>()).expect("brier");
        assert!(score < 1e-9, "{score}");
    }

    #[test]
    fn brier_is_worst_when_the_confident_answer_is_wrong() {
        let wrong = [case("a", "sim", "nao", 1.0)];
        let right = [case("a", "sim", "sim", 1.0)];
        let wrong_score = brier_score(&wrong.iter().collect::<Vec<_>>()).expect("brier");
        let right_score = brier_score(&right.iter().collect::<Vec<_>>()).expect("brier");
        assert!(wrong_score > right_score);
        assert!(wrong_score > 0.5, "{wrong_score}");
    }

    #[test]
    fn brier_is_none_when_any_case_lacks_a_distribution() {
        let cases = [case("a", "sim", "sim", 0.9), legacy_case("b", "sim", "sim")];
        assert_eq!(brier_score(&cases.iter().collect::<Vec<_>>()), None);
    }

    #[test]
    fn disputed_cases_are_excluded_from_every_metric() {
        let mut disputed = case("d", "sim", "nao", 0.9);
        disputed.provenance = LabelProvenance::Disputed;
        let cases = vec![case("a", "sim", "sim", 0.9), disputed];
        let metrics = Metrics::from_cases(&cases, 0.0);
        assert_eq!(metrics.cases_total, 2, "o total ainda conta");
        assert_eq!(metrics.cases_scored, 1, "mas so o pontuavel");
        assert_eq!(metrics.accuracy, Some(1.0));
    }

    #[test]
    fn a_set_with_only_disputed_cases_produces_no_metrics() {
        let mut disputed = case("d", "sim", "sim", 0.9);
        disputed.provenance = LabelProvenance::Disputed;
        let metrics = Metrics::from_cases(&[disputed], 0.0);
        assert_eq!(metrics.accuracy, None);
        assert!(selective_frontier(&[ScoredCase {
            id: "d".to_string(),
            expected: "sim".to_string(),
            provenance: LabelProvenance::Disputed,
            prediction: case("d", "sim", "sim", 0.9).prediction,
            note: None,
        }])
        .is_empty());
    }

    #[test]
    fn provenance_scorability_is_explicit() {
        assert!(LabelProvenance::Construction.is_scorable());
        assert!(LabelProvenance::CommonFact.is_scorable());
        assert!(LabelProvenance::Human.is_scorable());
        assert!(!LabelProvenance::Disputed.is_scorable());
    }

    #[test]
    fn the_frontier_covers_every_threshold_where_something_is_answered() {
        let cases = vec![case("a", "sim", "sim", 0.9), case("b", "sim", "nao", 0.4)];
        let frontier = selective_frontier(&cases);
        // Acima de 0.9 ninguem responde, entao nao ha ponto. Os pontos param
        // em 0.9: limiares 0.0 a 0.9 de passo 0.05 sao 19.
        assert_eq!(frontier.len(), 19, "{frontier:?}");
        assert!((frontier[0].threshold - 0.0).abs() < 1e-9);
        assert!(
            (frontier[0].coverage - 1.0).abs() < 1e-9,
            "no limiar 0 todos respondem"
        );
        assert!((frontier.last().expect("ultimo").threshold - 0.9).abs() < 1e-9);
    }

    #[test]
    fn the_frontier_is_deterministic_across_runs() {
        let cases = vec![
            case("a", "sim", "sim", 0.9),
            case("b", "sim", "nao", 0.4),
            case("c", "sim", "sim", 0.6),
        ];
        assert_eq!(selective_frontier(&cases), selective_frontier(&cases));
    }

    #[test]
    fn dominance_requires_being_no_worse_anywhere() {
        let strong = vec![FrontierPoint {
            threshold: 0.5,
            coverage: 1.0,
            accuracy: 0.9,
        }];
        let weak = vec![FrontierPoint {
            threshold: 0.5,
            coverage: 1.0,
            accuracy: 0.7,
        }];
        assert!(dominates(&strong, &weak));
        assert!(!dominates(&weak, &strong));

        // Um candidato que e melhor em cobertura total E ganha pontos extras em
        // cobertura parcial domina de verdade: em toda cobertura onde ambos
        // respondem, ele acerta pelo menos tanto.
        let better_everywhere = vec![
            FrontierPoint {
                threshold: 0.0,
                coverage: 1.0,
                accuracy: 0.95,
            },
            FrontierPoint {
                threshold: 0.5,
                coverage: 0.5,
                accuracy: 1.0,
            },
        ];
        assert!(dominates(&better_everywhere, &strong));
    }

    #[test]
    fn crossing_curves_are_not_dominance_in_either_direction() {
        // Candidato acerta pouco quando responde muito, e muito quando responde
        // pouco. Nao domina o legado, e o legado nao o domina: e trade-off.
        let candidate = vec![
            FrontierPoint {
                threshold: 0.0,
                coverage: 1.0,
                accuracy: 0.6,
            },
            FrontierPoint {
                threshold: 0.8,
                coverage: 0.5,
                accuracy: 0.95,
            },
        ];
        let baseline = vec![
            FrontierPoint {
                threshold: 0.0,
                coverage: 1.0,
                accuracy: 0.85,
            },
            FrontierPoint {
                threshold: 0.5,
                coverage: 0.5,
                accuracy: 0.6,
            },
        ];
        assert!(!dominates(&candidate, &baseline), "pior em cobertura total");
        assert!(
            !dominates(&baseline, &candidate),
            "pior em cobertura parcial"
        );
    }

    #[test]
    fn dominance_of_an_empty_frontier_is_false_not_vacuously_true() {
        assert!(!dominates(
            &[],
            &[FrontierPoint {
                threshold: 0.0,
                coverage: 1.0,
                accuracy: 1.0
            }]
        ));
        assert!(!dominates(
            &[FrontierPoint {
                threshold: 0.0,
                coverage: 1.0,
                accuracy: 1.0
            }],
            &[]
        ));
    }

    #[test]
    fn percentiles_handle_odd_even_and_tiny_samples() {
        assert_eq!(percentile(&[], 50.0), None);
        assert_eq!(percentile(&[7], 50.0), Some(7));
        assert_eq!(percentile(&[7], 95.0), Some(7));
        assert_eq!(percentile(&[10, 20, 30], 50.0), Some(20));
        assert_eq!(percentile(&[10, 20, 30, 40], 50.0), Some(25));
        // Nearest-rank: p95 de quatro amostras e o maior valor, nao 38.5.
        assert_eq!(percentile(&[10, 20, 30, 40], 95.0), Some(40));
        assert_eq!(percentile(&[10, 20], 0.0), Some(10));
        assert_eq!(percentile(&[10, 20], 100.0), Some(20));
        assert_eq!(
            percentile(&[40, 10, 30, 20], 95.0),
            Some(40),
            "ordem de entrada"
        );
    }

    #[test]
    fn latency_and_cost_are_summarised_over_every_case() {
        let mut slow = case("a", "sim", "sim", 0.9);
        slow.prediction.latency_ms = 500;
        slow.prediction.estimated_cost_usd = 0.004;
        let mut fast = case("b", "sim", "sim", 0.9);
        fast.prediction.latency_ms = 100;
        let cases = vec![slow, fast];
        let metrics = Metrics::from_cases(&cases, 0.0);
        assert_eq!(metrics.latency_p50_ms, Some(300), "mediana de dois valores");
        assert_eq!(metrics.latency_p95_ms, Some(500), "nearest-rank na cauda");
        assert!((metrics.total_cost_usd - 0.005).abs() < 1e-9);
    }

    #[test]
    fn declared_confidence_wins_over_the_recomputed_peak() {
        let prediction = Prediction {
            label: "sim".to_string(),
            distribution: BTreeMap::from([("sim".to_string(), 0.5), ("nao".to_string(), 0.5)]),
            confidence: Some(0.8),
            latency_ms: 1,
            estimated_cost_usd: 0.0,
        };
        assert_eq!(prediction.effective_confidence(), 0.8);
    }
}
