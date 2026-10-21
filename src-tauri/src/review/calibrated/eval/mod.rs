//! Harness de avaliacao do motor calibrado (F1).
//!
//! Objetivo desta fase e **medir**, nao migrar: nenhuma funcionalidade de
//! produto muda aqui. O harness pergunta direto ao motor e compara as
//! respostas com rotulos do golden set.
//!
//! Como ler o resultado — o que importa nao e acuracia bruta:
//!
//! - **ECE** responde "confianca 0.9 acerta 90% das vezes?". Se nao, o numero
//!   e decorativo e a UI nao deve exibi-lo (`calibrationValidated = false`).
//! - **Acuracia seletiva** responde "dos casos que o motor respondeu, quantos
//!   acertou?", e precisa vir com a taxa de abstention. Motor que acerta 99%
//!   se abstendo em 60% dos casos e um trade-off, nao uma vitoria.
//! - **Dominancia** (`metrics::dominates`) responde se um motor e melhor OU
//!   IGUAL em toda a curva. Curvas que cruzam sao decisao de produto.

pub mod golden;
pub mod metrics;

pub use golden::{
    CaseFailure, DimensionCoverage, EngineReport, GoldenCase, GoldenClaim, GoldenExchange,
    GoldenSet, Label,
};
pub use metrics::{
    calibration_bins, dominates, expected_calibration_error, selective_frontier, CalibrationBin,
    FrontierPoint, LabelProvenance, Metrics, Prediction, ScoredCase,
};

use serde::Serialize;
/// Limiares em que todo relatorio e pontuado.
///
/// `0.0` e `1.1` sao as pontas: o primeiro reproduz a comparacao de acuracia
/// bruta que o fornecedor divulga, e o segundo mede o preco de responder
/// sempre. Os do meio sao onde vive a decisao real.
pub const DEFAULT_THRESHOLDS: &[f64] = &[0.0, 0.3, 0.5, 0.7, 0.85, 1.1];

/// Comparacao entre dois motores sobre o mesmo conjunto.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReport {
    pub golden_set_size: usize,
    pub unscoreable: Vec<UnscoreableCase>,
    pub candidate: EngineReport,
    pub baseline: EngineReport,
    /// O candidato e melhor ou igual em toda a curva?
    pub candidate_dominates_baseline: bool,
    /// As curvas cruzam? Se sim, a escolha e de produto, nao de metrica.
    pub curves_cross: bool,
    /// `false` significa: nao exiba numeros de confianca na UI.
    pub confidence_is_actionable: bool,
    /// Os rotulos de prontidao foram revisados por alguem?
    ///
    /// Sem isto, o ECE mede concordancia com a construcao de quem escreveu os
    /// casos, e nao com veredito humano. E o que separa "o numero esta
    /// calibrado" de "o numero concorda com a minha opiniao".
    pub labels_reviewed: bool,
    /// O ECE de cada repeticao do JEV.
    ///
    /// A acuracia do JEV e estavel entre repeticoes; o que varia e a
    /// **confianca** que ele anexa as respostas, e o ECE e penalizado por
    /// excesso de confianca. Uma unica rodada transformava a decisao do gate
    /// numa moeda, entao o gate decide pelo pior.
    #[serde(default)]
    pub ece_by_run: Vec<Option<f64>>,
    /// A cobertura de ground truth de cada dimensao do conjunto.
    ///
    /// E o lugar onde "nao medido" aparece com nome. Sem isto, uma dimensao
    /// sem ground truth produz `0%` — que lido como "o motor errou em
    /// tudo", quando a verdade e que ninguem olhou.
    #[serde(default)]
    pub dimension_coverage: Vec<DimensionCoverage>,
    pub verdict: String,
}

/// Um rotulo que o harness se recusa a pontuar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnscoreableCase {
    pub case_id: String,
    pub dimension: String,
    pub provenance: LabelProvenance,
}

