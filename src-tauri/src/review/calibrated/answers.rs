//! Respostas tipadas do System One.
//!
//! A API promete que o formato corresponde ao schema declarado e que nunca
//! ha erro de tipo. Isso e verdade e verificavel, mas NAO torna a resposta
//! numericamente coerente: as probabilidades ainda precisam somar 1, o argmax
//! ainda pode nao estar entre as opcoes declaradas, e o `score` ainda pode
//! sair da faixa dos niveis. Este modulo verifica essas invariantes.
//!
//! A diferenca para o caminho legado e que aqui nao existe "parse tolerante":
//! nao ha alias, nao ha reparo, nao ha fallback. Ou a invariante vale, ou a
//! chamada falha.

use super::questions::{QuestionKind, QuestionSpec, MAX_SCORE_LEVELS};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Tolerancia na soma das probabilidades. A API documenta "floats that sum to
/// 1"; 1e-6 absorve erro de ponto flutuante sem aceitar uma distribuicao
/// genuinamente errada.
const PROBABILITY_SUM_TOLERANCE: f64 = 1e-6;

/// Uma pergunta Yes/No. A API **nao** devolve `confidence` para `noul` — a
/// propria probabilidade ja carrega a incerteza (perto de 0.5 = unsure).
/// Use `noul_confidence` quando precisar do mesmo gate 0-1 das outras.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoulAnswer {
    /// Probabilidade de "sim", de 0 a 1.
    pub noul: f64,
}

/// Uma pergunta de escolha fechada.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceAnswer {
    /// Opcao de maior probabilidade. Sempre presente em `probabilities`.
    pub choice: String,
    /// Todas as opcoes e suas probabilidades, que somam 1.
    pub probabilities: BTreeMap<String, f64>,
    /// Confianca de 0 a 1, derivada da forma da distribuicao.
    pub confidence: f64,
}

/// Uma pergunta de rubrica ordenada.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreAnswer {
    /// Esperanza ponderada dos niveis. Pode cair ENTRE dois niveis.
    pub score: f64,
    /// Probabilidade por indice de nivel (0-based), somando 1.
    pub probabilities: BTreeMap<usize, f64>,
    /// Confianca de 0 a 1, derivada da forma da distribuicao.
    pub confidence: f64,
}

/// Resposta de uma pergunta, casada com o tipo pedido.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Answer {
    Noul(NoulAnswer),
    Choice(ChoiceAnswer),
    Score(ScoreAnswer),
}

impl Answer {
    /// Confianca de 0 a 1, na MESMA escala de `choice` e `score`.
    ///
    /// Para `noul` derivamos `|2p - 1|`, que e a formula oficial da doc para
    ///_thresholdar `noul` e `choice` com o mesmo codigo. Isto nao e uma
    /// confianca calibrada pelo fornecedor: e a distancia de 0.5 derivada em
    /// cima de `p`.
    pub fn confidence(&self) -> f64 {
        match self {
            Answer::Noul(answer) => noul_confidence(answer.noul),
            Answer::Choice(answer) => answer.confidence,
            Answer::Score(answer) => answer.confidence,
        }
    }

    /// A opcao escolhida, para `choice`. `None` para os outros tipos.
    pub fn choice(&self) -> Option<&str> {
        match self {
            Answer::Choice(answer) => Some(answer.choice.as_str()),
            _ => None,
        }
    }

    /// As probabilidades, qualquer que seja o tipo.
    pub fn probabilities(&self) -> BTreeMap<String, f64> {
        match self {
            Answer::Noul(_) => BTreeMap::new(),
            Answer::Choice(answer) => answer.probabilities.clone(),
            Answer::Score(answer) => answer
                .probabilities
                .iter()
                .map(|(level, probability)| (level.to_string(), *probability))
                .collect(),
        }
    }

