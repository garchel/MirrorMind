use anyhow::{anyhow, bail, Result};
use keyring::{Entry, Error as KeyringError};
use std::sync::Mutex;

const SERVICE_NAME: &str = "com.mirrormind.desktop";
const GEMINI_ACCOUNT: &str = "gemini-api-key";
const GEMINI_CONSENT_ACCOUNT: &str = "gemini-content-consent-v1";
const OPENAI_COMPATIBLE_BASE_URL_ACCOUNT: &str = "openai-compatible-base-url";
/// Endereco e modelo do Ollama local. Ficam no mesmo cofre dos demais provedores
/// (nao sao segredos, mas o cofre ja e o lugar das preferencias de IA).
const OLLAMA_ENDPOINT_ACCOUNT: &str = "ollama-endpoint";
const OLLAMA_MODEL_ACCOUNT: &str = "ollama-model";
const OPENAI_COMPATIBLE_MODEL_ACCOUNT: &str = "openai-compatible-model";
const OPENAI_COMPATIBLE_API_KEY_ACCOUNT: &str = "openai-compatible-api-key";
const OPENAI_CONSENT_ACCOUNT: &str = "openai-compatible-consent-v1";
const TYPESAFE_API_KEY_ACCOUNT: &str = "typesafe-api-key";
const TYPESAFE_CONSENT_ACCOUNT: &str = "typesafe-content-consent-v1";
const CONSENT_MARKER: &str = "accepted";
const MIN_CREDENTIAL_LENGTH: usize = 16;
const MAX_CREDENTIAL_LENGTH: usize = 4_096;
const MAX_BASE_URL_LENGTH: usize = 512;
const MAX_MODEL_LENGTH: usize = 256;

pub trait CredentialStore: Send + Sync {
    fn set_secret(&self, account: &str, secret: &str) -> Result<()>;
    fn get_secret(&self, account: &str) -> Result<Option<String>>;
    fn delete_secret(&self, account: &str) -> Result<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CredentialStatus {
    pub gemini_configured: bool,
    pub typesafe_configured: bool,
}

/// De quem e a chave de IA que esta no cofre agora.
///
/// A chave nao e da maquina: numa maquina dividida, a chave do Gemini de uma pessoa
/// nao pode pagar a revisao da outra. Sem escopo (convidado sem identidade, ou app
/// recem-instalado), o nome fica o antigo — nada quebra para quem ja configurou.
static SCOPE: Mutex<Option<String>> = Mutex::new(None);

pub fn set_scope(scope: Option<String>) {
    if let Ok(mut guard) = SCOPE.lock() {
        *guard = scope;
    }
}

pub fn current_scope() -> Option<String> {
    SCOPE.lock().ok().and_then(|guard| guard.clone())
}

/// Conta logada manda; sem conta, vale a identidade local que entrou no vault.
pub fn set_scope_for_identity(identity_id: &str) {
    if let Some(conta) = session_account_id() {
        set_scope(Some(format!("conta:{conta}")));
        return;
    }
    set_scope(Some(format!("pessoa:{identity_id}")));
}

/// Recalcula o escopo a partir da sessao (login, restauracao, saida).
pub fn refresh_from_session() {
    match session_account_id() {
        Some(conta) => set_scope(Some(format!("conta:{conta}"))),
        None => set_scope(None),
    }
}

fn session_account_id() -> Option<String> {
    let sessao = crate::account::load_session().ok()??;
    crate::account::account_id_from_jwt(&sessao.access_token)
}

/// Nome do segredo no cofre, com o dono junto quando se sabe quem e.
fn scoped_account(account: &str, scope: Option<&str>) -> String {
    match scope {
        Some(escopo) if !escopo.is_empty() => format!("{account}@{escopo}"),
        _ => account.to_string(),
    }
}

/// Cofre **sem** escopo: o token de sessão não pertence a uma pessoa, ele
/// *define* quem é a pessoa.
///
/// Guardar a sessão com o sufixo do escopo dá o pior bug possível: entrar com
/// identidade local grava o token em `session-access-token@pessoa:X`, e na
/// abertura seguinte — escopo vazio, antes de qualquer login — o app não acha
/// nada e pede login de novo. Por isso a sessão usa nomes globais, sempre.
#[derive(Debug, Default)]
pub struct UnscopedCredentialStore {
    access: Mutex<()>,
}

impl UnscopedCredentialStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn entry(account: &str) -> Result<Entry> {
        Entry::new(SERVICE_NAME, account)
            .map_err(|_| anyhow!("O armazenamento seguro do sistema nao esta disponivel."))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.access
            .lock()
            .map_err(|_| anyhow!("O armazenamento seguro esta temporariamente indisponivel."))
    }
}

