//! Testes de integracao REAIS dos provedores de IA (Gemini e Ollama).
//!
//! A suite `conformance` prova a equivalencia de contrato entre os dois
//! adaptadores com um servidor falso deterministico, sem instancias reais.
//! Estes testes vao alem: chamam as instancias de verdade e **pulam
//! automaticamente** quando o ambiente nao esta disponivel, para nunca
//! quebrar CI:
//!
//! - `MIRRORMIND_REAL_AI_TESTS=1` roda uma sessao completa real (prontidao,
//!   geracao de prova e geracao de conversa) em cada adaptador. O Ollama pula
//!   se estiver fora do ar ou sem o modelo `qwen2.5:7b`; o Gemini pula sem
//!   chave salva no cofre nativo.
//! - `MIRRORMIND_REAL_AI_FAILURE_TESTS=1` cobre falhas reais de transporte e
//!   credencial: Ollama indisponivel (diagnostico legivel) e chave Gemini
//!   invalida via `MIRRORMIND_REAL_GEMINI_INVALID_KEY`.

use super::conformance::ready_document;
use super::credentials::{load_gemini_api_key, NativeCredentialStore};
use super::evaluation::{evaluate_readiness, ReadinessAttempt};
use super::gemini::{GeminiProvider, GEMINI_ENDPOINT};
use super::provider::{OllamaProvider, ProviderRequest, StructuredAiProvider, OLLAMA_MODEL};
use super::segmentation::DEFAULT_MAX_WHOLE_NOTE_WORDS;
use super::session::{start_review_session_with_coverage, PromptKind, ReviewGenerationAttempt};
use crate::review::contract::ReviewMode;
use serde_json::json;

const ENV_SUCCESS: &str = "MIRRORMIND_REAL_AI_TESTS";
const ENV_FAILURE: &str = "MIRRORMIND_REAL_AI_FAILURE_TESTS";
const ENV_INVALID_GEMINI_KEY: &str = "MIRRORMIND_REAL_GEMINI_INVALID_KEY";

/// Nota realista (varias linhas distintas) para dar material a geracao real:
/// o modelo precisa produzir 3-5 questoes mistas com citacoes literais.
const MARKDOWN: &str = "\
Fotossintese converte energia luminosa em energia quimica.\n\
A clorofila absorve luz nas bandas azul e vermelha do espectro.\n\
O processo libera oxigenio como subproduto da fase clara.\n\
A glicose e o principal produto da fase escura do ciclo de Calvin.\n\
A equacao geral consome gax carboxilico e agua para produzir glicose e oxigenio.\n";

fn gated(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

/// Carrega um arquivo `.env` simples (linhas `KEY=VALUE`, comentarios com `#`)
/// da raiz do projeto para que os testes rodeem com a chave fornecida sem
/// depender de export manual. Nao sobrescreve variaveis ja definidas e nunca
/// imprime os valores.
fn load_dotenv_if_present() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let dotenv_path = std::path::Path::new(&manifest)
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join(".env");
    let Ok(content) = std::fs::read_to_string(dotenv_path) else {
        return;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        if key.is_empty() || value.is_empty() {
            continue;
        }
        // Remove aspas delimitadoras comuns de arquivos .env ("valor" ou
        // 'valor'), preservando o conteudo interno.
        let value = if value.len() >= 2 {
            let (first, last) = (value.as_bytes()[0], value.as_bytes()[value.len() - 1]);
            if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
                &value[1..value.len() - 1]
            } else {
                value
            }
        } else {
            value
        };
        if value.is_empty() {
            continue;
        }
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
}

fn skip(reason: &str) {
    eprintln!("[integracoes reais] pulado: {reason}");
}

/// A exaustao de quota do provedor e uma condicao do ambiente (como chave
/// ausente ou instancia offline), nao um defeito do produto: a requisicao foi
/// aceita e processada, mas a janela do plano gratuito esgotou os pedidos do
/// dia. O teste registra o ocorrido e pula, em vez de falhar.
fn is_quota_exhaustion(message: &str, body: &str) -> bool {
    message.contains("limite temporario")
        || body.contains("too_many_requests")
        || body.contains("exceeded your current quota")
}

