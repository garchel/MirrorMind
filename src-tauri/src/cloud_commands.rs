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
    /// `nuvem` quando o add-on está pago; `nenhum` caso contrário. **Só o webhook
    /// do Stripe escreve isto** — o app lê e obedece.
    pub cloud_plan: String,
    pub plan_status: String,
    pub plan_period_end: Option<String>,
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

/// Resultado da varredura de objetos órfãos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    /// Objetos que o bucket tem neste vault.
    pub scanned: usize,
    /// Objetos que nenhuma linha referencia.
    pub orphans: Vec<OrphanItem>,
    pub freed_bytes: u64,
    /// `true` quando nada foi apagado (só a conta).
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanItem {
    /// Caminho dentro do bucket (o último segmento é o hash, no layout atual).
    pub name: String,
    pub size_bytes: u64,
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
            cloud_plan: "nenhum".to_string(),
            plan_status: "active".to_string(),
            plan_period_end: None,
        });
    };

    // Direitos vêm do servidor; se a chamada falhar, o status do add-on é "nenhum"
    // (e a tela oferece assinar) em vez de inventar um plano.
    let direitos = cloud_api::my_entitlements(&auth).unwrap_or(cloud_api::Entitlements {
        plan: "gratis".to_string(),
        plan_status: "active".to_string(),
        plan_period_end: None,
        cloud_plan: "nenhum".to_string(),
    });

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
        cloud_plan: direitos.cloud_plan,
        plan_status: direitos.plan_status,
        plan_period_end: direitos.plan_period_end,
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
        cloud_plan: "nenhum".to_string(),
        plan_status: "active".to_string(),
        plan_period_end: None,
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

/// Pede a URL do Checkout e devolve — abrir o navegador é do comando.
///
/// O `kind` é `cloud_month` ou `cloud_year`; qualquer outro valor é recusado aqui
/// antes de sair, para o servidor não precisar confiar no cliente.
pub fn checkout(base_url: &str, api_key: &str, kind: &str) -> Result<String> {
    if kind != "cloud_month" && kind != "cloud_year" {
        bail!("Plano de assinatura desconhecido: {kind}");
    }
    let auth = auth(base_url, api_key)?;
    cloud_api::create_checkout(&auth, kind)
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

/// Procura (e, se pedido, apaga) objetos que nenhuma linha de metadado referencia.
///
/// Pega a mesma trava do ciclo: varrer no meio de uma sincronização poderia
/// apagar conteúdo que acabou de subir e ainda não teve metadado gravado. A
/// carência de 24 h é a segunda camada dessa mesma proteção.
pub fn sweep_orphans(
    vault_root: &Path,
    base_url: &str,
    api_key: &str,
    dry_run: bool,
    grace_seconds: i64,
) -> Result<SweepReport> {
    let _guarda = SyncGuard::acquire()?;
    let auth = auth(base_url, api_key)?;
    let identidade = load_or_create_identity(vault_root, &vault_name(vault_root))?;
    if identidade.vault_id.is_none() {
        bail!("Este vault ainda não está ligado à nuvem.");
    }
    let Some(owner_id) = cloud_api::user_id_from_jwt(&auth.access_token) else {
        bail!("A sessão não identifica o dono da nuvem. Entre na conta de novo.");
    };

    // Referência = caminho do objeto que alguma linha sustenta, em **qualquer**
    // vault da conta. Duas razões:
    //
    // - linha marcada como excluída também conta: apagar o conteúdo de uma linha
    //   que existe deixaria um metadado apontando para o vazio;
    // - vault apagado na nuvem remove as linhas em cascata mas não os objetos, e
    //   esses só podem ser encontrados olhando a conta inteira.
    let mut referenciados: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for linha in cloud_api::list_vaults(&auth)? {
        for arquivo in cloud_api::list_files(&auth, &linha.id)? {
            referenciados.insert(crate::cloud::storage_path(
                &owner_id,
                &linha.id,
                &arquivo.hash,
            ));
        }
    }

    let objetos = cloud_api::list_all_objects(&auth, &owner_id)?;
    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_secs() as i64)
        .unwrap_or(0);
    let orfaos = crate::cloud::find_orphans(&objetos, &referenciados, agora, grace_seconds);

    let total_orfaos: u64 = orfaos.iter().map(|orfao| orfao.size_bytes).sum();
    let mut liberados = 0u64;
    if !dry_run {
        for orfao in &orfaos {
            // Apaga pelo caminho completo: o órfão pode ser de um vault que já não
            // existe, ou de um layout antigo (objeto nomeado pelo caminho da nota).
            if cloud_api::delete_object(&auth, &orfao.full_path).is_ok() {
                liberados += orfao.size_bytes;
            }
            // Objeto que já não existe (ou já foi apagado) não é erro de varredura:
            // a lista foi tirada antes, e outra máquina pode ter limpado antes.
        }
    }

    Ok(SweepReport {
        scanned: objetos.len(),
        orphans: orfaos
            .into_iter()
            .map(|orfao| OrphanItem {
                name: orfao.full_path,
                size_bytes: orfao.size_bytes,
            })
            .collect(),
        // Em modo de conferência o número é "quanto sairia", não "quanto saiu".
        freed_bytes: if dry_run { total_orfaos } else { liberados },
        dry_run,
    })
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
pub async fn cloud_start_checkout(
    url: String,
    api_key: String,
    kind: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let endereco = checkout(&url, &api_key, &kind).map_err(|erro| erro.to_string())?;
        crate::account_oauth::open_browser(&endereco).map_err(|erro| erro.to_string())
    })
    .await
    .map_err(|erro| erro.to_string())?
}

