//! Provedor calibrado deterministico, para builds E2E e testes de UI.
//!
//! Nenhuma chamada de rede acontece. As respostas sao derivadas do proprio
//! `state`, entao qualquer entrada valida produz respostas coerentes com as
//! perguntas — inclusive com as invariantes numericas que o caminho real
//! verifica (probabilidades somando 1, argmax presente, `score` igual a
//! esperanca ponderada).
//!
//! Isso importa: um mock que devolvesse numeros arbitrarios passaria pelo
//! `parse_system_one` do adapter real e esconderia bugs de validacao.

use super::questions::QuestionSpec;
use super::{Answer, CalibratedProvider, CalibratedResponse, CalibrationEngine};
use crate::review::provider::ProviderFailure;
use serde_json::Value;
use std::collections::BTreeMap;

/// Marcador do texto que o mock usa como estado. Presente para que um teste
/// possa afirmar que o mock foi realmente usado.
pub const MOCK_STATE_MARKER: &str = "mock-calibrated-state";

/// Provedor deterministico sem rede.
pub struct MockCalibratedProvider;

impl MockCalibratedProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MockCalibratedProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl CalibratedProvider for MockCalibratedProvider {
    fn engine(&self) -> CalibrationEngine {
        CalibrationEngine::Jev
    }

    fn model(&self) -> &'static str {
        "mock-calibrated"
    }

    fn evaluate(
        &self,
        state: &Value,
        questions: &BTreeMap<String, QuestionSpec>,
    ) -> Result<CalibratedResponse, ProviderFailure> {
        super::validate_calibrated_request(state, questions)?;
        let mut answers = BTreeMap::new();
        for (id, question) in questions {
            answers.insert(id.clone(), answer_for(question));
        }
        Ok(CalibratedResponse {
            model: self.model().to_string(),
            answers,
            input_tokens: Some(state.to_string().len() as u64 / 4),
            output_tokens: Some(questions.len() as u64 * 8),
            latency_ms: 0,
            raw_response: String::from(MOCK_STATE_MARKER),
        })
    }
}

