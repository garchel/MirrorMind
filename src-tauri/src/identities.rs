//! Identidade: quem é a pessoa, independente de qual vault ela abriu.
//!
//! ## O problema que isto resolve
//!
//! Até aqui o "cartão com o nome" morava **dentro da caixa** (`profiles.json` no
//! vault). Isso é certo para o *progresso* — o histórico de revisão é do par
//! pessoa × vault — mas errado para a *identidade*: na tela de abertura o app
//! precisa dizer "quem está entrando" antes de saber qual pasta vai abrir, e a
//! resposta só existia dentro da pasta escolhida.
//!
//! ## O desenho: cartão na gaveta, foto colada na caixa
//!
//! - `identities.json` na **pasta do app** (máquina): a lista viva, é ela que a
//!   abertura lê. Nome, cor, conta vinculada e a verificação do PIN.
//! - `identities.json` em **`.mirmind/`** (vault): o **espelho**, para a pasta não
//!   chegar anônima em outro computador. Quem recebe a pasta adota o espelho.
//!
//! ## Quem manda quando os dois discordam
//!
//! O registro mais recente (`updated_at_unix_ms`) vence, e o lado antigo é
//! reescrito. É a mesma regra que o motor de sync usa para notas — não há um
//! segundo jeito de resolver conflito neste app. O efeito colateral aceito: dois
//! computadores podem discordar do PIN até sincronizarem, e nessa janela o PIN
//! antigo ainda abre (documentado, não escondido).
//!
//! ## PIN continua sendo conveniência
//!
//! O hash fica no arquivo, salgado e iterado. Isso impede o colega de casa de
//! abrir o seu perfil; não impede quem tem acesso ao disco. Vale para o espelho
//! também: ele carrega o mesmo hash, porque a pasta precisa viajar com a
//! proteção junto.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::profiles::{hash_pin, validate_name, validate_pin};

const IDENTITIES_FILE: &str = "identities.json";
const METADATA_DIRECTORY: &str = ".mirmind";
const MAX_IDENTITIES: usize = 24;

fn file_version() -> u32 {
    1
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn random_id_public() -> String {
    random_id()
}

fn random_id() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("o sistema precisa fornecer entropia");
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Registro guardado no JSON. `pin_salt`/`pin_hash` nunca saem para o frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    /// Conta vinculada (id do usuário no servidor). Ausente = convidado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_salt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_hash: Option<String>,
    /// Quando este registro mudou pela última vez. É o critério do "mais
    /// recente vence" entre a máquina e o espelho do vault.
    #[serde(default)]
    pub updated_at_unix_ms: i64,
}

/// O que o frontend vê: sem sal e sem hash, só se existe PIN.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySummary {
    pub id: String,
    pub name: String,
    pub color: String,
    pub has_pin: bool,
    pub linked: bool,
    pub updated_at_unix_ms: i64,
}

impl Identity {
    pub fn summary(&self) -> IdentitySummary {
        IdentitySummary {
            id: self.id.clone(),
            name: self.name.clone(),
            color: self.color.clone(),
            has_pin: self.pin_hash.is_some(),
            linked: self.account_id.is_some(),
            updated_at_unix_ms: self.updated_at_unix_ms,
        }
    }

