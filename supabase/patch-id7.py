import pathlib


def patch(path, trocas):
    p = pathlib.Path(path)
    t = p.read_text(encoding="utf-8")
    for antigo, novo, rotulo in trocas:
        assert antigo in t, f"{path}: {rotulo}"
        t = t.replace(antigo, novo, 1)
    p.write_text(t, encoding="utf-8")
    print(f"{path}: ok")


# 1. identidades: ligar/desligar conta
patch(
    "src-tauri/src/identities.rs",
    [
        (
            "/// Registro vindo de um perfil do vault, para o caso de a edição ter sido",
            """/// Liga (ou desliga) uma identidade a uma conta.
///
/// Caminho **perfil → conta**: a pessoa vincula o perfil do vault a uma conta
/// existente na tela de perfis. Sem espelhar isso na identidade, ela continuaria
/// aparecendo na lista de convidados mesmo depois de virar conta.
pub fn set_account_link(
    app_config_dir: &Path,
    vault_root: &Path,
    identity_id: &str,
    account_id: Option<&str>,
) -> Result<bool> {
    let mut lista = load_machine(app_config_dir)?;
    let Some(indice) = lista.iter().position(|item| item.id == identity_id) else {
        return Ok(false);
    };
    lista[indice].account_id = account_id.map(str::to_string);
    lista[indice].updated_at_unix_ms = now_ms();
    let atualizada = lista[indice].clone();
    ordenar(&mut lista);
    save_machine(app_config_dir, &lista)?;
    gravar_espelho(app_config_dir, Some(vault_root), &atualizada)?;
    Ok(true)
}

/// Registro vindo de um perfil do vault, para o caso de a edição ter sido""",
            "set_account_link",
        ),
        (
            "    #[test]\n    fn conta_entra_uma_vez_so_e_nao_perde_o_nome_escolhido()",
            """    #[test]
    fn vincular_perfil_a_conta_tira_a_identidade_dos_convidados() {
        let app = tempdir().expect("app dir");
        let vault = vault();
        let criada = create(app.path(), Some(vault.path()), None, "Paulo", "sage", None).unwrap();
        assert_eq!(guests(app.path()).unwrap().len(), 1);

        assert!(set_account_link(app.path(), vault.path(), &criada.id, Some("acc-9")).unwrap());
        assert!(guests(app.path()).unwrap().is_empty());
        assert_eq!(
            load_machine(app.path()).unwrap()[0].account_id.as_deref(),
            Some("acc-9")
        );
        // e o espelho dentro do vault acompanhou
        assert_eq!(
            load_mirror(vault.path()).unwrap()[0].account_id.as_deref(),
            Some("acc-9")
        );

        // desvincular devolve para a lista de convidados
        assert!(set_account_link(app.path(), vault.path(), &criada.id, None).unwrap());
        assert_eq!(guests(app.path()).unwrap().len(), 1);
    }

    #[test]
    fn conta_entra_uma_vez_so_e_nao_perde_o_nome_escolhido()""",
            "teste do vinculo com conta",
        ),
    ],
)

# 2. profiles: as duas pontas espelham o vinculo
patch(
    "src-tauri/src/profiles.rs",
    [
        (
            """pub fn profiles_link_account(
    vault_root: String,
    id: String,
    account_id: String,""",
            """/// Espelha na identidade o vínculo (ou a remoção dele) feito no perfil do vault.
fn espelhar_vinculo(app: &tauri::AppHandle, vault_root: &Path, profile_id: &str) {
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
    let _ = crate::identities::set_account_link(
        &app_dir,
        vault_root,
        &identity_id,
        perfil.account_id.as_deref(),
    );
}

pub fn profiles_link_account(
    vault_root: String,
    id: String,
    account_id: String,""",
            "helper do vinculo",
        ),
    ],
)

# 3. os comandos ganham app e chamam o espelho
p = pathlib.Path("src-tauri/src/profiles.rs")
t = p.read_text(encoding="utf-8")

t = t.replace('''#[tauri::command]
pub fn profiles_link_account(
    vault_root: String,
    id: String,
    account_id: String,''', '''#[tauri::command]
pub fn profiles_link_account(
    app: tauri::AppHandle,
    vault_root: String,
    id: String,
    account_id: String,''', 1)

p.write_text(t, encoding="utf-8")
print("profiles_link_account: app injetado")

# corpo do comando: chamar o espelho depois de gravar
t = p.read_text(encoding="utf-8")
inicio = t.index("pub fn profiles_link_account(")
trecho = t[inicio:inicio + 900]
print("--- trecho atual ---")
print(trecho[:600])