/// Resposta coerente com a pergunta.
///
/// As escolhas de mock nao sao arbitrarias, e sao **indexadas pelo nome da
/// opcao, nunca pela posicao**. E o que torna o mock utilizavel como
/// referencia: um mock que pegasse a primeira opcao da lista carregaria o mesmo
/// vies de posicao que o JEV tem, e a medicao de vies de ordem (D12) mediria o
/// mock em vez do modelo.
///
/// A massa de probabilidade fica inclinada para o lado conservador porque e o
/// lado que o app trata como padrao quando a confianca e baixa. Um mock
/// otimista demais faria os testes de UI passarem num cenario que a producao
/// nunca produz.
fn answer_for(question: &QuestionSpec) -> Answer {
    match question {
        QuestionSpec::Noul { .. } => Answer::Noul(super::NoulAnswer { noul: 0.62 }),
        QuestionSpec::Choice { options, .. } => {
            let weights: BTreeMap<String, f64> = options
                .iter()
                .map(|option| {
                    let weight = key_weight(&option.key);
                    (option.key.clone(), weight)
                })
                .collect();
            let total: f64 = weights.values().sum();
            let probabilities: BTreeMap<String, f64> = weights
                .into_iter()
                .map(|(key, weight)| (key, weight / total))
                .collect();
            let choice = probabilities
                .iter()
                .max_by(|left, right| {
                    left.1
                        .partial_cmp(right.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(key, _)| key.clone())
                .unwrap_or_default();
            Answer::Choice(super::ChoiceAnswer {
                confidence: super::choice_confidence_from(&probabilities),
                choice,
                probabilities,
            })
        }
        QuestionSpec::Score { levels, .. } => {
            let last = levels.len().saturating_sub(1);
            let mut probabilities = BTreeMap::new();
            for level in 0..levels.len() {
                let value = if level == last {
                    0.7
                } else {
                    0.3 / last.max(1) as f64
                };
                probabilities.insert(level, value);
            }
            Answer::Score(super::ScoreAnswer {
                score: super::expected_score(&probabilities),
                confidence: super::score_confidence_from(&probabilities),
                probabilities,
            })
        }
    }
}

/// Peso determinstico e estavel entre processos para um nome de opcao.
///
/// `DefaultHasher` nao serve: nao e garantido estavel entre versoes do Rust.
fn key_weight(key: &str) -> f64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    // Faixa 0.20 a 0.60: nunca degenerado, nunca dominante demais.
    0.20 + (hash % 41) as f64 / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::calibrated::questions::options_from_pairs;
    use crate::review::calibrated::{instructions, QuestionSpec};

    fn state() -> Value {
        super::super::state_object(&[("nota", Value::String(MOCK_STATE_MARKER.to_string()))])
    }

    fn questions() -> BTreeMap<String, QuestionSpec> {
        BTreeMap::from([
            (
                "urgente".to_string(),
                QuestionSpec::Noul {
                    instructions: instructions("urgente?"),
                    criteria: None,
                },
            ),
            (
                "status".to_string(),
                QuestionSpec::Choice {
                    instructions: instructions("qual?"),
                    options: options_from_pairs([
                        ("lembrou".to_string(), "quando lembrou".to_string()),
                        ("parcial".to_string(), "quando parcial".to_string()),
                        ("esqueceu".to_string(), "quando esqueceu".to_string()),
                    ]),
                },
            ),
            (
                "nivel".to_string(),
                QuestionSpec::Score {
                    instructions: instructions("qual nivel?"),
                    levels: vec!["baixo".to_string(), "medio".to_string(), "alto".to_string()],
                },
            ),
        ])
    }

    #[test]
    fn the_mock_answers_every_question_without_network() {
        let response = MockCalibratedProvider
            .evaluate(&state(), &questions())
            .expect("avalia");
        assert_eq!(response.answers.len(), 3);
        assert_eq!(response.model, "mock-calibrated");
        assert_eq!(response.latency_ms, 0);
    }

    #[test]
    fn every_mocked_answer_passes_the_same_validation_as_the_real_path() {
        let asked = questions();
        let response = MockCalibratedProvider
            .evaluate(&state(), &asked)
            .expect("avalia");
        for (id, answer) in &response.answers {
            let question = asked.get(id).expect("pergunta");
            assert_eq!(
                answer.validate(question),
                Vec::<String>::new(),
                "resposta de {id} violou uma invariante"
            );
        }
    }

    #[test]
    fn the_mock_leans_toward_the_conservative_side() {
        let asked = questions();
        let response = MockCalibratedProvider
            .evaluate(&state(), &asked)
            .expect("avalia");
        // Confianca de noul abaixo de 0.7 e o cenario que dispara o guard
        // `ASSERTION_STATUS_MIN_PROB`; o mock precisa exercitar esse caminho.
        assert!(response.answers["urgente"].confidence() < 0.7);
    }

    #[test]
    fn the_mock_reports_the_engine_it_mimics() {
        assert_eq!(
            MockCalibratedProvider.engine(),
            CalibrationEngine::Jev,
            "o mock substitui o JEV, nao o legado"
        );
    }

    #[test]
    fn the_mock_still_validates_the_request() {
        let error = MockCalibratedProvider
            .evaluate(&state(), &BTreeMap::new())
            .expect_err("sem perguntas");
        assert!(error.message.contains("pelo menos uma pergunta"), "{error}");
    }

    #[test]
    fn the_mock_answer_does_not_depend_on_option_order() {
        // O mock precisa ser uma referencia limpa para a medicao de vies de
        // ordem: se ele mesmo favorecesse a primeira opcao, mediria a si
        // mesmo.
        let QuestionSpec::Choice { options, .. } = ChoiceProvider::question() else {
            panic!("a pergunta do mock e uma choice");
        };
        let rotated = super::super::questions::rotate_options(&options, "q1");
        let direct = answer_for(&QuestionSpec::Choice {
            instructions: super::super::instructions("q"),
            options,
        });
        let rotated_answer = answer_for(&QuestionSpec::Choice {
            instructions: super::super::instructions("q"),
            options: rotated,
        });
        let Answer::Choice(left) = direct else {
            panic!("choice");
        };
        let Answer::Choice(right) = rotated_answer else {
            panic!("choice");
        };
        assert_eq!(left.choice, right.choice);
        assert_eq!(left.probabilities, right.probabilities);
    }

    #[test]
    fn the_mock_is_deterministic_across_runs() {
        assert_eq!(key_weight("remembered"), key_weight("remembered"));
        assert_ne!(key_weight("remembered"), key_weight("missing"));
    }

    /// Construtor de pergunta compartilhado pelos testes do mock.
    struct ChoiceProvider;

    impl ChoiceProvider {
        fn question() -> QuestionSpec {
            QuestionSpec::Choice {
                instructions: super::super::instructions("q"),
                options: options_from_pairs([
                    ("remembered", "quando lembrou"),
                    ("partial", "quando parcial"),
                    ("missing", "quando esqueceu"),
                    ("contradicted", "quando contradiz"),
                ]),
            }
        }
    }

    #[test]
    fn a_score_question_with_one_level_is_refused_by_the_mock() {
        let broken = BTreeMap::from([(
            "nivel".to_string(),
            QuestionSpec::Score {
                instructions: instructions("?"),
                levels: vec!["so um".to_string()],
            },
        )]);
        let error = MockCalibratedProvider
            .evaluate(&state(), &broken)
            .expect_err("niveis insuficientes");
        assert!(error.message.contains("nivel"), "{error}");
    }
}
