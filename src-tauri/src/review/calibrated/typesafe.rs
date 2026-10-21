//! Adapter do System One (JEV), da TypeSafe AI.
//!
//! `POST https://api.typesafe.ai/v1/systemone` com `state` e `questions`,
//! resposta `answers` tipados. Diferencas em relacao aos adapters legados que
//! sao deliberadas:
//!
//! - **Timeout curto (10s).** A doc promete 70-500ms. Timeout longo nao e
//!   folga, e mascaramento: em caso de queda do servico ele vira espera.
//! - **Retry com backoff.** `429` e `529` sao condicoes normais documentadas
//!   pela API, que exige backoff exponencial. Nenhum adapter legado tem retry,
//!   entao isto e codigo novo.
//! - **Teto de estado menor (1 MiB).** O limite de transporte do legado e
//!   2 MiB. Aqui o limite e de precisao: acima disso o modelo se perde.
//! - **Endpoint fixo.** Nao ha base URL configuravel. Uma base URL variavel
//!   permitiria enviar a chave da TypeSafe para um servidor arbitrario.

use super::answers::{Answer, RawAnswer};
use super::questions::QuestionSpec;
use super::{
    validate_calibrated_request, CalibratedProvider, CalibratedResponse, CalibrationEngine,
};
use crate::review::provider::ProviderFailure;
use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Read;
use std::time::{Duration, Instant};

/// Endpoint fixo do System One. Nao configuravel, por decisao de seguranca.
pub const TYPESAFE_ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
/// Alias do modelo insignia. A resposta traz a versao concreta
/// (`jev-1.13.0`) no campo `model`.
pub const TYPESAFE_MODEL: &str = "jev-latest";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
/// Numero total de tentativas, incluindo a primeira. Tres tentativas cobrem
/// uma queda transitoria sem transformar um rate limit em espera longa.
const MAX_ATTEMPTS: u32 = 3;
/// Espera antes da primeira retentativa, dobrando a cada tentativa.
///
/// A versao anterior usava `200ms * (tentativa - 1)`, o que dava 0ms, 200ms e
/// 400ms. Isso e rapido demais para um rate limit: um burst de avaliacoes
/// batia em `429` e a retentativa seguinte chegava antes da janela abrir.
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);
/// Teto da espera entre tentativas. Um `Retry-After` absurdo nao pode travar
/// a thread de avaliacao.
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);

/// Erro de configuracao local: falha antes de qualquer rede.
fn configuration(message: &str) -> ProviderFailure {
    ProviderFailure {
        message: message.to_string(),
        raw_response: None,
        validation_errors: vec![message.to_string()],
    }
}

/// Erro de transporte apos uma ou mais tentativas.
fn transport(message: &str) -> ProviderFailure {
    ProviderFailure {
        message: message.to_string(),
        raw_response: None,
        validation_errors: Vec::new(),
    }
}

/// Resposta recebida que nao corresponde ao contrato das perguntas enviadas.
fn invalid(message: &str, raw: String, validation_errors: Vec<String>) -> ProviderFailure {
    ProviderFailure {
        message: message.to_string(),
        raw_response: Some(raw),
        validation_errors,
    }
}

/// Provedor System One.
pub struct TypeSafeProvider {
    client: Client,
    api_key: String,
    /// Sobrescrito apenas pela suite de contrato, para apontar um servidor
    /// falso. `None` em producao.
    #[cfg(test)]
    endpoint: Option<String>,
}

/// `Debug` manual, nunca derivado: `derive` incluiria a chave da API em
/// qualquer mensagem de panico ou assert.
impl std::fmt::Debug for TypeSafeProvider {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TypeSafeProvider")
            .field("model", &TYPESAFE_MODEL)
            .field("api_key", &"[REDACTED]")
            .finish()
    }
}

