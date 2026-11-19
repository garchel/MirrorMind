//! Executor da sincronização: transforma o plano em arquivos.
//!
//! `cloud::plan_sync` decide **o que** fazer; aqui se faz. A separação não é
//! enfeite: o plano é puro (entra mapa, sai lista de ações) e por isso é testável
//! sem rede; o executor fala com o transporte, mexe no disco e é testado com um
//! transporte em memória.
//!
//! Ordem das operações, e por quê:
//!
//! - **Subir**: conteúdo primeiro, metadado depois. Se o metadado falhar (cota,
//!   por exemplo), o conteúdo recém-enviado é removido. O contrário deixaria um
//!   arquivo "existindo" na nuvem sem bytes — e o outro computador baixaria lixo.
//! - **Descer**: o hash do conteúdo recebido é conferido antes de gravar. Download
//!   corrompido não vira nota corrompida.
//! - **Conflito**: a versão da nuvem vira uma cópia com sufixo, e o arquivo local
//!   fica intacto. A base passa a apontar para a versão remota, então a próxima
//!   sincronização sobe a sua versão — nada é escolhido por você, e nada se perde.
//! - **Exclusão**: o arquivo vai para `.mirmind/cloud-deleted/`, não para o lixo
//!   do sistema. Exclusão vinda de outro computador é o caso em que mais se
//!   arrepende.

use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::cloud::{
    content_hash, load_state, plan_sync, save_state, FileKind, LocalFile, RemoteFile, SyncAction,
    MAX_UPLOAD_BYTES,
};

const METADATA_DIRECTORY: &str = ".mirmind";
const TRASH_DIRECTORY: &str = "trash";
const DELETED_HOLD_DIRECTORY: &str = "cloud-deleted";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncReport {
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    pub conflicts: Vec<String>,
    pub deleted: Vec<String>,
    /// Arquivos grandes demais para o bucket (ficam só aqui).
    pub skipped: Vec<String>,
    /// Falhas por arquivo: o sync continua nos outros em vez de abortar tudo.
    pub failed: Vec<(String, String)>,
    pub bytes_up: u64,
    pub bytes_down: u64,
}

impl SyncReport {
    fn new() -> Self {
        Self {
            uploaded: Vec::new(),
            downloaded: Vec::new(),
            conflicts: Vec::new(),
            deleted: Vec::new(),
            skipped: Vec::new(),
            failed: Vec::new(),
            bytes_up: 0,
            bytes_down: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.uploaded.is_empty()
            && self.downloaded.is_empty()
            && self.conflicts.is_empty()
            && self.deleted.is_empty()
            && self.skipped.is_empty()
            && self.failed.is_empty()
    }
}

/// O que o executor precisa da nuvem. Implementado pelo cliente HTTP em
/// `cloud_api::HttpTransport` e, nos testes, por um mapa em memória.
pub trait CloudTransport {
    fn list(&self) -> Result<Vec<RemoteFile>>;
    fn upsert_metadata(&self, file: &RemoteFile) -> Result<()>;
    /// O conteúdo é identificado pelo **hash**, não pelo caminho da nota: um
    /// arquivo editado vira outro objeto na nuvem. Ver `cloud::storage_path`.
    fn upload(&self, content_hash: &str, bytes: &[u8]) -> Result<()>;
    fn download(&self, content_hash: &str) -> Result<Vec<u8>>;
    /// Remove um objeto do bucket (conteúdo recusado, ou versão que ninguém usa).
    fn delete_content(&self, content_hash: &str) -> Result<()>;
}

#[derive(Debug, Clone)]
pub struct SyncOptions {
    /// Anexos podem ser pesados; desligar é útil para um vault só de notas.
    pub include_attachments: bool,
    pub max_file_bytes: u64,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            include_attachments: true,
            max_file_bytes: MAX_UPLOAD_BYTES,
        }
    }
}

fn is_noise(component: &str) -> bool {
    component == METADATA_DIRECTORY || component == TRASH_DIRECTORY
}

