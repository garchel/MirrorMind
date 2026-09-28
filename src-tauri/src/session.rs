//! Sessao da conta MirrorMind (fundacao de monetizacao, F1): tokens de acesso
//! e atualizacao no OS keyring, nunca em plaintext. Reusa o selo
//! `CredentialStore` das credenciais de IA; os fluxos (PKCE, refresh,
//! telas) chegam na F1b com o backend.

use crate::review::credentials::CredentialStore;
use anyhow::{bail, Result};

const SESSION_ACCESS_ACCOUNT: &str = "session-access-token";
const SESSION_REFRESH_ACCOUNT: &str = "session-refresh-token";
const MIN_TOKEN_LENGTH: usize = 16;
const MAX_TOKEN_LENGTH: usize = 8_192;

/// Par de tokens da sessao (Supabase Auth: JWT de acesso + refresh opaco).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
}

fn validate_token(token: &str, what: &str) -> Result<String> {
    let token = token.trim().to_string();
    if token.len() < MIN_TOKEN_LENGTH
        || token.len() > MAX_TOKEN_LENGTH
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\\'))
    {
        bail!("O token de {} e invalido.", what);
    }
    Ok(token)
}

/// Persiste a sessao apos login/refresh. Tokens anteriores sao substituidos.
pub fn save_session(
    store: &dyn CredentialStore,
    access_token: &str,
    refresh_token: &str,
) -> Result<()> {
    let access_token = validate_token(access_token, "acesso")?;
    let refresh_token = validate_token(refresh_token, "atualizacao")?;
    store
        .set_secret(SESSION_ACCESS_ACCOUNT, &access_token)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel salvar a sessao com seguranca."))?;
    store
        .set_secret(SESSION_REFRESH_ACCOUNT, &refresh_token)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel salvar a sessao com seguranca."))?;
    Ok(())
}

/// Le a sessao (`None` = deslogado). Token corrompido e erro: o chamador
/// desloga em vez de operar com credencial invalida.
pub fn load_session(store: &dyn CredentialStore) -> Result<Option<Session>> {
    let access_token = store
        .get_secret(SESSION_ACCESS_ACCOUNT)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel acessar a sessao com seguranca."))?;
    let refresh_token = store
        .get_secret(SESSION_REFRESH_ACCOUNT)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel acessar a sessao com seguranca."))?;
    match (access_token, refresh_token) {
        (Some(access_token), Some(refresh_token)) => {
            let access_token = validate_token(&access_token, "acesso")
                .map_err(|_| anyhow::anyhow!("A sessao armazenada e invalida."))?;
            let refresh_token = validate_token(&refresh_token, "atualizacao")
                .map_err(|_| anyhow::anyhow!("A sessao armazenada e invalida."))?;
            Ok(Some(Session {
                access_token,
                refresh_token,
            }))
        }
        // Par incompleto nao e sessao valida: limpa o restante.
        _ => {
            let _ = store.delete_secret(SESSION_ACCESS_ACCOUNT);
            let _ = store.delete_secret(SESSION_REFRESH_ACCOUNT);
            Ok(None)
        }
    }
}

/// Encerra a sessao (logout + excluir conta local): ausente = sucesso.
pub fn clear_session(store: &dyn CredentialStore) -> Result<()> {
    store
        .delete_secret(SESSION_ACCESS_ACCOUNT)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel encerrar a sessao com seguranca."))?;
    store
        .delete_secret(SESSION_REFRESH_ACCOUNT)
        .map_err(|_| anyhow::anyhow!("Nao foi possivel encerrar a sessao com seguranca."))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryCredentialStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn set_secret(&self, account: &str, secret: &str) -> Result<()> {
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

    const ACCESS: &str = "eyJhbGciOiJIUzI1NiJ9.c3Vzc2lvbi1hY2Nlc3M.dGVzdA";
    const REFRESH: &str = "refresh-token-opaco-comprido-1234567890";

    #[test]
    fn session_roundtrips_through_the_secure_store() {
        let store = MemoryCredentialStore::default();
        assert_eq!(load_session(&store).expect("load empty"), None);
        save_session(&store, ACCESS, REFRESH).expect("save session");
        assert_eq!(
            load_session(&store).expect("load session"),
            Some(Session {
                access_token: ACCESS.to_string(),
                refresh_token: REFRESH.to_string(),
            })
        );
        clear_session(&store).expect("clear session");
        assert_eq!(load_session(&store).expect("load cleared"), None);
    }

    #[test]
    fn session_rejects_blank_or_short_tokens() {
        let store = MemoryCredentialStore::default();
        assert!(save_session(&store, "   ", REFRESH).is_err());
        assert!(save_session(&store, "curto", REFRESH).is_err());
        assert!(save_session(&store, ACCESS, "").is_err());
        assert_eq!(load_session(&store).expect("nothing stored"), None);
    }

    #[test]
    fn partial_session_is_discarded_not_returned() {
        let store = MemoryCredentialStore::default();
        store
            .set_secret(SESSION_ACCESS_ACCOUNT, ACCESS)
            .expect("partial write");
        assert_eq!(load_session(&store).expect("load partial"), None);
        // O orfao foi limpo junto.
        assert_eq!(load_session(&store).expect("load again"), None);
    }
}
