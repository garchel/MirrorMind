//! Contrato calibrado: estado na entrada, decisoes tipadas na saida.
//!
//! Este e o segundo, ao lado de `super::provider::StructuredAiProvider`.
//! Os dois coexistem porque respondem a perguntas diferentes:
//!
//! - `StructuredAiProvider` recebe instrucoes e devolve TEXTO gerado, que o
//!   codigo precisa esmagar ate virar um valor confiavel.
//! - `CalibratedProvider` recebe perguntas tipadas e devolve VALORES TIPADOS
//!   com probabilidades, sem geracao de texto.
//!
//! O JEV implementa este e **nao** implementa o outro: ele nao escreve texto.
//! `ProviderKind` tambem nao ganha uma variante nova, porque `ProviderKind`
//! decide quem GERA e e matchado exaustivamente no lanco de conteudo e no
//! registro de uso.

pub mod answers;
pub mod assertions;
pub mod comparison;
pub mod confidence_log;
#[cfg(test)]
pub mod conformance;
pub mod dispatch;
pub mod eval;
pub mod fact_check;
pub mod finish;
pub mod improvements;
pub mod mock;
pub mod proposals;
pub mod questions;
pub mod readiness;
pub mod typesafe;

pub use answers::{
    choice_confidence_from, expected_score, noul_confidence, score_confidence_from, Answer,
    ChoiceAnswer, NoulAnswer, ScoreAnswer,
};
pub use questions::{
    instructions, instructions_object, options_from_pairs, ChoiceOption, NoulCriteria,
    QuestionKind, QuestionSpec,
};
pub use typesafe::TypeSafeProvider;

use super::provider::ProviderFailure;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Motor que produziu uma decisao calibrada. Registrado na proveniencia para
/// que a comparacao entre `Off` e `Jev` saiba de onde veio cada numero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalibrationEngine {
    /// Caminho legado: `StructuredAiProvider` gera e o codigo valida.
    Legacy,
    /// Caminho JEV: decisao tipada com probabilidades.
    Jev,
}

impl CalibrationEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            CalibrationEngine::Legacy => "legacy",
            CalibrationEngine::Jev => "jev",
        }
    }
}

/// Resposta de uma avaliacao calibrada.
#[derive(Debug, Clone, PartialEq)]
pub struct CalibratedResponse {
    /// Modelo que respondeu, como reportado pela API (ex.: `jev-1.13.0`).
    pub model: String,
    /// Uma resposta por pergunta, sob o mesmo id enviado.
    pub answers: BTreeMap<String, Answer>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub latency_ms: u64,
    /// Corpo bruto, preservado para diagnostico igual ao caminho legado.
    pub raw_response: String,
}

/// Provedor que responde perguntas tipadas com probabilidades calibradas.
pub trait CalibratedProvider: Send + Sync {
    /// Identificador estavel do motor, para proveniencia e relatorios.
    fn engine(&self) -> CalibrationEngine;

    /// Modelo concreto em uso (para exibir na UI e comparar execucoes).
    fn model(&self) -> &'static str;

    /// Avalia `questions` contra `state` em UMA chamada.
    ///
    /// Todas as perguntas veem o MESMO estado. Por isso o estado deve conter
    /// so o que as perguntas precisam: o modelo avalia cada pergunta contra a
    /// totalidade do estado, e conteudo irrelevante dilui a precisao.
    fn evaluate(
        &self,
        state: &Value,
        questions: &BTreeMap<String, QuestionSpec>,
    ) -> Result<CalibratedResponse, ProviderFailure>;

    /// Adaptacao para o contrato legado, para os recursos que ainda pedem
    /// texto gerado dentro de um caminho calibrado (o decomposition de
    /// assertions do Caminho A e a prosa de synthesis sao exemplos).
    ///
    /// Devolve `None` quando o motor nao gera texto. Isso e proposital: quem
    /// implementa `CalibratedProvider` sem geracao deixa o compilador apontar
    /// o unico lugar que dependeria dela.
    fn generative_provider(&self) -> Option<&dyn super::provider::StructuredAiProvider> {
        None
    }
}

