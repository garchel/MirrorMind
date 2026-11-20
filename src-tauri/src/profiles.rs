//! Perfis locais: várias pessoas (ou vários "eus") no mesmo vault.
//!
//! Por que existem: o histórico de revisão mora na **pasta** do vault
//! (`.mirmind/learning`), então duas pessoas que abrem a mesma pasta dividem hoje
//! o mesmo histórico. Perfil separa o que é da pessoa (aprendizado, calibração,
//! consumo, metas, notificações) do que é do vault (notas, modelos, política).
//!
//! Onde fica a lista: `<vault>/.mirmind/profiles.json`. Fica no vault, não na
//! máquina, porque levar a pasta para outro computador tem que levar junto quem
//! estuda ali.
//!
//! **O perfil padrão usa os caminhos antigos** (`.mirmind/learning`, e não
//! `.mirmind/profiles/padrao/learning`). É de propósito: migrar 400 arquivos de
//! aprendizado de quem já usa o app é risco sem recompensa — o perfil original
//! herda os caminhos que já existem, e só perfis novos ganham pasta própria.
//!
//! PIN é **conveniência**, não criptografia de disco: ele impede o colega de casa
//! de abrir o seu perfil, não um atacante com acesso ao disco e ao arquivo de
//! perfis. O hash é salgado e iterado para não entregar o PIN em texto, e isso
//! está declarado aqui para ninguém confundir com segurança real.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const METADATA_DIRECTORY: &str = ".mirmind";
const PROFILES_FILE: &str = "profiles.json";
/// Id do perfil que herda os caminhos antigos do vault.
pub const DEFAULT_PROFILE_ID: &str = "padrao";
const MAX_NAME_CHARS: usize = 40;
const MAX_PROFILES: usize = 12;
const PIN_MIN_CHARS: usize = 4;
const PIN_MAX_CHARS: usize = 12;
/// Iterações do hash do PIN. 120k SHA-256 levam ~60 ms nesta classe de máquina:
/// suficiente para não travar a abertura do perfil e caro o bastante para o PIN
/// não ser lido de um arquivo em segundos.
const PIN_ROUNDS: u32 = 120_000;

/// Registro guardado no JSON. `pin_salt`/`pin_hash` nunca saem para o frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Cor de identificação na interface (token do app, ex.: "sage").
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub created_at_unix_ms: i64,
    /// Conta vinculada (id do usuário no servidor). Ausente = perfil convidado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_salt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_hash: Option<String>,
    /// Identidade da máquina a que este perfil pertence (ver `identities.rs`).
    ///
    /// Ausente = perfil local ao vault, criado dentro dele e sem identidade
    /// global: continua funcionando exatamente como antes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_id: Option<String>,
    /// Quando o perfil mudou pela última vez (mesma regra do "mais recente vence").
    #[serde(default)]
    pub updated_at_unix_ms: i64,
}

/// O que o frontend vê: sem sal e sem hash, só se existe PIN.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub color: String,
    pub is_default: bool,
    pub has_pin: bool,
    /// O perfil já está ligado a uma conta (a sincronização usa isso depois).
    pub linked: bool,
}

impl Profile {
    pub fn summary(&self) -> ProfileSummary {
        ProfileSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            color: self.color.clone(),
            is_default: self.id == DEFAULT_PROFILE_ID,
            has_pin: self.pin_hash.is_some(),
            linked: self.account_id.is_some(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfilesFile {
    #[serde(default = "file_version")]
    version: u32,
    profiles: Vec<Profile>,
}

fn file_version() -> u32 {
    1
}

fn profiles_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(PROFILES_FILE)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as i64)
        .unwrap_or(0)
}

fn profile_with_default() -> Profile {
    Profile {
        id: DEFAULT_PROFILE_ID.to_string(),
        name: "Eu".to_string(),
        color: "sage".to_string(),
        created_at_unix_ms: now_ms(),
        account_id: None,
        pin_salt: None,
        pin_hash: None,
        identity_id: None,
        updated_at_unix_ms: 0,
    }
}

/// Lê a lista; um vault sem `profiles.json` ganha o perfil padrão na hora (é a
/// migração de quem já usava o app: nenhum arquivo de aprendizado é movido).
pub fn load_profiles(vault_root: &Path) -> Result<Vec<Profile>> {
    let path = profiles_path(vault_root);
    let Ok(raw) = fs::read_to_string(&path) else {
        let profiles = vec![profile_with_default()];
        save_profiles(vault_root, &profiles)?;
        return Ok(profiles);
    };

    let parsed: ProfilesFile = serde_json::from_str(&raw)
        .with_context(|| format!("O arquivo de perfis está inválido: {}", path.display()))?;
    if parsed.profiles.is_empty() {
        let profiles = vec![profile_with_default()];
        save_profiles(vault_root, &profiles)?;
        return Ok(profiles);
    }
    Ok(parsed.profiles)
}

fn save_profiles(vault_root: &Path, profiles: &[Profile]) -> Result<()> {
    let metadata = vault_root.join(METADATA_DIRECTORY);
    fs::create_dir_all(&metadata)?;
    let path = profiles_path(vault_root);
    let conteudo = serde_json::to_string_pretty(&ProfilesFile {
        version: file_version(),
        profiles: profiles.to_vec(),
    })?;
    // Grava em temporário e renomeia: uma queda no meio deixa a lista anterior
    // intacta em vez de um JSON pela metade.
    let temporario = path.with_extension("json.tmp");
    fs::write(&temporario, conteudo)?;
    fs::rename(&temporario, &path)?;
    Ok(())
}

pub(crate) fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        bail!("O perfil precisa de um nome.");
    }
    if name.chars().count() > MAX_NAME_CHARS {
        bail!("O nome do perfil passa de {MAX_NAME_CHARS} caracteres.");
    }
    Ok(name.to_string())
}