impl CredentialStore for UnscopedCredentialStore {
    fn set_secret(&self, account: &str, secret: &str) -> Result<()> {
        let _guard = self.lock()?;
        Self::entry(account)?
            .set_password(secret)
            .map_err(|_| anyhow!("Nao foi possivel salvar a credencial no sistema."))
    }

    fn get_secret(&self, account: &str) -> Result<Option<String>> {
        let _guard = self.lock()?;
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(anyhow!(
                "Nao foi possivel ler a credencial do armazenamento seguro."
            )),
        }
    }

    fn delete_secret(&self, account: &str) -> Result<()> {
        let _guard = self.lock()?;
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(anyhow!(
                "Nao foi possivel remover a credencial do armazenamento seguro."
            )),
        }
    }
}

#[derive(Debug, Default)]
pub struct NativeCredentialStore {
    access: Mutex<()>,
}

impl NativeCredentialStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn entry(account: &str) -> Result<Entry> {
        let nome = scoped_account(account, current_scope().as_deref());
        Entry::new(SERVICE_NAME, &nome)
            .map_err(|_| anyhow!("O armazenamento seguro do sistema nao esta disponivel."))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.access
            .lock()
            .map_err(|_| anyhow!("O armazenamento seguro esta temporariamente indisponivel."))
    }
}

impl CredentialStore for NativeCredentialStore {
    fn set_secret(&self, account: &str, secret: &str) -> Result<()> {
        let _guard = self.lock()?;
        Self::entry(account)?
            .set_password(secret)
            .map_err(|_| anyhow!("Nao foi possivel salvar a credencial no sistema."))
    }

    fn get_secret(&self, account: &str) -> Result<Option<String>> {
        let _guard = self.lock()?;
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(anyhow!(
                "Nao foi possivel ler a credencial do armazenamento seguro."
            )),
        }
    }

    fn delete_secret(&self, account: &str) -> Result<()> {
        let _guard = self.lock()?;
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(anyhow!(
                "Nao foi possivel remover a credencial do armazenamento seguro."
            )),
        }
    }
}

pub fn save_gemini_api_key(store: &dyn CredentialStore, api_key: &str) -> Result<()> {
    let api_key = validate_gemini_api_key(api_key)?;
    store
        .set_secret(GEMINI_ACCOUNT, api_key)
        .map_err(|_| anyhow!("Nao foi possivel salvar a chave do Gemini com seguranca."))
}

pub(crate) fn validate_gemini_api_key(api_key: &str) -> Result<&str> {
    let api_key = api_key.trim();
    if api_key.len() < MIN_CREDENTIAL_LENGTH
        || api_key.len() > MAX_CREDENTIAL_LENGTH
        || !api_key
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\\'))
    {
        bail!("A chave do Gemini e invalida.");
    }
    Ok(api_key)
}

