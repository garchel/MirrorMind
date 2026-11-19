//! Comandos IPC da nuvem: o que a interface chama.
//!
//! Aqui vive a política que o executor não deve conhecer: quem é o dono, se há
//! sessão, qual vault da conta é este, e a **decisão de vínculo** — quando o
//! convidado já tem notas aqui e a conta já tem um vault na nuvem, nada é
//! escolhido no escuro: ele vê os dois lados e decide.
//!
//! Nenhum token atravessa o IPC: o comando pega o par do cofre do sistema, usa e
//! descarta. O frontend recebe contagens e o relatório do sync, nunca credencial.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;

use crate::cloud::{load_or_create_identity, random_id, save_identity, CloudIdentity};
use crate::cloud_api::{self, CloudAuth, HttpTransport};
use crate::cloud_sync::{run_sync, scan_local, SyncOptions, SyncReport};

/// Um vault que já existe na conta (para a tela de vínculo).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteVault {
    pub id: String,
    pub name: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    /// Há sessão utilizável (o add-on exige conta).
    pub signed_in: bool,
    /// Este vault já está ligado a um vault da nuvem.
    pub linked: bool,
    pub vault_name: String,
    /// Notas e anexos que subiriam daqui.
    pub local_files: usize,
    /// Arquivos já na nuvem para este vault (`None` = não ligado ou inacessível).
    pub remote_files: Option<usize>,
    /// Vaults que a conta já tem — a tela usa para oferecer "manter os dois".
    pub account_vaults: Vec<RemoteVault>,
    /// `true` quando vale perguntar antes de ligar: há dados dos dois lados.
    pub needs_choice: bool,
    /// ISO-8601 da última sincronização concluída deste vault.
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudReport {
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    pub conflicts: Vec<String>,
    pub deleted: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<FailItem>,
    pub bytes_up: u64,
    pub bytes_down: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailItem {
    pub path: String,
    pub reason: String,
}

impl From<SyncReport> for CloudReport {
    fn from(relatorio: SyncReport) -> Self {
        Self {
            uploaded: relatorio.uploaded,
            downloaded: relatorio.downloaded,
            conflicts: relatorio.conflicts,
            deleted: relatorio.deleted,
            skipped: relatorio.skipped,
            failed: relatorio
                .failed
                .into_iter()
                .map(|(path, reason)| FailItem { path, reason })
                .collect(),
            bytes_up: relatorio.bytes_up,
            bytes_down: relatorio.bytes_down,
        }
    }
}

/// Sessão + apikey para falar com a nuvem. O `snapshot` antes é de propósito: ele
/// renova o token quando está perto de expirar, então o que o cofre devolve aqui
/// está utilizável.
fn auth(base_url: &str, api_key: &str) -> Result<CloudAuth> {
    let retrato = crate::account::snapshot(base_url, api_key)?;
    if retrato.status != "auth" {
        bail!("Entre na sua conta para usar a nuvem.");
    }
    let sessao = crate::account::load_session()?
        .ok_or_else(|| anyhow::anyhow!("A sessão expirou. Entre na conta de novo."))?;
    Ok(CloudAuth {
        base_url: base_url.to_string(),
        api_key: api_key.to_string(),
        access_token: sessao.access_token,
    })
}

fn vault_name(vault_root: &Path) -> String {
    vault_root
        .file_name()
        .and_then(|nome| nome.to_str())
        .unwrap_or("Vault")
        .to_string()
}

fn local_file_count(vault_root: &Path) -> usize {
    scan_local(vault_root, &SyncOptions::default())
        .map(|arquivos| arquivos.len())
        .unwrap_or(0)
}

fn transport(auth: CloudAuth, vault_id: String) -> Result<HttpTransport> {
    HttpTransport::new(auth, vault_id)
}

/// Retrato para a tela: ligado? quanto de cada lado? já existe dado na conta?
pub fn status(vault_root: &Path, base_url: &str, api_key: &str) -> Result<CloudStatus> {
    let identidade = load_or_create_identity(vault_root, &vault_name(vault_root))?;
    let local_files = local_file_count(vault_root);

    let Ok(auth) = auth(base_url, api_key) else {
        // Sem sessão ainda dá para dizer o que existe aqui.
        return Ok(CloudStatus {
            signed_in: false,
            linked: identidade.vault_id.is_some(),
            vault_name: identidade.name,
            local_files,
            remote_files: None,
            account_vaults: Vec::new(),
            needs_choice: false,
            last_synced_at: None,
        });
    };

    let linhas = cloud_api::list_vaults(&auth).unwrap_or_default();
    let last_synced_at = identidade
        .vault_id
        .as_ref()
        .and_then(|id| linhas.iter().find(|linha| &linha.id == id))
        .and_then(|linha| linha.last_synced_at.clone());
    let account_vaults: Vec<RemoteVault> = linhas
        .into_iter()
        .map(|linha| RemoteVault {
            id: linha.id,
            name: linha.name,
            files: linha.files,
        })
        .collect();
    let remote_files = identidade
        .vault_id
        .as_ref()
        .and_then(|id| cloud_api::list_files(&auth, id).ok())
        .map(|arquivos| arquivos.iter().filter(|arquivo| !arquivo.deleted).count());

    // Só vale perguntar quando há trabalho dos dois lados e este vault ainda não
    // está ligado: depois de ligado, o motor já sabe resolver sozinho.
    let needs_choice = identidade.vault_id.is_none()
        && local_files > 0
        && account_vaults.iter().any(|vault| vault.files > 0);

    Ok(CloudStatus {
        signed_in: true,
        linked: identidade.vault_id.is_some(),
        vault_name: identidade.name,
        local_files,
        remote_files,
        account_vaults,
        needs_choice,
        last_synced_at,
    })
}

/// Liga este vault a um vault da nuvem.
///
/// `strategy`:
/// - `merge` — o mesmo vault dos dois lados: o motor compara e cria cópias de
///   conflito onde os dois mudaram (nada é escolhido aqui);
/// - `separate` — "manter os dois": um `local_id` novo, então a nuvem trata este
///   como outro vault e nada é mesclado.
pub fn link(
    vault_root: &Path,
    base_url: &str,
    api_key: &str,
    strategy: &str,
) -> Result<CloudStatus> {
    let auth = auth(base_url, api_key)?;
    let mut identidade = load_or_create_identity(vault_root, &vault_name(vault_root))?;

    if strategy == "separate" {
        // Identidade nova = vault novo na nuvem. O `vault_id` antigo é esquecido,
        // mas a pasta continua com todos os arquivos.
        identidade = CloudIdentity {
            local_id: random_id(),
            vault_id: None,
            name: identidade.name,
        };
        save_identity(vault_root, &identidade)?;
    } else if strategy != "merge" {
        bail!("Estratégia de vínculo desconhecida: {strategy}");
    }

    let vault_id = cloud_api::register_vault(&auth, &identidade.local_id, &identidade.name)?;
    identidade.vault_id = Some(vault_id);
    save_identity(vault_root, &identidade)?;

    status(vault_root, base_url, api_key)
}

/// Desliga este vault da nuvem. Não apaga nada: o conteúdo da nuvem fica, e o
/// local também. Serve para trocar de vault na nuvem sem sincronizar por engano.
pub fn unlink(vault_root: &Path) -> Result<CloudStatus> {
    let mut identidade = load_or_create_identity(vault_root, &vault_name(vault_root))?;
    identidade.vault_id = None;
    // `local_id` novo: religar deve perguntar de novo em vez de herdar uma base
    // de sincronização que já não corresponde a nada.
    identidade.local_id = random_id();
    save_identity(vault_root, &identidade)?;
    Ok(CloudStatus {
        signed_in: false,
        linked: false,
        vault_name: identidade.name,
        local_files: local_file_count(vault_root),
        remote_files: None,
        account_vaults: Vec::new(),
        needs_choice: false,
        last_synced_at: None,
    })
}

/// Impede dois ciclos simultâneos no mesmo processo.
///
/// A sincronização automática pode ser disparada pelo app abrindo, pelo salvamento
/// de uma nota e pelo botão — ao mesmo tempo. Dois ciclos concorrentes sobre o
/// mesmo arquivo de estado não corrompem nada (as escritas são atômicas e o plano
/// é idempotente), mas multiplicam uploads e podem produzir duas cópias de
/// conflito para a mesma divergência. Uma trava simples resolve.
static SYNC_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct SyncGuard;

impl SyncGuard {
    fn acquire() -> Result<Self> {
        use std::sync::atomic::Ordering;
        if SYNC_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            bail!("Uma sincronização já está em andamento.");
        }
        Ok(Self)
    }
}