/// Conversao de estado para o formato do wire.
///
/// `state` e sempre enviado como objeto de campos nomeados, mesmo quando ha
/// um unico campo. Padronizar a forma evita que a estrategia de filtragem
/// divirja entre funcionalidades e concentra a transformacao num lugar so.
pub fn state_object(fields: &[(&str, Value)]) -> Value {
    Value::Object(
        fields
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect(),
    )
}

/// Reuso dos limites de entrada do caminho legado.
///
/// O limite do JEV e MENOR de proposito: 2 MiB de nota nao e um problema de
/// transporte, e um problema de precisao (o modelo se perde no volume). O
/// filtro deterministico de unidade (`coverage::select_session_units`) e a
/// solucao de verdade; este teto e a rede de seguranca.
pub fn validate_calibrated_request(
    state: &Value,
    questions: &BTreeMap<String, QuestionSpec>,
) -> Result<(), ProviderFailure> {
    const MAX_STATE_BYTES: usize = 1024 * 1024;

    let state_bytes = serde_json::to_vec(state)
        .map_err(|_| invalid("O estado da avaliacao nao e serializavel em JSON."))?;
    if state_bytes.len() > MAX_STATE_BYTES {
        return Err(invalid(&format!(
            "O estado da avaliacao tem {} bytes e excede o limite de {MAX_STATE_BYTES}. \
             Filtre o estado para a unidade que a pergunta realmente precisa.",
            state_bytes.len()
        )));
    }
    if questions.is_empty() {
        return Err(invalid("A avaliacao precisa de pelo menos uma pergunta."));
    }
    let mut errors = Vec::new();
    for (id, question) in questions {
        if let Err(error) = question.validate(id) {
            errors.push(error);
        }
    }
    if !errors.is_empty() {
        return Err(invalid(&format!(
            "As perguntas da avaliacao sao invalidas: {}",
            errors.join(" ")
        )));
    }
    Ok(())
}

fn invalid(message: &str) -> ProviderFailure {
    ProviderFailure {
        message: message.to_string(),
        raw_response: None,
        validation_errors: vec![message.to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noul() -> QuestionSpec {
        QuestionSpec::Noul {
            instructions: instructions("a nota esta pronta?"),
            criteria: None,
        }
    }

    #[test]
    fn engine_names_are_stable() {
        assert_eq!(CalibrationEngine::Legacy.as_str(), "legacy");
        assert_eq!(CalibrationEngine::Jev.as_str(), "jev");
    }

    #[test]
    fn state_object_keeps_the_field_order_given() {
        let state = state_object(&[
            ("nota", Value::String("a".to_string())),
            ("resposta", Value::String("b".to_string())),
        ]);
        let keys: Vec<&String> = state.as_object().expect("objeto").keys().collect();
        assert_eq!(keys, vec!["nota", "resposta"]);
    }

    #[test]
    fn a_valid_request_passes_validation() {
        let questions = BTreeMap::from([("q".to_string(), noul())]);
        assert!(
            validate_calibrated_request(&state_object(&[("x", Value::Null)]), &questions).is_ok()
        );
    }

    #[test]
    fn an_empty_question_set_is_rejected() {
        let error =
            validate_calibrated_request(&Value::Null, &BTreeMap::new()).expect_err("sem perguntas");
        assert!(error.message.contains("pelo menos uma pergunta"), "{error}");
    }

    #[test]
    fn an_oversized_state_is_rejected_before_any_network_call() {
        let big = Value::String("a".repeat(1024 * 1024 + 1));
        let questions = BTreeMap::from([("q".to_string(), noul())]);
        let error = validate_calibrated_request(&big, &questions).expect_err("estado grande");
        assert!(error.message.contains("excede o limite"), "{error}");
        assert!(error.raw_response.is_none());
    }

    #[test]
    fn invalid_questions_are_reported_all_together() {
        let questions = BTreeMap::from([
            (
                "a".to_string(),
                QuestionSpec::Choice {
                    instructions: instructions("qual?"),
                    options: Vec::new(),
                },
            ),
            (
                "b".to_string(),
                QuestionSpec::Score {
                    instructions: instructions("qual?"),
                    levels: vec!["so um".to_string()],
                },
            ),
        ]);
        let error = validate_calibrated_request(&Value::Null, &questions).expect_err("invalidas");
        assert!(error.message.contains("/questions/a"), "{error}");
        assert!(error.message.contains("/questions/b"), "{error}");
    }
}