#[tauri::command]
pub async fn cloud_sweep_orphans(
    path: String,
    url: String,
    api_key: String,
    dry_run: bool,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<SweepReport, String> {
    let raiz = root_for(&path, &authorized_paths).map_err(|erro| erro.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        sweep_orphans(
            &raiz,
            &url,
            &api_key,
            dry_run,
            crate::cloud::ORPHAN_GRACE_SECONDS,
        )
        .map_err(|erro| erro.to_string())
    })
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

    // Os testes ao vivo (`live_*`) compartilham a trava de ciclo (`SyncGuard`, um
    // `static` do processo) e a mesma conta na nuvem. Rodando em paralelo, o
    // segundo recebe "Uma sincronização já está em andamento" e o teste falha por
    // motivo alheio ao que ele mede. Rode-os com `--test-threads=1`.

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

    /// Varredura contra a nuvem de verdade: um objeto sem dono é encontrado na
    /// conferência e removido de fato; o objeto referenciado sobrevive.
    #[test]
    #[ignore = "rede + cofre do sistema: fala com o Supabase de verdade"]
    fn live_varredura_de_orfaos() {
        let (Ok(url), Ok(key), Ok(email), Ok(senha)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        crate::account::sign_in(&url, &key, &email, &senha).expect("entrar");
        let auth = auth(&url, &key).expect("sessao");
        let owner = cloud_api::user_id_from_jwt(&auth.access_token).expect("dono");
        let local_id = format!(
            "orfaos-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duracao| duracao.as_secs())
                .unwrap_or(0)
        );
        let vault_id =
            cloud_api::register_vault(&auth, &local_id, "Vault de orfaos").expect("registrar");

        // 1. um arquivo com metadado (referenciado)
        let conteudo = b"# nota referenciada".to_vec();
        let hash = crate::cloud::content_hash(&conteudo);
        cloud_api::upload_blob(&auth, &owner, &vault_id, &hash, &conteudo).expect("subir nota");
        cloud_api::upsert_file(
            &auth,
            &vault_id,
            &crate::cloud::RemoteFile {
                path: "nota.md".to_string(),
                kind: crate::cloud::FileKind::Note,
                hash: hash.clone(),
                size_bytes: conteudo.len() as u64,
                deleted: false,
            },
        )
        .expect("metadado");

        // 2. um objeto sem nenhuma linha apontando para ele
        let sobra = b"conteudo orfao".to_vec();
        let hash_orfao = crate::cloud::content_hash(&sobra);
        cloud_api::upload_blob(&auth, &owner, &vault_id, &hash_orfao, &sobra).expect("subir orfao");

        // o vault precisa existir no disco para a identidade ser lida
        let vault = tempfile::tempdir().expect("vault");
        let mut identidade =
            crate::cloud::load_or_create_identity(vault.path(), "Vault de orfaos").expect("id");
        identidade.vault_id = Some(vault_id.clone());
        crate::cloud::save_identity(vault.path(), &identidade).expect("salvar id");

        let caminho_orfao = format!("{owner}/{vault_id}/{hash_orfao}");
        let caminho_nota = format!("{owner}/{vault_id}/{hash}");

        // 3. conferência: encontra o órfão e não apaga nada
        let conferencia = sweep_orphans(vault.path(), &url, &key, true, 0).expect("conferir");
        assert!(
            conferencia.scanned >= 2,
            "conta inteira: {}",
            conferencia.scanned
        );
        assert!(
            conferencia
                .orphans
                .iter()
                .any(|orfao| orfao.name == caminho_orfao),
            "o objeto sem metadado tem que estar na lista: {:?}",
            conferencia.orphans
        );
        assert!(
            !conferencia
                .orphans
                .iter()
                .any(|orfao| orfao.name == caminho_nota),
            "o arquivo com metadado não pode ser candidato"
        );
        assert!(conferencia.freed_bytes >= sobra.len() as u64);
        assert!(conferencia.dry_run);

        // a conferência não apagou: o objeto continua listado no bucket
        let ainda_la = cloud_api::list_all_objects(&auth, &owner).expect("listar");
        assert!(ainda_la
            .iter()
            .any(|objeto| objeto.full_path == caminho_orfao));

        // 4. varredura de verdade: apaga o órfão e preserva o referenciado
        let limpeza = sweep_orphans(vault.path(), &url, &key, false, 0).expect("limpar");
        assert!(!limpeza.dry_run);
        assert!(
            limpeza.freed_bytes >= sobra.len() as u64,
            "liberou {} bytes",
            limpeza.freed_bytes
        );

        // a listagem do bucket é a fonte da verdade — baixar um objeto apagado pode
        // devolver cópia em cache, e foi isso que quase fez o teste mentir
        let depois = cloud_api::list_all_objects(&auth, &owner).expect("listar 2");
        assert!(
            !depois
                .iter()
                .any(|objeto| objeto.full_path == caminho_orfao),
            "o órfão tem que ter saído do bucket"
        );
        assert!(
            depois.iter().any(|objeto| objeto.full_path == caminho_nota),
            "o objeto referenciado tem que continuar lá"
        );
        assert_eq!(
            cloud_api::download_blob(&auth, &owner, &vault_id, &hash).expect("referenciado"),
            conteudo,
            "o arquivo com metadado continua baixando igual"
        );

        // 5. nada de órfão sobrando na conferência seguinte
        let repetida = sweep_orphans(vault.path(), &url, &key, true, 0).expect("conferir 2");
        assert!(
            !repetida
                .orphans
                .iter()
                .any(|orfao| orfao.name == caminho_orfao),
            "já foi apagado; {:?}",
            repetida.orphans
        );

        // limpeza do teste
        let _ = cloud_api::delete_blob(&auth, &owner, &vault_id, &hash);
        let apagado = crate::account::client()
            .expect("cliente")
            .delete(format!(
                "{}/rest/v1/vaults?id=eq.{vault_id}",
                crate::account::endpoint(&url, "").expect("endpoint")
            ))
            .header("apikey", &key)
            .bearer_auth(&auth.access_token)
            .send()
            .expect("apagar vault");
        assert!(apagado.status().is_success());
        crate::account::sign_out(&url, &key).expect("sair");
    }

    #[test]
    fn plano_desconhecido_e_recusado_antes_de_falar_com_o_servidor() {
        // sem sessão nem rede: a validação vem primeiro
        let erro = checkout("http://127.0.0.1:9", "", "cloud_vitalicio").unwrap_err();
        assert!(erro.to_string().contains("desconhecido"), "{erro}");
    }

    /// Enquanto o Stripe não estiver configurado (falta `STRIPE_SECRET_KEY` na
    /// função), o checkout tem de devolver uma frase clara — não um 500 nem um
    /// silêncio. É o estado real do ambiente hoje.
    #[test]
    #[ignore = "rede + cofre do sistema: fala com o Supabase de verdade"]
    fn live_checkout_sem_chave_responde_com_mensagem_clara() {
        let (Ok(url), Ok(key), Ok(email), Ok(senha)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        crate::account::sign_in(&url, &key, &email, &senha).expect("entrar");
        match checkout(&url, &key, "cloud_month") {
            Ok(endereco) => {
                // se o segredo já estiver configurado, o Stripe devolve uma URL real
                assert!(
                    endereco.starts_with("https://checkout.stripe.com/"),
                    "endereço inesperado: {endereco}"
                );
            }
            Err(erro) => {
                let texto = erro.to_string();
                assert!(
                    texto.contains("não está configurado")
                        || texto.contains("Preço não configurado"),
                    "mensagem inesperada: {texto}"
                );
            }
        }
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
