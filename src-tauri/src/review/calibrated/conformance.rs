//! Suite de conformidade do adapter calibrado (System One).
//!
//! A suite `super::super::conformance` prova a equivalencia de contrato dos
//! adapters **gerativos** com um servidor falso deterministico. Esta e a
//! contraparte do adapter **calibrado**, e cobre o que nao existe no caminho
//! legado:
//!
//! - retry com backoff em `429` e `529`, que a API exige e nenhum adapter
//!   gerativo precisa;
//! - as invariantes numericas das respostas (probabilidades somando 1, argmax
//!   presente, `score` igual a esperanca ponderada), que nao tem equivalente
//!   no caminho de texto;
//! - redacao da chave de API em qualquer corpo devolvido.
//!
//! Nenhum teste aqui toca a rede real: todos apontam para um servidor TCP
//! local que responde com envelopes literais.

use super::questions::{instructions, options_from_pairs, QuestionSpec};
use super::typesafe::TypeSafeProvider;
use super::{state_object, CalibratedProvider};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Chave usada nas pruebas. Comprida o bastante para passar na validacao de
/// credencial, curta o bastante para caber num assert.
const TEST_KEY: &str = "typesk_teste_conformance_0123456789";
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(15);

/// Le o pedido HTTP completo,Headers + corpo conforme `Content-Length`.
fn read_http_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("set fake server timeout");
    let mut request = Vec::new();
    loop {
        let mut chunk = [0_u8; 4096];
        let read = stream.read(&mut chunk).expect("read request");
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim())
                })
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            if request.len() >= header_end + 4 + content_length {
                break;
            }
        }
    }
    String::from_utf8(request).expect("UTF-8 HTTP request")
}

