//! Login com Google: PKCE + loopback, no Rust.
//!
//! Por que este arquivo existe separado de `account.rs`: o login por senha é uma
//! chamada; este é um **fluxo** — abrir o navegador do sistema, escutar uma porta
//! local, receber o retorno e trocar o código por tokens. As peças do fluxo
//! (verifier, state, callback, troca) ficam juntas para poderem ser lidas e
//! testadas de uma vez.
//!
//! Regras que o desenho respeita:
//!
//! - **O token nunca passa pelo JavaScript.** A troca acontece aqui e o par
//!   access/refresh vai direto para o cofre do sistema (`session.rs`), igual ao
//!   login por senha.
//! - **PKCE obrigatório.** O `code_verifier` nasce aleatório neste processo e
//!   nunca sai dele; o servidor recebe só o `challenge` (SHA-256 em base64url).
//!   Sem isso, qualquer processo que escutasse a porta poderia trocar o código.
//! - **`state` conferido.** O valor que volta na URL tem que ser o que saiu; sem
//!   essa checagem, um link forjado poderia plantar uma sessão de outra pessoa.
//! - **Porta efêmera em `127.0.0.1`.** Nada escuta em `0.0.0.0`: o retorno do
//!   navegador chega na própria máquina e não fica visível na rede.
//!
//! O endereço de retorno é `http://127.0.0.1:<porta>`; ele precisa estar nas
//! *Redirect URLs* do Supabase (o `127.0.0.1:*` já está lá — ver
//! `docs/passo-a-passo-contas.md`).

use anyhow::{bail, Result};
use base64::Engine;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use crate::account::{
    client, endpoint, friendly_error, json_body, read_email, read_tokens, require_key,
    snapshot_from_session, store_session, AccountSnapshot,
};

/// Quanto tempo esperamos o navegador voltar. Passou disso, a porta fecha: uma
/// escuta local aberta por tempo indeterminado é superfície sem motivo.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// Intervalo do laço de `accept` em modo não bloqueante.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

fn url_safe(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// 32 bytes de entropia do sistema em base64url (43 caracteres) — dentro da
/// faixa 43..128 que o RFC 7636 exige do `code_verifier`.
pub(crate) fn random_verifier() -> String {
    let mut bytes = [0u8; 32];
    // getrandom só falha se o SO não tiver fonte de entropia; sem ela não há
    // login seguro, então o erro sobe em vez de cair num valor previsível.
    getrandom::fill(&mut bytes).expect("o sistema precisa fornecer entropia");
    url_safe(&bytes)
}

pub(crate) fn random_state() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("o sistema precisa fornecer entropia");
    url_safe(&bytes)
}

/// `BASE64URL(SHA256(verifier))` — método `S256` do RFC 7636.
pub(crate) fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    url_safe(&digest)
}

/// URL do Supabase Auth que abre a tela do Google.
pub(crate) fn authorize_url(
    base_url: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> Result<Url> {
    let mut url = Url::parse(&endpoint(base_url, "/auth/v1/authorize")?)?;
    url.query_pairs_mut()
        .append_pair("provider", "google")
        .append_pair("redirect_to", redirect_uri)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "s256")
        .append_pair("state", state);
    Ok(url)
}

/// O que o navegador devolveu. `None` quando a requisição não é o callback
/// (`/favicon.ico` e afins): nesses casos seguimos escutando.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Callback {
    pub code: String,
    pub state: Option<String>,
}

pub(crate) fn parse_callback(request_line: &str) -> Result<Option<Callback>> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || !target.starts_with('/') {
        return Ok(None);
    }

    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| anyhow::anyhow!("O navegador voltou com um endereço inválido."))?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.to_string()),
            "state" => state = Some(value.to_string()),
            "error" => error = Some(value.to_string()),
            "error_description" => error_description = Some(value.to_string()),
            _ => {}
        }
    }

    if let Some(error) = error {
        // `access_denied` é o "cancelar" da tela do Google: não é falha, é escolha.
        if error == "access_denied" {
            bail!("Login com Google cancelado.");
        }
        let detail = error_description.unwrap_or(error);
        bail!("O Google não concluiu o login: {detail}");
    }

    match code {
        Some(code) if !code.is_empty() => Ok(Some(Callback { code, state })),
        _ => Ok(None),
    }
}