impl TypeSafeProvider {
    /// Endpoint fixo, chave do cofre nativo. A validacao da chave acontece em
    /// `credentials::save_typesafe_api_key`; aqui so interessa que nao esteja
    /// vazia, porque `bearer_auth("")` sairia como header malformado.
    pub fn new(api_key: String) -> Result<Self, ProviderFailure> {
        Self::build(api_key, None)
    }

    /// Cliente apontado para um servidor falso. Existe para a suite de
    /// contrato exercitar retry e parsing sem duplicar a logica de transporte.
    #[cfg(test)]
    pub(crate) fn for_test(endpoint: String, api_key: String) -> Self {
        Self::build(api_key, Some(endpoint)).expect("endpoint de teste valido")
    }

    fn build(api_key: String, endpoint_override: Option<String>) -> Result<Self, ProviderFailure> {
        let api_key = api_key.trim().to_string();
        if api_key.is_empty() {
            return Err(configuration("A chave da TypeSafe AI nao foi configurada."));
        }
        // `no_proxy` segue os adapters remotos: uma variavel de ambiente de
        // proxy nao deve poder redirecionar a credencial para fora.
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| configuration("Nao foi possivel preparar o cliente da TypeSafe AI."))?;
        #[cfg(test)]
        {
            Ok(Self {
                client,
                api_key,
                endpoint: endpoint_override,
            })
        }
        #[cfg(not(test))]
        {
            let _ = endpoint_override;
            Ok(Self { client, api_key })
        }
    }

    /// Endpoint efetivo da chamada. Em producao e sempre o fixo.
    fn endpoint(&self) -> &str {
        #[cfg(test)]
        {
            self.endpoint.as_deref().unwrap_or(TYPESAFE_ENDPOINT)
        }
        #[cfg(not(test))]
        {
            TYPESAFE_ENDPOINT
        }
    }

    /// Remove a chave de API de um texto antes de devolverlo ao chamador.
    ///
    /// A chave viaja em `Authorization: Bearer`, entao o caso realista e o
    /// servico ecoar o header num erro de diagnostico. O caminho legado faz o
    /// mesmo em `gemini.rs:117`.
    fn redact(&self, raw: &str) -> Option<String> {
        if raw.is_empty() {
            return None;
        }
        Some(raw.replace(&self.api_key, "[REDACTED]"))
    }
}

impl CalibratedProvider for TypeSafeProvider {
    fn engine(&self) -> CalibrationEngine {
        CalibrationEngine::Jev
    }

    fn model(&self) -> &'static str {
        TYPESAFE_MODEL
    }

    fn evaluate(
        &self,
        state: &Value,
        questions: &BTreeMap<String, QuestionSpec>,
    ) -> Result<CalibratedResponse, ProviderFailure> {
        validate_calibrated_request(state, questions)?;
        let body = json!({
            "state": state,
            "model": TYPESAFE_MODEL,
            "questions": questions,
        });
        let serialized = serde_json::to_string(&body)
            .map_err(|_| configuration("A requisicao nao e serializavel."))?;

        let started = Instant::now();
        let mut attempt: u32 = 1;
        loop {
            let outcome = self.send_once(&serialized);
            let retryable = match &outcome {
                Ok((status, _, _)) => is_retryable(*status),
                Err(error) => error.retryable,
            };
            if !retryable || attempt >= MAX_ATTEMPTS {
                return match outcome {
                    Ok((status, raw, _)) => {
                        if !status.is_success() {
                            return Err(self.http_failure(status, &raw));
                        }
                        parse_system_one(raw, questions, started.elapsed().as_millis() as u64)
                    }
                    Err(error) => Err(error.into_failure()),
                };
            }
            // O atraso antes de tentar de novo.
            //
            // O `Retry-After` do servidor tem precedencia: ele sabe quanto
            // tempo falta para a janela de limite liberar. Sem ele, um
            // backoff exponencial — 1s, 2s, 4s — porque o anterior (0ms,
            // 200ms, 400ms) era rapido demais para um rate limit e deixava
            // a chamada falhar por razao que nao era do produto.
            let server_hint = match &outcome {
                Ok((_, _, hint)) => *hint,
                Err(_) => None,
            };
            let backoff = RETRY_BASE_DELAY * (1u32 << (attempt - 1).min(4));
            let wait = server_hint.unwrap_or(backoff).min(MAX_RETRY_WAIT);
            std::thread::sleep(wait);
            attempt += 1;
        }
    }
}