/// Caminho relativo normalizado com `/` (igual ao que vai para a nuvem).
fn relative_key(vault_root: &Path, path: &Path) -> Option<String> {
    let relativo = path.strip_prefix(vault_root).ok()?;
    let mut partes = Vec::new();
    for componente in relativo.components() {
        match componente {
            Component::Normal(os) => {
                let texto = os.to_str()?;
                if is_noise(texto) {
                    return None;
                }
                partes.push(texto.to_string());
            }
            // `..` nunca deveria aparecer num vault; recusar é mais seguro.
            Component::ParentDir => return None,
            _ => {}
        }
    }
    Some(partes.join("/"))
}

/// Varre o vault e devolve hash e tamanho de cada arquivo. `.mirmind/` e `trash/`
/// ficam de fora: são estado interno e lixeira, não conteúdo do usuário.
pub fn scan_local(vault_root: &Path, options: &SyncOptions) -> Result<BTreeMap<String, LocalFile>> {
    let raiz = vault_root
        .canonicalize()
        .with_context(|| "O vault não existe mais no disco.")?;
    let mut arquivos = BTreeMap::new();
    visitar(&raiz, &raiz, options, &mut arquivos)?;
    Ok(arquivos)
}

fn visitar(
    raiz: &Path,
    pasta: &Path,
    options: &SyncOptions,
    saida: &mut BTreeMap<String, LocalFile>,
) -> Result<()> {
    let entradas = fs::read_dir(pasta)
        .with_context(|| format!("Não foi possível ler a pasta {}.", pasta.display()))?;

    for entrada in entradas {
        let entrada = entrada?;
        let caminho = entrada.path();
        let nome = entrada.file_name().to_string_lossy().to_string();
        if nome == METADATA_DIRECTORY || nome == TRASH_DIRECTORY {
            continue;
        }
        // Arquivos temporários do próprio sync e do editor nunca sobem.
        if nome.ends_with(".sync-tmp") || nome.starts_with(".mirmind-") {
            continue;
        }

        let tipo = entrada.file_type()?;
        if tipo.is_dir() {
            visitar(raiz, &caminho, options, saida)?;
            continue;
        }
        if !tipo.is_file() {
            // atalho, dispositivo, link quebrado: fora do sync
            continue;
        }

        let Some(chave) = relative_key(raiz, &caminho) else {
            continue;
        };
        let eh_nota = caminho
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !eh_nota && !options.include_attachments {
            continue;
        }

        let bytes = match fs::read(&caminho) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        saida.insert(
            chave.clone(),
            LocalFile {
                path: chave,
                kind: if eh_nota {
                    FileKind::Note
                } else {
                    FileKind::Attachment
                },
                hash: content_hash(&bytes),
                size_bytes: bytes.len() as u64,
                exists: true,
            },
        );
    }

    Ok(())
}

/// Quantos arquivos da nuvem apontam para o mesmo conteúdo. Dois caminhos com texto
/// idêntico compartilham um objeto só (o nome é o hash); apagar o objeto porque um
/// deles mudou destruiria o outro.
fn contar_usos(remoto: &BTreeMap<String, RemoteFile>, hash: &str) -> usize {
    remoto
        .values()
        .filter(|arquivo| arquivo.hash == hash && !arquivo.deleted)
        .count()
}

fn target_path(vault_root: &Path, relative: &str) -> Result<PathBuf> {
    // O caminho vem da nuvem: `..` ou caminho absoluto seria escrita fora do
    // vault. Recusar aqui é a única defesa que importa.
    let relativo = Path::new(relative);
    if relativo.is_absolute() {
        bail!("Caminho absoluto vindo da nuvem foi recusado: {relative}");
    }
    for componente in relativo.components() {
        match componente {
            Component::Normal(_) => {}
            _ => bail!("Caminho inválido vindo da nuvem: {relative}"),
        }
    }
    Ok(vault_root.join(relativo))
}

fn write_atomically(target: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(pai) = target.parent() {
        fs::create_dir_all(pai)?;
    }
    let temp = target.with_extension(format!(
        "{}sync-tmp",
        target
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!("{e}."))
            .unwrap_or_default()
    ));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, target)?;
    Ok(())
}

