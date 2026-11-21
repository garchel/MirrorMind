//! Sessao da conta MirrorMind (fundacao de monetizacao, F1): tokens de acesso
//! e atualizacao no OS keyring, nunca em plaintext. Reusa o selo
//! `CredentialStore` das credenciais de IA; os fluxos (PKCE, refresh,
//! telas) chegam na F1b com o backend.

use crate::review::credentials::CredentialStore;
use anyhow::{bail, Result};
use serde::Serialize;

const SESSION_ACCESS_ACCOUNT: &str = "session-access-token";
const SESSION_REFRESH_ACCOUNT: &str = "session-refresh-token";
/// Piso do tamanho: o refresh token do Supabase Auth e opaco e **curto** —
/// 12 caracteres no formato observado em 2026-11. O minimo aqui serve para
/// recusar vazio/lixo, nao para medir entropia (essa e do servidor).
const MIN_TOKEN_LENGTH: usize = 8;
const MAX_TOKEN_LENGTH: usize = 8_192;
/// Uma credencial genérica do Windows aceita no máximo 5 × 512 = 2.560 bytes.
/// O JWT de acesso emitido quando a conta entra pelo **Google** passa disso — ele
/// carrega os claims do perfil do provedor. Medido no login real: o `set_password`
/// falhava e a pessoa via "não foi possível salvar a sessão" depois de autorizar.
/// Por isso o token vai em pedaços, cada um numa entrada própria; a primeira usa o
/// nome histórico, então uma sessão antiga (token curto) continua legível.
const CHUNK_SIZE: usize = 2_000;
const MAX_CHUNKS: usize = 5;

/// Par de tokens da sessao (Supabase Auth: JWT de acesso + refresh opaco).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

/// Nomes das entradas de um token (a 1ª é a histórica, sem sufixo).
fn nomes_de_pedacos(base: &str) -> Vec<String> {
    let mut nomes = vec![base.to_string()];
    for indice in 2..=MAX_CHUNKS {
        nomes.push(format!("{base}-{indice}"));
    }
    nomes
}

/// Grava o token em pedaços, apagando as sobras de uma sessão anterior maior.
fn gravar_em_pedacos(store: &dyn CredentialStore, base: &str, token: &str) -> Result<()> {
    let nomes = nomes_de_pedacos(base);
    let pedacos: Vec<&[u8]> = token.as_bytes().chunks(CHUNK_SIZE).collect();
    if pedacos.len() > nomes.len() {
        bail!("A sessao e grande demais para o armazenamento seguro do sistema.");
    }
    for (indice, pedaco) in pedacos.iter().enumerate() {
        // O token é ASCII (validado acima), então todo pedaço é UTF-8 válido.
        let texto = std::str::from_utf8(pedaco)
            .map_err(|_| anyhow::anyhow!("O token de sessao e invalido."))?;
        // O motivo do sistema vai junto: "não foi possível salvar" sozinho custou
        // uma rodada de investigação no login real (era o limite do Windows).
        store.set_secret(&nomes[indice], texto).map_err(|erro| {
            anyhow::anyhow!("Nao foi possivel salvar a sessao com seguranca: {erro}")
        })?;
    }
    for nome in &nomes[pedacos.len()..] {
        let _ = store.delete_secret(nome);
    }
    Ok(())
}

/// Junta os pedaços presentes; `None` quando não há nenhum.
fn ler_em_pedacos(store: &dyn CredentialStore, base: &str) -> Result<Option<String>> {
    let mut token = String::new();
    for nome in nomes_de_pedacos(base) {
        match store
            .get_secret(&nome)
            .map_err(|_| anyhow::anyhow!("Nao foi possivel acessar a sessao com seguranca."))?
        {
            Some(pedaco) => token.push_str(&pedaco),
            None => break,
        }
    }
    if token.is_empty() {
        Ok(None)
    } else {
        Ok(Some(token))
    }
}