impl TypeSafeProvider {
    /// Uma ida e volta. Erros de transporte ficam marcados como retryable;
    /// erro de codigo e erro de leitura do corpo, nao.
    fn send_once(
        &self,
        serialized: &str,
    ) -> Result<(reqwest::StatusCode, String, Option<Duration>), TransportFailure> {
        let response = self
            .client
            .post(self.endpoint())
            .bearer_auth(&self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serialized.to_string())
            .send()
            .map_err(|error| TransportFailure {
                message: if error.is_timeout() {
                    "A TypeSafe AI excedeu o tempo limite da solicitacao.".to_string()
                } else if error.is_connect() {
                    "A TypeSafe AI nao esta acessivel.".to_string()
                } else {
                    "Falha ao comunicar com a TypeSafe AI.".to_string()
                },
                retryable: error.is_timeout() || error.is_connect(),
            })?;
        let status = response.status();
        // O `Retry-After` do servidor diz quanto tempo falta para a janela de
        // limite liberar. Obedecer e o que distingue um retry que funciona de
        // um retry que apenas insiste.
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(Duration::from_secs);
        let raw = read_bounded(response).map_err(|message| TransportFailure {
            message,
            retryable: false,
        })?;
        Ok((status, raw, retry_after))
    }

    /// Traduz um status HTTP inesperado em falha de provider, com a chave
    /// redigida no corpo.
    fn http_failure(&self, status: reqwest::StatusCode, raw: &str) -> ProviderFailure {
        let raw_redacted = self.redact(raw);
        let field = field_error(raw);
        let message = match status.as_u16() {
            400 => "A TypeSafe AI rejeitou a requisicao.".to_string(),
            401 | 403 => "A chave da TypeSafe AI foi recusada.".to_string(),
            413 => "O estado enviado excede o limite da TypeSafe AI.".to_string(),
            415 => "O corpo usa uma codificacao nao suportada.".to_string(),
            422 => {
                return invalid(
                    &format!("A TypeSafe AI recusou uma pergunta: {field}"),
                    raw_redacted.unwrap_or_default(),
                    vec![field],
                )
            }
            429 => {
                return transport(&format!(
                    "Limite de requisicoes da TypeSafe AI alcancado apos {MAX_ATTEMPTS} tentativas."
                ))
            }
            529 => {
                return transport(&format!(
                    "A TypeSafe AI esta sobrecarregada apos {MAX_ATTEMPTS} tentativas."
                ))
            }
            code => format!("A TypeSafe AI respondeu com o status HTTP {code}."),
        };
        ProviderFailure {
            message,
            raw_response: raw_redacted,
            validation_errors: Vec::new(),
        }
    }
}

/// Erro de transporte que pode ou nao valer nova tentativa.
struct TransportFailure {
    message: String,
    retryable: bool,
}

impl TransportFailure {
    fn into_failure(self) -> ProviderFailure {
        transport(&self.message)
    }
}

/// `429` (rate limit) e `529` (sobrecarregado) sao as duas condicoes que a doc
/// manda repetir. `5xx` generico tambem e transitorio na pratica; `4xx` de
/// cliente nao e, e repetir so desperdicaria cota.
fn is_retryable(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.as_u16() == 529
        || status.is_server_error()
}

/// Extrai o campo culpado do corpo de erro da API, para o diagnostico apontar
/// a pergunta e nao so o status.
fn field_error(raw: &str) -> String {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .map(|error| error.get("field").unwrap_or(error).to_string())
        })
        .unwrap_or_else(|| "campo nao informado pelo servico".to_string())
}