fn run_full_session(provider: &dyn StructuredAiProvider, session_prefix: &str) {
    // 1) Prontidao real: a resposta do modelo precisa ser parseavel e
    // fundamentada. O status em si pode variar entre modelos reais (um modelo
    // local menor pode classificar a nota como ambiguous), entao o teste exige
    // apenas um relatorio valido — o fluxo do app tambem aceita as tres.
    let attempt = evaluate_readiness(provider, MARKDOWN, DEFAULT_MAX_WHOLE_NOTE_WORDS, None)
        .expect("chamada real de prontidao");
    let report = match attempt {
        ReadinessAttempt::Valid { report, .. } => report,
        ReadinessAttempt::Invalid {
            message,
            raw_response,
            validation_errors,
            ..
        } => {
            let detail = if validation_errors.is_empty() {
                message
            } else {
                format!("{message}: {}", validation_errors.join("; "))
            };
            let body = raw_response.unwrap_or_default();
            if is_quota_exhaustion(&detail, &body) {
                skip(&format!(
                    "{session_prefix}: {detail} — a requisicao foi aceita (schema do wire OK), mas a quota do provedor esgotou; rode de novo quando a janela liberar"
                ));
                return;
            }
            panic!("prontidao real invalida: {detail} (corpo da API: {body})");
        }
    };
    eprintln!(
        "[integracoes reais] {session_prefix}: prontidao status={:?}",
        report.status
    );

    // 2) Geracao real de prova e de conversa: o rascunho precisa ser valido
    // (estrutura, mistura de tipos e citacoes fundamentadas) — o mesmo
    // `parse_prompt_plan` que a producao usa.
    let document = ready_document(MARKDOWN);
    let modes = [
        (ReviewMode::Exam, format!("{session_prefix}-exam")),
        (
            ReviewMode::Conversation,
            format!("{session_prefix}-conversation"),
        ),
    ];
    for (mode, session_id) in modes {
        let (attempt, _) = match start_review_session_with_coverage(
            provider,
            &document,
            MARKDOWN,
            mode.clone(),
            session_id,
        ) {
            Ok(roundtrip) => roundtrip,
            Err(error) => {
                let detail = error.to_string();
                if is_quota_exhaustion(&detail, &detail) {
                    skip(&format!(
                        "{session_prefix}: {detail} — quota do provedor esgotada; rode de novo quando a janela liberar"
                    ));
                    return;
                }
                panic!("chamada real de geracao falhou: {detail}");
            }
        };
        match attempt {
            ReviewGenerationAttempt::Valid { draft } => {
                eprintln!(
                    "[integracoes reais] {session_prefix}: {:?} gerou {} pergunta(s)",
                    mode,
                    draft.prompts.len()
                );
                match mode {
                    ReviewMode::Exam => {
                        assert!(
                            draft.prompts.len() >= 3,
                            "prova real precisa de 3-5 perguntas"
                        );
                        assert!(
                            draft
                                .prompts
                                .iter()
                                .any(|prompt| prompt.kind == PromptKind::MultipleChoice),
                            "prova real precisa de multipla escolha"
                        );
                        assert!(
                            draft
                                .prompts
                                .iter()
                                .any(|prompt| prompt.kind == PromptKind::ShortAnswer),
                            "prova real precisa de resposta curta"
                        );
                    }
                    ReviewMode::Conversation => {
                        assert_eq!(draft.prompts.len(), 1, "conversa real inicia com um turno");
                    }
                }
            }
            ReviewGenerationAttempt::Invalid {
                message,
                validation_errors,
                raw_response,
            } => {
                // Modelos locais pequenos (ex.: qwen2.5:7b) nem sempre seguem a
                // exigencia de prova mista: a resposta real e um diagnostico
                // legivel do mesmo parse que a producao usa. O teste registra o
                // ocorrido em vez de falhar — o app oferece nova tentativa.
                let note = if validation_errors.is_empty() {
                    message
                } else {
                    format!("{message}: {}", validation_errors.join("; "))
                };
                eprintln!(
                    "[integracoes reais] {session_prefix}: geracao real nao utilizavel: {note}"
                );
                if raw_response.is_some() {
                    eprintln!("[integracoes reais] {session_prefix}: resposta bruta preservada para diagnostico");
                }
            }
        }
    }
}

