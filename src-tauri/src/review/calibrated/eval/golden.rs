//! Harness de avaliacao do motor calibrado (F1).
//!
//! O objetivo desta fase e **medir**, nao migrar. Nenhuma funcionalidade de
//! produto muda aqui: o harness pergunta direto ao motor e compara as
//! respostas com rotulos do golden set.
//!
//! Como ler o resultado — o que importa nao e acuracia bruta:
//!
//! - **ECE** responde "confianca 0.9 acerta 90% das vezes?". Se nao, o numero
//!   e decorativo e a UI nao deve exibi-lo (`calibrationValidated = false`).
//! - **Acuracia seletiva** responde "dos casos que o motor respondreu, quantos
//!   ele acertou?", e precisa ser comparada com a taxa de abstention. Um motor
//!   que acerta 99% se abstendo em 60% dos casos e um trade-off, nao uma
//!   vitoria.
//! - **Dominancia** (`dominates`) responde se um motor e melhor OU IGUAL em
//!   toda a curva. Se as curvas cruzam, a escolha vira decisao de produto.

use super::metrics::{selective_frontier, FrontierPoint, LabelProvenance, Metrics, ScoredCase};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Rótulo esperado em um caso do golden set.
///
/// `#[serde(untagged)]` aceita tanto `"ready"` quanto
/// `{"label": "ready", "provenance": "disputed", "why": "..."}`. A forma curta
/// serve para casos cuja construção já determina o rótulo; a longa existe
/// para os que precisam registrar de onde a afirmação veio.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Label {
    Short(String),
    Detailed(DetailedLabel),
}

impl Label {
    pub fn value(&self) -> &str {
        match self {
            Label::Short(value) => value,
            Label::Detailed(detailed) => &detailed.label,
        }
    }

    /// Rótulos curtos contam como `construction`: quem escreveu o caso
    /// construiu a nota para ter aquele rótulo.
    pub fn provenance(&self) -> LabelProvenance {
        match self {
            Label::Short(_) => LabelProvenance::Construction,
            Label::Detailed(detailed) => detailed.provenance,
        }
    }

    pub fn why(&self) -> Option<&str> {
        match self {
            Label::Short(_) => None,
            Label::Detailed(detailed) => detailed.why.as_deref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedLabel {
    pub label: String,
    #[serde(default)]
    pub provenance: LabelProvenance,
    /// Regra ou fato que sustenta o rótulo. Sem isto, o rótulo é opinião.
    #[serde(default)]
    pub why: Option<String>,
}

/// Uma afirmação factual presente na nota, com o rótulo de veracidade.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenClaim {
    /// Trecho literal da nota que ancora a afirmação.
    pub quote: String,
    pub label: Label,
}

/// Uma troca de pergunta e resposta na sessão, com o status esperado da
/// afirmação avaliada.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenExchange {
    pub prompt: String,
    pub answer: String,
    /// `remembered`, `partial`, `missing` ou `contradicted`.
    pub status: String,
    /// Rótulo ancorado em construção: resposta que repete a nota é
    /// `remembered` por definição, não por opinião.
    pub status_provenance: LabelProvenance,
}

/// Uma dimensao do golden set, e o quanto dela foi medida.
///
/// ## Por que isto existe
///
/// O mecanismo de honestidade do golden set **nao** e "ter um caso
/// `disputed`": e **nao apresentar como medida uma dimensao que nao foi
/// medida**. Um relatorio que mostra `0/0` numa dimensao sem ground truth
/// parece um resultado perfeito, e nao e.
///
/// Por isso o relatorio carrega a cobertura de cada dimensao: `measured` e
/// `total` sao numeros separados, e o leitor ve que a dimensao existe, que
/// tem N itens, e que M deles tem ground truth.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionCoverage {
    /// Nome da dimensao: `readiness`, `claims`, `exchanges` ou `definitions`.
    pub dimension: String,
    /// O que a contagem mede: `casos` ou `afirmacoes`.
    pub unit: String,
    /// Itens com ground truth utilizavel.
    pub measured: usize,
    /// Itens que a dimensao tem no conjunto.
    pub total: usize,
}

impl DimensionCoverage {
    /// A dimensao tem ground truth, mas nao para todos os itens.
    pub fn is_partial(&self) -> bool {
        self.measured > 0 && self.measured < self.total
    }