fn read_bounded(response: Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("A resposta da TypeSafe AI excede o limite seguro.".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Nao foi possivel ler a resposta da TypeSafe AI.".to_string())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("A resposta da TypeSafe AI excede o limite seguro.".to_string());
    }
    String::from_utf8(bytes)
        .map_err(|_| "A resposta da TypeSafe AI nao esta em UTF-8 valido.".to_string())
}

/// Converte o envelope em respostas tipadas, conferindo cada resposta contra a
/// pergunta que a originou.
///
/// Nao existe caminho "tolerante" aqui, e essa e a diferenca que importa: o
/// caminho legado tem alias tables, reparo e fallback porque o modelo gera
/// texto. Aqui o formato ja e garantido; se uma invariante numerica falha, a
/// chamada falha.
fn parse_system_one(
    raw: String,
    questions: &BTreeMap<String, QuestionSpec>,
    latency_ms: u64,
) -> Result<CalibratedResponse, ProviderFailure> {
    let envelope: Value = serde_json::from_str(&raw).map_err(|_| {
        invalid(
            "A TypeSafe AI retornou um envelope malformado.",
            raw.clone(),
            vec!["O corpo da resposta nao e JSON valido.".to_string()],
        )
    })?;

    let model = envelope
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(TYPESAFE_MODEL)
        .to_string();
    let usage = envelope.get("usage");
    let read_tokens = |field: &str| {
        usage
            .and_then(|usage| usage.get(field))
            .and_then(Value::as_u64)
    };

    let raw_answers = envelope
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            invalid(
                "A resposta da TypeSafe AI nao traz as respostas esperadas.",
                raw.clone(),
                vec!["O campo answers esta ausente ou invalido.".to_string()],
            )
        })?;

    // Toda pergunta enviada precisa de volta: uma pergunta sem resposta impede
    // a decisao que motivou a chamada.
    let missing: Vec<String> = questions
        .keys()
        .filter(|id| !raw_answers.contains_key(*id))
        .cloned()
        .collect();
    if !missing.is_empty() {
        return Err(invalid(
            "A TypeSafe AI nao respondeu a todas as perguntas.",
            raw.clone(),
            missing
                .iter()
                .map(|id| format!("/answers/{id}: pergunta enviada sem resposta."))
                .collect(),
        ));
    }

    let mut answers: BTreeMap<String, Answer> = BTreeMap::new();
    let mut validation_errors = Vec::new();
    for (id, question) in questions {
        let entry = raw_answers.get(id).expect("presenca verificada acima");
        let parsed: RawAnswer = match serde_json::from_value(entry.clone()) {
            Ok(parsed) => parsed,
            Err(error) => {
                validation_errors.push(format!("/answers/{id}: {error}"));
                continue;
            }
        };
        let answer: Answer = match parsed.into_answer(question) {
            Ok(answer) => answer,
            Err(error) => {
                validation_errors.push(format!("/answers/{id}: {error}"));
                continue;
            }
        };
        for error in answer.validate(question) {
            validation_errors.push(format!("/answers/{id}{error}"));
        }
        answers.insert(id.clone(), answer);
    }

    if !validation_errors.is_empty() {
        return Err(invalid(
            "As respostas da TypeSafe AI nao correspondem ao contrato solicitado.",
            raw,
            validation_errors,
        ));
    }

    Ok(CalibratedResponse {
        model,
        answers,
        input_tokens: read_tokens("input_tokens"),
        output_tokens: read_tokens("output_tokens"),
        latency_ms,
        raw_response: raw,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::calibrated::questions::options_from_pairs;
    use crate::review::calibrated::{instructions, state_object};
    use serde_json::json;

    fn questions() -> BTreeMap<String, QuestionSpec> {
        BTreeMap::from([(
            "urgente".to_string(),
            QuestionSpec::Noul {
                instructions: instructions("Isto e urgente?"),
                criteria: None,
            },
        )])
    }

    fn provider(endpoint: String) -> TypeSafeProvider {
        TypeSafeProvider::for_test(endpoint, "chave-de-teste-suficiente".to_string())
    }

    #[test]
    fn an_empty_key_is_refused_before_any_request() {
        let error = TypeSafeProvider::new("   ".to_string()).expect_err("chave vazia");
        assert!(error.message.contains("nao foi configurada"), "{error}");
    }

    #[test]
    fn the_engine_and_model_are_stable() {
        let provider = provider("http://127.0.0.1:1".to_string());
        assert_eq!(provider.engine(), CalibrationEngine::Jev);
        assert_eq!(provider.model(), TYPESAFE_MODEL);
    }

    #[test]
    fn the_endpoint_is_fixed_in_production() {
        assert!(TYPESAFE_ENDPOINT.starts_with("https://api.typesafe.ai/"));
    }

    #[test]
    fn a_key_in_the_response_body_is_redacted() {
        let key = "chave-de-teste-suficiente".to_string();
        let provider = provider("http://127.0.0.1:1".to_string());
        let redacted = provider
            .redact(&format!("erro: chave {key} rejeitada"))
            .expect("corpo nao vazio");
        assert_eq!(redacted, "erro: chave [REDACTED] rejeitada");
        assert!(!redacted.contains(&key), "a chave nao pode sobrar");
        assert!(provider.redact("").is_none());
    }

    #[test]
    fn retryable_statuses_are_the_transient_ones() {
        assert!(is_retryable(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable(reqwest::StatusCode::INTERNAL_SERVER_ERROR));
        assert!(is_retryable(reqwest::StatusCode::SERVICE_UNAVAILABLE));
        // 529 nao existe em `StatusCode`; e o codigo cru.
        assert!(is_retryable(
            reqwest::StatusCode::from_u16(529).expect("codigo 529")
        ));
    }

    #[test]
    fn client_errors_are_not_retried() {
        for code in [400u16, 401, 403, 413, 415, 422] {
            assert!(
                !is_retryable(reqwest::StatusCode::from_u16(code).expect("status")),
                "{code} nao deveria ser repetido"
            );
        }
    }

    #[test]
    fn an_oversized_state_never_reaches_the_network() {
        // Porta fechada: se a requisicao saisse, o erro seria de transporte, nao
        // de validacao local.
        let provider = provider("http://127.0.0.1:1".to_string());
        let big = Value::String("a".repeat(1024 * 1024 + 1));
        let error = provider
            .evaluate(&big, &questions())
            .expect_err("estado grande");
        assert!(error.message.contains("excede o limite"), "{error}");
    }

    #[test]
    fn field_error_extracts_the_offending_field() {
        let raw = r#"{"error":{"field":"/questions/status_0","message":"opcao invalida"}}"#;
        assert!(field_error(raw).contains("/questions/status_0"));
    }

    #[test]
    fn field_error_falls_back_when_the_body_is_unexpected() {
        assert!(field_error("nao e json").contains("nao informado"));
        assert!(field_error(r#"{"other":1}"#).contains("nao informado"));
    }

    #[test]
    fn a_well_formed_envelope_becomes_typed_answers() {
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": {
                "urgente": {
                    "type": "noul",
                    "noul": 0.95
                }
            },
            "usage": { "input_tokens": 307, "output_tokens": 20 }
        })
        .to_string();
        let response = parse_system_one(raw, &questions(), 123).expect("resposta valida");
        assert_eq!(response.model, "jev-1.13.0");
        assert_eq!(response.input_tokens, Some(307));
        assert_eq!(response.output_tokens, Some(20));
        assert_eq!(response.latency_ms, 123);
        let Answer::Noul(answer) = response.answers.get("urgente").expect("resposta") else {
            panic!("esperava noul");
        };
        assert!((answer.noul - 0.95).abs() < 1e-9);
    }

    #[test]
    fn usage_being_absent_is_not_an_error() {
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": { "urgente": { "type": "noul", "noul": 0.1 } }
        })
        .to_string();
        let response = parse_system_one(raw, &questions(), 1).expect("valida");
        assert_eq!(response.input_tokens, None);
    }

    #[test]
    fn a_non_json_body_is_an_invalid_failure_with_the_body_kept() {
        let error = parse_system_one("nao e json".to_string(), &questions(), 1)
            .expect_err("envelope quebrado");
        assert!(error.message.contains("malformado"), "{error}");
        assert_eq!(error.raw_response.as_deref(), Some("nao e json"));
    }

    #[test]
    fn a_missing_answers_field_names_the_problem() {
        let error = parse_system_one(r#"{"model":"jev"}"#.to_string(), &questions(), 1)
            .expect_err("sem answers");
        assert!(error.validation_errors[0].contains("answers"), "{error}");
    }

    #[test]
    fn a_question_without_an_answer_is_reported_by_id() {
        let questions = BTreeMap::from([
            (
                "urgente".to_string(),
                QuestionSpec::Noul {
                    instructions: instructions("urgente?"),
                    criteria: None,
                },
            ),
            (
                "completa".to_string(),
                QuestionSpec::Noul {
                    instructions: instructions("completa?"),
                    criteria: None,
                },
            ),
        ]);
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": { "urgente": { "type": "noul", "noul": 0.9 } }
        })
        .to_string();
        let error = parse_system_one(raw, &questions, 1).expect_err("falta resposta");
        assert!(error.validation_errors[0].contains("completa"), "{error:?}");
    }

    #[test]
    fn a_numerically_inconsistent_answer_is_rejected() {
        let questions = BTreeMap::from([(
            "status".to_string(),
            QuestionSpec::Choice {
                instructions: instructions("Qual?"),
                options: options_from_pairs([
                    ("sim".to_string(), "quando sim".to_string()),
                    ("nao".to_string(), "quando nao".to_string()),
                ]),
            },
        )]);
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": {
                "status": {
                    "type": "choice",
                    "choice": "sim",
                    // Somam 0.7, nao 1.
                    "probabilities": { "sim": 0.5, "nao": 0.2 },
                    "confidence": 0.6
                }
            }
        })
        .to_string();
        let error = parse_system_one(raw, &questions, 1).expect_err("soma errada");
        assert!(
            error.validation_errors.iter().any(|e| e.contains("somam")),
            "{error:?}"
        );
    }

    #[test]
    fn an_answer_of_the_wrong_kind_is_rejected() {
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": { "urgente": { "type": "choice", "choice": "sim",
                "probabilities": { "sim": 1.0 }, "confidence": 1.0 } }
        })
        .to_string();
        let error = parse_system_one(raw, &questions(), 1).expect_err("tipo errado");
        assert!(
            error
                .validation_errors
                .iter()
                .any(|e| e.contains("pedia noul")),
            "{error:?}"
        );
    }

    #[test]
    fn every_broken_answer_is_reported_at_once() {
        let questions = BTreeMap::from([
            (
                "a".to_string(),
                QuestionSpec::Noul {
                    instructions: instructions("a?"),
                    criteria: None,
                },
            ),
            (
                "b".to_string(),
                QuestionSpec::Noul {
                    instructions: instructions("b?"),
                    criteria: None,
                },
            ),
        ]);
        let raw = json!({
            "model": "jev-1.13.0",
            "answers": {
                "a": { "type": "choice", "choice": "x" },
                "b": { "type": "noul", "noul": 5.0 }
            }
        })
        .to_string();
        let error = parse_system_one(raw, &questions, 1).expect_err("ambos quebrados");
        let joined = error.validation_errors.join(" | ");
        assert!(joined.contains("/answers/a"), "{joined}");
        assert!(joined.contains("/answers/b"), "{joined}");
    }

    #[test]
    fn state_is_sent_as_a_named_object() {
        let state = state_object(&[("nota", Value::String("foto".to_string()))]);
        assert!(state["nota"].is_string());
    }
}