/// Confere o `state` devolvido contra o enviado.
pub(crate) fn check_state(expected: &str, received: Option<&str>) -> Result<()> {
    match received {
        Some(received) if received == expected => Ok(()),
        _ => bail!("O retorno do login não confere. Tente de novo."),
    }
}

fn page(title: &str, message: &str) -> String {
    // HTML mínimo e sem recurso externo: a página só existe para o usuário
    // saber que pode fechar a aba.
    format!(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">\
<title>{title}</title><style>body{{font:16px/1.6 system-ui,sans-serif;\
display:grid;place-items:center;height:100vh;margin:0;background:#fdfcf8;\
color:#24231f}}main{{max-width:32ch;text-align:center}}h1{{font-size:20px;\
font-weight:600}}</style></head><body><main><h1>{title}</h1><p>{message}</p>\
</main></body></html>"
    )
}

fn respond(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn read_request(stream: &mut TcpStream) -> String {
    let mut buffer = [0u8; 2048];
    match stream.read(&mut buffer) {
        Ok(read) if read > 0 => String::from_utf8_lossy(&buffer[..read]).to_string(),
        _ => String::new(),
    }
}

/// Espera o retorno do navegador na porta já aberta.
pub(crate) fn wait_for_callback(listener: &TcpListener, expected_state: &str) -> Result<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + CALLBACK_TIMEOUT;

    loop {
        if Instant::now() > deadline {
            bail!("O navegador não voltou em três minutos. Tente de novo.");
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false)?;
                stream.set_read_timeout(Some(READ_TIMEOUT))?;
                let request = read_request(&mut stream);
                let request_line = request.lines().next().unwrap_or_default().to_string();

                match parse_callback(&request_line) {
                    Ok(Some(callback)) => {
                        respond(
                            &mut stream,
                            &page(
                                "Conta conectada",
                                "Pode fechar esta aba e voltar para o MirrorMind.",
                            ),
                        );
                        check_state(expected_state, callback.state.as_deref())?;
                        return Ok(callback.code);
                    }
                    // Requisição que não é o callback (favicon, pré-conexão).
                    Ok(None) => {
                        respond(&mut stream, &page("MirrorMind", "Nada para ver aqui."));
                    }
                    Err(error) => {
                        respond(
                            &mut stream,
                            &page("Não deu certo", &error.to_string()),
                        );
                        return Err(error);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(error) => bail!("Não foi possível receber o retorno do navegador: {error}"),
        }
    }
}

/// No Windows a URL precisa ir **entre aspas**: a URL de autorização tem `&`
/// (`provider=google&state=…`) e o `cmd` corta a linha no `&`, abrindo só o
/// primeiro pedaço. `raw_arg` passa o texto sem a escapada do `std`, que não
/// colocaria aspas porque não há espaço na URL.
#[cfg(target_os = "windows")]
fn windows_url_arg(url: &str) -> String {
    format!("\"{url}\"")
}

/// Navegador que o Windows escolheu para `http`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserKind {
    Chrome,
    Edge,
    Brave,
    Firefox,
    Outro,
}

/// Traduz o ProgId do registro para o navegador. O Windows guarda o padrão em
/// `UserChoice\ProgId`; o sufixo `HTML` é o formato antigo e ainda é o que
/// aparece para Chrome/Edge/Brave.
pub(crate) fn browser_kind_from_prog_id(prog_id: &str) -> BrowserKind {
    let id = prog_id.trim().to_ascii_lowercase();
    if id.starts_with("chromehtml") {
        BrowserKind::Chrome
    } else if id.starts_with("msedgehtm") {
        BrowserKind::Edge
    } else if id.starts_with("bravehtml") {
        BrowserKind::Brave
    } else if id.starts_with("firefoxurl") {
        BrowserKind::Firefox
    } else {
        BrowserKind::Outro
    }
}

/// Argumentos de janela própria. `--app=` abre uma janela sem abas nem barra de
/// endereço — é o mais próximo de um popup de login, e continua sendo o navegador
/// de verdade (o Google recusa OAuth em WebView embutida).
pub(crate) fn app_window_args(url: &str) -> Vec<String> {
    vec![format!("--app={url}"), "--window-size=520,760".to_string()]
}

pub(crate) fn firefox_window_args(url: &str) -> Vec<String> {
    vec!["-new-window".to_string(), url.to_string()]
}

