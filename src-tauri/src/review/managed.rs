//! Provedor de IA **gerenciado pela assinatura** (a nossa chave).
//!
//! A chave do provedor fica no servidor (secret da função de borda `ai-review`):
//! embutida no app, qualquer pessoa a extrairia e gastaria nosso dinheiro. Este
//! módulo é o transporte — quem decide se a chamada acontece (plano, cota do dia,
//! do mês, do minuto, teto de custo) é o banco, do outro lado.
//!
//! O pedido é **o mesmo corpo** que o provedor Gemini monta (`interaction_body`),
//! então a resposta volta no mesmo formato e é parseada pela mesma função. Um
//! formato, dois transportes: chave própria vai direto; assinatura passa por aqui.

use super::gemini::{interaction_body, parse_interaction};
use super::provider::{
    ProviderFailure, ProviderKind, ProviderRequest, ProviderResponse, StructuredAiProvider,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

static PROXIMO_PEDIDO: AtomicU64 = AtomicU64::new(1);

/// URL pública do projeto. Não é segredo: já vai embutida no bundle do app. O
/// ambiente pode trocar (staging) sem recompilar.
const SUPABASE_PADRAO: &str = "https://uzxpeoxrvdcptvbepzua.supabase.co";
const MAX_RESPOSTA_BYTES: usize = 2 * 1024 * 1024;

fn base_url() -> String {
    std::env::var("MIRRORMIND_SUPABASE_URL")
        .ok()
        .map(|valor| valor.trim().trim_end_matches('/').to_string())
        .filter(|valor| !valor.is_empty())
        .unwrap_or_else(|| SUPABASE_PADRAO.to_string())
}

/// Chave de idempotência: a mesma tentativa reenviada não cobra duas vezes.
fn chave_de_idempotencia() -> String {
    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_nanos())
        .unwrap_or(0);
    let sequencia = PROXIMO_PEDIDO.fetch_add(1, Ordering::Relaxed);
    format!("{agora}-{}-{sequencia}", std::process::id())
}

/// Traduz a resposta do proxy em mensagem para a tela.
///
/// Os códigos vêm do servidor (`cota_vitalicia`, `cota_mensal`, ...) e o texto
/// mora aqui de propósito: o servidor não sabe em que idioma a pessoa está.
pub(crate) fn mensagem_do_erro(status: u16, codigo: &str) -> String {
    match (status, codigo) {
        (401, _) => "Sua sessão expirou. Entre de novo na conta para usar a IA do MirrorMind.".into(),
        (402, _) => "A assinatura está pendente de pagamento. A revisão com Ollama ou sua própria chave continua disponível.".into(),
        (429, "cota_vitalicia") => {
            "As chamadas de IA incluídas na conta gratuita terminaram. Use o Ollama local ou a sua própria chave — a revisão continua funcionando.".into()
        }
        (429, "cota_mensal") => {
            "Você chegou ao limite de uso justo deste mês. No próximo ciclo volta sozinho; enquanto isso, o Ollama e a sua chave continuam livres.".into()
        }
        (429, "cota_diaria") => {
            "Limite do dia atingido. Volta a valer amanhã; o Ollama e a sua chave continuam livres.".into()
        }
        (429, _) => "Muitas chamadas em pouco tempo. Espere um minuto e tente de novo.".into(),
        (503, _) => "A IA do MirrorMind ainda não está configurada no servidor. Use o Ollama ou a sua própria chave.".into(),
        (502, _) => "O provedor de IA recusou a chamada. Tente de novo em instantes.".into(),
        (413, _) => "O conteúdo enviado é grande demais para a IA do MirrorMind.".into(),
        _ => "A IA do MirrorMind não conseguiu responder. Tente de novo.".to_string(),
    }
}

/// Estado da IA gerenciada para a tela: plano, tetos e quanto já foi usado.
///
/// Vem do servidor (não do app) porque é ele quem conta: mostrar número local
/// daria uma expectativa que a chamada seguinte contradiria.
pub fn status() -> Result<serde_json::Value, String> {
    let sessao = crate::account::load_session()
        .map_err(|erro| format!("Não foi possível ler a sessão: {erro}"))?
        .ok_or_else(|| "Entre na conta para ver o uso da IA incluída.".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "Não foi possível preparar a conexão.".to_string())?;
    let resposta = client
        .post(format!("{}/functions/v1/ai-review", base_url()))
        .header("Authorization", format!("Bearer {}", sessao.access_token))
        .json(&json!({ "mode": "status" }))
        .send()
        .map_err(|_| "Não foi possível consultar o uso agora.".to_string())?;
    let status = resposta.status();
    let corpo: Value = resposta.json().unwrap_or_else(|_| json!({}));
    if !status.is_success() {
        let codigo = corpo.get("error").and_then(Value::as_str).unwrap_or_default();
        return Err(mensagem_do_erro(status.as_u16(), codigo));
    }
    Ok(corpo)
}