    /// A dimensao nao foi medida de jeito nenhum.
    ///
    /// Uma dimensao com **zero itens** nao conta: nao ha nada para medir e
    /// nada para esconder. O que marca a dimensao como nao medida e ter
    /// itens que ninguem revisou.
    pub fn is_unmeasured(&self) -> bool {
        self.total > 0 && self.measured == 0
    }
}

/// Um caso do golden set.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenCase {
    pub id: String,
    /// Caminho da nota, relativo à raiz do conjunto.
    pub note: String,
    /// `ready`, `ambiguous` ou `insufficient`.
    pub readiness: Label,
    #[serde(default)]
    pub claims: Vec<GoldenClaim>,
    #[serde(default)]
    pub exchanges: Vec<GoldenExchange>,
    /// A síntese do usuário para este caso.
    ///
    /// É a entrada que os **dois** caminhos de síntese recebem: o legado
    /// escreve a prosa a partir dela, e o JEV classifica a mesma frase. Sem
    /// ela não há como comparar as bandas — `band_agreement` mede se os dois
    /// motores descrevem a mesma coisa, e isso exige que olhem para o mesmo
    /// material.
    ///
    /// Ausente nos casos cuja nota não admite síntese (os `insufficient`):
    /// não há o que sintetizar sobre uma nota que é só uma lista de tarefas.
    #[serde(default)]
    pub synthesis: Option<String>,
    /// A banda esperada por dimensao, para os casos revisados por alguem.
    ///
    /// Ausente enquanto ninguem revisou: e o que separa "medido contra ground
    /// truth" de "medido contra a construcao de quem escreveu o caso".
    #[serde(default)]
    pub expected_bands: Option<std::collections::BTreeMap<String, String>>,
    /// De onde veio a revisao das sinteses deste caso.
    ///
    /// `human` so quando alguem revisou. E **nao** tem nada a ver com a
    /// `provenance` do rotulo de prontidao: revisar as sinteses nao torna o
    /// rotulo de prontidao revisado.
    #[serde(default)]
    pub synthesis_provenance: Option<LabelProvenance>,
    /// Os termos que, se definidos, melhorariam a nota.
    ///
    /// **Esta e a resposta de OUTRA pergunta** que a de prontidao. O rotulo
    /// `ready` diz se a nota sustenta uma revisao; esta lista diz que
    /// terminos Defined a nota usaria melhor. Uma nota **sobre** o ciclo de
    /// Calvin nao precisa definir "rubisco" para sustentar uma revisao — mas
    /// ganha com essa definicao.
    ///
    /// A lista pode estar incompleta (um revisor pode deixar passar um termo),
    /// e por isso ela mede **recall** e nao precisa: quantas das definicoes
    /// que o revisorSaid que melhorariam a nota o pipeline encontrou?
    #[serde(default)]
    pub expected_definitions: Option<Vec<ExpectedDefinition>>,
    /// De onde veio a revisao dos termos.
    #[serde(default)]
    pub expected_definitions_provenance: Option<LabelProvenance>,
}

/// Um termo que o revisor disse que melhoraria a nota.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedDefinition {
    pub term: String,
    /// A citacao onde o termo aparece, quando o revisor a过身.
    #[serde(default)]
    pub source_quote: Option<String>,
}

impl GoldenCase {
    /// Regra de construcao que sustenta o rotulo de prontidao.
    ///
    /// O golden set nao aceita rotulo de prontidao sem regra: e o rotulo mais
    /// facil de escrever por opiniao e o que mais influencia o produto.
    pub fn readiness_rule(&self) -> Option<&str> {
        self.readiness.why()
    }

    /// Os termos que o revisor disse que melhorariam a nota.
    ///
    /// `None` significa **ninguem revisou esta dimensao** — o que e diferente
    /// de "revisei e nao achei nenhum termo" (que e `Some(vec![])`). A
    /// distincao importa: a primeira diz que a dimensao nao foi medida, e a
    /// segunda diz que a medicao deu zero.
    pub fn definition_ground_truth(&self) -> Option<&[ExpectedDefinition]> {
        self.expected_definitions.as_deref()
    }
}

/// Subpasta onde vivem as notas do conjunto.
///
/// Declarado aqui em vez de repetido em cada `note` do JSON: adicionar um caso
/// nao exige editar caminho, e o diretorio de fixtures tem um so owner.
pub const NOTES_DIRECTORY: &str = "cases";