impl Drop for SyncGuard {
    fn drop(&mut self) {
        SYNC_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

pub fn sync(
    vault_root: &Path,
    base_url: &str,
    api_key: &str,
    options: &SyncOptions,
) -> Result<CloudReport> {
    let _guarda = SyncGuard::acquire()?;
    let auth = auth(base_url, api_key)?;
    let identidade = load_or_create_identity(vault_root, &vault_name(vault_root))?;
    let Some(vault_id) = identidade.vault_id else {
        bail!("Este vault ainda não está ligado à nuvem.");
    };
    let marcador = auth.clone();
    let transporte = transport(auth, vault_id.clone())?;
    let relatorio = run_sync(vault_root, &transporte, options)?;

    // A data só é gravada quando o ciclo terminou sem falha de rede — o ciclo pode
    // ter arquivos que falharam individualmente, e isso não é "sincronizado".
    if !relatorio.uploaded.is_empty()
        || !relatorio.downloaded.is_empty()
        || !relatorio.conflicts.is_empty()
        || !relatorio.deleted.is_empty()
        || relatorio.failed.is_empty()
    {
        let _ = cloud_api::touch_vault_synced(&marcador, &vault_id);
    }

    Ok(relatorio.into())
}

// -----------------------------------------------------------------------------
// Comandos Tauri
// -----------------------------------------------------------------------------

fn root_for(path: &str, authorized: &crate::AuthorizedPaths) -> Result<std::path::PathBuf> {
    let raiz = crate::canonicalize_directory(Path::new(path))?;
    authorized
        .ensure_authorized_vault_root(&raiz)
        .context("O vault não está autorizado nesta sessão.")?;
    Ok(raiz)
}

#[tauri::command]
pub async fn cloud_status(
    path: String,
    url: String,
    api_key: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<CloudStatus, String> {
    let raiz = root_for(&path, &authorized_paths).map_err(|erro| erro.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        status(&raiz, &url, &api_key).map_err(|erro| erro.to_string())
    })
    .await
    .map_err(|erro| erro.to_string())?
}

#[tauri::command]
pub async fn cloud_link_vault(
    path: String,
    url: String,
    api_key: String,
    strategy: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<CloudStatus, String> {
    let raiz = root_for(&path, &authorized_paths).map_err(|erro| erro.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        link(&raiz, &url, &api_key, &strategy).map_err(|erro| erro.to_string())
    })
    .await
    .map_err(|erro| erro.to_string())?
}

#[tauri::command]
pub async fn cloud_unlink_vault(
    path: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<CloudStatus, String> {
    let raiz = root_for(&path, &authorized_paths).map_err(|erro| erro.to_string())?;
    tauri::async_runtime::spawn_blocking(move || unlink(&raiz).map_err(|erro| erro.to_string()))
        .await
        .map_err(|erro| erro.to_string())?
}

#[tauri::command]
pub async fn cloud_sync_now(
    path: String,
    url: String,
    api_key: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<CloudReport, String> {
    let raiz = root_for(&path, &authorized_paths).map_err(|erro| erro.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        sync(&raiz, &url, &api_key, &SyncOptions::default()).map_err(|erro| erro.to_string())
    })
    .await
    .map_err(|erro| erro.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Caminho que a interface percorre, com sessão de verdade no cofre: entrar,
    /// ler o retrato, ligar o vault, sincronizar e desligar.
    #[test]
    #[ignore = "rede + cofre do sistema: fala com o Supabase de verdade"]
    fn live_ciclo_dos_comandos() {
        let (Ok(url), Ok(key), Ok(email), Ok(senha)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        crate::account::sign_in(&url, &key, &email, &senha).expect("entrar");

        let vault = tempfile::tempdir().expect("vault");
        std::fs::write(vault.path().join("nota.md"), "# nota pela interface").expect("nota");

        // 1. retrato antes de ligar
        let antes = status(vault.path(), &url, &key).expect("status");
        assert!(antes.signed_in, "o snapshot deveria ver a sessão");
        assert!(!antes.linked);
        assert_eq!(antes.local_files, 1);

        // 2. ligar (escolha explícita, como a tela faz)
        let ligado = link(vault.path(), &url, &key, "merge").expect("ligar");
        assert!(ligado.linked);
        assert!(
            ligado.needs_choice == false,
            "depois de ligado não se pergunta mais"
        );

        // 3. sincronizar
        let relatorio = sync(vault.path(), &url, &key, &SyncOptions::default()).expect("sync");
        assert_eq!(relatorio.uploaded, vec!["nota.md".to_string()]);
        assert!(relatorio.failed.is_empty(), "{:?}", relatorio.failed);

        // 4. o retrato agora vê o arquivo na nuvem e a data da sincronização
        let depois = status(vault.path(), &url, &key).expect("status 2");
        assert_eq!(depois.remote_files, Some(1));
        assert!(
            depois.last_synced_at.is_some(),
            "o servidor deve registrar quando o ciclo terminou"
        );

        // 5. segunda passada não faz nada
        let ociosa = sync(vault.path(), &url, &key, &SyncOptions::default()).expect("sync 2");
        assert!(
            ociosa.uploaded.is_empty() && ociosa.downloaded.is_empty(),
            "{ociosa:?}"
        );

        // 6. desligar não apaga arquivo local
        let desligado = unlink(vault.path()).expect("desligar");
        assert!(!desligado.linked);
        assert!(vault.path().join("nota.md").exists());

        crate::account::sign_out(&url, &key).expect("sair");
    }

    #[test]
    fn dois_ciclos_simultaneos_nao_rodam_juntos() {
        let primeiro = SyncGuard::acquire().expect("o primeiro entra");
        assert!(
            SyncGuard::acquire().is_err(),
            "o segundo tem que ser recusado enquanto o primeiro roda"
        );
        drop(primeiro);
        // liberado: o próximo ciclo pode entrar
        assert!(SyncGuard::acquire().is_ok());
    }

    #[test]
    fn nome_do_vault_vem_da_pasta() {
        let pasta = tempfile::tempdir().expect("pasta");
        assert!(vault_name(pasta.path()).starts_with(".tmp"));
    }

    #[test]
    fn sem_sessao_o_retrato_ainda_conta_o_que_existe_aqui() {
        // Sem tocar na rede: `auth` falha porque não há apikey válida.
        let vault = tempfile::tempdir().expect("vault");
        std::fs::write(vault.path().join("a.md"), "# a").expect("nota");
        std::fs::write(vault.path().join("b.md"), "# b").expect("nota");

        let retrato = status(vault.path(), "http://127.0.0.1:9", "").expect("retrato");
        assert!(!retrato.signed_in);
        assert!(!retrato.linked);
        assert_eq!(retrato.local_files, 2);
        assert!(retrato.remote_files.is_none());
        assert!(!retrato.needs_choice);
    }

    #[test]
    fn desligar_troca_a_identidade_e_nao_mexe_em_arquivo() {
        let vault = tempfile::tempdir().expect("vault");
        std::fs::write(vault.path().join("nota.md"), "# conteudo").expect("nota");

        let antes = load_or_create_identity(vault.path(), "Estudo").expect("identidade");
        let depois = unlink(vault.path()).expect("desligar");

        assert!(!depois.linked);
        let atual = load_or_create_identity(vault.path(), "Estudo").expect("identidade");
        assert_ne!(
            atual.local_id, antes.local_id,
            "religar deve perguntar de novo"
        );
        assert!(atual.vault_id.is_none());
        assert_eq!(
            std::fs::read_to_string(vault.path().join("nota.md")).expect("nota"),
            "# conteudo"
        );
    }

    #[test]
    fn estrategia_desconhecida_e_recusada_antes_de_tocar_na_nuvem() {
        let vault = tempfile::tempdir().expect("vault");
        let erro = link(vault.path(), "http://127.0.0.1:9", "", "qualquer").unwrap_err();
        // sem sessão o erro é o de sessão, não o de estratégia: a ordem importa
        assert!(erro.to_string().contains("conta") || erro.to_string().contains("estratégia"));
    }
}