    /// Confere as invariantes numericas contra a pergunta que a originou.
    ///
    /// Os ponteiros sao RELATIVOS a resposta (`/probabilities/...`); quem chama
    /// prefixa com `/answers/{id}`. A separacao importa: o mesmo `validate` serve
    /// para uma resposta solta e para o envelope com varios ids.
    ///
    /// Erros sao acumulados e nao short-circuitados: um diagnostico que lista tudo
    /// que esta errado vale mais que o primeiro erro.
    pub fn validate(&self, question: &QuestionSpec) -> Vec<String> {
        match (self, question) {
            (Answer::Noul(answer), QuestionSpec::Noul { .. }) => {
                let mut errors = Vec::new();
                check_probability(answer.noul, "noul", &mut errors);
                errors
            }
            (Answer::Choice(answer), QuestionSpec::Choice { options, .. }) => {
                let mut errors = Vec::new();
                let declared: Vec<&str> =
                    options.iter().map(|option| option.key.as_str()).collect();
                if !declared.contains(&answer.choice.as_str()) {
                    errors.push(format!(
                        "/choice: '{}' nao esta entre as opcoes declaradas.",
                        answer.choice
                    ));
                }
                if answer.probabilities.len() != declared.len() {
                    errors.push(format!(
                        "/probabilities: {} probabilidades para {} opcoes declaradas.",
                        answer.probabilities.len(),
                        declared.len()
                    ));
                }
                for option in &declared {
                    match answer.probabilities.get(*option) {
                        None => errors.push(format!(
                            "/probabilities/{option}: opcao declarada sem probabilidade."
                        )),
                        Some(probability) => check_probability(
                            *probability,
                            &format!("probabilities/{option}"),
                            &mut errors,
                        ),
                    }
                }
                check_sum(&answer.probabilities, &mut errors);
                check_confidence(answer.confidence, "confidence", &mut errors);
                errors
            }
            (Answer::Score(answer), QuestionSpec::Score { levels, .. }) => {
                let mut errors = Vec::new();
                if answer.probabilities.len() != levels.len() {
                    errors.push(format!(
                        "/probabilities: {} probabilidades para {} niveis declarados.",
                        answer.probabilities.len(),
                        levels.len()
                    ));
                }
                for level in 0..levels.len() {
                    match answer.probabilities.get(&level) {
                        None => errors.push(format!(
                            "/probabilities/{level}: nivel declarado sem probabilidade."
                        )),
                        Some(probability) => check_probability(
                            *probability,
                            &format!("probabilities/{level}"),
                            &mut errors,
                        ),
                    }
                }
                if answer.probabilities.len() > MAX_SCORE_LEVELS {
                    errors.push(format!(
                        "/probabilities: mais de {MAX_SCORE_LEVELS} niveis."
                    ));
                }
                check_sum(
                    &answer
                        .probabilities
                        .iter()
                        .map(|(level, probability)| (level.to_string(), *probability))
                        .collect(),
                    &mut errors,
                );
                check_confidence(answer.confidence, "confidence", &mut errors);
                // O `score` da API e a media ponderada dos niveis, mas o servico
                // a calcula com precisao interna e **arredonda as
                // probabilidades** que devolve. Recomputar a media a partir das
                // probabilidades exibidas da um valor diferente — as respostas
                // reais provam isso: `application` e `gaps` vieram com as
                // MESMAS probabilidades `{0: 0.99, 1: 0.01}` e scores
                // diferentes.
                //
                // A versao anterior desta checagem exigia igualdade com
                // tolerancia `1e-6` e rejeitava **toda** resposta real. A
                // seguinte usava um intervalo com margem de arredondamento, e
                // ainda assim rejeitava cerca de **uma em oito** respostas
                // validas.
                //
                // A checagem foi removida porque o sinal era redundante e o
                // custo era alto: o produto NAO usa o `score` da API — a
                // sintese recalcula 0-100 a partir das probabilidades — e uma
                // resposta corrompida ja falha nas checagens de probabilidade
                // (soma 1, faixa 0..1) e de campo obrigatorio. O que resta e
                // um limite de sanidade, que nao pode rejeitar resposta
                // valida.
                let max_level = answer.probabilities.keys().copied().max().unwrap_or(0);
                if !answer.score.is_finite()
                    || answer.score < -1e-6
                    || answer.score > max_level as f64 + 1e-6
                {
                    errors.push(format!(
                        "/score: {} esta fora da faixa de niveis (0..={max_level}).",
                        answer.score
                    ));
                }
                errors
            }
            (answer, question) => vec![format!(
                "a resposta e do tipo {:?} mas a pergunta pedia {:?}.",
                question.kind(),
                answer.kind()
            )],
        }
    }

    fn kind(&self) -> QuestionKind {
        match self {
            Answer::Noul(_) => QuestionKind::Noul,
            Answer::Choice(_) => QuestionKind::Choice,
            Answer::Score(_) => QuestionKind::Score,
        }
    }
}