/// Resolve o caminho de uma nota dentro do conjunto.
///
/// Rejeita `..` e caminho absoluto. O campo `note` vem de um arquivo do
/// proprio repositorio, entao isso nao e defesa contra atacante — e defesa
/// contra um erro de edicao que faria o harness ler arquivo de fora das
/// fixtures sem ninguem perceber.
pub fn resolve_note_path(
    set_root: &std::path::Path,
    note: &str,
) -> Result<std::path::PathBuf, String> {
    let relative = std::path::Path::new(note);
    // `Path::is_absolute` nao basta: no Windows `/etc/passwd` tem uma barra
    // inicial mas NAO e absoluto, e passaria. O que importa e nao haver
    // `Prefix` (C:\, \\server) nem `RootDir` (/) em nenhum componente.
    let escapes = relative.components().any(|part| {
        matches!(
            part,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    });
    if escapes || relative.as_os_str().is_empty() {
        return Err(format!(
            "o campo `note` precisa ser um caminho relativo dentro de `{NOTES_DIRECTORY}/`: {note}"
        ));
    }
    Ok(set_root.join(NOTES_DIRECTORY).join(relative))
}

/// O conjunto completo.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenSet {
    pub cases: Vec<GoldenCase>,
}

impl GoldenSet {
    /// Avisa casos cuja provenance torna a medição parcial ou impossível.
    ///
    /// Rodar um relatório sem ler esta lista é a forma mais fácil de concluir
    /// coisas erradas: um caso `disputed` excluído muda a taxa de acerto sem
    /// deixar rastro no número.
    pub fn unscoreable(&self) -> Vec<(&str, &str, LabelProvenance)> {
        let mut out = Vec::new();
        for case in &self.cases {
            if !case.readiness.provenance().is_scorable() {
                out.push((case.id.as_str(), "readiness", case.readiness.provenance()));
            }
            for claim in &case.claims {
                if !claim.label.provenance().is_scorable() {
                    out.push((case.id.as_str(), "claims", claim.label.provenance()));
                }
            }
            for exchange in &case.exchanges {
                if !exchange.status_provenance.is_scorable() {
                    out.push((case.id.as_str(), "exchanges", exchange.status_provenance));
                }
            }
        }
        out
    }

    /// A cobertura de ground truth de cada dimensao do conjunto.
    ///
    /// ## Por que a cobertura e separada do `unscoreable`
    ///
    /// `unscoreable` lista o que foi **excluido** da metrica: um rotulo
    /// `disputed`. A cobertura lista o que **nem foi medido**: uma dimensao
    /// sem ground truth nao produz erro, produz silencio — e o silencio e o
    /// que o leitor nao percebe.
    ///
    /// A dimensao `definitions` (os termos que melhorariam a nota) e o
    /// exemplo vivo: enquanto ninguem revisar, o recall dela e `0/0`, que
    /// lido como "achou tudo" e nao como "ninguem olhou".
    pub fn dimension_coverage(&self) -> Vec<DimensionCoverage> {
        let cases = self.cases.len();
        let claims: usize = self.cases.iter().map(|case| case.claims.len()).sum();
        let exchanges: usize = self.cases.iter().map(|case| case.exchanges.len()).sum();

        let readiness_measured = self
            .cases
            .iter()
            .filter(|case| case.readiness.provenance().is_scorable())
            .count();
        let claims_measured = self
            .cases
            .iter()
            .flat_map(|case| case.claims.iter())
            .filter(|claim| claim.label.provenance().is_scorable())
            .count();
        let exchanges_measured = self
            .cases
            .iter()
            .flat_map(|case| case.exchanges.iter())
            .filter(|exchange| exchange.status_provenance.is_scorable())
            .count();
        let definitions_measured = self
            .cases
            .iter()
            .filter(|case| case.definition_ground_truth().is_some())
            .count();

        vec![
            DimensionCoverage {
                dimension: "readiness".to_string(),
                unit: "casos".to_string(),
                measured: readiness_measured,
                total: cases,
            },
            DimensionCoverage {
                dimension: "claims".to_string(),
                unit: "afirmacoes".to_string(),
                measured: claims_measured,
                total: claims,
            },
            DimensionCoverage {
                dimension: "exchanges".to_string(),
                unit: "trocas".to_string(),
                measured: exchanges_measured,
                total: exchanges,
            },
            DimensionCoverage {
                dimension: "definitions".to_string(),
                unit: "casos".to_string(),
                measured: definitions_measured,
                total: cases,
            },
        ]
    }