/// Persiste a sessao apos login/refresh. Tokens anteriores sao substituidos.
pub fn save_session(
    store: &dyn CredentialStore,
    access_token: &str,
    refresh_token: &str,
) -> Result<()> {
    let access_token = validate_token(access_token, "acesso")?;
    let refresh_token = validate_token(refresh_token, "atualizacao")?;
    gravar_em_pedacos(store, SESSION_ACCESS_ACCOUNT, &access_token)?;
    gravar_em_pedacos(store, SESSION_REFRESH_ACCOUNT, &refresh_token)?;
    Ok(())
}

/// Le a sessao (`None` = deslogado). Token corrompido e erro: o chamador
/// desloga em vez de operar com credencial invalida.
pub fn load_session(store: &dyn CredentialStore) -> Result<Option<Session>> {
    let access_token = ler_em_pedacos(store, SESSION_ACCESS_ACCOUNT)?;
    let refresh_token = ler_em_pedacos(store, SESSION_REFRESH_ACCOUNT)?;
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
            for nome in nomes_de_pedacos(SESSION_ACCESS_ACCOUNT) {
                let _ = store.delete_secret(&nome);
            }
            for nome in nomes_de_pedacos(SESSION_REFRESH_ACCOUNT) {
                let _ = store.delete_secret(&nome);
            }
            Ok(None)
        }
    }
}

/// Encerra a sessao (logout + excluir conta local): ausente = sucesso.
pub fn clear_session(store: &dyn CredentialStore) -> Result<()> {
    for base in [SESSION_ACCESS_ACCOUNT, SESSION_REFRESH_ACCOUNT] {
        for nome in nomes_de_pedacos(base) {
            store
                .delete_secret(&nome)
                .map_err(|_| anyhow::anyhow!("Nao foi possivel encerrar a sessao com seguranca."))?;
        }
    }
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

    /// Imita o limite do Windows: uma credencial genérica recusa mais de 2.560
    /// bytes. É o que fazia o login pelo Google falhar depois de autorizar.
    struct LimitedCredentialStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl LimitedCredentialStore {
        fn new() -> Self {
            Self {
                values: Mutex::new(HashMap::new()),
            }
        }
    }

    impl CredentialStore for LimitedCredentialStore {
        fn set_secret(&self, account: &str, secret: &str) -> Result<()> {
            if secret.len() > 2_560 {
                anyhow::bail!("credencial grande demais");
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
    fn token_maior_que_a_credencial_do_windows_vai_em_pedacos() {
        // 6.000 caracteres: o dobro do limite de 2.560 da credencial genérica.
        let grande = format!("eyJ{}.{}", "a".repeat(5_900), "b".repeat(80));
        let store = LimitedCredentialStore::new();

        save_session(&store, &grande, "refresh-curto").expect("gravar em pedaços");
        let sessao = load_session(&store).expect("ler").expect("sessao");

        assert_eq!(sessao.access_token, grande);
        assert_eq!(sessao.refresh_token, "refresh-curto");
        // e não sobrou pedaço vazio de graça
        assert_eq!(store.values.lock().unwrap().len(), 4);
    }

    #[test]
    fn sessao_menor_depois_apaga_pedacos_antigos() {
        let grande = format!("eyJ{}.{}", "a".repeat(5_900), "b".repeat(80));
        let store = LimitedCredentialStore::new();
        save_session(&store, &grande, "refresh-curto").expect("gravar");

        save_session(&store, "token-curto", "refresh-curto").expect("regravar");
        let sessao = load_session(&store).expect("ler").expect("sessao");

        assert_eq!(sessao.access_token, "token-curto");
        // sem sobras: se um pedaço antigo ficasse, o token voltaria concatenado errado
        assert_eq!(sessao.access_token.len(), "token-curto".len());
    }

    #[test]
    fn encerrar_sessao_apaga_todos_os_pedacos() {
        let grande = format!("eyJ{}.{}", "a".repeat(5_900), "b".repeat(80));
        let store = LimitedCredentialStore::new();
        save_session(&store, &grande, "refresh-curto").expect("gravar");

        clear_session(&store).expect("limpar");
        assert!(load_session(&store).expect("ler").is_none());
        assert!(store.values.lock().unwrap().is_empty());
    }
}