/// Procura o executável do navegador nos caminhos usuais do Windows.
#[cfg(target_os = "windows")]
fn browser_executable(kind: BrowserKind) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    let var = |nome: &str| std::env::var_os(nome).map(PathBuf::from);
    let mut candidatos: Vec<PathBuf> = Vec::new();
    let mut push = |base: Option<PathBuf>, resto: &str| {
        if let Some(base) = base {
            candidatos.push(base.join(resto));
        }
    };

    match kind {
        BrowserKind::Chrome => {
            push(var("ProgramFiles"), "Google/Chrome/Application/chrome.exe");
            push(var("ProgramFiles(x86)"), "Google/Chrome/Application/chrome.exe");
            push(var("LOCALAPPDATA"), "Google/Chrome/Application/chrome.exe");
        }
        BrowserKind::Edge => {
            push(var("ProgramFiles(x86)"), "Microsoft/Edge/Application/msedge.exe");
            push(var("ProgramFiles"), "Microsoft/Edge/Application/msedge.exe");
        }
        BrowserKind::Brave => {
            push(var("ProgramFiles"), "BraveSoftware/Brave-Browser/Application/brave.exe");
            push(var("LOCALAPPDATA"), "BraveSoftware/Brave-Browser/Application/brave.exe");
        }
        BrowserKind::Firefox => {
            push(var("ProgramFiles"), "Mozilla Firefox/firefox.exe");
            push(var("ProgramFiles(x86)"), "Mozilla Firefox/firefox.exe");
        }
        BrowserKind::Outro => {}
    }

    candidatos.into_iter().find(|caminho| caminho.exists())
}

/// Lê o navegador padrão do registro. `None` quando não dá para saber.
#[cfg(target_os = "windows")]
fn default_browser_prog_id() -> Option<String> {
    let saida = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
            "/v",
            "ProgId",
        ])
        .output()
        .ok()?;
    let texto = String::from_utf8_lossy(&saida.stdout);
    texto
        .lines()
        .find(|linha| linha.contains("ProgId"))
        .and_then(|linha| linha.split_whitespace().last())
        .map(str::to_string)
}

/// Abre o login numa **janela própria** do navegador padrão, não numa aba.
///
/// Antes usávamos `start <url>`, que entrega a URL ao navegador já aberto e o
/// login caía numa aba no meio das abas do usuário. Aqui o Chromium abre com
/// `--app=`, uma janela sem abas e sem barra de endereço; o Firefox com
/// `-new-window`. Sem navegador identificado, cai no comportamento antigo.
pub(crate) fn open_browser_window(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        if let Some(prog_id) = default_browser_prog_id() {
            let kind = browser_kind_from_prog_id(&prog_id);
            if let Some(exe) = browser_executable(kind) {
                let args = if kind == BrowserKind::Firefox {
                    firefox_window_args(url)
                } else {
                    app_window_args(url)
                };
                if std::process::Command::new(exe).args(&args).spawn().is_ok() {
                    return Ok(());
                }
            }
        }
        // Sem navegador identificado: `start` é o que o Windows sabe fazer.
        return open_browser(url);
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_browser(url)
    }
}

/// Abre a URL no navegador padrão do sistema.
pub(crate) fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        // O primeiro argumento vazio é o título da janela: sem ele, o `start`
        // trataria a URL como título.
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command.raw_arg(windows_url_arg(url));
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map_err(|_| anyhow::anyhow!("Não foi possível abrir o navegador."))?;
    Ok(())
}