    /// A dimensao de ground truth que ainda nao foi medida.
    ///
    /// Uma dimensao com zero ground truth **nao** e um resultado de zero: e
    /// uma dimensao que o harness nao pode medir. Quem reportar precisa
    /// dizer "nao medido", nunca `0%`.
    pub fn unmeasured_dimensions(&self) -> Vec<DimensionCoverage> {
        self.dimension_coverage()
            .into_iter()
            .filter(DimensionCoverage::is_unmeasured)
            .collect()
    }

    pub fn cases_by_id(&self) -> BTreeMap<&str, &GoldenCase> {
        self.cases
            .iter()
            .map(|case| (case.id.as_str(), case))
            .collect()
    }
}

/// Relatório de uma execução: um motor, um conjunto, um limiar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineReport {
    pub engine: String,
    pub model: String,
    /// Limiares em que as metricas sao reportadas.
    pub thresholds: Vec<f64>,
    pub metrics: BTreeMap<String, Metrics>,
    /// Fronteira de acurácia x cobertura.
    pub frontier: Vec<FrontierPoint>,
    /// As faixas de confianca, com o que o motor respondeu e o que acertou em
    /// cada uma.
    ///
    /// Sem isto o ECE e um numero que ninguem consegue ler: a conta que
    /// produz ele so fica visivel nestas faixas.
    #[serde(default)]
    pub bins: Vec<crate::review::calibrated::eval::metrics::CalibrationBin>,
    /// Casos que falharam antes de produzir previsao.
    pub failures: Vec<CaseFailure>,
    /// Previsao por caso, para o relatorio ser comparavel caso a caso.
    ///
    /// Sem isto o relatorio so diz "88.9% de acuracia" e nao diz **quais**
    /// casos o motor errou — que e a unica parte que um humano consegue agir.
    pub cases: Vec<ScoredCase>,
    pub total_cost_usd: f64,
    pub total_latency_ms: u64,
}

/// Um caso que nao produziu previsao utilizavel.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseFailure {
    pub case_id: String,
    pub dimension: String,
    pub message: String,
}