pub struct ManagedAiProvider {
    client: reqwest::blocking::Client,
    endpoint: String,
    access_token: String,
}

impl ManagedAiProvider {
    /// Só existe com sessão: sem conta, não há assinatura para cobrir a chamada.
    pub fn from_session() -> Result<Self, String> {
        let sessao = crate::account::load_session()
            .map_err(|erro| format!("Não foi possível ler a sessão: {erro}"))?
            .ok_or_else(|| {
                "Entre na sua conta para usar a IA do MirrorMind, ou escolha o Ollama/a sua própria chave."
                    .to_string()
            })?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|_| "Não foi possível preparar a conexão com a IA.".to_string())?;
        Ok(Self {
            client,
            endpoint: format!("{}/functions/v1/ai-review", base_url()),
            access_token: sessao.access_token,
        })
    }

    fn generate(
        &self,
        request: ProviderRequest,
    ) -> std::result::Result<ProviderResponse, ProviderFailure> {
        let corpo = json!({
            "mode": "call",
            "request": interaction_body(&request, super::gemini::GEMINI_MODEL),
        });

        let resposta = self
            .client
            .post(&self.endpoint)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Idempotency-Key", chave_de_idempotencia())
            .json(&corpo)
            .send()
            .map_err(|_| ProviderFailure {
                message: "Não foi possível falar com a IA do MirrorMind. Verifique a conexão."
                    .to_string(),
                raw_response: None,
                validation_errors: Vec::new(),
            })?;

        let status = resposta.status();
        let corpo = resposta.bytes().map_err(|_| ProviderFailure {
            message: "A resposta da IA do MirrorMind veio incompleta.".to_string(),
            raw_response: None,
            validation_errors: Vec::new(),
        })?;
        let corpo = &corpo[..corpo.len().min(MAX_RESPOSTA_BYTES)];
        let payload: Value = serde_json::from_slice(corpo).unwrap_or_else(|_| json!({}));

        if !status.is_success() {
            let codigo = payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default();
            return Err(ProviderFailure {
                message: mensagem_do_erro(status.as_u16(), codigo),
                raw_response: None,
                validation_errors: Vec::new(),
            });
        }

        let Some(bruto) = payload.get("response") else {
            return Err(ProviderFailure {
                message: "A IA do MirrorMind respondeu em formato inesperado.".to_string(),
                raw_response: None,
                validation_errors: vec!["resposta sem campo response".to_string()],
            });
        };
        parse_interaction(bruto.to_string(), &request.response_schema)
    }
}

impl StructuredAiProvider for ManagedAiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Managed
    }

    fn generate_structured(
        &self,
        request: ProviderRequest,
    ) -> std::result::Result<ProviderResponse, ProviderFailure> {
        self.generate(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_tentativa_tem_chave_propria() {
        let primeira = chave_de_idempotencia();
        let segunda = chave_de_idempotencia();
        assert_ne!(
            primeira, segunda,
            "retry de verdade não pode repetir a chave"
        );
        assert!(primeira.len() > 8);
    }

    #[test]
    fn mensagem_de_cota_fala_do_caminho_que_continua_livre() {
        // Quem bate no teto precisa saber que a revisão não parou.
        for (status, codigo) in [
            (429, "cota_vitalicia"),
            (429, "cota_mensal"),
            (429, "cota_diaria"),
        ] {
            let texto = mensagem_do_erro(status, codigo);
            assert!(
                texto.contains("Ollama") || texto.contains("própria chave"),
                "mensagem sem saída: {texto}"
            );
        }
    }

    #[test]
    fn sessao_expirada_pede_login_em_vez_de_falar_de_cota() {
        let texto = mensagem_do_erro(401, "sessao_invalida");
        assert!(texto.contains("Entre de novo"));
        assert!(!texto.contains("cota"));
    }

    #[test]
    fn servidor_sem_chave_diz_que_falta_configurar() {
        assert!(mensagem_do_erro(503, "nao_configurado").contains("configurada no servidor"));
    }
}
