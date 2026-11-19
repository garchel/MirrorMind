//! Conta MirrorMind (F1b-2): cadastro, login e refresh contra o Supabase Auth.
//!
//! Por que no Rust e não no renderer: o refresh token nunca deve existir no
//! JavaScript. Aqui o par de tokens nasce, é trocado e morre no cofre do sistema
//! (`session.rs`); o frontend recebe apenas `{ status, email, expiração }`.
//!
//! O endereço e a chave publicável chegam por parâmetro (vêm do `.env` no build),
//! não de variável de ambiente do binário: um endereço de backend compilado no
//! executável não pode ser trocado sem recompilar.

use anyhow::{bail, Result};
use base64::Engine;
use reqwest::blocking::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

use crate::review::credentials::NativeCredentialStore;
use crate::session;

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// Margem para renovar antes de expirar (evita corrida de 1 segundo no servidor).
const EXPIRY_SKEW_SECONDS: i64 = 60;

/// Retrato da conta para o frontend. Nada de token aqui.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    /// `auth` quando há sessão utilizável, `anon` quando não há.
    pub status: &'static str,
    pub email: Option<String>,
    pub expires_at_unix_ms: Option<i64>,
}

fn anon() -> AccountSnapshot {
    AccountSnapshot {
        status: "anon",
        email: None,
        expires_at_unix_ms: None,
    }
}

pub(crate) fn client() -> Result<Client> {
    Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|_| anyhow::anyhow!("Não foi possível preparar a conexão com o servidor."))
}

/// `https://projeto.supabase.co` + caminho. Recusa qualquer coisa que não seja
/// http(s) para não enviar credencial a um esquema local (file:, jar:, ...).
pub(crate) fn endpoint(base_url: &str, path: &str) -> Result<String> {
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        bail!("Endereço do servidor de contas ausente.");
    }
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
        bail!("O endereço do servidor de contas precisa começar com https://.");
    }
    Ok(format!("{base_url}{path}"))
}

pub(crate) fn require_key(api_key: &str) -> Result<&str> {
    let api_key = api_key.trim();
    if api_key.len() < 16 {
        bail!("Chave pública do servidor de contas ausente.");
    }
    Ok(api_key)
}

/// Traduz o erro do Supabase para algo que o usuário entende. A mensagem crua
/// fica no log; a tela recebe uma frase acionável.
pub(crate) fn friendly_error(status: u16, body: &Value) -> String {
    let raw = body
        .get("msg")
        .or_else(|| body.get("error_description"))
        .or_else(|| body.get("message"))
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let lower = raw.to_ascii_lowercase();

    if lower.contains("invalid login credentials") {
        return "E-mail ou senha incorretos.".to_string();
    }
    if lower.contains("user already registered") || lower.contains("already been registered") {
        return "Este e-mail já tem conta. Use entrar.".to_string();
    }
    if lower.contains("email not confirmed") {
        return "Confirme seu e-mail antes de entrar.".to_string();
    }
    if lower.contains("password should be at least") {
        return "A senha precisa de pelo menos 6 caracteres.".to_string();
    }
    if lower.contains("rate limit") || lower.contains("too many requests") {
        return "Muitas tentativas em pouco tempo. Aguarde alguns minutos.".to_string();
    }
    if lower.contains("invalid email") || lower.contains("is invalid") {
        return "O e-mail digitado não parece válido.".to_string();
    }
    if status >= 500 {
        return "O servidor de contas não respondeu. Tente de novo em instantes.".to_string();
    }
    if raw.is_empty() {
        return "Não foi possível concluir a operação com a conta.".to_string();
    }
    format!("Não foi possível concluir: {raw}")
}

pub(crate) fn json_body(response: Response) -> Value {
    response.json::<Value>().unwrap_or(Value::Null)
}