fn conflict_copy_path(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("nota")
        .to_string();
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("md");
    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    target.with_file_name(format!("{stem} (conflito {agora}).{ext}"))
}

fn hold_deleted_copy(vault_root: &Path, relative: &str, target: &Path) -> Result<()> {
    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let destino = vault_root
        .join(METADATA_DIRECTORY)
        .join(DELETED_HOLD_DIRECTORY)
        .join(agora.to_string())
        .join(relative);
    if let Some(pai) = destino.parent() {
        fs::create_dir_all(pai)?;
    }
    // Renomear preserva o arquivo original; se falhar (outro volume), copia.
    if fs::rename(target, &destino).is_err() {
        fs::copy(target, &destino)?;
        fs::remove_file(target)?;
    }
    Ok(())
}

/// Executa o plano e devolve o relatório. Falha por arquivo não aborta o resto —
/// um anexo com problema não pode impedir 300 notas de sincronizar.
pub fn run_sync(
    vault_root: &Path,
    transport: &dyn CloudTransport,
    options: &SyncOptions,
) -> Result<SyncReport> {
    let mut estado = load_state(vault_root);
    let local = scan_local(vault_root, options)?;
    let remoto: BTreeMap<String, RemoteFile> = transport
        .list()?
        .into_iter()
        .map(|arquivo| (arquivo.path.clone(), arquivo))
        .collect();

    let plano = plan_sync(&local, &remoto, &estado.last_synced);
    let mut relatorio = SyncReport::new();

    for acao in plano {
        match acao {
            SyncAction::Settle { path } => {
                if let Some(arquivo) = local.get(&path) {
                    estado.last_synced.insert(path, arquivo.hash.clone());
                }
            }

            SyncAction::Upload { path } => {
                let Some(arquivo) = local.get(&path) else {
                    continue;
                };
                if arquivo.size_bytes > options.max_file_bytes {
                    relatorio.skipped.push(path);
                    continue;
                }
                let alvo = match target_path(vault_root, &path) {
                    Ok(alvo) => alvo,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };
                let bytes = match fs::read(&alvo) {
                    Ok(bytes) => bytes,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };

                // conteúdo primeiro: metadado só existe se o bytes subiram
                if let Err(erro) = transport.upload(&arquivo.hash, &bytes) {
                    relatorio.failed.push((path, erro.to_string()));
                    continue;
                }
                let metadado = RemoteFile {
                    path: arquivo.path.clone(),
                    kind: arquivo.kind,
                    hash: arquivo.hash.clone(),
                    size_bytes: arquivo.size_bytes,
                    deleted: false,
                };
                if let Err(erro) = transport.upsert_metadata(&metadado) {
                    // cota estourada, por exemplo: não deixa conteúdo órfão
                    let _ = transport.delete_content(&arquivo.hash);
                    relatorio.failed.push((path, erro.to_string()));
                    continue;
                }
                // A versão anterior deste caminho deixa de ser referenciada — mas só
                // se nenhum outro arquivo usa o mesmo conteúdo (dedupe pelo hash).
                if let Some(anterior) = remoto.get(&path) {
                    if anterior.hash != arquivo.hash && contar_usos(&remoto, &anterior.hash) <= 1 {
                        let _ = transport.delete_content(&anterior.hash);
                    }
                }
                estado
                    .last_synced
                    .insert(path.clone(), arquivo.hash.clone());
                relatorio.bytes_up += arquivo.size_bytes;
                relatorio.uploaded.push(path);
            }

            SyncAction::Download { path } => {
                let Some(remoto_arq) = remoto.get(&path) else {
                    continue;
                };
                let alvo = match target_path(vault_root, &path) {
                    Ok(alvo) => alvo,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };
                let bytes = match transport.download(&remoto_arq.hash) {
                    Ok(bytes) => bytes,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };
                // Integridade: hash diferente do metadado = download corrompido.
                if content_hash(&bytes) != remoto_arq.hash {
                    relatorio.failed.push((
                        path,
                        "o conteúdo baixado não confere com o hash".to_string(),
                    ));
                    continue;
                }
                if let Err(erro) = write_atomically(&alvo, &bytes) {
                    relatorio.failed.push((path, erro.to_string()));
                    continue;
                }
                estado
                    .last_synced
                    .insert(path.clone(), remoto_arq.hash.clone());
                relatorio.bytes_down += bytes.len() as u64;
                relatorio.downloaded.push(path);
            }

            SyncAction::Conflict { path } => {
                let Some(remoto_arq) = remoto.get(&path) else {
                    continue;
                };
                let alvo = match target_path(vault_root, &path) {
                    Ok(alvo) => alvo,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };
                match transport.download(&remoto_arq.hash) {
                    Ok(bytes) => {
                        let copia = conflict_copy_path(&alvo);
                        if let Err(erro) = write_atomically(&copia, &bytes) {
                            relatorio.failed.push((path, erro.to_string()));
                            continue;
                        }
                        // A base passa a ser a versão da nuvem: na próxima vez o
                        // seu arquivo sobe, e a cópia vai junto como nota nova.
                        estado
                            .last_synced
                            .insert(path.clone(), remoto_arq.hash.clone());
                        relatorio.bytes_down += bytes.len() as u64;
                        relatorio.conflicts.push(path);
                    }
                    Err(erro) => relatorio.failed.push((path, erro.to_string())),
                }
            }

            SyncAction::MarkDeleted { path } => {
                let alvo = match target_path(vault_root, &path) {
                    Ok(alvo) => alvo,
                    Err(erro) => {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                };
                if alvo.exists() {
                    if let Err(erro) = hold_deleted_copy(vault_root, &path, &alvo) {
                        relatorio.failed.push((path, erro.to_string()));
                        continue;
                    }
                }
                if let Some(remoto_arq) = remoto.get(&path) {
                    if !remoto_arq.deleted && contar_usos(&remoto, &remoto_arq.hash) <= 1 {
                        let _ = transport.delete_content(&remoto_arq.hash);
                    }
                }
                estado.last_synced.remove(&path);
                relatorio.deleted.push(path);
            }
        }
    }

    save_state(vault_root, &estado)?;
    Ok(relatorio)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Memoria {
        /// metadados: caminho -> (hash, excluído)
        arquivos: RefCell<BTreeMap<String, (String, bool)>>,
        /// conteúdo: hash -> bytes
        objetos: RefCell<BTreeMap<String, Vec<u8>>>,
    }

    impl Memoria {
        fn new() -> Self {
            Self {
                arquivos: RefCell::new(BTreeMap::new()),
                objetos: RefCell::new(BTreeMap::new()),
            }
        }

        fn colocar(&self, path: &str, bytes: &[u8]) {
            let hash = content_hash(bytes);
            self.objetos
                .borrow_mut()
                .insert(hash.clone(), bytes.to_vec());
            self.arquivos
                .borrow_mut()
                .insert(path.to_string(), (hash, false));
        }
    }

    impl CloudTransport for Memoria {
        fn list(&self) -> Result<Vec<RemoteFile>> {
            Ok(self
                .arquivos
                .borrow()
                .iter()
                .map(|(path, (hash, deleted))| RemoteFile {
                    path: path.clone(),
                    kind: if path.ends_with(".md") {
                        FileKind::Note
                    } else {
                        FileKind::Attachment
                    },
                    hash: hash.clone(),
                    size_bytes: self
                        .objetos
                        .borrow()
                        .get(hash)
                        .map(|bytes| bytes.len() as u64)
                        .unwrap_or(0),
                    deleted: *deleted,
                })
                .collect())
        }

        fn upsert_metadata(&self, file: &RemoteFile) -> Result<()> {
            self.arquivos
                .borrow_mut()
                .insert(file.path.clone(), (file.hash.clone(), file.deleted));
            Ok(())
        }

        fn upload(&self, content_hash: &str, bytes: &[u8]) -> Result<()> {
            // o objeto é o conteúdo: guardar por hash é o que a nuvem real faz
            self.objetos
                .borrow_mut()
                .insert(content_hash.to_string(), bytes.to_vec());
            Ok(())
        }

        fn download(&self, content_hash: &str) -> Result<Vec<u8>> {
            self.objetos
                .borrow()
                .get(content_hash)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("objeto ausente na nuvem"))
        }

        fn delete_content(&self, content_hash: &str) -> Result<()> {
            self.objetos.borrow_mut().remove(content_hash);
            Ok(())
        }
    }

    fn vault() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault")
    }

    fn escrever(vault: &Path, relativo: &str, conteudo: &str) {
        let caminho = vault.join(relativo);
        fs::create_dir_all(caminho.parent().expect("pai")).expect("pasta");
        fs::write(caminho, conteudo).expect("nota");
    }

    #[test]
    fn varredura_ignora_estado_interno_e_lixeira() {
        let vault = vault();
        escrever(vault.path(), "notas/a.md", "# a");
        escrever(vault.path(), "attachments/imagem.png", "bytes");
        escrever(vault.path(), ".mirmind/config.json", "{}");
        escrever(vault.path(), "trash/velha.md", "# velha");

        let arquivos = scan_local(vault.path(), &SyncOptions::default()).expect("varrer");
        let chaves: Vec<&String> = arquivos.keys().collect();
        assert_eq!(chaves, vec!["attachments/imagem.png", "notas/a.md"]);
        assert_eq!(arquivos["notas/a.md"].kind, FileKind::Note);
        assert_eq!(
            arquivos["attachments/imagem.png"].kind,
            FileKind::Attachment
        );
    }

    #[test]
    fn primeira_sincronizacao_sobe_tudo_e_a_segunda_nao_faz_nada() {
        let vault = vault();
        escrever(vault.path(), "a.md", "# a");
        escrever(vault.path(), "b.md", "# b");
        let nuvem = Memoria::new();

        let primeiro = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert_eq!(primeiro.uploaded.len(), 2);
        assert!(primeiro.bytes_up > 0);

        let segundo = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert!(
            segundo.is_empty(),
            "sem mudanca, nada pode acontecer: {segundo:?}"
        );
    }

    #[test]
    fn duas_notas_iguais_compartilham_um_objeto_e_apagar_uma_nao_derruba_a_outra() {
        let vault = vault();
        // mesmo conteúdo em caminhos diferentes: um objeto só
        escrever(vault.path(), "a.md", "texto igual");
        escrever(vault.path(), "b.md", "texto igual");
        let nuvem = Memoria::new();

        run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("base");
        assert_eq!(
            nuvem.objetos.borrow().len(),
            1,
            "conteúdo igual é guardado uma vez"
        );

        // um dos dois muda: o objeto antigo continua porque o outro ainda usa
        escrever(vault.path(), "a.md", "texto novo");
        run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert_eq!(
            nuvem.objetos.borrow().len(),
            2,
            "o objeto antigo é necessário para b.md"
        );
        assert_eq!(
            nuvem
                .objetos
                .borrow()
                .get(&content_hash(b"texto igual"))
                .map(|bytes| bytes.len()),
            Some(11),
            "o conteúdo de b.md continua na nuvem"
        );
    }

    #[test]
    fn arquivo_criado_na_nuvem_desce_igual() {
        let vault = vault();
        let nuvem = Memoria::new();
        nuvem.colocar("outra/nota.md", b"# vinda de la");

        let relatorio = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert_eq!(relatorio.downloaded, vec!["outra/nota.md".to_string()]);
        let baixado = fs::read(vault.path().join("outra/nota.md")).expect("arquivo");
        assert_eq!(baixado, b"# vinda de la");
    }

    #[test]
    fn edicao_nos_dois_lados_vira_copia_de_conflito_sem_perder_nada() {
        let vault = vault();
        let nuvem = Memoria::new();

        escrever(vault.path(), "n.md", "versao base");
        run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("base");

        // os dois lados mudam
        escrever(vault.path(), "n.md", "minha versao");
        nuvem.colocar("n.md", b"versao de la");

        let relatorio = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert_eq!(relatorio.conflicts, vec!["n.md".to_string()]);

        // meu arquivo fica como está
        assert_eq!(
            fs::read_to_string(vault.path().join("n.md")).expect("nota"),
            "minha versao"
        );

        // a versão da nuvem vira uma cópia ao lado
        let copias: Vec<_> = fs::read_dir(vault.path())
            .expect("ler")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|nome| nome.contains("conflito"))
            .collect();
        assert_eq!(
            copias.len(),
            1,
            "esperava uma cópia de conflito: {copias:?}"
        );
        let conteudo = fs::read_to_string(vault.path().join(&copias[0])).expect("copia");
        assert_eq!(conteudo, "versao de la");

        // e a próxima sincronização sobe a minha versão
        let depois = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync 2");
        assert!(depois.uploaded.contains(&"n.md".to_string()), "{depois:?}");
    }

    #[test]
    fn exclusao_na_nuvem_move_para_area_de_recuperacao() {
        let vault = vault();
        let nuvem = Memoria::new();

        escrever(vault.path(), "n.md", "conteudo");
        run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("base");

        // outro computador apagou
        nuvem
            .arquivos
            .borrow_mut()
            .insert("n.md".into(), (content_hash(b"conteudo"), true));

        let relatorio = run_sync(vault.path(), &nuvem, &SyncOptions::default()).expect("sync");
        assert_eq!(relatorio.deleted, vec!["n.md".to_string()]);
        assert!(!vault.path().join("n.md").exists());

        let mut guardados: Vec<String> = Vec::new();
        for lote in fs::read_dir(vault.path().join(".mirmind/cloud-deleted")).expect("pasta") {
            let lote = lote.expect("lote");
            for arquivo in fs::read_dir(lote.path()).expect("lote") {
                guardados.push(
                    arquivo
                        .expect("arquivo")
                        .file_name()
                        .to_string_lossy()
                        .to_string(),
                );
            }
        }
        assert_eq!(guardados, vec!["n.md".to_string()]);
    }

    #[test]
    fn arquivo_grande_fica_so_no_computador_com_aviso() {
        let vault = vault();
        escrever(vault.path(), "grande.bin", "12345");
        let nuvem = Memoria::new();
        let opcoes = SyncOptions {
            include_attachments: true,
            max_file_bytes: 3,
        };

        let relatorio = run_sync(vault.path(), &nuvem, &opcoes).expect("sync");
        assert_eq!(relatorio.skipped, vec!["grande.bin".to_string()]);
        assert!(relatorio.uploaded.is_empty());
        assert!(nuvem.arquivos.borrow().is_empty());
    }

    #[test]
    fn download_corrompido_nao_sobrescreve_a_nota() {
        struct Corrompido;
        impl CloudTransport for Corrompido {
            fn list(&self) -> Result<Vec<RemoteFile>> {
                Ok(vec![RemoteFile {
                    path: "n.md".into(),
                    kind: FileKind::Note,
                    hash: content_hash(b"esperado"),
                    size_bytes: 8,
                    deleted: false,
                }])
            }
            fn upsert_metadata(&self, _file: &RemoteFile) -> Result<()> {
                Ok(())
            }
            fn upload(&self, _hash: &str, _bytes: &[u8]) -> Result<()> {
                Ok(())
            }
            fn download(&self, _hash: &str) -> Result<Vec<u8>> {
                Ok(b"outra coisa".to_vec())
            }
            fn delete_content(&self, _hash: &str) -> Result<()> {
                Ok(())
            }
        }

        let vault = vault();
        let relatorio = run_sync(vault.path(), &Corrompido, &SyncOptions::default()).expect("sync");
        assert_eq!(relatorio.failed.len(), 1);
        assert!(!vault.path().join("n.md").exists(), "nada foi gravado");
    }

    #[test]
    fn caminho_com_travessia_vindo_da_nuvem_e_recusado() {
        assert!(target_path(Path::new("C:/vault"), "../fora.md").is_err());
        assert!(target_path(Path::new("C:/vault"), "C:/fora.md").is_err());
        assert!(target_path(Path::new("C:/vault"), "notas/ok.md").is_ok());
    }
}