impl EngineReport {
    pub fn new(engine: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            engine: engine.into(),
            model: model.into(),
            thresholds: Vec::new(),
            metrics: BTreeMap::new(),
            frontier: Vec::new(),
            bins: Vec::new(),
            failures: Vec::new(),
            cases: Vec::new(),
            total_cost_usd: 0.0,
            total_latency_ms: 0,
        }
    }

    /// Recalcula as metricas em todos os limiares declarados.
    pub fn score(&mut self, cases: &[ScoredCase], thresholds: &[f64]) {
        self.thresholds = thresholds.to_vec();
        self.cases = cases.to_vec();
        for threshold in thresholds {
            let key = format!("{threshold:.2}");
            self.metrics
                .insert(key, Metrics::from_cases(cases, *threshold));
        }
        self.frontier = selective_frontier(cases);
        // As faixas de confianca, para o ECE poder ser lido: e nelas que a
        // conta acontece.
        self.bins = crate::review::calibrated::eval::metrics::calibration_bins(
            &cases.iter().collect::<Vec<_>>(),
        );
        self.total_cost_usd = cases
            .iter()
            .map(|case| case.prediction.estimated_cost_usd)
            .sum();
        self.total_latency_ms = cases.iter().map(|case| case.prediction.latency_ms).sum();
    }

    pub fn metrics_at(&self, threshold: f64) -> Option<&Metrics> {
        self.metrics.get(&format!("{threshold:.2}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::calibrated::eval::metrics::Prediction;

    fn label(value: &str) -> Label {
        Label::Short(value.to_string())
    }

    fn detailed(value: &str, provenance: LabelProvenance, why: Option<&str>) -> Label {
        Label::Detailed(DetailedLabel {
            label: value.to_string(),
            provenance,
            why: why.map(str::to_string),
        })
    }

    #[test]
    fn a_short_label_counts_as_constructed() {
        assert_eq!(label("ready").value(), "ready");
        assert_eq!(label("ready").provenance(), LabelProvenance::Construction);
        assert_eq!(label("ready").why(), None);
    }

    #[test]
    fn a_detailed_label_carries_its_provenance_and_reason() {
        let label = detailed(
            "divergent",
            LabelProvenance::CommonFact,
            Some("errado por definicao"),
        );
        assert_eq!(label.value(), "divergent");
        assert_eq!(label.provenance(), LabelProvenance::CommonFact);
        assert_eq!(label.why(), Some("errado por definicao"));
    }

    #[test]
    fn the_set_parses_from_the_short_form() {
        let json = serde_json::from_str::<GoldenSet>(
            r#"{"cases":[{"id":"a","note":"a.md","readiness":"ready",
                 "claims":[{"quote":"Agua ferve a 100 graus.","label":"confirmed"}]}]}"#,
        )
        .expect("parse");
        assert_eq!(set_cases(&json)[0].readiness.value(), "ready");
        assert_eq!(set_cases(&json)[0].claims.len(), 1);
        assert!(set_cases(&json)[0].claims[0]
            .label
            .provenance()
            .is_scorable());
    }

    fn set_cases(set: &GoldenSet) -> &[GoldenCase] {
        &set.cases
    }

    #[test]
    fn the_set_parses_from_the_detailed_form() {
        let json = serde_json::from_str::<GoldenSet>(
            r#"{"cases":[{"id":"a","note":"a.md",
                 "readiness":{"label":"ready","provenance":"human","why":"revisado"}}]}"#,
        )
        .expect("parse");
        assert_eq!(
            set_cases(&json)[0].readiness.provenance(),
            LabelProvenance::Human
        );
        assert_eq!(set_cases(&json)[0].readiness_rule(), Some("revisado"));
    }

    #[test]
    fn disputed_labels_are_listed_for_review_not_silently_dropped() {
        let json = serde_json::from_str::<GoldenSet>(
            r#"{"cases":[{"id":"limite","note":"a.md",
                 "readiness":{"label":"ready","provenance":"disputed","why":"fronteira"},
                 "claims":[{"quote":"x","label":{"label":"confirmed","provenance":"disputed"}}],
                 "exchanges":[{"prompt":"p","answer":"a","status":"remembered",
                               "statusProvenance":"disputed"}]}]}"#,
        )
        .expect("parse");
        let unscoreable = json.unscoreable();
        assert_eq!(unscoreable.len(), 3, "{unscoreable:?}");
        assert!(unscoreable
            .iter()
            .any(|(_, dimension, _)| *dimension == "claims"));
    }

    #[test]
    fn a_readiness_label_without_a_rule_is_allowed_but_visible() {
        let json = serde_json::from_str::<GoldenSet>(
            r#"{"cases":[{"id":"a","note":"a.md","readiness":"ready"}]}"#,
        )
        .expect("parse");
        assert_eq!(json.cases[0].readiness_rule(), None);
        assert!(json.unscoreable().is_empty(), "curto e pontuavel");
    }

    #[test]
    fn the_set_rejects_a_case_without_a_note() {
        assert!(
            serde_json::from_str::<GoldenSet>(r#"{"cases":[{"id":"a","readiness":"ready"}]}"#)
                .is_err()
        );
    }

    #[test]
    fn the_set_rejects_an_unknown_provenance() {
        let parsed = serde_json::from_str::<GoldenSet>(
            r#"{"cases":[{"id":"a","note":"a.md",
                 "readiness":{"label":"ready","provenance":"palpite"}}]}"#,
        );
        assert!(parsed.is_err(), "provenance desconhecida nao pode passar");
    }

    #[test]
    fn a_report_scores_at_every_declared_threshold() {
        let mut report = EngineReport::new("jev", "jev-1.13.0");
        let cases = vec![ScoredCase {
            id: "a".to_string(),
            expected: "ready".to_string(),
            provenance: LabelProvenance::Construction,
            prediction: Prediction {
                label: "ready".to_string(),
                distribution: BTreeMap::from([("ready".to_string(), 0.9)]),
                confidence: Some(0.9),
                latency_ms: 120,
                estimated_cost_usd: 0.001,
            },
            note: None,
        }];
        report.score(&cases, &[0.0, 0.5, 0.95]);
        assert_eq!(report.thresholds, vec![0.0, 0.5, 0.95]);
        assert!(report.metrics_at(0.0).is_some());
        // Em 0.95 o unico caso (0.9) e abstido.
        assert_eq!(report.metrics_at(0.95).expect("m").cases_scored, 0);
        assert_eq!(report.metrics_at(0.0).expect("m").cases_scored, 1);
        assert!((report.total_cost_usd - 0.001).abs() < 1e-9);
        assert_eq!(report.total_latency_ms, 120);
    }

    #[test]
    fn the_report_serializes_for_committing_as_a_baseline() {
        let mut report = EngineReport::new("legacy", "ollama-qwen2.5:7b");
        report.score(&[], &[0.0]);
        let json = serde_json::to_string_pretty(&report).expect("serializa");
        assert!(json.contains("\"engine\": \"legacy\""));
        assert!(json.contains("frontier"));
    }

    /// Conjunto minimo com uma dimensao revisada e outra nao.
    fn set_with_and_without_definition_ground_truth() -> GoldenSet {
        serde_json::from_str(
            r#"{"cases":[
                {"id":"com-termo","note":"a.md","readiness":"ready",
                 "expectedDefinitions":[{"term":"rubisco"}]},
                {"id":"sem-termo","note":"b.md","readiness":"ready"}
            ]}"#,
        )
        .expect("parse")
    }

    #[test]
    fn a_dimension_without_ground_truth_is_declared_as_unmeasured() {
        // O ponto inteiro: uma dimensao que ninguem revisou nao pode
        // aparecer como medida. `definitions` com zero ground truth e
        // "nao medida", e nao "medido com zero erro".
        let set = set_with_and_without_definition_ground_truth();
        let coverage = set.dimension_coverage();
        let definitions = coverage
            .iter()
            .find(|dimension| dimension.dimension == "definitions")
            .expect("a dimensao definitions e declarada");
        assert_eq!(definitions.measured, 1);
        assert_eq!(definitions.total, 2);
        assert!(definitions.is_partial());
        assert!(!definitions.is_unmeasured());
    }

    #[test]
    fn a_dimension_with_no_ground_truth_at_all_is_listed_as_unmeasured() {
        let set: GoldenSet =
            serde_json::from_str(r#"{"cases":[{"id":"a","note":"a.md","readiness":"ready"}]}"#)
                .expect("parse");
        let unmeasured = set.unmeasured_dimensions();
        assert!(
            unmeasured
                .iter()
                .any(|dimension| dimension.dimension == "definitions"),
            "sem ground truth de definicoes, a dimensao tem que aparecer como nao medida"
        );
        for dimension in &unmeasured {
            assert_eq!(dimension.measured, 0);
            assert!(dimension.is_unmeasured());
        }
    }

    #[test]
    fn a_reviewed_but_empty_definition_list_is_measured_not_absent() {
        // "Revisei e nao achei termo" (lista vazia) e diferente de "ninguem
        // revisou" (ausente). A dimensao conta o primeiro como medida e o
        // segundo como nao medida.
        let set: GoldenSet = serde_json::from_str(
            r#"{"cases":[{"id":"a","note":"a.md","readiness":"ready",
                 "expectedDefinitions":[]}]}"#,
        )
        .expect("parse");
        let definitions = set
            .dimension_coverage()
            .into_iter()
            .find(|dimension| dimension.dimension == "definitions")
            .expect("dimensao declarations");
        assert_eq!(definitions.measured, 1);
        assert!(set.unmeasured_dimensions().is_empty());
    }

    #[test]
    fn a_disputed_label_counts_as_present_but_not_measurable() {
        // `disputed` continua fora da metrica, mas o item **existe**: a
        // cobertura conta o ground truth disponivel, e `unscoreable` diz o
        // que ficou de fora.
        let set: GoldenSet = serde_json::from_str(
            r#"{"cases":[{"id":"a","note":"a.md",
                 "readiness":{"label":"ready","provenance":"disputed","why":"fronteira"}}]}"#,
        )
        .expect("parse");
        let coverage = set.dimension_coverage();
        let readiness = coverage
            .iter()
            .find(|dimension| dimension.dimension == "readiness")
            .expect("dimensao readiness");
        assert_eq!(readiness.measured, 0);
        assert_eq!(readiness.total, 1);
        assert_eq!(set.unscoreable().len(), 1);
    }
}