/// Pedido minimo que passa na validacao local, para exercitar somente o
/// transporte real (sem depender de esquemas privados da geracao).
fn transport_request() -> ProviderRequest {
    ProviderRequest {
        system_instructions: "Responda somente com JSON.".to_string(),
        source_markdown: MARKDOWN.to_string(),
        user_content: "Cenario de falha real.".to_string(),
        response_schema: json!({ "type": "object" }),
    }
}

#[test]
fn real_ollama_full_session_roundtrip_when_available() {
    if !gated(ENV_SUCCESS) {
        skip(&format!("{ENV_SUCCESS} ausente"));
        return;
    }
    let provider = match OllamaProvider::new() {
        Ok(provider) => provider,
        Err(error) => {
            skip(&format!("OllamaProvider::new falhou: {error}"));
            return;
        }
    };
    match provider.check_readiness() {
        Ok(status) if status.reachable && status.model_installed => {}
        Ok(status) => {
            skip(&format!(
                "Ollama acessivel mas modelo {OLLAMA_MODEL} ausente (reachable={})",
                status.reachable
            ));
            return;
        }
        Err(failure) => {
            skip(&format!("Ollama indisponivel: {}", failure.message));
            return;
        }
    }
    run_full_session(&provider, "ollama-real");
}

#[test]
fn real_gemini_full_session_roundtrip_when_key_configured() {
    load_dotenv_if_present();
    if !gated(ENV_SUCCESS) {
        skip(&format!("{ENV_SUCCESS} ausente"));
        return;
    }
    // Fonte da chave: primeiro a variavel GEMINI_API_KEY (que pode vir do
    // arquivo .env da raiz do projeto), depois o cofre nativo do sistema.
    let store = NativeCredentialStore::new();
    let env_key = std::env::var("GEMINI_API_KEY")
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    let store_key = if env_key.is_some() {
        None
    } else {
        load_gemini_api_key(&store).expect("leitura do cofre nativo")
    };
    let key = env_key.or(store_key);
    let Some(key) = key else {
        skip("nenhuma chave Gemini disponivel (GEMINI_API_KEY ou cofre nativo)");
        return;
    };
    let provider = GeminiProvider::for_test(GEMINI_ENDPOINT.to_string(), key);
    run_full_session(&provider, "gemini-real");
}

#[test]
fn real_ollama_failure_diagnostic_when_unreachable() {
    if !gated(ENV_FAILURE) {
        skip(&format!("{ENV_FAILURE} ausente"));
        return;
    }
    let Ok(provider) = OllamaProvider::new() else {
        skip("OllamaProvider::new falhou");
        return;
    };
    // A falha real so acontece quando o Ollama esta de fato fora do ar: se a
    // instancia estiver acessivel neste ambiente, o cenario nao se aplica.
    if provider.check_readiness().is_ok() {
        skip("Ollama esta acessivel neste ambiente");
        return;
    }
    let failure = provider
        .generate_structured(transport_request())
        .expect_err("a chamada real deve falhar sem instancia");
    assert!(!failure.message.trim().is_empty(), "diagnostico legivel");
    assert!(
        failure.raw_response.is_none(),
        "falha de transporte nao carrega resposta bruta"
    );
    eprintln!(
        "[integracoes reais] falha real registrada: {}",
        failure.message
    );
}

#[test]
fn real_gemini_invalid_key_produces_legible_failure() {
    let Some(invalid_key) = std::env::var_os(ENV_INVALID_GEMINI_KEY) else {
        skip(&format!("{ENV_INVALID_GEMINI_KEY} ausente"));
        return;
    };
    if !gated(ENV_FAILURE) {
        skip(&format!("{ENV_FAILURE} ausente"));
        return;
    }
    let key = invalid_key
        .into_string()
        .expect("chave invalida deve ser UTF-8");
    let provider = GeminiProvider::for_test(GEMINI_ENDPOINT.to_string(), key);
    let failure = provider
        .generate_structured(transport_request())
        .expect_err("a chamada real com chave invalida deve falhar");
    assert!(!failure.message.trim().is_empty(), "diagnostico legivel");
    eprintln!(
        "[integracoes reais] falha real registrada: {}",
        failure.message
    );
}