impl ComparisonReport {
    pub fn build(
        golden_set: &GoldenSet,
        candidate: EngineReport,
        baseline: EngineReport,
        max_ece: f64,
    ) -> Self {
        let candidate_dominates = dominates(&candidate.frontier, &baseline.frontier);
        let baseline_dominates = dominates(&baseline.frontier, &candidate.frontier);
        let curves_cross = !candidate_dominates && !baseline_dominates;

        // ECE so e interpretavel para quem DECLARA estar confiante. O caminho
        // legado nao produz probabilidade nenhuma: sua confianca efetiva e 0
        // por construcao, e um ECE calculado sobre isso seria a acuracia de
        // novo, nao uma medida de calibracao. Incluir o legado no gate faria
        // `confidence_is_actionable` falso para sempre.
        // Nao usar `.fold(f64::INFINITY, f64::max)`: `f64::max` aqui resolve para
        // `Ord::max`, que compara por ORDEM TOTAL — e `INFINITY` e maior que
        // qualquer probabilidade. A semente nunca sai do lugar e o gate vira
        // `inf <= max`, ou seja, sempre reprovado. O comentario existe para
        // ninguem "simplificar" de volta.
        let mut worst_ece: Option<f64> = None;
        for metrics in candidate.metrics.values() {
            let Some(ece) = metrics.expected_calibration_error else {
                continue;
            };
            worst_ece = Some(match worst_ece {
                Some(current) if current >= ece => current,
                _ => ece,
            });
        }
        let worst_ece = worst_ece.unwrap_or(f64::INFINITY);
        // Tolerancia: erro de ponto flutuante entre 0.1 e 0.1000000000000001
        // nao pode reprovar um conjunto exatamente no limite.
        const ECE_TOLERANCE: f64 = 1e-6;
        let confidence_is_actionable =
            worst_ece.is_finite() && worst_ece <= max_ece + ECE_TOLERANCE;

        // Os rotulos de prontidao precisam ter sido revisados por alguem. Um
        // rotulo `construction` e a construcao de quem escreveu o caso, e o
        // ECE contra ele mede auto-concordancia.
        let labels_reviewed = golden_set
            .cases
            .iter()
            .filter(|case| case.readiness.provenance().is_scorable())
            .all(|case| case.readiness.provenance() == LabelProvenance::Human);

        let verdict = if confidence_is_actionable && candidate_dominates {
            "Candidato dominante e confianca acionavel: aprovar a migracao.".to_string()
        } else if confidence_is_actionable && curves_cross {
            "Confianca acionavel, mas as curvas cruzam: e uma escolha de produto, \
             nao um ganho automatico. Decidir pelo preco da verificacao humana."
                .to_string()
        } else if !confidence_is_actionable {
            format!(
                "Confianca NAO acionavel (pior ECE {worst_ece:.3} acima de {max_ece:.2}): \
                 nao exibir numeros de confianca na UI."
            )
        } else {
            "Candidato nao domina o legado: manter o legado como primario.".to_string()
        };

        Self {
            golden_set_size: golden_set.cases.len(),
            unscoreable: golden_set
                .unscoreable()
                .into_iter()
                .map(|(case_id, dimension, provenance)| UnscoreableCase {
                    case_id: case_id.to_string(),
                    dimension: dimension.to_string(),
                    provenance,
                })
                .collect(),
            candidate,
            baseline,
            candidate_dominates_baseline: candidate_dominates,
            curves_cross,
            confidence_is_actionable,
            labels_reviewed,
            ece_by_run: Vec::new(),
            dimension_coverage: golden_set.dimension_coverage(),
            verdict,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn prediction(label: &str, confidence: f64) -> Prediction {
        Prediction {
            label: label.to_string(),
            distribution: BTreeMap::from([
                (label.to_string(), confidence),
                ("outro".to_string(), 1.0 - confidence),
            ]),
            confidence: Some(confidence),
            latency_ms: 100,
            estimated_cost_usd: 0.001,
        }
    }

    fn scored(id: &str, expected: &str, predicted: &str, confidence: f64) -> ScoredCase {
        ScoredCase {
            id: id.to_string(),
            expected: expected.to_string(),
            provenance: LabelProvenance::Construction,
            prediction: prediction(predicted, confidence),
            note: None,
        }
    }

    fn golden_set() -> GoldenSet {
        GoldenSet {
            cases: vec![GoldenCase {
                id: "a".to_string(),
                note: "a.md".to_string(),
                readiness: Label::Short("ready".to_string()),
                claims: vec![],
                exchanges: vec![],
                synthesis: None,
                expected_bands: None,
                synthesis_provenance: None,
                expected_definitions: None,
                expected_definitions_provenance: None,
            }],
        }
    }

    fn report_for(cases: &[ScoredCase], engine: &str) -> EngineReport {
        let mut report = EngineReport::new(engine, "modelo");
        report.score(cases, DEFAULT_THRESHOLDS);
        report
    }

    #[test]
    fn the_default_thresholds_span_the_decision() {
        assert_eq!(DEFAULT_THRESHOLDS.first(), Some(&0.0), "acuracia bruta");
        assert_eq!(
            DEFAULT_THRESHOLDS.last(),
            Some(&1.1),
            "1.1 nunca abstem: mede o preco de responder sempre"
        );
    }

    #[test]
    fn an_accurate_candidate_beats_a_legacy_that_never_abstains_wrongly() {
        // Candidato: acerta os dois com confianca 0.9.
        // Legado: acerta zero, e como nao produz confianca nunca se abstem —
        // logo tem cobertura 100% com acuracia 0%. O candidato domina.
        let candidate = report_for(
            &[
                scored("a", "ready", "ready", 0.9),
                scored("b", "ready", "ready", 0.9),
            ],
            "jev",
        );
        let baseline = report_for(
            &[
                scored("a", "ready", "nao", 0.0),
                scored("b", "ready", "nao", 0.0),
            ],
            "legacy",
        );
        let comparison = ComparisonReport::build(&golden_set(), candidate, baseline, 0.10);
        assert!(comparison.candidate_dominates_baseline);
        assert!(!comparison.curves_cross);
        assert!(
            comparison.confidence_is_actionable,
            "verdict={}",
            comparison.verdict
        );
        assert!(
            comparison.verdict.contains("aprovar"),
            "{}",
            comparison.verdict
        );
    }

    /// Regressao do gate: semear um `fold` com `INFINITY` usando `f64::max`
    /// resolve para `Ord::max` (ordem total), que nunca substitui a semente.
    /// O resultado era `inf <= max_ece`, sempre falso, e a confianca ficava
    /// desabilitada para sempre sem erro visivel.
    #[test]
    fn a_worst_ece_on_the_boundary_is_not_rejected_by_float_noise() {
        // ECE exatamente 0.1: o limite do gate.
        let candidate = report_for(
            &[
                scored("a", "ready", "ready", 0.9),
                scored("b", "ready", "ready", 0.9),
            ],
            "jev",
        );
        let baseline = report_for(&[scored("a", "ready", "nao", 0.0)], "legacy");
        let comparison = ComparisonReport::build(&golden_set(), candidate, baseline, 0.10);
        assert!(
            comparison.confidence_is_actionable,
            "verdict={}",
            comparison.verdict
        );
    }

    #[test]
    fn a_bad_ece_blocks_the_confidence_display_even_when_accurate() {
        // 100% de acerto com confianca 0.5 declarada: o numero mente, mesmo
        // estando certo.
        let candidate = report_for(
            &[
                scored("a", "ready", "ready", 0.5),
                scored("b", "ready", "ready", 0.5),
            ],
            "jev",
        );
        let baseline = report_for(&[scored("a", "ready", "nao", 0.0)], "legacy");
        let comparison = ComparisonReport::build(&golden_set(), candidate, baseline, 0.10);
        assert!(!comparison.confidence_is_actionable);
        assert!(
            comparison.verdict.contains("NAO acionavel"),
            "{}",
            comparison.verdict
        );
    }

    #[test]
    fn abstention_is_not_free_against_a_competent_legacy() {
        // Candidato acerta so a metade que responde; o legado, que nunca se
        // abstem porque nao produz confianca, acerta tudo com cobertura total.
        // O candidato NAO pode ser aprovado aqui: ficar calado em 50% dos
        // casos e um preco alto demais contra um baseline que acerta 100%.
        let candidate = report_for(
            &[
                scored("a", "ready", "ready", 0.9),
                scored("b", "ready", "ready", 0.9),
                scored("c", "ready", "nao", 0.1),
                scored("d", "ready", "nao", 0.1),
            ],
            "jev",
        );
        let baseline = report_for(
            &[
                scored("a", "ready", "ready", 0.0),
                scored("b", "ready", "ready", 0.0),
                scored("c", "ready", "ready", 0.0),
                scored("d", "ready", "ready", 0.0),
            ],
            "legacy",
        );
        let comparison = ComparisonReport::build(&golden_set(), candidate, baseline, 0.10);
        assert!(
            !comparison.candidate_dominates_baseline,
            "acertar 50% nao pode vencer um baseline que acerta 100% sem se calar"
        );
        assert!(
            comparison.verdict.contains("nao domina"),
            "{}",
            comparison.verdict
        );
    }

    #[test]
    fn a_confident_candidate_can_beat_a_competent_legacy() {
        // Mesmo baseline, mas o candidato acerta os dois que responde e
        // cala os dois difficultes. No limiar 0.5 ele tem 100% de acuracia
        // com metade da cobertura — que e a proposta do JEV.
        let candidate = report_for(
            &[
                scored("a", "ready", "ready", 0.95),
                scored("b", "ready", "ready", 0.95),
                scored("c", "ready", "ready", 0.15),
                scored("d", "ready", "nao", 0.15),
            ],
            "jev",
        );
        let baseline = report_for(
            &[
                scored("a", "ready", "ready", 0.0),
                scored("b", "ready", "ready", 0.0),
                scored("c", "ready", "nao", 0.0),
                scored("d", "ready", "nao", 0.0),
            ],
            "legacy",
        );
        let comparison = ComparisonReport::build(&golden_set(), candidate, baseline, 0.10);
        let at_half = comparison
            .candidate
            .metrics_at(0.5)
            .expect("metrica em 0.5");
        assert_eq!(at_half.cases_scored, 2, "so os casos confiaveis");
        assert!((at_half.accuracy.expect("acc") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn unscoreable_labels_are_surfaced_in_the_comparison() {
        let set = GoldenSet {
            cases: vec![GoldenCase {
                id: "limite".to_string(),
                note: "a.md".to_string(),
                readiness: Label::Detailed(golden::DetailedLabel {
                    label: "ready".to_string(),
                    provenance: LabelProvenance::Disputed,
                    why: Some("fronteira entre ready e ambiguous".to_string()),
                }),
                claims: vec![],
                exchanges: vec![],
                synthesis: None,
                expected_bands: None,
                synthesis_provenance: None,
                expected_definitions: None,
                expected_definitions_provenance: None,
            }],
        };
        let report = report_for(&[scored("a", "ready", "ready", 0.9)], "jev");
        let comparison = ComparisonReport::build(&set, report.clone(), report, 0.10);
        assert_eq!(comparison.golden_set_size, 1);
        assert_eq!(comparison.unscoreable.len(), 1);
        assert_eq!(comparison.unscoreable[0].case_id, "limite");
    }

    #[test]
    fn a_report_with_no_ece_at_all_is_not_actionable() {
        let empty = report_for(&[], "jev");
        let comparison = ComparisonReport::build(&golden_set(), empty.clone(), empty, 0.10);
        assert!(
            !comparison.confidence_is_actionable,
            "sem dado nao se habilita a exibicao"
        );
    }

    #[test]
    fn the_comparison_serializes_to_a_committable_report() {
        let report = report_for(&[scored("a", "ready", "ready", 0.9)], "jev");
        let comparison = ComparisonReport::build(&golden_set(), report.clone(), report, 0.10);
        let json = serde_json::to_string_pretty(&comparison).expect("serializa");
        assert!(json.contains("candidateDominatesBaseline"));
        assert!(json.contains("confidenceIsActionable"));
        assert!(json.contains("verdict"));
    }
}
