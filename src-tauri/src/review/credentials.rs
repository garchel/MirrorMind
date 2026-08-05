use anyhow::{anyhow, bail, Result};
use keyring::{Entry, Error as KeyringError};
use std::sync::Mutex;

const SERVICE_NAME: &str = "com.mirrormind.desktop";
const GEMINI_ACCOUNT: &str = "gemini-api-key";
const GEMINI_CONSENT_ACCOUNT: &str = "gemini-content-consent-v1";
const CONSENT_MARKER: &str = "accepted";
const MIN_CREDENTIAL_LENGTH: usize = 16;
const MAX_CREDENTIAL_LENGTH: usize = 4_096;

pub trait CredentialStore: Send + Sync {
    fn set_secret(&self, account: &str, secret: &str) -> Result<()>;
    fn get_secret(&self, account: &str) -> Result<Option<String>>;
    fn delete_secret(&self, account: &str) -> Result<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CredentialStatus {
    pub gemini_configured: bool,
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
        Entry::new(SERVICE_NAME, account)
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
pub fn delete_gemini_api_key(store: &dyn CredentialStore) -> Result<()> {
    store
        .delete_secret(GEMINI_ACCOUNT)
        .map_err(|_| anyhow!("Nao foi possivel remover a chave do Gemini com seguranca."))
}

pub fn credential_status(store: &dyn CredentialStore) -> Result<CredentialStatus> {
    Ok(CredentialStatus {
        gemini_configured: load_gemini_api_key(store)?.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        credential_status, delete_gemini_api_key, has_gemini_consent, load_gemini_api_key,
        save_gemini_api_key, set_gemini_consent, CredentialStore, GEMINI_ACCOUNT,
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
}