pub(crate) fn validate_pin(pin: &str) -> Result<()> {
    let tamanho = pin.chars().count();
    if !(PIN_MIN_CHARS..=PIN_MAX_CHARS).contains(&tamanho) {
        bail!("O PIN precisa ter de {PIN_MIN_CHARS} a {PIN_MAX_CHARS} dígitos.");
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        bail!("O PIN aceita apenas números.");
    }
    Ok(())
}

pub(crate) fn random_salt() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("o sistema precisa fornecer entropia");
    base64_encode(&bytes)
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 iterado sobre `salt:pin`. Não é KDF de senha (não tem custo de memória),
/// mas é o suficiente para um PIN de 4-12 dígitos que só protege a tela.
pub fn hash_pin(pin: &str, salt: &str) -> String {
    let mut digest = Sha256::digest(format!("{salt}:{pin}").as_bytes());
    for _ in 1..PIN_ROUNDS {
        digest = Sha256::digest(&digest);
    }
    base64_encode(&digest)
}

fn compare_constant_time(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diferenca = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diferenca |= x ^ y;
    }
    diferenca == 0
}

pub fn verify_pin(vault_root: &Path, profile_id: &str, pin: &str) -> Result<bool> {
    let profiles = load_profiles(vault_root)?;
    let Some(perfil) = profiles.iter().find(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    let (Some(salt), Some(hash)) = (perfil.pin_salt.as_deref(), perfil.pin_hash.as_deref()) else {
        return Ok(true); // perfil sem PIN: nada a conferir
    };
    Ok(compare_constant_time(&hash_pin(pin, salt), hash))
}

pub fn create_profile(
    vault_root: &Path,
    name: &str,
    color: &str,
    pin: Option<&str>,
) -> Result<ProfileSummary> {
    let name = validate_name(name)?;
    let mut profiles = load_profiles(vault_root)?;
    if profiles.len() >= MAX_PROFILES {
        bail!("Este vault já tem {MAX_PROFILES} perfis. Exclua um antes de criar outro.");
    }
    if profiles.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
        bail!("Já existe um perfil com esse nome.");
    }
    if let Some(pin) = pin {
        validate_pin(pin)?;
    }

    let salt = pin.map(|_| random_salt());
    let perfil = Profile {
        id: random_salt().replace(['-', '_'], ""),
        name,
        color: if color.trim().is_empty() {
            "sage".to_string()
        } else {
            color.trim().to_string()
        },
        created_at_unix_ms: now_ms(),
        account_id: None,
        pin_hash: pin.map(|pin| hash_pin(pin, salt.as_deref().unwrap_or_default())),
        pin_salt: salt,
        // Perfil criado dentro do vault (tela "Quem está usando?"): sem identidade
        // global por enquanto — continua sendo o cartão só desta caixa.
        identity_id: None,
        updated_at_unix_ms: now_ms(),
    };
    let resumo = perfil.summary();
    profiles.push(perfil);
    save_profiles(vault_root, &profiles)?;
    Ok(resumo)
}