/// Confianca de um `noul` na escala 0-1 das demais respostas.
///
/// Formula oficial da doc: `confidence = |2p - 1|`. Zero em p = 0.5 (o modelo
/// nao sabe), um em p = 0 ou p = 1. E a formula de `choice` com duas opcoes.
pub fn noul_confidence(noul: f64) -> f64 {
    (2.0 * noul - 1.0).abs()
}

/// Confianca de uma `choice` a partir da distribuicao, se o fornecedor nao a
/// tiver enviado. Util para verificar o valor recebido.
///
/// `confidence = (p_max - 1/n) / (1 - 1/n)`
pub fn choice_confidence_from(probabilities: &BTreeMap<String, f64>) -> f64 {
    let count = probabilities.len();
    if count == 0 {
        return 0.0;
    }
    if count == 1 {
        return 1.0;
    }
    let peak = probabilities.values().copied().fold(0.0_f64, f64::max);
    let even = 1.0 / count as f64;
    ((peak - even) / (1.0 - even)).clamp(0.0, 1.0)
}

/// Confianca de um `score` a partir da distribuicao.
///
/// `confidence = max(0, 1 - sum(p_i * |i - m|) / MAD_unif)`, onde `m` e o
/// nivel mais provavel e `MAD_unif` e a distancia media de uma distribuicao
/// uniforme medida do nivel do meio. Probabilidade no vizinho do pico derruba
/// menos a confianca que no extremo oposto.
pub fn score_confidence_from(probabilities: &BTreeMap<usize, f64>) -> f64 {
    if probabilities.len() < 2 {
        return 0.0;
    }
    let count = probabilities.len();
    let peak = probabilities
        .iter()
        .max_by(|left, right| {
            left.1
                .partial_cmp(right.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(level, _)| *level)
        .unwrap_or(0);
    let spread: f64 = probabilities
        .iter()
        .map(|(level, probability)| probability * (*level as f64 - peak as f64).abs())
        .sum();
    let middle = (count as f64 - 1.0) / 2.0;
    let even_spread: f64 = (0..count)
        .map(|level| (level as f64 - middle).abs())
        .sum::<f64>()
        / count as f64;
    if even_spread <= 0.0 {
        return 0.0;
    }
    (1.0 - spread / even_spread).max(0.0)
}

/// Esperanza ponderada dos niveis: o valor que `score` deve ter.
pub fn expected_score(probabilities: &BTreeMap<usize, f64>) -> f64 {
    probabilities
        .iter()
        .map(|(level, probability)| *level as f64 * probability)
        .sum()
}

/// Margem de arredondamento da probabilidade devolvida.
///
/// A API devolve as probabilidades arredondadas (duas casas, pelo que se
/// observa nas respostas reais) e calcula o `score` com a precisao interna.
/// Cada probabilidade exibida pode estar ate esta margem do valor real.
const PROBABILITY_DISPLAY_TOLERANCE: f64 = 0.005;

/// Intervalo de `score` que as probabilidades exibidas permitem.
///
/// **Nao e mais usado para rejeitar uma resposta.** Ficou aqui porque
/// documenta o fenomeno: o `score` da API e calculado com precisao interna e
/// as probabilidades devolvidas vem arredondadas, entao a media das
/// probabilidades exibidas NAO e igual ao score. A checagem por intervalo
/// rejeitava cerca de uma em oito respostas validas, e o produto nem usa o
/// `score` — a sintese recalcula 0-100 a partir das probabilidades.
pub fn expected_score_range(probabilities: &BTreeMap<usize, f64>) -> (f64, f64) {
    let mut lower = 0.0;
    let mut upper = 0.0;
    for (level, probability) in probabilities {
        let weight = *level as f64;
        let low = (probability - PROBABILITY_DISPLAY_TOLERANCE).max(0.0);
        let high = (probability + PROBABILITY_DISPLAY_TOLERANCE).min(1.0);
        lower += weight * low;
        upper += weight * high;
    }
    (lower, upper)
}

fn check_probability(value: f64, pointer: &str, errors: &mut Vec<String>) {
    if !value.is_finite() {
        errors.push(format!("/{pointer}: valor nao finito."));
    } else if !(0.0..=1.0).contains(&value) {
        errors.push(format!("/{pointer}: {value} esta fora da faixa 0..=1."));
    }
}

fn check_confidence(value: f64, pointer: &str, errors: &mut Vec<String>) {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        errors.push(format!("/{pointer}: {value} esta fora da faixa 0..=1."));
    }
}

fn check_sum(probabilities: &BTreeMap<String, f64>, errors: &mut Vec<String>) {
    let total: f64 = probabilities.values().sum();
    if !total.is_finite() || (total - 1.0).abs() > PROBABILITY_SUM_TOLERANCE {
        errors.push(format!(
            "/probabilities: somam {total:.9}, esperado 1 (tolerancia {PROBABILITY_SUM_TOLERANCE})."
        ));
    }
}

/// Forma bruta da resposta, como chega da API, antes da checagem de tipo.
///
/// `noul` e `score` sao campos separados no wire (`noul` so existe em
/// respostas `noul`, `score` so em respostas `score`), por isso ficam em campos
/// distintos em vez de um so "numero".
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RawAnswer {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub noul: Option<f64>,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub choice: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub probabilities: Option<BTreeMap<String, f64>>,
}

impl RawAnswer {
    /// Converte para o tipo pedido e, se falta um campo obrigatorio, devolve
    /// o motivo pelo campo ausente.
    pub(crate) fn into_answer(self, question: &QuestionSpec) -> Result<Answer, String> {
        let missing = |field: &str| format!("/answers/{field}: campo ausente na resposta.");
        match question {
            QuestionSpec::Noul { .. } => {
                if self.kind != "noul" {
                    return Err(format!(
                        "a resposta e '{:?}' e a pergunta pedia noul.",
                        self.kind
                    ));
                }
                Ok(Answer::Noul(NoulAnswer {
                    noul: self.noul.ok_or_else(|| missing("noul"))?,
                }))
            }
            QuestionSpec::Choice { .. } => {
                if self.kind != "choice" {
                    return Err(format!(
                        "a resposta e '{:?}' e a pergunta pedia choice.",
                        self.kind
                    ));
                }
                Ok(Answer::Choice(ChoiceAnswer {
                    choice: self.choice.ok_or_else(|| missing("choice"))?,
                    probabilities: self.probabilities.ok_or_else(|| missing("probabilities"))?,
                    confidence: self.confidence.ok_or_else(|| missing("confidence"))?,
                }))
            }
            QuestionSpec::Score { .. } => {
                if self.kind != "score" {
                    return Err(format!(
                        "a resposta e '{:?}' e a pergunta pedia score.",
                        self.kind
                    ));
                }
                let raw = self.probabilities.ok_or_else(|| missing("probabilities"))?;
                let mut probabilities = BTreeMap::new();
                // Todas as chaves invalidas sao reportadas de uma vez: um
                // diagnostico que para na primeira e obrigaria N chamadas para
                // achar N erros.
                let mut invalid: Vec<String> = Vec::new();
                for (level, probability) in raw {
                    match level.parse::<usize>() {
                        Ok(index) => {
                            probabilities.insert(index, probability);
                        }
                        Err(_) => invalid.push(level.clone()),
                    }
                }
                if !invalid.is_empty() {
                    return Err(format!(
                        "/answers/probabilities: {} nao e um indice de nivel valido ({}).",
                        invalid.join("', '"),
                        invalid.len()
                    ));
                }
                Ok(Answer::Score(ScoreAnswer {
                    score: self.score.ok_or_else(|| missing("score"))?,
                    probabilities,
                    confidence: self.confidence.ok_or_else(|| missing("confidence"))?,
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::calibrated::questions::{instructions, options_from_pairs, QuestionSpec};
    use serde_json::json;

    fn choice_question() -> QuestionSpec {
        QuestionSpec::Choice {
            instructions: instructions("Qual?"),
            options: options_from_pairs([
                ("sim".to_string(), "quando sim".to_string()),
                ("nao".to_string(), "quando nao".to_string()),
            ]),
        }
    }

    fn score_question() -> QuestionSpec {
        QuestionSpec::Score {
            instructions: instructions("Qual nivel?"),
            levels: vec!["baixo".to_string(), "medio".to_string(), "alto".to_string()],
        }
    }

    /// Pergunta com cinco niveis, como a da sintese real.
    fn five_level_score_question() -> QuestionSpec {
        QuestionSpec::Score {
            instructions: instructions("Qual nivel?"),
            levels: (0..5).map(|index| format!("nivel {index}")).collect(),
        }
    }

    fn probabilities(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), *value))
            .collect()
    }

    #[test]
    fn noul_confidence_is_zero_at_the_decision_boundary() {
        assert_eq!(noul_confidence(0.5), 0.0);
        assert_eq!(noul_confidence(0.0), 1.0);
        assert_eq!(noul_confidence(1.0), 1.0);
        assert!((noul_confidence(0.75) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn noul_and_choice_share_the_same_scale() {
        let two_option = probabilities(&[("sim", 0.75), ("nao", 0.25)]);
        let from_choice = choice_confidence_from(&two_option);
        let from_noul = noul_confidence(0.75);
        assert!(
            (from_choice - from_noul).abs() < 1e-9,
            "{from_choice} vs {from_noul}"
        );
    }

    #[test]
    fn choice_confidence_matches_the_documented_formula() {
        // Formula da doc: (p_max - 1/n) / (1 - 1/n).
        // Para [0.9, 0.06, 0.04]: (0.9 - 0.3333) / 0.6667 = 0.85.
        let peaked = probabilities(&[("a", 0.9), ("b", 0.06), ("c", 0.04)]);
        assert!((choice_confidence_from(&peaked) - 0.85).abs() < 1e-9);
        // Uma distribuicao quase uniforme zera a confianca. 1/3 nao e representavel
        // em f64, entao o alvo e "proximo de zero", nao zero exato.
        let even = probabilities(&[("a", 0.34), ("b", 0.33), ("c", 0.33)]);
        assert!(choice_confidence_from(&even) < 0.02);
        // Uma opcao com certeza total da 1.
        let certain = probabilities(&[("a", 1.0), ("b", 0.0)]);
        assert!((choice_confidence_from(&certain) - 1.0).abs() < 1e-9);
    }

    /// O exemplo numerico da doc (`confidence: 0.81` para `probabilities:
    /// {billing: 0.88, technical: 0.12}`) nao bate com a formula que a propria
    /// doc declara, que da 0.76. Seguimos a FORMULA, que e a parte normativa.
    /// O teste existe para registrar a divergencia em vez de discover-la num
    /// diagnostico.
    #[test]
    fn our_formula_disagrees_with_the_docs_own_worked_example() {
        let doc_example = probabilities(&[("billing", 0.88), ("technical", 0.12)]);
        let computed = choice_confidence_from(&doc_example);
        assert!(
            (computed - 0.76).abs() < 1e-9,
            "a formula da doc produz {computed}, o exemplo da doc diz 0.81"
        );
    }

    #[test]
    fn score_confidence_penalizes_distance_from_the_peak() {
        let adjacent: BTreeMap<usize, f64> = BTreeMap::from([(0, 0.0), (1, 0.5), (2, 0.5)]);
        let opposite: BTreeMap<usize, f64> = BTreeMap::from([(0, 0.5), (1, 0.0), (2, 0.5)]);
        let adjacent_confidence = score_confidence_from(&adjacent);
        let opposite_confidence = score_confidence_from(&opposite);
        assert!(adjacent_confidence > opposite_confidence);
        assert!(
            (adjacent_confidence - 0.25).abs() < 1e-9,
            "{adjacent_confidence}"
        );
        assert!(opposite_confidence.abs() < 1e-9, "{opposite_confidence}");
    }

    #[test]
    fn score_confidence_matches_the_documented_example() {
        // A doc: probabilidades (0, 0.57, 0.43) => confianca ~0.35.
        let probabilities: BTreeMap<usize, f64> = BTreeMap::from([(0, 0.0), (1, 0.57), (2, 0.43)]);
        let confidence = score_confidence_from(&probabilities);
        assert!(
            (confidence - 0.35).abs() < 0.01,
            "esperado ~0.35, obtido {confidence}"
        );
    }

    #[test]
    fn expected_score_is_the_probability_weighted_average() {
        let probabilities: BTreeMap<usize, f64> = BTreeMap::from([(0, 0.0), (1, 0.95), (2, 0.05)]);
        assert!((expected_score(&probabilities) - 1.05).abs() < 1e-9);
    }

    #[test]
    fn a_valid_choice_passes_validation() {
        let answer = Answer::Choice(ChoiceAnswer {
            choice: "sim".to_string(),
            probabilities: probabilities(&[("sim", 0.88), ("nao", 0.12)]),
            confidence: 0.76,
        });
        assert_eq!(answer.validate(&choice_question()), Vec::<String>::new());
    }

    #[test]
    fn a_score_outside_the_level_range_is_rejected() {
        // O limite de sanidade que sobrou: o `score` nao pode estar fora dos
        // niveis declarados. Um `score` de 5 com niveis 0..2 e resposta
        // corrompida.
        let answer = Answer::Score(ScoreAnswer {
            score: 5.0,
            probabilities: BTreeMap::from([(0, 0.0), (1, 0.95), (2, 0.05)]),
            confidence: 0.92,
        });
        let errors = answer.validate(&score_question());
        assert!(
            errors.iter().any(|error| error.contains("faixa de niveis")),
            "{errors:?}"
        );
    }

    #[test]
    fn probabilities_that_do_not_sum_to_one_are_rejected() {
        let answer = Answer::Choice(ChoiceAnswer {
            choice: "sim".to_string(),
            probabilities: probabilities(&[("sim", 0.7), ("nao", 0.2)]),
            confidence: 0.4,
        });
        let errors = answer.validate(&choice_question());
        assert!(
            errors.iter().any(|error| error.contains("somam")),
            "{errors:?}"
        );
    }

    #[test]
    fn a_missing_option_probability_is_rejected() {
        let answer = Answer::Choice(ChoiceAnswer {
            choice: "sim".to_string(),
            probabilities: probabilities(&[("sim", 1.0)]),
            confidence: 1.0,
        });
        let errors = answer.validate(&choice_question());
        assert!(
            errors
                .iter()
                .any(|error| error.contains("sem probabilidade")),
            "{errors:?}"
        );
    }

    #[test]
    fn a_probability_outside_the_unit_range_is_rejected() {
        // 1.4 + (-0.4) = 1.0, entao a soma passa e apenas as faixas falham.
        let answer = Answer::Choice(ChoiceAnswer {
            choice: "sim".to_string(),
            probabilities: probabilities(&[("sim", 1.4), ("nao", -0.4)]),
            confidence: 0.5,
        });
        let errors = answer.validate(&choice_question());
        assert_eq!(errors.len(), 2, "{errors:?}");
        assert!(
            errors.iter().all(|error| error.contains("fora da faixa")),
            "{errors:?}"
        );
    }

    #[test]
    fn a_valid_score_passes_validation() {
        let answer = Answer::Score(ScoreAnswer {
            score: 1.05,
            probabilities: BTreeMap::from([(0, 0.0), (1, 0.95), (2, 0.05)]),
            confidence: 0.92,
        });
        assert_eq!(answer.validate(&score_question()), Vec::<String>::new());
    }

    #[test]
    fn a_score_within_the_rounding_range_is_accepted() {
        // Este e o caso que a API real produz: o score vem da precisao interna
        // e as probabilidades devolvidas vem arredondadas. Uma resposta real
        // tinha probabilidades `{0: 0.99, 1: 0.01}` e score `0.03`, enquanto a
        // media das probabilidades exibidas dava `0.01`. A versao anterior
        // desta validacao exigia igualdade com `1e-6` e rejeitava **toda**
        // resposta real.
        let answer = Answer::Score(ScoreAnswer {
            score: 0.03,
            probabilities: BTreeMap::from([(0, 0.99), (1, 0.01), (2, 0.0), (3, 0.0), (4, 0.0)]),
            confidence: 0.99,
        });
        assert_eq!(
            answer.validate(&five_level_score_question()),
            Vec::<String>::new(),
            "um score dentro da faixa de arredondamento e aceito"
        );
    }

    #[test]
    fn the_range_widens_with_the_number_of_levels() {
        // O erro maximo cresce com a soma dos pesos dos niveis: com cinco
        // niveis, a faixa e de cerca de 0.05.
        let few: BTreeMap<usize, f64> = BTreeMap::from([(0, 0.99), (1, 0.01)]);
        let many: BTreeMap<usize, f64> =
            BTreeMap::from([(0, 0.79), (1, 0.01), (2, 0.0), (3, 0.0), (4, 0.20)]);
        let (few_low, few_high) = expected_score_range(&few);
        let (many_low, many_high) = expected_score_range(&many);
        assert!(
            (many_high - many_low) > (few_high - few_low),
            "a faixa tem de crescer com o numero de niveis: {few_low}..{few_high} vs {many_low}..{many_high}"
        );
    }

    #[test]
    fn a_score_level_outside_the_declared_range_is_rejected() {
        let answer = Answer::Score(ScoreAnswer {
            score: 5.0,
            probabilities: BTreeMap::from([(0, 0.2), (1, 0.2), (2, 0.2), (9, 0.4)]),
            confidence: 0.5,
        });
        let errors = answer.validate(&score_question());
        assert!(
            errors
                .iter()
                .any(|error| error.contains("3 niveis declarados")),
            "{errors:?}"
        );
    }

    #[test]
    fn mismatched_answer_and_question_kinds_are_rejected() {
        let answer = Answer::Noul(NoulAnswer { noul: 0.9 });
        let errors = answer.validate(&choice_question());
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("pedia"), "{errors:?}");
    }

    #[test]
    fn confidence_is_readable_from_every_kind() {
        assert_eq!(Answer::Noul(NoulAnswer { noul: 0.9 }).confidence(), 0.8);
        assert_eq!(
            Answer::Choice(ChoiceAnswer {
                choice: "sim".to_string(),
                probabilities: probabilities(&[("sim", 1.0)]),
                confidence: 0.5,
            })
            .confidence(),
            0.5
        );
        assert_eq!(
            Answer::Score(ScoreAnswer {
                score: 0.0,
                probabilities: BTreeMap::from([(0, 0.0), (1, 1.0)]),
                confidence: 0.25,
            })
            .confidence(),
            0.25
        );
    }

    #[test]
    fn raw_answer_reports_the_missing_field_by_name() {
        let raw = RawAnswer {
            kind: "choice".to_string(),
            noul: None,
            score: None,
            choice: Some("sim".to_string()),
            confidence: Some(0.9),
            probabilities: None,
        };
        let error = raw
            .into_answer(&choice_question())
            .expect_err("probabilities ausente");
        assert!(error.contains("probabilities"), "{error}");
    }

    #[test]
    fn raw_answer_rejects_a_kind_that_does_not_match_the_question() {
        let raw = RawAnswer {
            kind: "score".to_string(),
            noul: None,
            score: Some(1.0),
            choice: None,
            confidence: Some(0.9),
            probabilities: None,
        };
        let error = raw
            .into_answer(&choice_question())
            .expect_err("tipo divergente");
        assert!(error.contains("pedia choice"), "{error}");
    }

    #[test]
    fn raw_noul_does_not_borrow_the_score_field() {
        let raw = RawAnswer {
            kind: "noul".to_string(),
            noul: Some(0.95),
            score: None,
            choice: None,
            confidence: None,
            probabilities: None,
        };
        let Answer::Noul(answer) = raw
            .into_answer(&QuestionSpec::Noul {
                instructions: instructions("?"),
                criteria: None,
            })
            .expect("converte")
        else {
            panic!("esperava noul");
        };
        assert_eq!(answer.noul, 0.95);
    }

    #[test]
    fn raw_score_reads_the_score_field_and_parses_level_keys() {
        let raw = RawAnswer {
            kind: "score".to_string(),
            noul: None,
            score: Some(1.05),
            choice: None,
            confidence: Some(0.92),
            probabilities: serde_json::from_value(json!({ "0": 0.0, "1": 0.95, "2": 0.05 }))
                .expect("mapa"),
        };
        let Answer::Score(answer) = raw.into_answer(&score_question()).expect("converte") else {
            panic!("esperava score");
        };
        assert_eq!(answer.probabilities.len(), 3);
        assert_eq!(answer.probabilities.get(&2), Some(&0.05));
    }

    #[test]
    fn raw_score_without_the_score_field_is_rejected() {
        let raw = RawAnswer {
            kind: "score".to_string(),
            noul: None,
            score: None,
            choice: None,
            confidence: Some(0.5),
            probabilities: serde_json::from_value(json!({ "0": 0.0, "1": 1.0 })).expect("mapa"),
        };
        let error = raw
            .into_answer(&score_question())
            .expect_err("score ausente");
        assert!(error.contains("score"), "{error}");
    }

    #[test]
    fn a_non_numeric_level_key_is_rejected_with_the_offending_key() {
        let raw = RawAnswer {
            kind: "score".to_string(),
            noul: None,
            score: Some(0.5),
            choice: None,
            confidence: Some(0.5),
            probabilities: serde_json::from_value(json!({ "baixo": 0.5, "alto": 0.5 }))
                .expect("mapa"),
        };
        let error = raw
            .into_answer(&score_question())
            .expect_err("indice invalido");
        assert!(error.contains("baixo"), "{error}");
    }
}