    fn pin_ok(&self, pin: &str) -> bool {
        match (&self.pin_salt, &self.pin_hash) {
            (Some(salt), Some(hash)) => hash_pin(pin, salt) == *hash,
            // Sem hash não há PIN a conferir — e "sem PIN" não pode virar
            // "aceita qualquer coisa".
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentitiesFile {
    #[serde(default = "file_version")]
    version: u32,
    #[serde(default)]
    identities: Vec<Identity>,
}

fn machine_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(IDENTITIES_FILE)
}

fn mirror_path(vault_root: &Path) -> PathBuf {
    vault_root
        .join(METADATA_DIRECTORY)
        .join(IDENTITIES_FILE)
}

/// Grava em temporário e renomeia: queda no meio deixa o arquivo anterior
/// inteiro, não um JSON pela metade.
fn write_file(path: &Path, lista: &[Identity]) -> Result<()> {
    if let Some(pai) = path.parent() {
        fs::create_dir_all(pai)?;
    }
    let conteudo = serde_json::to_string_pretty(&IdentitiesFile {
        version: file_version(),
        identities: lista.to_vec(),
    })?;
    let temporario = path.with_extension("json.tmp");
    fs::write(&temporario, conteudo)?;
    fs::rename(&temporario, path)?;
    Ok(())
}

fn read_file(path: &Path) -> Result<Vec<Identity>> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    let parsed: IdentitiesFile = serde_json::from_str(&raw)
        .with_context(|| format!("O arquivo de identidades está inválido: {}", path.display()))?;
    Ok(parsed.identities)
}

/// Lista viva (máquina). Não toca no vault.
pub fn load_machine(app_config_dir: &Path) -> Result<Vec<Identity>> {
    read_file(&machine_path(app_config_dir))
}

/// Espelho que veio junto com a pasta.
pub fn load_mirror(vault_root: &Path) -> Result<Vec<Identity>> {
    read_file(&mirror_path(vault_root))
}

pub(crate) fn ordenar(lista: &mut [Identity]) {
    // Mais recente primeiro: é a ordem em que a abertura mostra as pessoas.
    lista.sort_by(|a, b| b.updated_at_unix_ms.cmp(&a.updated_at_unix_ms));
}

pub(crate) fn save_machine(app_config_dir: &Path, lista: &[Identity]) -> Result<()> {
    write_file(&machine_path(app_config_dir), lista)
}

pub(crate) fn save_mirror(vault_root: &Path, lista: &[Identity]) -> Result<()> {
    write_file(&mirror_path(vault_root), lista)
}

/// Mesmo conteúdo, ignorando a ordem (as listas são ordenadas por data).
fn iguais(esquerda: &[Identity], direita: &[Identity]) -> bool {
    if esquerda.len() != direita.len() {
        return false;
    }
    let mut a = esquerda.to_vec();
    let mut b = direita.to_vec();
    a.sort_by(|x, y| x.id.cmp(&y.id));
    b.sort_by(|x, y| x.id.cmp(&y.id));
    a == b
}

/// Funde duas listas pelo id, "mais recente vence". Devolve o resultado e se algo
/// mudou em relação à máquina (para não regravar à toa).
pub fn merge(machine: &[Identity], mirror: &[Identity]) -> (Vec<Identity>, bool) {
    let mut resultado: Vec<Identity> = machine.to_vec();
    let mut mudou = false;

    for remota in mirror {
        match resultado.iter_mut().find(|local| local.id == remota.id) {
            Some(local) => {
                if remota.updated_at_unix_ms > local.updated_at_unix_ms {
                    *local = remota.clone();
                    mudou = true;
                }
            }
            None => {
                // Identidade que só existe no espelho: alguém usou esta pasta
                // noutro computador. Adotar é o ponto do espelho.
                resultado.push(remota.clone());
                mudou = true;
            }
        }
    }

    ordenar(&mut resultado);
    resultado.truncate(MAX_IDENTITIES);
    (resultado, mudou)
}

/// Junta o espelho do vault com a lista da máquina e regrava os dois lados.
pub fn adopt_from_vault(app_config_dir: &Path, vault_root: &Path) -> Result<Vec<Identity>> {
    let machine = load_machine(app_config_dir)?;
    let mirror = load_mirror(vault_root)?;
    let (fundida, _) = merge(&machine, &mirror);

    // Cada lado só é regravado se estiver diferente do resultado. Olhar só se o
    // espelho **tinha** algo novo deixava o caso oposto de fora: máquina mais
    // recente não atualizava o espelho, e a "foto na caixa" envelhecia.
    if !iguais(&fundida, &machine) {
        save_machine(app_config_dir, &fundida)?;
    }
    if !iguais(&fundida, &mirror) {
        save_mirror(vault_root, &fundida)?;
    }

    Ok(fundida)
}

/// Cria uma identidade e grava na máquina; se houver vault, grava o espelho.
pub fn create(
    app_config_dir: &Path,
    vault_root: Option<&Path>,
    account_id: Option<&str>,
    name: &str,
    color: &str,
    pin: Option<&str>,
) -> Result<Identity> {
    let nome = validate_name(name)?;
    let mut identidade = Identity {
        id: random_id(),
        name: nome,
        color: if color.trim().is_empty() {
            "sage".to_string()
        } else {
            color.trim().to_string()
        },
        account_id: account_id.map(|valor| valor.to_string()),
        pin_salt: None,
        pin_hash: None,
        updated_at_unix_ms: now_ms(),
    };

    if let Some(pin) = pin {
        let pin = pin.trim();
        if !pin.is_empty() {
            validate_pin(pin)?;
            let salt = crate::profiles::random_salt();
            identidade.pin_hash = Some(hash_pin(pin, &salt));
            identidade.pin_salt = Some(salt);
        }
    }

    let mut lista = load_machine(app_config_dir)?;
    if lista.len() >= MAX_IDENTITIES {
        bail!("Já existem {MAX_IDENTITIES} identidades nesta máquina.");
    }
    lista.push(identidade.clone());
    ordenar(&mut lista);
    save_machine(app_config_dir, &lista)?;
    if let Some(root) = vault_root {
        let mut espelho = load_mirror(root)?;
        espelho.retain(|existente| existente.id != identidade.id);
        espelho.push(identidade.clone());
        ordenar(&mut espelho);
        save_mirror(root, &espelho)?;
    }
    Ok(identidade)
}

/// Altera nome/cor e/ou PIN. `pin` com `Some(None)` remove o PIN.
pub fn update(
    app_config_dir: &Path,
    vault_root: Option<&Path>,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
    pin: Option<Option<&str>>,
) -> Result<Identity> {
    let mut lista = load_machine(app_config_dir)?;
    let indice = lista
        .iter()
        .position(|item| item.id == id)
        .with_context(|| format!("Identidade '{id}' não encontrada."))?;

    if let Some(nome) = name {
        lista[indice].name = validate_name(nome)?;
    }
    if let Some(cor) = color {
        if !cor.trim().is_empty() {
            lista[indice].color = cor.trim().to_string();
        }
    }
    if let Some(pin) = pin {
        match pin.map(str::trim).filter(|valor| !valor.is_empty()) {
            Some(valor) => {
                validate_pin(valor)?;
                let salt = crate::profiles::random_salt();
                lista[indice].pin_hash = Some(hash_pin(valor, &salt));
                lista[indice].pin_salt = Some(salt);
            }
            None => {
                lista[indice].pin_hash = None;
                lista[indice].pin_salt = None;
            }
        }
    }

    lista[indice].updated_at_unix_ms = now_ms();
    let atualizada = lista[indice].clone();
    ordenar(&mut lista);
    save_machine(app_config_dir, &lista)?;
    gravar_espelho(app_config_dir, vault_root, &atualizada)?;
    Ok(atualizada)
}

/// Propaga um registro para o espelho do vault, se houver vault.
pub fn gravar_espelho(
    app_config_dir: &Path,
    vault_root: Option<&Path>,
    identidade: &Identity,
) -> Result<()> {
    let Some(root) = vault_root else {
        return Ok(());
    };
    let mut espelho = load_mirror(root)?;
    espelho.retain(|existente| existente.id != identidade.id);
    espelho.push(identidade.clone());
    ordenar(&mut espelho);
    save_mirror(root, &espelho)?;
    let _ = app_config_dir;
    Ok(())
}

/// Garante a identidade de uma conta que acabou de entrar.
///
/// Sem isto, quem entra com e-mail/Google e depois usa "sem conta" vira **duas
/// pessoas** — e o histórico de um lado não conversa com o outro. A identidade da
/// conta usa o id do usuário no servidor (`accountId`) e nasce com o nome tirado
/// do e-mail.
///
/// Idempotente e **sem sobrescrever**: se a pessoa já renomeou a identidade em
/// Configurações › Perfil, entrar de novo não devolve o nome do e-mail.
pub fn ensure_account_identity(
    app_config_dir: &Path,
    account_id: &str,
    email: Option<&str>,
) -> Result<Identity> {
    let mut lista = load_machine(app_config_dir)?;
    if let Some(existente) = lista
        .iter()
        .find(|item| item.account_id.as_deref() == Some(account_id))
        .cloned()
    {
        return Ok(existente);
    }

    let nome = email
        .and_then(|valor| valor.split('@').next())
        .map(str::trim)
        .filter(|valor| !valor.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Conta".to_string());

    let identidade = Identity {
        id: random_id(),
        name: nome,
        color: "sage".to_string(),
        account_id: Some(account_id.to_string()),
        pin_salt: None,
        pin_hash: None,
        updated_at_unix_ms: now_ms(),
    };
    lista.push(identidade.clone());
    ordenar(&mut lista);
    save_machine(app_config_dir, &lista)?;
    Ok(identidade)
}

/// Registro vindo de um perfil do vault, para o caso de a edição ter sido
/// feita lá (renomear, trocar PIN no portão de perfis).
pub struct IdentitySnapshot<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub color: &'a str,
    pub pin_salt: Option<&'a str>,
    pub pin_hash: Option<&'a str>,
    pub updated_at_unix_ms: i64,
}

/// Propaga para a identidade uma edição feita no perfil do vault.
///
/// A regra é a mesma dos dois arquivos: **o mais recente vence**. Se a identidade
/// já é mais nova (PIN trocado noutra máquina, por exemplo), nada acontece — não
/// vale reverter uma mudança legítima para "consertar" a foto.
pub fn sync_from_profile(
    app_config_dir: &Path,
    vault_root: &Path,
    snapshot: IdentitySnapshot<'_>,
) -> Result<bool> {
    let mut lista = load_machine(app_config_dir)?;
    let Some(indice) = lista.iter().position(|item| item.id == snapshot.id) else {
        return Ok(false);
    };
    if lista[indice].updated_at_unix_ms >= snapshot.updated_at_unix_ms {
        return Ok(false);
    }

    lista[indice].name = snapshot.name.to_string();
    lista[indice].color = snapshot.color.to_string();
    lista[indice].pin_salt = snapshot.pin_salt.map(str::to_string);
    lista[indice].pin_hash = snapshot.pin_hash.map(str::to_string);
    lista[indice].updated_at_unix_ms = snapshot.updated_at_unix_ms;
    let atualizada = lista[indice].clone();

    ordenar(&mut lista);
    save_machine(app_config_dir, &lista)?;
    gravar_espelho(app_config_dir, Some(vault_root), &atualizada)?;
    Ok(true)
}

/// Confere o PIN contra o registro **mais recente** que a máquina conhece.
pub fn verify_pin(app_config_dir: &Path, id: &str, pin: &str) -> Result<bool> {
    let lista = load_machine(app_config_dir)?;
    let identidade = lista
        .iter()
        .find(|item| item.id == id)
        .with_context(|| format!("Identidade '{id}' não encontrada."))?;
    Ok(identidade.pin_ok(pin))
}

/// Convidados, mais recente primeiro. Conta vinculada fica de fora: quem entrou
/// com conta não precisa escolher perfil na abertura.
pub fn guests(app_config_dir: &Path) -> Result<Vec<IdentitySummary>> {
    let mut lista = load_machine(app_config_dir)?;
    ordenar(&mut lista);
    Ok(lista
        .into_iter()
        .filter(|item| item.account_id.is_none())
        .map(|item| item.summary())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn vault() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault temporario")
    }

    #[test]
    fn criar_grava_na_maquina_e_no_espelho_do_vault() {
        let app = tempdir().expect("app dir");
        let vault = vault();

        let criada = create(app.path(), Some(vault.path()), None, "Paulo", "sage", None)
            .expect("identidade");

        assert_eq!(load_machine(app.path()).unwrap().len(), 1);
        let espelho = load_mirror(vault.path()).unwrap();
        assert_eq!(espelho.len(), 1);
        assert_eq!(espelho[0].id, criada.id);
        assert_eq!(espelho[0].name, "Paulo");
    }

    #[test]
    fn espelho_de_outra_maquina_e_adotado() {
        // Simula: a pasta veio de outro computador com a identidade da Ana dentro.
        let app = tempdir().expect("app dir");
        let vault = vault();
        let ana = Identity {
            id: "ana-1".into(),
            name: "Ana".into(),
            color: "brick".into(),
            account_id: None,
            pin_salt: None,
            pin_hash: None,
            updated_at_unix_ms: 1_000,
        };
        save_mirror(vault.path(), &[ana.clone()]).unwrap();

        let lista = adopt_from_vault(app.path(), vault.path()).expect("adocao");

        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].name, "Ana");
        // e passou a existir na máquina
        assert_eq!(load_machine(app.path()).unwrap()[0].id, "ana-1");
    }

    #[test]
    fn o_mais_recente_vence_nos_dois_sentidos() {
        let app = tempdir().expect("app dir");
        let vault = vault();

        let velha = Identity {
            id: "x".into(),
            name: "Nome velho".into(),
            color: "sage".into(),
            account_id: None,
            pin_salt: None,
            pin_hash: None,
            updated_at_unix_ms: 100,
        };
        let nova = Identity {
            name: "Nome novo".into(),
            updated_at_unix_ms: 200,
            ..velha.clone()
        };

        // máquina nova, espelho velho -> o do espelho é sobrescrito
        save_machine(app.path(), &[nova.clone()]).unwrap();
        save_mirror(vault.path(), &[velha.clone()]).unwrap();
        let lista = adopt_from_vault(app.path(), vault.path()).unwrap();
        assert_eq!(lista[0].name, "Nome novo");
        assert_eq!(load_mirror(vault.path()).unwrap()[0].name, "Nome novo");

        // espelho novo, máquina velha -> a máquina é atualizada
        save_machine(app.path(), &[velha.clone()]).unwrap();
        save_mirror(vault.path(), &[nova.clone()]).unwrap();
        let lista = adopt_from_vault(app.path(), vault.path()).unwrap();
        assert_eq!(lista[0].name, "Nome novo");
        assert_eq!(load_machine(app.path()).unwrap()[0].name, "Nome novo");
    }

    #[test]
    fn pin_confere_e_recusa_o_errado() {
        let app = tempdir().expect("app dir");
        let criada = create(app.path(), None, None, "Paulo", "sage", Some("1234")).unwrap();

        assert!(verify_pin(app.path(), &criada.id, "1234").unwrap());
        assert!(!verify_pin(app.path(), &criada.id, "9999").unwrap());
        // sem hash nenhum, ninguém entra com PIN vazio por engano
        let sem_pin = create(app.path(), None, None, "Ana", "sage", None).unwrap();
        assert!(!verify_pin(app.path(), &sem_pin.id, "").unwrap());
    }

    #[test]
    fn atualizar_nome_e_pin_propaga_para_o_espelho() {
        let app = tempdir().expect("app dir");
        let vault = vault();
        let criada = create(app.path(), Some(vault.path()), None, "Paulo", "sage", None).unwrap();

        update(app.path(), Some(vault.path()), &criada.id, Some("Paulo H."), None, Some(Some("4321")))
            .expect("update");

        let espelho = load_mirror(vault.path()).unwrap();
        assert_eq!(espelho[0].name, "Paulo H.");
        assert!(verify_pin(app.path(), &criada.id, "4321").unwrap());

        // remover o PIN também viaja
        update(app.path(), Some(vault.path()), &criada.id, None, None, Some(None)).unwrap();
        assert!(load_mirror(vault.path()).unwrap()[0].pin_hash.is_none());
    }

    #[test]
    fn nome_vazio_e_pin_curto_sao_recusados() {
        let app = tempdir().expect("app dir");
        assert!(create(app.path(), None, None, "   ", "sage", None).is_err());
        assert!(create(app.path(), None, None, "Ana", "sage", Some("12")).is_err());
        assert!(create(app.path(), None, None, "Ana", "sage", Some("abcd")).is_err());
    }


    #[test]
    fn edicao_feita_no_perfil_do_vault_chega_na_identidade() {
        let app = tempdir().expect("app dir");
        let vault = vault();
        let criada = create(app.path(), Some(vault.path()), None, "Paulo", "sage", None).unwrap();

        // perfil do vault renomeado e com PIN novo, mais recente que a identidade
        let salt = crate::profiles::random_salt();
        let hash = crate::profiles::hash_pin("4321", &salt);
        let atualizou = sync_from_profile(
            app.path(),
            vault.path(),
            IdentitySnapshot {
                id: &criada.id,
                name: "Paulo H.",
                color: "brick",
                pin_salt: Some(&salt),
                pin_hash: Some(&hash),
                updated_at_unix_ms: criada.updated_at_unix_ms + 10,
            },
        )
        .expect("sync");
        assert!(atualizou);
        assert_eq!(load_machine(app.path()).unwrap()[0].name, "Paulo H.");
        assert!(verify_pin(app.path(), &criada.id, "4321").unwrap());
        // e o espelho dentro do vault acompanhou
        assert_eq!(load_mirror(vault.path()).unwrap()[0].name, "Paulo H.");

        // snapshot mais velho não reescreve nada (não reverte mudança legítima)
        let reverteu = sync_from_profile(
            app.path(),
            vault.path(),
            IdentitySnapshot {
                id: &criada.id,
                name: "Nome antigo",
                color: "sage",
                pin_salt: None,
                pin_hash: None,
                updated_at_unix_ms: criada.updated_at_unix_ms,
            },
        )
        .expect("sync");
        assert!(!reverteu);
        assert_eq!(load_machine(app.path()).unwrap()[0].name, "Paulo H.");
    }

    #[test]
    fn conta_entra_uma_vez_so_e_nao_perde_o_nome_escolhido() {
        let app = tempdir().expect("app dir");

        let primeira =
            ensure_account_identity(app.path(), "acc-1", Some("paulo@exemplo.com")).unwrap();
        assert_eq!(primeira.name, "paulo");
        assert_eq!(primeira.account_id.as_deref(), Some("acc-1"));

        // segunda entrada: mesma identidade, sem duplicar
        let segunda = ensure_account_identity(app.path(), "acc-1", Some("paulo@exemplo.com")).unwrap();
        assert_eq!(segunda.id, primeira.id);
        assert_eq!(load_machine(app.path()).unwrap().len(), 1);

        // renomeou em Configurações › Perfil? entrar de novo não devolve o e-mail
        update(app.path(), None, &primeira.id, Some("Paulo H."), None, None).unwrap();
        let terceira = ensure_account_identity(app.path(), "acc-1", Some("paulo@exemplo.com")).unwrap();
        assert_eq!(terceira.name, "Paulo H.");
    }

    #[test]
    fn conta_sem_email_ainda_ganha_nome() {
        let app = tempdir().expect("app dir");
        let criada = ensure_account_identity(app.path(), "acc-2", None).unwrap();
        assert_eq!(criada.name, "Conta");
    }

    #[test]
    fn convidados_nao_incluem_quem_tem_conta() {
        let app = tempdir().expect("app dir");
        create(app.path(), None, None, "Convidado", "sage", None).unwrap();
        create(app.path(), None, Some("acc-1"), "Conta", "sage", None).unwrap();

        let lista = guests(app.path()).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].name, "Convidado");
        assert!(!lista[0].linked);
    }

    #[test]
    fn merge_nao_duplica_o_mesmo_id() {
        let a = Identity {
            id: "1".into(),
            name: "Um".into(),
            color: "sage".into(),
            account_id: None,
            pin_salt: None,
            pin_hash: None,
            updated_at_unix_ms: 10,
        };
        let (lista, mudou) = merge(&[a.clone()], &[a.clone()]);
        assert_eq!(lista.len(), 1);
        assert!(!mudou);
    }
}