pub fn rename_profile(
    vault_root: &Path,
    profile_id: &str,
    name: &str,
    color: Option<&str>,
) -> Result<ProfileSummary> {
    let name = validate_name(name)?;
    let mut profiles = load_profiles(vault_root)?;
    if profiles
        .iter()
        .any(|p| p.id != profile_id && p.name.eq_ignore_ascii_case(&name))
    {
        bail!("Já existe um perfil com esse nome.");
    }
    let Some(perfil) = profiles.iter_mut().find(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    perfil.name = name;
    if let Some(color) = color {
        perfil.color = color.to_string();
    }
    let resumo = perfil.summary();
    save_profiles(vault_root, &profiles)?;
    Ok(resumo)
}

/// Remove o perfil e a pasta de estado dele. Recusa apagar o último: um vault
/// sem perfil não teria onde guardar o aprendizado.
pub fn delete_profile(vault_root: &Path, profile_id: &str) -> Result<()> {
    let mut profiles = load_profiles(vault_root)?;
    if profiles.len() <= 1 {
        bail!("Este é o único perfil do vault — não é possível excluir.");
    }
    let Some(posicao) = profiles.iter().position(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    profiles.remove(posicao);
    save_profiles(vault_root, &profiles)?;

    // Só apaga pasta de perfil não-padrão: os caminhos legados pertencem ao vault.
    if profile_id != DEFAULT_PROFILE_ID {
        let pasta = vault_root
            .join(METADATA_DIRECTORY)
            .join("profiles")
            .join(profile_id);
        if pasta.exists() {
            let _ = fs::remove_dir_all(pasta);
        }
    }
    Ok(())
}

pub fn set_pin(vault_root: &Path, profile_id: &str, pin: Option<&str>) -> Result<()> {
    if let Some(pin) = pin {
        validate_pin(pin)?;
    }
    let mut profiles = load_profiles(vault_root)?;
    let Some(perfil) = profiles.iter_mut().find(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    match pin {
        Some(pin) => {
            let salt = random_salt();
            perfil.pin_hash = Some(hash_pin(pin, &salt));
            perfil.pin_salt = Some(salt);
        }
        None => {
            perfil.pin_hash = None;
            perfil.pin_salt = None;
        }
    }
    save_profiles(vault_root, &profiles)
}

// -----------------------------------------------------------------------------
// Vínculo perfil ↔ conta.
//
// O vínculo é local: diz "este perfil é desta conta". A sincronização (fase 2)
// usa esse campo para decidir o que subir; hoje ele só impede a confusão de ter
// a mesma conta em dois perfis da mesma máquina, que tornaria o merge ambíguo.
// -----------------------------------------------------------------------------

/// Liga o perfil à conta. Recusa quando a conta já está em outro perfil deste
/// vault — duas trilhas locais para a mesma conta não têm merge possível.
pub fn link_account(
    vault_root: &Path,
    profile_id: &str,
    account_id: &str,
) -> Result<ProfileSummary> {
    let account_id = account_id.trim();
    if account_id.is_empty() {
        bail!("Conta inválida para vincular.");
    }
    let mut profiles = load_profiles(vault_root)?;
    if let Some(outro) = profiles
        .iter()
        .find(|p| p.id != profile_id && p.account_id.as_deref() == Some(account_id))
    {
        bail!(
            "Esta conta já está vinculada ao perfil \"{}\". Desvincule lá antes.",
            outro.name
        );
    }
    let Some(perfil) = profiles.iter_mut().find(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    perfil.account_id = Some(account_id.to_string());
    let resumo = perfil.summary();
    save_profiles(vault_root, &profiles)?;
    Ok(resumo)
}

pub fn unlink_account(vault_root: &Path, profile_id: &str) -> Result<ProfileSummary> {
    let mut profiles = load_profiles(vault_root)?;
    let Some(perfil) = profiles.iter_mut().find(|p| p.id == profile_id) else {
        bail!("Este perfil não existe mais.");
    };
    perfil.account_id = None;
    let resumo = perfil.summary();
    save_profiles(vault_root, &profiles)?;
    Ok(resumo)
}

// -----------------------------------------------------------------------------
// Sessão aberta: aviso de uso simultâneo.
//
// Não é trava de sistema operacional — é um aviso com prazo. Se duas janelas do
// app abrirem o mesmo perfil, a segunda vê o aviso e pode seguir mesmo assim
// (o usuário sabe o que está fazendo). O prazo de 30 minutos evita o pior caso:
// um arquivo de sessão órfão deixado por um travamento, que impediria a abertura
// para sempre.
// -----------------------------------------------------------------------------

const SESSION_FILE: &str = "session.json";
const SESSION_STALE_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMarker {
    pid: u32,
    opened_at_unix_ms: i64,
}

fn session_path(vault_root: &Path, profile_id: &str) -> PathBuf {
    metadata_dir_for(vault_root, profile_id).join(SESSION_FILE)
}

/// Registra que este processo abriu o perfil. Devolve o aviso quando outra janela
/// (outro processo) já tinha aberto o mesmo perfil e o marcador está fresco.
pub fn acquire_session(vault_root: &Path, profile_id: &str, force: bool) -> Result<Option<String>> {
    let path = session_path(vault_root, profile_id);
    let meu_pid = std::process::id();

    if !force {
        if let Ok(bruto) = fs::read_to_string(&path) {
            if let Ok(marcador) = serde_json::from_str::<SessionMarker>(&bruto) {
                let idade = now_ms() - marcador.opened_at_unix_ms;
                if marcador.pid != meu_pid && idade >= 0 && idade < SESSION_STALE_MS {
                    bail!(
                        "Este perfil parece estar aberto em outra janela do app. \
                         Feche a outra janela ou continue mesmo assim."
                    );
                }
            }
        }
    }

    if let Some(pai) = path.parent() {
        fs::create_dir_all(pai)?;
    }
    let conteudo = serde_json::to_string(&SessionMarker {
        pid: meu_pid,
        opened_at_unix_ms: now_ms(),
    })?;
    fs::write(&path, conteudo)?;
    Ok(None)
}

/// Solta o marcador da sessão (chamado ao trocar de perfil ou fechar o app).
pub fn release_session(vault_root: &Path, profile_id: &str) {
    let path = session_path(vault_root, profile_id);
    if let Ok(bruto) = fs::read_to_string(&path) {
        if let Ok(marcador) = serde_json::from_str::<SessionMarker>(&bruto) {
            if marcador.pid != std::process::id() {
                return; // não apaga sessão de outro processo
            }
        }
    }
    let _ = fs::remove_file(&path);
}

// -----------------------------------------------------------------------------
// Comandos IPC. Moram no modulo (como `account::*`) para nao duplicar o macro
// `__cmd__*` no namespace da raiz do crate.
// -----------------------------------------------------------------------------

fn como_erro<T>(resultado: Result<T>) -> Result<T, String> {
    resultado.map_err(|erro| erro.to_string())
}

/// Traz para o mundo das identidades os perfis que já existiam **dentro** do vault.
///
/// Quem usava o app antes da identidade tem nome e PIN guardados só em
/// `profiles.json`. Sem esta migração, a abertura mostraria "crie seu perfil"
/// para alguém que já tem um — e o PIN sumiria da vista.
///
/// Fica de fora o perfil de fábrica intocado (`Eu`, sem PIN, sem identidade):
/// ninguém o criou, e torná-lo identidade faria a tela perguntar "é você mesmo?"
/// a quem nunca escolheu nada.
pub fn migrate_profiles_to_identities(
    app_config_dir: &Path,
    vault_root: &Path,
) -> Result<usize> {
    let mut perfis = load_profiles(vault_root)?;
    let mut maquina = crate::identities::load_machine(app_config_dir)?;
    let mut migrados = 0;

    for perfil in perfis.iter_mut() {
        if perfil.identity_id.is_some() {
            continue;
        }
        let fabrica_intacto = perfil.id == DEFAULT_PROFILE_ID
            && perfil.name == "Eu"
            && perfil.pin_hash.is_none();
        if fabrica_intacto {
            continue;
        }

        let identidade = crate::identities::Identity {
            id: format!("id-{}", crate::identities::random_id_public()),
            name: perfil.name.clone(),
            color: perfil.color.clone(),
            account_id: perfil.account_id.clone(),
            pin_salt: perfil.pin_salt.clone(),
            pin_hash: perfil.pin_hash.clone(),
            updated_at_unix_ms: crate::identities::now_ms(),
        };
        perfil.identity_id = Some(identidade.id.clone());
        perfil.updated_at_unix_ms = crate::identities::now_ms();
        maquina.push(identidade);
        migrados += 1;
    }

    if migrados > 0 {
        crate::identities::ordenar(&mut maquina);
        crate::identities::save_machine(app_config_dir, &maquina)?;
        crate::identities::save_mirror(vault_root, &maquina)?;
        save_profiles(vault_root, &perfis)?;
    }
    Ok(migrados)
}

/// Garante um perfil neste vault para a identidade da máquina.
///
/// Se já existe um perfil ligado a ela, o perfil é atualizado com nome/cor/PIN da
/// identidade (a identidade manda: é o "mais recente vence" entre os dois
/// arquivos). Se não existe, nasce um perfil novo — é o que faz a mesma pessoa
/// entrar em *Medicina* e em *Residência* com o mesmo nome, sem virar duas.
///
/// PIN salgado é copiado junto de propósito: sem ele o perfil novo abriria sem
/// proteção no vault onde ainda não existia.
pub fn ensure_profile_for_identity(
    vault_root: &Path,
    identidade: &crate::identities::Identity,
) -> Result<Profile> {
    let mut perfis = load_profiles(vault_root)?;
    let indice = perfis
        .iter()
        .position(|perfil| perfil.identity_id.as_deref() == Some(identidade.id.as_str()));

    match indice {
        Some(posicao) => {
            perfis[posicao].name = identidade.name.clone();
            perfis[posicao].color = identidade.color.clone();
            perfis[posicao].pin_salt = identidade.pin_salt.clone();
            perfis[posicao].pin_hash = identidade.pin_hash.clone();
            perfis[posicao].updated_at_unix_ms = now_ms();
            let atualizado = perfis[posicao].clone();
            save_profiles(vault_root, &perfis)?;
            Ok(atualizado)
        }
        None => {
            let novo = Profile {
                id: format!("id-{}", crate::identities::random_id_public()),
                name: identidade.name.clone(),
                color: identidade.color.clone(),
                created_at_unix_ms: now_ms(),
                account_id: identidade.account_id.clone(),
                pin_salt: identidade.pin_salt.clone(),
                pin_hash: identidade.pin_hash.clone(),
                identity_id: Some(identidade.id.clone()),
                updated_at_unix_ms: now_ms(),
            };
            perfis.push(novo.clone());
            save_profiles(vault_root, &perfis)?;
            Ok(novo)
        }
    }
}

#[tauri::command]
pub fn profiles_list(vault_root: String) -> Result<Vec<ProfileSummary>, String> {
    como_erro(
        load_profiles(Path::new(&vault_root))
            .map(|perfis| perfis.iter().map(Profile::summary).collect()),
    )
}

#[tauri::command]
pub fn profiles_create(
    vault_root: String,
    name: String,
    color: String,
    pin: Option<String>,
) -> Result<ProfileSummary, String> {
    como_erro(create_profile(
        Path::new(&vault_root),
        &name,
        &color,
        pin.as_deref(),
    ))
}

/// Espelha na identidade da máquina uma edição feita no perfil do vault.
///
/// Sem isto, renomear pelo portão de perfis mudava só a cópia de dentro da pasta
/// e a identidade (que manda ao entrar no vault) revertia o nome na abertura
/// seguinte — a pessoa via "meu nome voltou sozinho".
fn espelhar_identidade(app: &tauri::AppHandle, vault_root: &Path, profile_id: &str) {
    use tauri::Manager;
    let Ok(app_dir) = app.path().app_config_dir() else {
        return;
    };
    let Ok(perfis) = load_profiles(vault_root) else {
        return;
    };
    let Some(perfil) = perfis.iter().find(|item| item.id == profile_id) else {
        return;
    };
    let Some(identity_id) = perfil.identity_id.clone() else {
        return;
    };
    let _ = crate::identities::sync_from_profile(
        &app_dir,
        vault_root,
        crate::identities::IdentitySnapshot {
            id: &identity_id,
            name: &perfil.name,
            color: &perfil.color,
            pin_salt: perfil.pin_salt.as_deref(),
            pin_hash: perfil.pin_hash.as_deref(),
            updated_at_unix_ms: perfil.updated_at_unix_ms,
        },
    );
}

#[tauri::command]
pub fn profiles_rename(
    app: tauri::AppHandle,
    vault_root: String,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<ProfileSummary, String> {
    let resultado = como_erro(rename_profile(
        Path::new(&vault_root),
        &id,
        &name,
        color.as_deref(),
    ));
    if resultado.is_ok() {
        espelhar_identidade(&app, Path::new(&vault_root), &id);
    }
    resultado
}

#[tauri::command]
pub fn profiles_delete(vault_root: String, id: String) -> Result<(), String> {
    como_erro(delete_profile(Path::new(&vault_root), &id))
}

#[tauri::command]
pub fn profiles_link_account(
    vault_root: String,
    id: String,
    account_id: String,
) -> Result<ProfileSummary, String> {
    como_erro(link_account(Path::new(&vault_root), &id, &account_id))
}

#[tauri::command]
pub fn profiles_unlink_account(vault_root: String, id: String) -> Result<ProfileSummary, String> {
    como_erro(unlink_account(Path::new(&vault_root), &id))
}

#[tauri::command]
pub fn profiles_set_pin(
    app: tauri::AppHandle,
    vault_root: String,
    id: String,
    pin: Option<String>,
) -> Result<(), String> {
    let resultado = como_erro(set_pin(Path::new(&vault_root), &id, pin.as_deref()));
    if resultado.is_ok() {
        // Trocar o PIN aqui também vale para todos os vaults: a identidade é a
        // que a abertura confere.
        espelhar_identidade(&app, Path::new(&vault_root), &id);
    }
    resultado
}

#[tauri::command]
pub fn profiles_verify_pin(vault_root: String, id: String, pin: String) -> Result<bool, String> {
    como_erro(verify_pin(Path::new(&vault_root), &id, &pin))
}

/// Define o perfil ativo deste processo e registra a sessão aberta.
///
/// O frontend chama antes de abrir o vault e a cada troca de perfil. `force`
/// ignora o aviso de "aberto em outra janela".
#[tauri::command]
pub fn profiles_select(vault_root: String, id: String, force: Option<bool>) -> Result<(), String> {
    let anterior = active_profile();
    if anterior != id {
        release_session(Path::new(&vault_root), &anterior);
    }
    como_erro(acquire_session(
        Path::new(&vault_root),
        &id,
        force.unwrap_or(false),
    ))?;
    set_active_profile(&id);
    Ok(())
}

// -----------------------------------------------------------------------------
// Perfil ativo: contexto de requisição.
//
// A alternativa seria passar o perfil por parâmetro nas ~30 funções de
// armazenamento — e um único ponto esquecido gravaria o aprendizado do perfil A
// na pasta do B. O contexto é definido no comando IPC (a fronteira onde o perfil
// vem do frontend) e lido na resolução de caminho. Um comando IPC por vez, então
// não há troca no meio de uma operação.
// -----------------------------------------------------------------------------

static ACTIVE_PROFILE: OnceLock<Mutex<String>> = OnceLock::new();

fn active_slot() -> &'static Mutex<String> {
    ACTIVE_PROFILE.get_or_init(|| Mutex::new(DEFAULT_PROFILE_ID.to_string()))
}

pub fn set_active_profile(profile_id: &str) {
    if let Ok(mut guarda) = active_slot().lock() {
        *guarda = if profile_id.trim().is_empty() {
            DEFAULT_PROFILE_ID.to_string()
        } else {
            profile_id.trim().to_string()
        };
    }
}

pub fn active_profile() -> String {
    // Nos testes, o perfil pode ser fixado **por thread**: a suíte roda em
    // paralelo e trocar o contexto global num teste mudaria o caminho de todos
    // os outros ao mesmo tempo.
    #[cfg(test)]
    if let Some(fixo) = test_profile_override() {
        return fixo;
    }

    active_slot()
        .lock()
        .map(|guarda| guarda.clone())
        .unwrap_or_else(|_| DEFAULT_PROFILE_ID.to_string())
}

#[cfg(test)]
thread_local! {
    static TEST_PROFILE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn test_profile_override() -> Option<String> {
    TEST_PROFILE.with(|valor| valor.borrow().clone())
}

/// Roda `f` como se o perfil ativo fosse `profile_id` — só em testes.
#[cfg(test)]
pub fn with_profile_for_test<R>(profile_id: &str, f: impl FnOnce() -> R) -> R {
    let anterior = TEST_PROFILE.with(|valor| valor.replace(Some(profile_id.to_string())));
    let resultado = f();
    TEST_PROFILE.with(|valor| *valor.borrow_mut() = anterior);
    resultado
}

/// Pasta de estado **dentro do vault**: o `.mirmind` para o perfil padrão (compatível
/// com o que já existe) e `.mirmind/profiles/<id>` para os demais.
pub fn metadata_dir_for_active(vault_root: &Path) -> PathBuf {
    metadata_dir_for(vault_root, &active_profile())
}

pub fn metadata_dir_for(vault_root: &Path, profile_id: &str) -> PathBuf {
    let metadados = vault_root.join(METADATA_DIRECTORY);
    if profile_id == DEFAULT_PROFILE_ID {
        metadados
    } else {
        metadados.join("profiles").join(profile_id)
    }
}

/// Pasta de estado **no app** (o que não pertence ao vault, como as preferências
/// de notificação), também separada por perfil.
pub fn app_state_dir_for(app_config_dir: &Path, profile_id: &str) -> PathBuf {
    if profile_id == DEFAULT_PROFILE_ID {
        app_config_dir.to_path_buf()
    } else {
        app_config_dir.join("profiles").join(profile_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_temporario() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault temporario")
    }


    #[test]
    fn migracao_leva_perfil_nomeado_para_identidade_e_pula_o_de_fabrica() {
        let vault = vault_temporario();
        let app = tempfile::tempdir().expect("app dir");

        // perfil de fábrica intocado + perfil criado por alguém, com PIN
        let mut perfis = load_profiles(vault.path()).expect("perfis");
        let salt = random_salt();
        perfis.push(Profile {
            id: "abc".into(),
            name: "Ana".into(),
            color: "brick".into(),
            created_at_unix_ms: 1,
            account_id: None,
            pin_salt: Some(salt.clone()),
            pin_hash: Some(hash_pin("1234", &salt)),
            identity_id: None,
            updated_at_unix_ms: 0,
        });
        save_profiles(vault.path(), &perfis).expect("gravar");

        let migrados = migrate_profiles_to_identities(app.path(), vault.path()).expect("migrar");
        assert_eq!(migrados, 1, "só o perfil criado vira identidade");

        let identidades = crate::identities::load_machine(app.path()).expect("identidades");
        assert_eq!(identidades.len(), 1);
        assert_eq!(identidades[0].name, "Ana");
        // o PIN viaja: a identidade protege com o mesmo número
        assert!(crate::identities::verify_pin(app.path(), &identidades[0].id, "1234").unwrap());

        // e o perfil guardou o vínculo, para não migrar de novo
        let depois = load_profiles(vault.path()).expect("perfis");
        let ana = depois.iter().find(|perfil| perfil.id == "abc").expect("ana");
        assert_eq!(ana.identity_id.as_deref(), Some(identidades[0].id.as_str()));

        // rodar de novo não duplica
        assert_eq!(migrate_profiles_to_identities(app.path(), vault.path()).unwrap(), 0);
    }

    #[test]
    fn vault_novo_ganha_perfil_padrao_na_leitura() {
        let vault = vault_temporario();
        let perfis = load_profiles(vault.path()).expect("perfis");
        assert_eq!(perfis.len(), 1);
        assert_eq!(perfis[0].id, DEFAULT_PROFILE_ID);
        assert!(profiles_path(vault.path()).exists());
    }

    #[test]
    fn perfil_padrao_usa_caminhos_legados_e_novo_perfil_ganha_pasta() {
        let vault = vault_temporario();
        assert_eq!(
            metadata_dir_for(vault.path(), DEFAULT_PROFILE_ID),
            vault.path().join(METADATA_DIRECTORY)
        );
        let novo = metadata_dir_for(vault.path(), "abc123");
        assert!(novo.ends_with(
            Path::new(METADATA_DIRECTORY)
                .join("profiles")
                .join("abc123")
        ));
    }

    #[test]
    fn cria_renomeia_e_recusa_nome_repetido() {
        let vault = vault_temporario();
        let criado = create_profile(vault.path(), "Maria", "sage", None).expect("criar");
        assert_eq!(criado.name, "Maria");
        assert!(!criado.is_default);

        let erro = create_profile(vault.path(), "maria", "sage", None).unwrap_err();
        assert!(erro.to_string().contains("Já existe um perfil"));

        rename_profile(vault.path(), &criado.id, "Maria Silva", Some("brick")).expect("renomear");
        let perfis = load_profiles(vault.path()).expect("perfis");
        let maria = perfis.iter().find(|p| p.id == criado.id).expect("maria");
        assert_eq!(maria.name, "Maria Silva");
        assert_eq!(maria.color, "brick");
    }

    #[test]
    fn pin_nao_vaza_e_e_conferido() {
        let vault = vault_temporario();
        let criado = create_profile(vault.path(), "João", "sage", Some("2468")).expect("criar");
        assert!(criado.has_pin);

        let bruto = fs::read_to_string(profiles_path(vault.path())).expect("json");
        assert!(
            !bruto.contains("2468"),
            "o PIN não pode aparecer no arquivo"
        );

        assert!(verify_pin(vault.path(), &criado.id, "2468").expect("verificar"));
        assert!(!verify_pin(vault.path(), &criado.id, "1357").expect("verificar"));

        set_pin(vault.path(), &criado.id, None).expect("remover pin");
        let perfis = load_profiles(vault.path()).expect("perfis");
        let joao = perfis.iter().find(|p| p.id == criado.id).expect("joao");
        assert!(joao.pin_hash.is_none());
        assert!(verify_pin(vault.path(), &criado.id, "qualquer").expect("sem pin"));
    }

    #[test]
    fn pin_invalido_e_recusado() {
        let vault = vault_temporario();
        assert!(create_profile(vault.path(), "Ana", "sage", Some("12")).is_err());
        assert!(create_profile(vault.path(), "Bia", "sage", Some("abcd")).is_err());
    }

    #[test]
    fn excluir_recusa_o_ultimo_perfil_e_apaga_a_pasta_do_outro() {
        let vault = vault_temporario();
        let erro = delete_profile(vault.path(), DEFAULT_PROFILE_ID).unwrap_err();
        assert!(erro.to_string().contains("único perfil"));

        let criado = create_profile(vault.path(), "Maria", "sage", None).expect("criar");
        let pasta = metadata_dir_for(vault.path(), &criado.id);
        fs::create_dir_all(&pasta).expect("criar pasta");
        fs::write(pasta.join("learning.json"), "{}").expect("arquivo");

        delete_profile(vault.path(), &criado.id).expect("excluir");
        assert!(!pasta.exists(), "a pasta do perfil excluído deve sumir");
        assert_eq!(load_profiles(vault.path()).expect("perfis").len(), 1);
    }

    #[test]
    fn perfil_ativo_vira_caminho_de_metadados() {
        let vault = vault_temporario();
        set_active_profile("abc123");
        assert_eq!(
            metadata_dir_for_active(vault.path()),
            vault
                .path()
                .join(METADATA_DIRECTORY)
                .join("profiles")
                .join("abc123")
        );
        set_active_profile("");
        assert_eq!(
            metadata_dir_for_active(vault.path()),
            vault.path().join(METADATA_DIRECTORY)
        );
    }

    #[test]
    fn sessao_avisa_outra_janela_e_solta_ao_sair() {
        let vault = vault_temporario();
        let perfil = create_profile(vault.path(), "Maria", "sage", None).expect("criar");

        // Simula outro processo com marcador fresco.
        let caminho = session_path(vault.path(), &perfil.id);
        fs::create_dir_all(caminho.parent().expect("pai")).expect("pasta");
        let outro = SessionMarker {
            pid: std::process::id() + 1,
            opened_at_unix_ms: now_ms(),
        };
        fs::write(&caminho, serde_json::to_string(&outro).expect("json")).expect("gravar");

        let erro = acquire_session(vault.path(), &perfil.id, false).unwrap_err();
        assert!(erro.to_string().contains("outra janela"));

        // `force` passa por cima do aviso.
        assert!(acquire_session(vault.path(), &perfil.id, true).is_ok());

        // Marcador antigo não bloqueia (evita travar quem sofreu um crash).
        let velho = SessionMarker {
            pid: std::process::id() + 1,
            opened_at_unix_ms: now_ms() - SESSION_STALE_MS - 1000,
        };
        fs::write(&caminho, serde_json::to_string(&velho).expect("json")).expect("gravar");
        assert!(acquire_session(vault.path(), &perfil.id, false).is_ok());

        release_session(vault.path(), &perfil.id);
        assert!(!caminho.exists());
    }

    /// Tudo que é da pessoa precisa resolver na pasta do perfil, não só o
    /// aprendizado: calibração, consumo de IA e metas também são individuais.
    #[test]
    fn estado_pessoal_resolve_na_pasta_do_perfil() {
        let vault = vault_temporario();

        let sob_maria = with_profile_for_test("maria", || {
            (
                crate::review::calibration::calibration_file_path(vault.path()),
                crate::review::usage::usage_file_path(vault.path()),
                metadata_dir_for_active(vault.path()),
            )
        });
        let esperado = vault
            .path()
            .join(METADATA_DIRECTORY)
            .join("profiles")
            .join("maria");
        assert!(sob_maria.0.starts_with(&esperado), "{:?}", sob_maria.0);
        assert!(sob_maria.1.starts_with(&esperado), "{:?}", sob_maria.1);
        assert_eq!(sob_maria.2, esperado);

        let sob_padrao = with_profile_for_test(DEFAULT_PROFILE_ID, || {
            crate::review::usage::usage_file_path(vault.path())
        });
        assert_eq!(
            sob_padrao,
            vault
                .path()
                .join(METADATA_DIRECTORY)
                .join("review-usage.json")
        );
    }

    #[test]
    fn vinculo_recusa_a_mesma_conta_em_dois_perfis() {
        let vault = vault_temporario();
        let maria = create_profile(vault.path(), "Maria", "sage", None).expect("criar");
        let joao = create_profile(vault.path(), "João", "sage", None).expect("criar");

        let vinculado = link_account(vault.path(), &maria.id, "conta-1").expect("vincular");
        assert!(vinculado.linked);

        let erro = link_account(vault.path(), &joao.id, "conta-1").unwrap_err();
        assert!(erro.to_string().contains("já está vinculada"), "{erro}");

        // Desvincular libera a conta para outro perfil.
        assert!(
            !unlink_account(vault.path(), &maria.id)
                .expect("desvincular")
                .linked
        );
        assert!(link_account(vault.path(), &joao.id, "conta-1").is_ok());
    }

    #[test]
    fn hash_do_pin_muda_com_o_sal() {
        assert_ne!(hash_pin("1234", "sal-a"), hash_pin("1234", "sal-b"));
        assert_eq!(hash_pin("1234", "sal-a"), hash_pin("1234", "sal-a"));
    }
}