/// Fluxo completo: abre o navegador, espera o retorno, troca o código por
/// tokens e guarda no cofre. Devolve o mesmo retrato do login por senha.
pub fn sign_in_with_google(base_url: &str, api_key: &str) -> Result<AccountSnapshot> {
    let api_key = require_key(api_key)?;
    endpoint(base_url, "/auth/v1/authorize")?; // valida o endereço antes de escutar

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| anyhow::anyhow!("Não foi possível abrir a porta de retorno do login."))?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_verifier();
    let state = random_state();
    let url = authorize_url(base_url, &redirect_uri, &code_challenge(&verifier), &state)?;

    open_browser_window(url.as_str())?;
    let code = wait_for_callback(&listener, &state)?;
    drop(listener); // a porta fecha antes de falar com o servidor

    let token_url = endpoint(base_url, "/auth/v1/token?grant_type=pkce")?;
    let response = client()?
        .post(token_url)
        .header("apikey", api_key)
        .json(&json!({ "auth_code": code, "code_verifier": verifier }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com o servidor de contas."))?;

    let status = response.status();
    let body: Value = json_body(response);
    if !status.is_success() {
        bail!("{}", friendly_error(status.as_u16(), &body));
    }

    let Some((access, refresh, email)) = read_tokens(&body) else {
        bail!("O servidor de contas não devolveu uma sessão. Tente de novo.");
    };
    store_session(&access, &refresh)?;
    let email = email.or_else(|| read_email(base_url, api_key, &access));
    Ok(snapshot_from_session(email, &access))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vetor oficial do RFC 7636 (Apêndice B).
    #[test]
    fn pkce_bate_com_o_vetor_do_rfc() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            code_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_e_state_saem_aleatorios_e_no_tamanho_certo() {
        let primeiro = random_verifier();
        let segundo = random_verifier();
        assert_ne!(primeiro, segundo);
        assert!((43..=128).contains(&primeiro.len()));
        assert!(primeiro.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(random_state(), random_state());
    }

    #[test]
    fn authorize_url_leva_pkce_e_state() {
        let url = authorize_url(
            "https://projeto.supabase.co",
            "http://127.0.0.1:51234",
            "abc",
            "xyz",
        )
        .expect("url");
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(params.get("provider").map(String::as_str), Some("google"));
        assert_eq!(params.get("code_challenge_method").map(String::as_str), Some("s256"));
        assert_eq!(params.get("code_challenge").map(String::as_str), Some("abc"));
        assert_eq!(params.get("state").map(String::as_str), Some("xyz"));
        assert_eq!(
            params.get("redirect_to").map(String::as_str),
            Some("http://127.0.0.1:51234")
        );
        assert_eq!(url.path(), "/auth/v1/authorize");
    }

    #[test]
    fn callback_traz_codigo_e_state() {
        let callback = parse_callback("GET /?code=abc123&state=xyz HTTP/1.1")
            .expect("parse")
            .expect("callback");
        assert_eq!(callback.code, "abc123");
        assert_eq!(callback.state.as_deref(), Some("xyz"));
    }

    #[test]
    fn requisicao_que_nao_e_callback_e_ignorada() {
        assert!(parse_callback("GET /favicon.ico HTTP/1.1").expect("parse").is_none());
        assert!(parse_callback("POST /?code=abc HTTP/1.1").expect("parse").is_none());
        assert!(parse_callback("GET /sem-codigo HTTP/1.1").expect("parse").is_none());
    }

    #[test]
    fn cancelar_no_google_vira_mensagem_e_nao_falha_crua() {
        let erro = parse_callback("GET /?error=access_denied HTTP/1.1").unwrap_err();
        assert_eq!(erro.to_string(), "Login com Google cancelado.");
    }

    #[test]
    fn state_diferente_e_recusado() {
        assert!(check_state("esperado", Some("outro")).is_err());
        assert!(check_state("esperado", None).is_err());
        assert!(check_state("esperado", Some("esperado")).is_ok());
    }

    #[test]
    fn prog_id_vira_navegador() {
        assert_eq!(browser_kind_from_prog_id("ChromeHTML"), BrowserKind::Chrome);
        assert_eq!(browser_kind_from_prog_id("MSEdgeHTM"), BrowserKind::Edge);
        assert_eq!(browser_kind_from_prog_id("BraveHTML"), BrowserKind::Brave);
        assert_eq!(browser_kind_from_prog_id("FirefoxURL-308046B0AF4A39CB"), BrowserKind::Firefox);
        assert_eq!(browser_kind_from_prog_id("OperaStable"), BrowserKind::Outro);
    }

    /// Cadeia real desta máquina: ProgId do registro → navegador → executável.
    /// Ignorado porque depende do Windows de quem roda (aqui é o Brave).
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "depende do navegador padrão da máquina"]
    fn live_navegador_padrao_tem_executavel_mapeado() {
        let prog_id = default_browser_prog_id().expect("ProgId no registro");
        let kind = browser_kind_from_prog_id(&prog_id);
        println!("prog_id = {prog_id} -> {kind:?}");
        assert!(
            browser_executable(kind).is_some(),
            "navegador padrão {prog_id} sem executável mapeado"
        );
    }

    #[test]
    fn janela_de_app_vai_sem_abas_e_com_tamanho_de_popup() {
        let url = "https://projeto.supabase.co/auth/v1/authorize?provider=google&state=abc";
        let args = app_window_args(url);
        assert_eq!(args[0], format!("--app={url}"));
        assert!(args.iter().any(|arg| arg == "--window-size=520,760"));
    }

    #[test]
    fn firefox_abre_janela_nova() {
        let args = firefox_window_args("https://exemplo/x");
        assert_eq!(args, vec!["-new-window".to_string(), "https://exemplo/x".to_string()]);
    }

    /// A URL de autorização tem `&`; sem aspas o `cmd` cortaria a linha ali.
    #[cfg(target_os = "windows")]
    #[test]
    fn url_de_autorizacao_vai_entre_aspas_no_windows() {
        let url = "https://projeto.supabase.co/auth/v1/authorize?provider=google&state=abc";
        assert_eq!(windows_url_arg(url), format!("\"{url}\""));
    }

    /// Prova de verdade do `cmd`: com a URL entre aspas, o `&` chega inteiro ao
    /// programa aberto; sem elas, o `cmd` corta em `&state=` e tenta rodar o
    /// resto como comando. Usa `echo` no lugar do `start` para poder ler a saída.
    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_recebe_a_url_inteira_com_ampersand() {
        use std::os::windows::process::CommandExt;

        let url = "https://projeto.supabase.co/auth/v1/authorize?provider=google&state=abc";
        let saida = std::process::Command::new("cmd")
            .args(["/C", "echo", ""])
            .raw_arg(windows_url_arg(url))
            .output()
            .expect("rodar cmd");
        let texto = String::from_utf8_lossy(&saida.stdout);
        assert!(
            texto.contains("provider=google&state=abc"),
            "o cmd cortou a URL: {texto}"
        );
    }

    /// O caminho real da porta: alguém conecta em 127.0.0.1 e manda o GET do
    /// navegador. Prova a escuta, a leitura da linha de requisição, a resposta
    /// HTML e a extração do código — tudo sem abrir navegador.
    #[test]
    fn callback_na_porta_real_e_recebido() {
        use std::io::Write;

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("porta");
        let porta = listener.local_addr().expect("endereco").port();
        let espera = std::thread::spawn(move || wait_for_callback(&listener, "estado-certo"));

        let mut navegador = TcpStream::connect(("127.0.0.1", porta)).expect("conectar");
        navegador
            .write_all(b"GET /?code=abc123&state=estado-certo HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .expect("enviar");
        let mut resposta = [0u8; 512];
        let lidos = navegador.read(&mut resposta).expect("ler");
        let texto = String::from_utf8_lossy(&resposta[..lidos]);
        assert!(texto.contains("200 OK"));
        assert!(texto.contains("Conta conectada"));

        assert_eq!(espera.join().expect("thread").expect("codigo"), "abc123");
    }

    #[test]
    fn callback_com_state_errado_nao_entrega_codigo() {
        use std::io::Write;

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("porta");
        let porta = listener.local_addr().expect("endereco").port();
        let espera = std::thread::spawn(move || wait_for_callback(&listener, "esperado"));

        let mut navegador = TcpStream::connect(("127.0.0.1", porta)).expect("conectar");
        navegador
            .write_all(b"GET /?code=abc123&state=forjado HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .expect("enviar");

        assert!(espera.join().expect("thread").is_err());
    }

    /// Fluxo real até a troca: sem navegador, o código é inválido — o que
    /// provamos aqui é que a chamada sai com os parâmetros certos e o erro volta
    /// traduzido (não como pânico nem como erro de rede).
    #[test]
    #[ignore = "rede: fala com o Supabase de verdade"]
    fn live_troca_recusa_codigo_inventado() {
        let (Ok(url), Ok(key)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY");
        };
        let token_url = endpoint(&url, "/auth/v1/token?grant_type=pkce").expect("endpoint");
        let response = client()
            .expect("cliente")
            .post(token_url)
            .header("apikey", key)
            .json(&json!({ "auth_code": "codigo-inventado", "code_verifier": random_verifier() }))
            .send()
            .expect("resposta");
        assert!(!response.status().is_success(), "código inventado não pode entrar");
        let mensagem = friendly_error(response.status().as_u16(), &json_body(response));
        assert!(!mensagem.is_empty());
    }
}