/// Lê o `exp` do JWT de acesso (segundos → ms). Sem biblioteca de JWT: só o
/// payload, que é base64url e não precisa de assinatura para saber quando expira
/// (a assinatura é verificada pelo servidor a cada chamada).
pub(crate) fn expires_at_from_jwt(access_token: &str) -> Option<i64> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: Value = serde_json::from_slice(&decoded).ok()?;
    let exp = claims.get("exp")?.as_i64()?;
    Some(exp * 1000)
}

pub(crate) fn snapshot_from_session(email: Option<String>, access_token: &str) -> AccountSnapshot {
    AccountSnapshot {
        status: "auth",
        email,
        expires_at_unix_ms: expires_at_from_jwt(access_token),
    }
}

pub(crate) fn store_session(access_token: &str, refresh_token: &str) -> Result<()> {
    let store = NativeCredentialStore::new();
    session::save_session(&store, access_token, refresh_token)
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

/// Extrai `(access_token, refresh_token, email)` de uma resposta de token.
pub(crate) fn read_tokens(body: &Value) -> Option<(String, String, Option<String>)> {
    let access = body.get("access_token")?.as_str()?.to_string();
    let refresh = body.get("refresh_token")?.as_str()?.to_string();
    let email = body
        .get("user")
        .and_then(|user| user.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Some((access, refresh, email))
}

pub(crate) fn read_email(base_url: &str, api_key: &str, access_token: &str) -> Option<String> {
    let url = endpoint(base_url, "/auth/v1/user").ok()?;
    let response = client()
        .ok()?
        .get(url)
        .header("apikey", api_key)
        .bearer_auth(access_token)
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    json_body(response)
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Troca o refresh token guardado por um par novo. Devolve `None` quando não há
/// sessão válida (o chamador trata como deslogado).
fn refresh(base_url: &str, api_key: &str, refresh_token: &str) -> Result<Option<AccountSnapshot>> {
    let url = endpoint(base_url, "/auth/v1/token?grant_type=refresh_token")?;
    let response = client()?
        .post(url)
        .header("apikey", api_key)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com o servidor de contas."))?;
    let status = response.status();

    if status.as_u16() == 400 || status.as_u16() == 401 {
        // Refresh vencido/revogado: a sessão acabou, e isso não é erro de tela.
        let _ = clear_session();
        return Ok(None);
    }
    if !status.is_success() {
        let body = json_body(response);
        bail!("{}", friendly_error(status.as_u16(), &body));
    }

    let body = json_body(response);
    let Some((access, refresh, email)) = read_tokens(&body) else {
        let _ = clear_session();
        return Ok(None);
    };
    store_session(&access, &refresh)?;
    let email = email.or_else(|| read_email(base_url, api_key, &access));
    Ok(Some(snapshot_from_session(email, &access)))
}

fn clear_session() -> Result<()> {
    let store = NativeCredentialStore::new();
    session::clear_session(&store).map_err(|error| anyhow::anyhow!(error.to_string()))
}

pub(crate) fn load_session() -> Result<Option<session::Session>> {
    let store = NativeCredentialStore::new();
    session::load_session(&store).map_err(|error| anyhow::anyhow!(error.to_string()))
}

/// Cria a conta e já devolve a sessão (a confirmação de e-mail precisa estar
/// desligada no provedor; ligada, o Supabase devolve usuário sem token e aqui
/// viramos erro explicativo).
pub fn sign_up(
    base_url: &str,
    api_key: &str,
    email: &str,
    password: &str,
    terms_accepted_at: Option<&str>,
    privacy_accepted_at: Option<&str>,
) -> Result<AccountSnapshot> {
    let api_key = require_key(api_key)?;
    let url = endpoint(base_url, "/auth/v1/signup")?;
    let email = email.trim();
    if !email.contains('@') {
        bail!("Digite um e-mail válido.");
    }

    let response = client()?
        .post(url)
        .header("apikey", api_key)
        .json(&json!({
            "email": email,
            "password": password,
            "data": {
                "terms_accepted_at": terms_accepted_at,
                "privacy_accepted_at": privacy_accepted_at,
            }
        }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com o servidor de contas."))?;
    let status = response.status();
    let body = json_body(response);
    if !status.is_success() {
        bail!("{}", friendly_error(status.as_u16(), &body));
    }

    let Some((access, refresh, email)) = read_tokens(&body) else {
        bail!("Conta criada. Confirme o e-mail para entrar.");
    };
    store_session(&access, &refresh)?;
    Ok(snapshot_from_session(email, &access))
}

/// Login por e-mail e senha. Tokens só no keyring; a tela recebe o retrato.
pub fn sign_in(
    base_url: &str,
    api_key: &str,
    email: &str,
    password: &str,
) -> Result<AccountSnapshot> {
    let api_key = require_key(api_key)?;
    let url = endpoint(base_url, "/auth/v1/token?grant_type=password")?;
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        bail!("Informe e-mail e senha.");
    }

    let response = client()?
        .post(url)
        .header("apikey", api_key)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com o servidor de contas."))?;
    let status = response.status();
    let body = json_body(response);
    if !status.is_success() {
        bail!("{}", friendly_error(status.as_u16(), &body));
    }

    let Some((access, refresh, email)) = read_tokens(&body) else {
        bail!("O servidor não devolveu uma sessão. Tente de novo.");
    };
    store_session(&access, &refresh)?;
    Ok(snapshot_from_session(email, &access))
}

/// Estado atual: sessão guardada, renovada se estiver perto de expirar.
pub fn snapshot(base_url: &str, api_key: &str) -> Result<AccountSnapshot> {
    let api_key = require_key(api_key)?;
    let Some(session) = load_session()? else {
        return Ok(anon());
    };

    let now_ms = chrono_like_now_ms();
    let expires = expires_at_from_jwt(&session.access_token);
    let needs_refresh = expires
        .map(|exp| exp - now_ms <= EXPIRY_SKEW_SECONDS * 1000)
        .unwrap_or(true);

    if needs_refresh {
        return Ok(refresh(base_url, api_key, &session.refresh_token)?.unwrap_or_else(anon));
    }

    let email = read_email(base_url, api_key, &session.access_token);
    Ok(snapshot_from_session(email, &session.access_token))
}

fn chrono_like_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Sair: revoga a sessão no servidor (melhor esforço) e apaga o cofre local.
pub fn sign_out(base_url: &str, api_key: &str) -> Result<()> {
    let api_key = require_key(api_key)?;
    if let Some(session) = load_session()? {
        if let Ok(url) = endpoint(base_url, "/auth/v1/logout") {
            if let Ok(http) = client() {
                let _ = http
                    .post(url)
                    .header("apikey", api_key)
                    .bearer_auth(&session.access_token)
                    .send();
            }
        }
    }
    clear_session()
}

// -----------------------------------------------------------------------------
// Comandos IPC. Vivem neste modulo (e nao no `lib.rs`) pelo mesmo motivo dos
// `review::ipc::*`: o atributo `#[tauri::command]` em `async fn` na raiz do crate
// gera o macro `__cmd__*` duas vezes no namespace do modulo.
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn account_sign_up(
    url: String,
    api_key: String,
    email: String,
    password: String,
    terms_accepted_at: Option<String>,
    privacy_accepted_at: Option<String>,
) -> Result<AccountSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sign_up(
            &url,
            &api_key,
            &email,
            &password,
            terms_accepted_at.as_deref(),
            privacy_accepted_at.as_deref(),
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn account_sign_in(
    url: String,
    api_key: String,
    email: String,
    password: String,
) -> Result<AccountSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sign_in(&url, &api_key, &email, &password).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Login com Google (PKCE + loopback). O fluxo é longo — abre navegador e espera
/// até três minutos — por isso roda em `spawn_blocking` como os demais.
#[tauri::command]
pub async fn account_sign_in_google(
    url: String,
    api_key: String,
) -> Result<AccountSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::account_oauth::sign_in_with_google(&url, &api_key).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn account_snapshot(url: String, api_key: String) -> Result<AccountSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        snapshot(&url, &api_key).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn account_sign_out(url: String, api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        sign_out(&url, &api_key).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_with_exp(exp: i64) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp},"sub":"abc"}}"#).as_bytes());
        format!("{header}.{payload}.assinatura")
    }

    #[test]
    fn le_a_expiracao_do_jwt() {
        let token = jwt_with_exp(1_800_000_000);
        assert_eq!(expires_at_from_jwt(&token), Some(1_800_000_000_000));
    }

    #[test]
    fn token_malformado_nao_tem_expiracao() {
        assert_eq!(expires_at_from_jwt("sem-pontos"), None);
        assert_eq!(expires_at_from_jwt("a.b.c"), None);
    }

    #[test]
    fn recusa_endereco_que_nao_e_http() {
        assert!(endpoint("file:///c:/windows", "/auth/v1/token").is_err());
        assert!(endpoint("", "/x").is_err());
        assert!(endpoint("https://proj.supabase.co/", "/auth/v1/token").is_ok());
    }

    #[test]
    fn traduz_erros_do_provedor() {
        let credenciais = json!({ "msg": "Invalid login credentials" });
        assert_eq!(
            friendly_error(400, &credenciais),
            "E-mail ou senha incorretos."
        );

        let ja_existe = json!({ "msg": "User already registered" });
        assert_eq!(
            friendly_error(422, &ja_existe),
            "Este e-mail já tem conta. Use entrar."
        );

        let sem_confirmar = json!({ "msg": "Email not confirmed" });
        assert_eq!(
            friendly_error(400, &sem_confirmar),
            "Confirme seu e-mail antes de entrar."
        );

        let queda = Value::Null;
        assert_eq!(
            friendly_error(503, &queda),
            "O servidor de contas não respondeu. Tente de novo em instantes."
        );
    }

    /// Ciclo real contra o Supabase, fora do app: cadastro → retrato → saída.
    ///
    /// `#[ignore]` porque cria conta de verdade e grava no cofre do sistema.
    /// Rodar com:
    ///   MIRRORMIND_TEST_SUPABASE_URL=... MIRRORMIND_TEST_SUPABASE_KEY=... \
    ///   MIRRORMIND_TEST_EMAIL=voce+teste@dominio MIRRORMIND_TEST_PASSWORD=... \
    ///   cargo test --lib account::tests::live_ciclo_de_conta -- --ignored --nocapture
    #[test]
    #[ignore = "rede + cofre do sistema"]
    fn live_ciclo_de_conta() {
        let (Ok(url), Ok(key), Ok(email), Ok(password)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        // Cadastro: se a conta já existir, o erro tem que ser o traduzido.
        match sign_up(
            &url,
            &key,
            &email,
            &password,
            Some("2026-11-19T00:00:00Z"),
            Some("2026-11-19T00:00:00Z"),
        ) {
            Ok(snapshot) => {
                assert_eq!(snapshot.status, "auth");
                assert_eq!(snapshot.email.as_deref(), Some(email.as_str()));
                assert!(snapshot.expires_at_unix_ms.unwrap_or(0) > chrono_like_now_ms());
            }
            Err(error) => assert_eq!(error.to_string(), "Este e-mail já tem conta. Use entrar."),
        }

        let sessao = sign_in(&url, &key, &email, &password).expect("login");
        assert_eq!(sessao.status, "auth");
        assert_eq!(sessao.email.as_deref(), Some(email.as_str()));

        let atual = snapshot(&url, &key).expect("retrato");
        assert_eq!(atual.status, "auth");

        sign_out(&url, &key).expect("saida");
        assert_eq!(
            snapshot(&url, &key).expect("retrato pos-saida").status,
            "anon"
        );
    }

    #[test]
    fn sem_tokens_a_resposta_e_anonima_por_padrao() {
        let vazio = json!({ "user": { "email": "a@b.c" } });
        assert!(read_tokens(&vazio).is_none());
        assert_eq!(anon().status, "anon");
    }
}
