//! Vínculo conta → vault, nesta máquina.
//!
//! A conta não é dona das notas — a pasta é. O que a conta ganha é **memória de
//! quais pastas ela usa aqui**: no primeiro login desta conta nesta máquina não
//! há vínculo, então a abertura mostra "Onde ficam suas notas?" (criar ou
//! escolher); a resposta vira o vínculo e a próxima abertura já vai direto.
//!
//! Regra de decisão igual à dos vaults conhecidos: **um** vínculo abre direto,
//! **dois ou mais** viram escolha. Zero cai no comportamento antigo (vaults
//! conhecidos da máquina), para quem só usa sem conta não perder nada.
//!
//! Por que na máquina e não no servidor: o caminho é local (`C:\...`, `D:\...`)
//! e não faz sentido fora daqui. O servidor já sabe quais vaults pertencem à
//! conta (`vaults.owner_id`), e essa é a pista para o dia em que a pessoa entrar
//! numa máquina nova — mas isso é outra etapa.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const FILE: &str = "account-vaults.json";
/// Teto por conta: além disso "recente" deixa de significar algo.
const MAX_POR_CONTA: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountVault {
    pub path: String,
    pub name: String,
    pub last_opened_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountVaultsFile {
    #[serde(default = "versao")]
    version: u32,
    #[serde(default)]
    accounts: BTreeMap<String, Vec<AccountVault>>,
}

fn versao() -> u32 {
    1
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as i64)
        .unwrap_or(0)
}

fn caminho(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(FILE)
}

fn ler(app_config_dir: &Path) -> Result<AccountVaultsFile> {
    let path = caminho(app_config_dir);
    let Ok(bruto) = fs::read_to_string(&path) else {
        return Ok(AccountVaultsFile::default());
    };
    Ok(serde_json::from_str(&bruto)
        .with_context(|| format!("O arquivo de vinculos esta invalido: {}", path.display()))?)
}

/// Grava em temporário e renomeia: queda no meio deixa o arquivo anterior.
fn gravar(app_config_dir: &Path, dados: &AccountVaultsFile) -> Result<()> {
    fs::create_dir_all(app_config_dir)?;
    let path = caminho(app_config_dir);
    let temporario = path.with_extension("json.tmp");
    fs::write(&temporario, serde_json::to_string_pretty(dados)?)?;
    fs::rename(&temporario, &path)?;
    Ok(())
}

/// Vaults que esta conta já abriu aqui, mais recente primeiro.
pub fn list(app_config_dir: &Path, account_id: &str) -> Result<Vec<AccountVault>> {
    let dados = ler(app_config_dir)?;
    Ok(dados.accounts.get(account_id).cloned().unwrap_or_default())
}

/// Registra (ou atualiza) um vault para esta conta.
pub fn remember(
    app_config_dir: &Path,
    account_id: &str,
    vault_root: &Path,
) -> Result<Vec<AccountVault>> {
    let mut dados = ler(app_config_dir)?;
    let path = vault_root.display().to_string();
    let name = vault_root
        .file_name()
        .and_then(|nome| nome.to_str())
        .unwrap_or(&path)
        .to_string();

    let lista = dados.accounts.entry(account_id.to_string()).or_default();
    lista.retain(|item| item.path != path);
    lista.insert(
        0,
        AccountVault {
            path,
            name,
            last_opened_at_ms: now_ms(),
        },
    );
    lista.truncate(MAX_POR_CONTA);
    let resultado = lista.clone();
    gravar(app_config_dir, &dados)?;
    Ok(resultado)
}

/// Esquece um vault (pasta sumiu, ou a pessoa trocou de pasta de propósito).
pub fn forget(app_config_dir: &Path, account_id: &str, vault_path: &str) -> Result<()> {
    let mut dados = ler(app_config_dir)?;
    if let Some(lista) = dados.accounts.get_mut(account_id) {
        lista.retain(|item| item.path != vault_path);
    }
    gravar(app_config_dir, &dados)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn lembra_por_conta_e_nao_duplica() {
        let app = tempdir().expect("app dir");
        let a = Path::new("C:/vaults/Estudo");
        let b = Path::new("C:/vaults/Medicina");

        remember(app.path(), "conta-1", a).expect("lembrar");
        remember(app.path(), "conta-1", b).expect("lembrar");
        let lista = remember(app.path(), "conta-1", a).expect("lembrar de novo");

        assert_eq!(lista.len(), 2);
        assert_eq!(
            lista[0].path, "C:/vaults/Estudo",
            "o reaberto volta ao topo"
        );
        assert_eq!(lista[0].name, "Estudo");
        // outra conta não vê nada disso
        assert!(list(app.path(), "conta-2").expect("listar").is_empty());
    }

    #[test]
    fn respeita_o_teto_por_conta() {
        let app = tempdir().expect("app dir");
        for indice in 0..(MAX_POR_CONTA + 3) {
            remember(
                app.path(),
                "conta-1",
                Path::new(&format!("C:/vaults/v{indice}")),
            )
            .expect("lembrar");
        }
        let lista = list(app.path(), "conta-1").expect("listar");
        assert_eq!(lista.len(), MAX_POR_CONTA);
        assert_eq!(
            lista[0].path,
            format!("C:/vaults/v{}", MAX_POR_CONTA + 2),
            "o mais recente fica na frente"
        );
    }

    #[test]
    fn esquecer_tira_da_lista_sem_tocar_nas_outras_contas() {
        let app = tempdir().expect("app dir");
        remember(app.path(), "conta-1", Path::new("C:/vaults/A")).unwrap();
        remember(app.path(), "conta-2", Path::new("C:/vaults/B")).unwrap();

        forget(app.path(), "conta-1", "C:/vaults/A").expect("esquecer");

        assert!(list(app.path(), "conta-1").unwrap().is_empty());
        assert_eq!(list(app.path(), "conta-2").unwrap().len(), 1);
    }

    #[test]
    fn arquivo_invalido_nao_derruba_o_app() {
        let app = tempdir().expect("app dir");
        fs::write(caminho(app.path()), "{ nao e json").unwrap();
        assert!(list(app.path(), "conta-1").is_err());
        // e o erro é explicado, não engolido
        let erro = list(app.path(), "conta-1").unwrap_err().to_string();
        assert!(erro.contains("vinculos"));
    }
}