pub fn load_gemini_api_key(store: &dyn CredentialStore) -> Result<Option<String>> {
    let stored = store
        .get_secret(GEMINI_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel acessar a chave do Gemini com seguranca."))?;
    stored
        .map(|secret| validate_gemini_api_key(&secret).map(str::to_owned))
        .transpose()
        .map_err(|_| anyhow!("A chave do Gemini armazenada e invalida."))
}

pub fn set_gemini_consent(store: &dyn CredentialStore, consent: bool) -> Result<()> {
    if consent {
        store
            .set_secret(GEMINI_CONSENT_ACCOUNT, CONSENT_MARKER)
            .map_err(|_| {
                anyhow!("Nao foi possivel salvar o consentimento do Gemini com seguranca.")
            })
    } else {
        store.delete_secret(GEMINI_CONSENT_ACCOUNT).map_err(|_| {
            anyhow!("Nao foi possivel remover o consentimento do Gemini com seguranca.")
        })
    }
}

pub fn has_gemini_consent(store: &dyn CredentialStore) -> Result<bool> {
    let marker = store
        .get_secret(GEMINI_CONSENT_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler o consentimento do Gemini com seguranca."))?;
    Ok(marker.as_deref() == Some(CONSENT_MARKER))
}

pub fn set_openai_compatible_consent(store: &dyn CredentialStore, consent: bool) -> Result<()> {
    if consent {
        store
            .set_secret(OPENAI_CONSENT_ACCOUNT, CONSENT_MARKER)
            .map_err(|_| {
                anyhow!("Nao foi possivel salvar o consentimento do servidor com seguranca.")
            })
    } else {
        store.delete_secret(OPENAI_CONSENT_ACCOUNT).map_err(|_| {
            anyhow!("Nao foi possivel remover o consentimento do servidor com seguranca.")
        })
    }
}

pub fn has_openai_compatible_consent(store: &dyn CredentialStore) -> Result<bool> {
    let marker = store
        .get_secret(OPENAI_CONSENT_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler o consentimento do servidor com seguranca."))?;
    Ok(marker.as_deref() == Some(CONSENT_MARKER))
}

pub fn delete_gemini_api_key(store: &dyn CredentialStore) -> Result<()> {
    store
        .delete_secret(GEMINI_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel remover a chave do Gemini com seguranca."))
}

// ---------------------------------------------------------------------------
// TypeSafe AI (System One / JEV)
// ---------------------------------------------------------------------------
//
// Nao ha base URL para configurar: o endpoint e fixo no codigo
// (`calibrated::typesafe::TYPESAFE_ENDPOINT`). Uma base URL variavel permitiria
// enviar a chave da TypeSafe para um servidor arbitrario escolhido por quem
// configure, entao a validacao de URL dos outros provedores se aplica aqui
// pela ausencia do parametro.

/// Valida a chave da TypeSafe AI. Mesmas restricoes de comprimento e charset da
/// chave do Gemini.
pub(crate) fn validate_typesafe_api_key(api_key: &str) -> Result<&str> {
    let api_key = api_key.trim();
    if api_key.len() < MIN_CREDENTIAL_LENGTH
        || api_key.len() > MAX_CREDENTIAL_LENGTH
        || !api_key
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\\'))
    {
        bail!("A chave da TypeSafe AI e invalida.");
    }
    Ok(api_key)
}

pub fn save_typesafe_api_key(store: &dyn CredentialStore, api_key: &str) -> Result<()> {
    let api_key = validate_typesafe_api_key(api_key)?;
    store
        .set_secret(TYPESAFE_API_KEY_ACCOUNT, api_key)
        .map_err(|_| anyhow!("Nao foi possivel salvar a chave da TypeSafe AI com seguranca."))
}

pub fn load_typesafe_api_key(store: &dyn CredentialStore) -> Result<Option<String>> {
    let stored = store
        .get_secret(TYPESAFE_API_KEY_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel acessar a chave da TypeSafe AI com seguranca."))?;
    stored
        .map(|secret| validate_typesafe_api_key(&secret).map(str::to_owned))
        .transpose()
        .map_err(|_| anyhow!("A chave da TypeSafe AI armazenada e invalida."))
}

pub fn delete_typesafe_api_key(store: &dyn CredentialStore) -> Result<()> {
    store
        .delete_secret(TYPESAFE_API_KEY_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel remover a chave da TypeSafe AI com seguranca."))
}

pub fn set_typesafe_consent(store: &dyn CredentialStore, consent: bool) -> Result<()> {
    if consent {
        store
            .set_secret(TYPESAFE_CONSENT_ACCOUNT, CONSENT_MARKER)
            .map_err(|_| {
                anyhow!("Nao foi possivel salvar o consentimento da TypeSafe AI com seguranca.")
            })
    } else {
        store.delete_secret(TYPESAFE_CONSENT_ACCOUNT).map_err(|_| {
            anyhow!("Nao foi possivel remover o consentimento da TypeSafe AI com seguranca.")
        })
    }
}

pub fn has_typesafe_consent(store: &dyn CredentialStore) -> Result<bool> {
    let marker = store.get_secret(TYPESAFE_CONSENT_ACCOUNT).map_err(|_| {
        anyhow!("Nao foi possivel ler o consentimento da TypeSafe AI com seguranca.")
    })?;
    Ok(marker.as_deref() == Some(CONSENT_MARKER))
}

pub(crate) fn validate_openai_compatible_base_url(base_url: &str) -> Result<&str> {
    let base_url = base_url.trim();
    if base_url.is_empty() || base_url.len() > MAX_BASE_URL_LENGTH {
        bail!("O endereco do servidor OpenAI-compatible e invalido.");
    }
    if let Some((scheme, rest)) = base_url.split_once("://") {
        if rest.is_empty() {
            bail!("O endereco do servidor precisa usar http ou https.");
        }
        // LGPD Art.46 — so permite http para localhost (desenvolvimento local
        // com Ollama/LM Studio). Qualquer host remoto exige TLS.
        let is_localhost = rest
            .split('/')
            .next()
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case("127.0.0.1")
            || rest
                .split('/')
                .next()
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("")
                .eq_ignore_ascii_case("localhost");
        if scheme == "https" {
            // ok
        } else if scheme == "http" && is_localhost {
            // ok — desenvolvimento local
        } else if scheme == "http" {
            bail!("Use https para servidores remotos. http e permitido apenas para 127.0.0.1/localhost.");
        } else {
            bail!("O endereco do servidor precisa usar http ou https.");
        }
    } else {
        bail!("O endereco do servidor precisa incluir o protocolo (http ou https).");
    }
    Ok(base_url)
}

pub(crate) fn validate_openai_compatible_model(model: &str) -> Result<&str> {
    let model = model.trim();
    if model.is_empty() || model.len() > MAX_MODEL_LENGTH {
        bail!("O modelo do servidor OpenAI-compatible e invalido.");
    }
    if model
        .bytes()
        .any(|byte| !byte.is_ascii_graphic() || matches!(byte, b'"' | b'\\'))
    {
        bail!("O modelo do servidor OpenAI-compatible e invalido.");
    }
    Ok(model)
}

/// Endereco do Ollama local: http so para loopback ou rede privada (o servico
/// roda na maquina do usuario; um host publico em http seria envio em claro).
pub(crate) fn validate_ollama_endpoint(endpoint: &str) -> Result<&str> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() || endpoint.len() > MAX_BASE_URL_LENGTH {
        bail!("O endereco do Ollama local e invalido.");
    }
    let Some((scheme, rest)) = endpoint.split_once("://") else {
        bail!("O endereco do Ollama precisa comecar com http:// ou https://.");
    };
    if scheme != "http" && scheme != "https" {
        bail!("O endereco do Ollama precisa usar http ou https.");
    }
    let host = rest
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if host.is_empty() {
        bail!("O endereco do Ollama precisa de um host.");
    }
    if scheme == "http" && !is_loopback_or_private(host) {
        bail!("Use https para um host publico; http so para localhost ou rede privada.");
    }
    Ok(endpoint)
}

fn is_loopback_or_private(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return true;
    }
    let mut partes = host.split('.');
    let Some(a) = partes.next().and_then(|v| v.parse::<u8>().ok()) else {
        return false;
    };
    let Some(b) = partes.next().and_then(|v| v.parse::<u8>().ok()) else {
        return false;
    };
    a == 10 || (a == 192 && b == 168) || (a == 172 && (16..=31).contains(&b))
}

/// Nome do modelo no Ollama (`qwen2.5:7b`, `llama3.2:3b`...): sem espacos.
pub(crate) fn validate_ollama_model(model: &str) -> Result<&str> {
    let model = model.trim();
    if model.is_empty() || model.len() > MAX_MODEL_LENGTH {
        bail!("O modelo do Ollama local e invalido.");
    }
    if model
        .bytes()
        .any(|byte| !byte.is_ascii_graphic() || matches!(byte, b'"' | b'\\'))
    {
        bail!("O modelo do Ollama local e invalido.");
    }
    Ok(model)
}

pub fn save_ollama_local_configuration(
    store: &dyn CredentialStore,
    endpoint: &str,
    model: &str,
) -> Result<()> {
    let endpoint = validate_ollama_endpoint(endpoint)?;
    let model = validate_ollama_model(model)?;
    store
        .set_secret(OLLAMA_ENDPOINT_ACCOUNT, endpoint)
        .and_then(|_| store.set_secret(OLLAMA_MODEL_ACCOUNT, model))
        .map_err(|_| anyhow!("Nao foi possivel salvar a configuracao do Ollama local."))
}

/// Ausente, corrompido ou invalido: devolve `None` e o chamador usa o padrao.
pub fn load_ollama_local_configuration(
    store: &dyn CredentialStore,
) -> Result<Option<(String, String)>> {
    let endpoint = store
        .get_secret(OLLAMA_ENDPOINT_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler a configuracao do Ollama local."))?;
    let model = store
        .get_secret(OLLAMA_MODEL_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler a configuracao do Ollama local."))?;
    let (Some(endpoint), Some(model)) = (endpoint, model) else {
        return Ok(None);
    };
    let (Ok(endpoint), Ok(model)) = (
        validate_ollama_endpoint(&endpoint),
        validate_ollama_model(&model),
    ) else {
        return Ok(None);
    };
    Ok(Some((endpoint.to_string(), model.to_string())))
}

pub fn save_openai_compatible_provider(
    store: &dyn CredentialStore,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<()> {
    let base_url = validate_openai_compatible_base_url(base_url)?;
    let model = validate_openai_compatible_model(model)?;
    let api_key = api_key.trim();
    if api_key.is_empty() || api_key.len() > MAX_CREDENTIAL_LENGTH {
        bail!("A chave do servidor OpenAI-compatible e invalida.");
    }
    store
        .set_secret(OPENAI_COMPATIBLE_BASE_URL_ACCOUNT, base_url)
        .and_then(|_| store.set_secret(OPENAI_COMPATIBLE_MODEL_ACCOUNT, model))
        .and_then(|_| store.set_secret(OPENAI_COMPATIBLE_API_KEY_ACCOUNT, api_key))
        .map_err(|_| anyhow!("Nao foi possivel salvar a configuracao do servidor com seguranca."))
}

pub fn delete_openai_compatible_provider(store: &dyn CredentialStore) -> Result<()> {
    store
        .delete_secret(OPENAI_COMPATIBLE_BASE_URL_ACCOUNT)
        .and_then(|_| {
            store
                .delete_secret(OPENAI_COMPATIBLE_MODEL_ACCOUNT)
                .and_then(|_| store.delete_secret(OPENAI_COMPATIBLE_API_KEY_ACCOUNT))
        })
        .map_err(|_| anyhow!("Nao foi possivel remover a configuracao do servidor com seguranca."))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiCompatibleConfiguration {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

/// Le a configuracao completa do provedor OpenAI-compatible; ausente ou
/// corrompida (inserida fora do app) retorna `None` sem vazar o segredo.
pub fn load_openai_compatible_provider(
    store: &dyn CredentialStore,
) -> Result<Option<OpenAiCompatibleConfiguration>> {
    let base_url = store
        .get_secret(OPENAI_COMPATIBLE_BASE_URL_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler a configuracao do servidor com seguranca."))?;
    let Some(base_url) = base_url else {
        return Ok(None);
    };
    let model = store
        .get_secret(OPENAI_COMPATIBLE_MODEL_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler a configuracao do servidor com seguranca."))?;
    let api_key = store
        .get_secret(OPENAI_COMPATIBLE_API_KEY_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel ler a chave do servidor com seguranca."))?;
    let (Some(model), Some(api_key)) = (model, api_key) else {
        return Ok(None);
    };
    let base_url = match validate_openai_compatible_base_url(&base_url) {
        Ok(valid) => valid.to_string(),
        Err(_) => return Ok(None),
    };
    let model = match validate_openai_compatible_model(&model) {
        Ok(valid) => valid.to_string(),
        Err(_) => return Ok(None),
    };
    Ok(Some(OpenAiCompatibleConfiguration {
        base_url,
        model,
        api_key,
    }))
}

pub fn credential_status(store: &dyn CredentialStore) -> Result<CredentialStatus> {
    Ok(CredentialStatus {
        gemini_configured: load_gemini_api_key(store)?.is_some(),
        typesafe_configured: load_typesafe_api_key(store)?.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        scoped_account, set_scope, current_scope, NativeCredentialStore, UnscopedCredentialStore,
        credential_status, delete_gemini_api_key, delete_openai_compatible_provider,
        delete_typesafe_api_key, has_gemini_consent, has_typesafe_consent, load_gemini_api_key,
        load_openai_compatible_provider, load_typesafe_api_key, save_gemini_api_key,
        save_openai_compatible_provider, save_typesafe_api_key, set_gemini_consent,
        set_typesafe_consent, CredentialStore, GEMINI_ACCOUNT, TYPESAFE_API_KEY_ACCOUNT,
    };
    use anyhow::{bail, Result};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryCredentialStore {
        values: Mutex<HashMap<String, String>>,
        fail_with_secret: Mutex<Option<String>>,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn set_secret(&self, account: &str, secret: &str) -> Result<()> {
            if let Some(message) = self.fail_with_secret.lock().expect("failure lock").clone() {
                bail!(message);
            }
            self.values
                .lock()
                .expect("values lock")
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn get_secret(&self, account: &str) -> Result<Option<String>> {
            Ok(self
                .values
                .lock()
                .expect("values lock")
                .get(account)
                .cloned())
        }

        fn delete_secret(&self, account: &str) -> Result<()> {
            self.values.lock().expect("values lock").remove(account);
            Ok(())
        }
    }

    #[test]
    fn stores_reads_reports_and_deletes_the_gemini_key() {
        let store = MemoryCredentialStore::default();
        save_gemini_api_key(&store, "  test-gemini-key-123  ").expect("save key");

        assert_eq!(
            load_gemini_api_key(&store).expect("load key").as_deref(),
            Some("test-gemini-key-123")
        );
        assert!(credential_status(&store).expect("status").gemini_configured);

        delete_gemini_api_key(&store).expect("delete key");
        assert!(!credential_status(&store).expect("status").gemini_configured);
        assert!(!store
            .values
            .lock()
            .expect("values lock")
            .contains_key(GEMINI_ACCOUNT));
    }

    #[test]
    fn stores_and_revokes_gemini_content_consent() {
        let store = MemoryCredentialStore::default();
        assert!(!has_gemini_consent(&store).expect("initial consent"));
        set_gemini_consent(&store, true).expect("save consent");
        assert!(has_gemini_consent(&store).expect("stored consent"));
        set_gemini_consent(&store, false).expect("revoke consent");
        assert!(!has_gemini_consent(&store).expect("revoked consent"));
    }
    #[test]
    fn rejects_empty_oversized_and_control_character_keys() {
        let store = MemoryCredentialStore::default();
        assert!(save_gemini_api_key(&store, "   ").is_err());
        assert!(save_gemini_api_key(&store, &"x".repeat(4_097)).is_err());
        assert!(save_gemini_api_key(&store, "key\nleak-invalid-123").is_err());
        assert!(save_gemini_api_key(&store, "invalid\"key\\value").is_err());
    }

    #[test]
    fn accepts_a_printable_key_without_assuming_a_provider_specific_format() {
        let store = MemoryCredentialStore::default();
        save_gemini_api_key(&store, "AIza.test-key:version/1").expect("save printable key");

        assert_eq!(
            load_gemini_api_key(&store).expect("load key").as_deref(),
            Some("AIza.test-key:version/1")
        );
    }
    #[test]
    fn never_includes_the_secret_in_public_errors() {
        let store = MemoryCredentialStore::default();
        let secret = "super-secret-provider-key";
        *store.fail_with_secret.lock().expect("failure lock") =
            Some(format!("backend leaked {secret}"));

        let error = save_gemini_api_key(&store, secret).expect_err("store failure");
        assert!(!error.to_string().contains(secret));
    }
    #[test]
    fn stores_reads_and_removes_the_open_ai_compatible_provider() {
        let store = MemoryCredentialStore::default();
        assert!(load_openai_compatible_provider(&store)
            .expect("initial load")
            .is_none());

        save_openai_compatible_provider(
            &store,
            "https://api.example.com/v1/",
            " my-model ",
            " sk-secret-key ",
        )
        .expect("save provider");

        let configuration = load_openai_compatible_provider(&store)
            .expect("load provider")
            .expect("configured");
        assert_eq!(configuration.base_url, "https://api.example.com/v1/");
        assert_eq!(configuration.model, "my-model");
        assert_eq!(configuration.api_key, "sk-secret-key");

        delete_openai_compatible_provider(&store).expect("remove provider");
        assert!(load_openai_compatible_provider(&store)
            .expect("load after remove")
            .is_none());
    }

    #[test]
    fn rejects_invalid_open_ai_compatible_endpoints_and_models() {
        let store = MemoryCredentialStore::default();
        assert!(save_openai_compatible_provider(&store, "ftp://host", "model", "key").is_err());
        assert!(save_openai_compatible_provider(&store, "sem-protocolo", "model", "key").is_err());
        assert!(
            save_openai_compatible_provider(&store, "https://host", "model\nquebrado", "key")
                .is_err()
        );
        assert!(save_openai_compatible_provider(&store, "https://host", "model", "  ").is_err());
        assert!(load_openai_compatible_provider(&store)
            .expect("nothing persisted")
            .is_none());
    }

    #[test]
    fn rejects_an_invalid_key_inserted_outside_the_application() {
        let store = MemoryCredentialStore::default();
        store
            .values
            .lock()
            .expect("values lock")
            .insert(GEMINI_ACCOUNT.to_string(), "invalid\nkey".to_string());

        let error = load_gemini_api_key(&store).expect_err("invalid external key");
        assert!(!error.to_string().contains("invalid\nkey"));
        assert!(credential_status(&store).is_err());
    }

    #[test]
    fn stores_reads_reports_and_deletes_the_typesafe_key() {
        let store = MemoryCredentialStore::default();
        save_typesafe_api_key(&store, "  typesk_teste_0123456789  ").expect("save key");

        assert_eq!(
            load_typesafe_api_key(&store).expect("load key").as_deref(),
            Some("typesk_teste_0123456789")
        );
        assert!(
            credential_status(&store)
                .expect("status")
                .typesafe_configured
        );

        delete_typesafe_api_key(&store).expect("delete key");
        assert!(
            !credential_status(&store)
                .expect("status")
                .typesafe_configured
        );
        assert!(!store
            .values
            .lock()
            .expect("values lock")
            .contains_key(TYPESAFE_API_KEY_ACCOUNT));
    }



    /// Mede no cofre real do Windows: duas contas na mesma máquina não dividem
    /// chave de IA.
    ///
    /// Usa as duas contas de teste criadas no projeto Supabase. Não faz rede: só
    /// forja o JWT (o app apenas decodifica o `sub`) e passa pelo mesmo caminho de
    /// gravação de sessão do login de verdade.
    #[test]
    #[ignore = "usa o cofre real do Windows"]
    fn live_duas_contas_nao_compartilham_chave_de_ia() {
        use crate::account;
        use crate::session;

        fn jwt_para(conta: &str) -> String {
            use base64::Engine;
            let cabecalho = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(r#"{"alg":"HS256","typ":"JWT"}"#);
            let corpo = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(
                r#"{{"sub":"{conta}","exp":4102444800}}"#
            ));
            format!("{cabecalho}.{corpo}.assinatura-de-teste")
        }

        const CONTA_A: &str = "5b7e228f-dc07-4b94-b9aa-11a3c3741c0a";
        const CONTA_B: &str = "f127c3c8-a88e-4267-86e6-33a255b073ea";
        const CHAVE_A: &str = "chave-da-conta-a-0001";
        const CHAVE_B: &str = "chave-da-conta-b-0002";

        let cofre_global = UnscopedCredentialStore::new();
        // Estado limpo: nada de sessão nem chave sobrando de rodada anterior.
        let _ = session::clear_session(&cofre_global);
        for conta in [CONTA_A, CONTA_B] {
            set_scope(Some(format!("conta:{conta}")));
            let _ = super::delete_gemini_api_key(&NativeCredentialStore::new());
        }
        set_scope(None);

        // Conta A entra e configura a chave dela.
        account::store_session(&jwt_para(CONTA_A), "refresh-conta-a").expect("sessao da conta A");
        assert_eq!(current_scope(), Some(format!("conta:{CONTA_A}")));
        super::save_gemini_api_key(&NativeCredentialStore::new(), CHAVE_A).expect("chave da A");
        assert_eq!(
            super::load_gemini_api_key(&NativeCredentialStore::new()).expect("ler A"),
            Some(CHAVE_A.to_string())
        );

        // Conta B entra na mesma máquina: não enxerga a chave da A.
        account::store_session(&jwt_para(CONTA_B), "refresh-conta-b").expect("sessao da conta B");
        assert_eq!(current_scope(), Some(format!("conta:{CONTA_B}")));
        assert_eq!(
            super::load_gemini_api_key(&NativeCredentialStore::new()).expect("ler B"),
            None,
            "a conta B nao pode herdar a chave da conta A"
        );
        super::save_gemini_api_key(&NativeCredentialStore::new(), CHAVE_B).expect("chave da B");

        // A volta e continua com a chave dela — a da B não sobrescreveu nada.
        account::store_session(&jwt_para(CONTA_A), "refresh-conta-a").expect("sessao da A de novo");
        assert_eq!(
            super::load_gemini_api_key(&NativeCredentialStore::new()).expect("ler A de novo"),
            Some(CHAVE_A.to_string())
        );

        // A sessão sobrevive a escopo nenhum (é o estado de uma abertura nova).
        set_scope(None);
        assert!(
            session::load_session(&cofre_global).expect("ler sessao").is_some(),
            "a sessao nao pode depender do escopo"
        );

        // Limpeza: o teste não deixa chave nem sessão na máquina.
        for conta in [CONTA_A, CONTA_B] {
            set_scope(Some(format!("conta:{conta}")));
            let _ = super::delete_gemini_api_key(&NativeCredentialStore::new());
        }
        let _ = session::clear_session(&cofre_global);
        set_scope(None);
    }

    #[test]
    fn segredo_do_cofre_leva_o_dono_no_nome() {
        // Duas pessoas na mesma maquina: chaves diferentes, sem sobrescrever.
        assert_eq!(
            scoped_account("gemini-api-key", Some("conta:abc")),
            "gemini-api-key@conta:abc"
        );
        assert_ne!(
            scoped_account("gemini-api-key", Some("conta:abc")),
            scoped_account("gemini-api-key", Some("pessoa:RZ9"))
        );
        // Sem escopo o nome e o antigo: quem ja configurou nao perde a chave.
        assert_eq!(scoped_account("gemini-api-key", None), "gemini-api-key");
        assert_eq!(scoped_account("gemini-api-key", Some("")), "gemini-api-key");
    }

    #[test]
    fn stores_and_revokes_typesafe_content_consent() {
        let store = MemoryCredentialStore::default();
        assert!(!has_typesafe_consent(&store).expect("initial consent"));
        set_typesafe_consent(&store, true).expect("save consent");
        assert!(has_typesafe_consent(&store).expect("stored consent"));
        set_typesafe_consent(&store, false).expect("revoke consent");
        assert!(!has_typesafe_consent(&store).expect("revoked consent"));
    }

    #[test]
    fn rejects_invalid_typesafe_keys_with_the_same_rules_as_the_others() {
        let store = MemoryCredentialStore::default();
        assert!(save_typesafe_api_key(&store, "   ").is_err());
        assert!(save_typesafe_api_key(&store, &"x".repeat(4_097)).is_err());
        assert!(save_typesafe_api_key(&store, "key\nleak-invalid-123").is_err());
        assert!(save_typesafe_api_key(&store, "invalid\"key\\value").is_err());
    }

    #[test]
    fn never_includes_the_typesafe_secret_in_public_errors() {
        let store = MemoryCredentialStore::default();
        let secret = "typesk-super-secret-value";
        *store.fail_with_secret.lock().expect("failure lock") =
            Some(format!("backend leaked {secret}"));

        let error = save_typesafe_api_key(&store, secret).expect_err("store failure");
        assert!(!error.to_string().contains(secret));
    }

    #[test]
    fn an_invalid_typesafe_key_inserted_outside_fails_loudly() {
        let store = MemoryCredentialStore::default();
        store
            .values
            .lock()
            .expect("values lock")
            .insert(TYPESAFE_API_KEY_ACCOUNT.to_string(), "curta".to_string());

        let error = load_typesafe_api_key(&store).expect_err("chave invalida externa");
        assert!(!error.to_string().contains("curta"));
        assert!(credential_status(&store).is_err());
    }
}