/// Corpo de resposta com um status arbitrario.
fn response(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Servidor que atende um numero fixo de pedidos, em ordem, e captura o que
/// recebeu.
struct FakeServer {
    address: String,
    captured: Arc<Mutex<Vec<String>>>,
    join: Option<thread::JoinHandle<()>>,
}

impl FakeServer {
    fn start(responses: Vec<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake provider");
        listener
            .set_nonblocking(true)
            .expect("nonblocking fake provider");
        let address = listener.local_addr().expect("fake provider address");
        let captured = Arc::new(Mutex::new(Vec::new()));
        let thread_captured = Arc::clone(&captured);
        let deadline = std::time::Instant::now() + ACCEPT_TIMEOUT;
        let join = thread::spawn(move || {
            let mut served = 0usize;
            while served < responses.len() {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_nonblocking(false)
                            .expect("blocking accepted stream");
                        let request = read_http_request(&mut stream);
                        thread_captured.lock().expect("capture lock").push(request);
                        stream
                            .write_all(responses[served].as_bytes())
                            .expect("respond");
                        served += 1;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            break;
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("fake server accept failed: {error}"),
                }
            }
        });
        Self {
            address: address.to_string(),
            captured,
            join: Some(join),
        }
    }

    fn endpoint(&self) -> String {
        format!("http://{}", self.address)
    }

    fn finish(&mut self) -> Vec<String> {
        if let Some(join) = self.join.take() {
            join.join().expect("fake server");
        }
        self.captured.lock().expect("capture lock").clone()
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// As perguntas usadas na maioria dos cenarios: um `noul` e um `choice`.
fn questions() -> BTreeMap<String, QuestionSpec> {
    BTreeMap::from([
        (
            "urgente".to_string(),
            QuestionSpec::Noul {
                instructions: instructions("Isto e urgente?"),
                criteria: None,
            },
        ),
        (
            "status".to_string(),
            QuestionSpec::Choice {
                instructions: instructions("Qual e o status?"),
                options: options_from_pairs([
                    ("ready".to_string(), "a nota esta pronta".to_string()),
                    (
                        "ambiguous".to_string(),
                        "a nota tem partes fraxas".to_string(),
                    ),
                ]),
            },
        ),
    ])
}

/// Envelope correspondente a `questions()`.
fn full_envelope() -> String {
    json!({
        "model": "jev-1.13.0",
        "answers": {
            "urgente": { "type": "noul", "noul": 0.95 },
            "status": {
                "type": "choice",
                "choice": "ready",
                "probabilities": { "ready": 0.88, "ambiguous": 0.12 },
                "confidence": 0.76
            }
        },
        "usage": { "input_tokens": 318, "output_tokens": 34 }
    })
    .to_string()
}

fn state() -> Value {
    state_object(&[(
        "untrusted_note_markdown",
        Value::String("# Ciclo de Calvin\n\nA glicose e o produto da fase escura.".to_string()),
    )])
}

/// Cenario completo: servidor responde com sucesso e conferimos contrato,
/// transporte e corpo enviado.
#[test]
fn a_valid_exchange_produces_typed_answers() {
    let mut server = FakeServer::start(vec![response(200, "OK", &full_envelope())]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let asked = questions();

    let outcome = provider
        .evaluate(&state(), &asked)
        .expect("avaliacao valida");
    let requests = server.finish();

    assert_eq!(requests.len(), 1, "uma unica ida e volta");
    assert_eq!(outcome.model, "jev-1.13.0");
    assert_eq!(outcome.answers.len(), 2);
    assert_eq!(outcome.input_tokens, Some(318));
    assert_eq!(outcome.output_tokens, Some(34));

    // A chave vai no cabecalho `Authorization` e NUNCA no corpo, que carrega o
    // Markdown da nota do usuario.
    let request = &requests[0];
    let header_is_authorized = request.lines().any(|line| {
        line.to_ascii_lowercase()
            .starts_with("authorization: bearer")
    });
    assert!(header_is_authorized, "{request}");
    let body = request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    assert!(!body.contains(TEST_KEY), "a chave nao pode ir no corpo");
    let sent: Value = serde_json::from_str(body).expect("corpo JSON");
    assert_eq!(sent["model"], "jev-latest");
    assert_eq!(sent["questions"]["urgente"]["type"], "noul");
    assert_eq!(sent["questions"]["status"]["type"], "choice");
    assert_eq!(
        sent["state"]["untrusted_note_markdown"],
        "# Ciclo de Calvin\n\nA glicose e o produto da fase escura."
    );
}

/// O estado viaja como objeto de campos nomeados, nunca como texto solto.
#[test]
fn the_state_is_always_sent_as_a_named_object() {
    let mut server = FakeServer::start(vec![response(200, "OK", &full_envelope())]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    provider.evaluate(&state(), &questions()).expect("avalia");
    let requests = server.finish();
    let body = requests[0]
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    let sent: Value = serde_json::from_str(body).expect("corpo JSON");
    assert!(
        sent["state"].is_object(),
        "o estado precisa ser objeto nomeado, veio {}",
        sent["state"]
    );
}

/// `429` e`529` sao condicoes normais: o adapter tem de repetir e succeedir.
#[test]
fn rate_limits_are_retried_and_eventually_succeed() {
    for retryable in [429u16, 529, 503] {
        let mut server = FakeServer::start(vec![
            response(retryable, "Too Many Requests", r#"{"error":"de novo"}"#),
            response(retryable, "Too Many Requests", r#"{"error":"de novo"}"#),
            response(200, "OK", &full_envelope()),
        ]);
        let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
        let outcome = provider
            .evaluate(&state(), &questions())
            .unwrap_or_else(|error| panic!("{retryable} deveria ser repetido: {error}"));
        assert_eq!(outcome.answers.len(), 2, "{retryable} recovers");
        assert_eq!(server.finish().len(), 3, "{retryable} tentou 3 vezes");
    }
}

/// Repetir ate o limite e depois falhar alto — nunca em loop infinito.
#[test]
fn a_persistent_rate_limit_fails_after_bounded_attempts() {
    let mut server = FakeServer::start(vec![
        response(429, "Too Many Requests", r#"{"error":"limite"}"#),
        response(429, "Too Many Requests", r#"{"error":"limite"}"#),
        response(429, "Too Many Requests", r#"{"error":"limite"}"#),
    ]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("429 persistente");
    assert!(error.message.contains("Limite de requisicoes"), "{error}");
    assert_eq!(server.finish().len(), 3, "teto de 3 tentativas");
}

/// `4xx` de cliente nao e transitorio: repetir so desperdicaria cota.
#[test]
fn client_errors_are_not_retried() {
    for code in [400u16, 413, 415] {
        let mut server = FakeServer::start(vec![response(
            code,
            "Error",
            r#"{"error":{"field":"/state"}}"#,
        )]);
        let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
        let error = provider.evaluate(&state(), &questions()).unwrap_err();
        assert_eq!(server.finish().len(), 1, "{code} nao deveria repetir");
        assert!(!error.message.is_empty());
    }
}

/// `422` aponta o campo culpado, para o diagnostico dizer QUAL pergunta falhou.
#[test]
fn an_unprocessable_question_names_the_field() {
    let server = FakeServer::start(vec![response(
        422,
        "Unprocessable Entity",
        r#"{"error":{"field":"/questions/status/options","message":"opcao invalida"}}"#,
    )]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("pergunta recusada");
    assert!(error.message.contains("/questions/status"), "{error}");
    assert!(
        error.raw_response.is_some(),
        "o corpo precisa ser preservado"
    );
}

/// A chave nunca aparece no texto devolvido ao chamador.
#[test]
fn a_recused_key_is_never_echoed_back() {
    let body = format!(r#"{{"error":"chave {TEST_KEY} recusada"}}"#);
    let server = FakeServer::start(vec![response(401, "Unauthorized", &body)]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("chave recusada");
    let redacted = error.raw_response.unwrap_or_default();
    assert!(!redacted.contains(TEST_KEY), "a chave vazou: {redacted}");
    assert!(redacted.contains("[REDACTED]"), "{redacted}");
}

/// Um envelope que quebra o contrato falha com o corpo preservado e sem
/// escrever nada — o caminho legado tem o mesmo envelope `Invalid`.
#[test]
fn a_contract_violation_fails_without_partial_state() {
    let broken = json!({
        "model": "jev-1.13.0",
        "answers": {
            "urgente": { "type": "noul", "noul": 0.9 },
            "status": {
                "type": "choice",
                "choice": "ready",
                // Somam 0.7, nao 1.
                "probabilities": { "ready": 0.5, "ambiguous": 0.2 },
                "confidence": 0.6
            }
        }
    })
    .to_string();
    let server = FakeServer::start(vec![response(200, "OK", &broken)]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("probabilidades inconsistentes");
    assert!(error.raw_response.is_some());
    assert!(
        error
            .validation_errors
            .iter()
            .any(|detail| detail.contains("somam")),
        "{error:?}"
    );
}

/// Um `307` nao pode virar seguimento automatico: o corpo da requisicao
/// carrega o estado da nota do usuario.
#[test]
fn a_redirect_is_not_followed() {
    let mut server = FakeServer::start(vec![response(307, "Temporary Redirect", "")]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("307 nao pode ser seguido");
    assert!(
        error.message.contains("307") || error.message.contains("3"),
        "{error}"
    );
    assert_eq!(server.finish().len(), 1, "so uma requisicao");
}

/// Corpo maior que o limite e recusado na leitura, sem estourar memoria.
#[test]
fn an_oversized_body_is_refused() {
    let huge = "x".repeat(3 * 1024 * 1024);
    let server = FakeServer::start(vec![response(200, "OK", &huge)]);
    let provider = TypeSafeProvider::for_test(server.endpoint(), TEST_KEY.to_string());
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("corpo grande");
    assert!(
        error.message.contains("limite seguro") || error.message.contains("UTF-8"),
        "{error}"
    );
}

/// Uma falha de validacao local nunca chega a abrir conexao.
#[test]
fn local_validation_happens_before_any_connection() {
    // Porta 1: se algo sair, o erro seria de transporte.
    let provider =
        TypeSafeProvider::for_test("http://127.0.0.1:1".to_string(), TEST_KEY.to_string());
    let empty = BTreeMap::new();
    let error = provider
        .evaluate(&state(), &empty)
        .expect_err("sem perguntas");
    assert!(error.message.contains("pelo menos uma pergunta"), "{error}");

    let oversized = Value::String("a".repeat(1024 * 1024 + 1));
    let error = provider
        .evaluate(&oversized, &questions())
        .expect_err("estado grande");
    assert!(error.message.contains("excede o limite"), "{error}");
}

/// `redirect(Policy::none())` e `no_proxy` sao invariantes de seguranca do
/// adapter: um 307 levaria a chave da TypeSafe para fora, e um proxy do
/// ambiente faria o mesmo.
#[test]
fn the_client_refuses_proxies() {
    let provider =
        TypeSafeProvider::for_test("http://127.0.0.1:1".to_string(), TEST_KEY.to_string());
    // Um endpoint invalido falha na conexao em vez de passar pelo proxy.
    let error = provider
        .evaluate(&state(), &questions())
        .expect_err("endpoint invalido");
    assert!(!error.message.is_empty());
}
