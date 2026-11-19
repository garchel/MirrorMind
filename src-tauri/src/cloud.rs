//! Sincronização do vault com a nuvem (add-on), decisão A: uma pessoa por conta.
//!
//! Este módulo é o **motor**: identidade do vault, estado do último sync, o
//! plano de sincronização (o que sobe, o que desce, o que conflita) e o cliente
//! HTTP que fala com o Supabase. Quem executa o plano (ler arquivo, subir bytes)
//! é `cloud::execute`, que entra junto com a interface.
//!
//! Regras que o desenho respeita:
//!
//! - **Incremental de verdade.** O que decide é o `sha256` do conteúdo, não a data
//!   do arquivo: nada sobe nem desce se o hash não mudou.
//! - **Nunca sobrescrever calado.** Se os dois lados mudaram desde o último sync,
//!   o item vira conflito e a interface cria uma cópia marcada em vez de escolher
//!   um lado.
//! - **Exclusão é marca.** `deleted_at` na nuvem é o "apagado em algum lugar";
//!   sem isso, o outro computador ressuscitaria o arquivo no sync seguinte.
//! - **O servidor vê o conteúdo.** É a diferença central em relação ao resto do
//!   app (local-first); por isso o add-on é opcional, declarado na política de
//!   privacidade, e a primeira sincronização pede escolha explícita.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const METADATA_DIRECTORY: &str = ".mirmind";
const IDENTITY_FILE: &str = "cloud.json";
const STATE_FILE: &str = "cloud-state.json";
/// Teto por arquivo no bucket (espelha o `file_size_limit` criado na migration).
/// O executor do plano confere antes de subir, para o erro aparecer com mensagem
/// clara em vez de um 413 do Storage.
pub const MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

/// `sha256` em hexadecimal minúsculo, sem prefixo — o formato guardado em
/// `vault_files.content_hash` (64 caracteres).
pub fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut texto = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(texto, "{byte:02x}");
    }
    texto
}

// -----------------------------------------------------------------------------
// Identidade do vault
// -----------------------------------------------------------------------------

/// `local_id` nasce no primeiro uso e viaja com a pasta: é ele que faz o app
/// reconhecer "o mesmo vault" em outro computador. `vault_id` só existe depois de
/// registrar na conta.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudIdentity {
    pub local_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_id: Option<String>,
    /// Nome exibido na nuvem (o mesmo do vault, editável depois).
    #[serde(default)]
    pub name: String,
}

fn identity_path(vault_root: &Path) -> PathBuf {
    // A identidade é do vault, não do perfil: notas são as mesmas para todos.
    vault_root.join(METADATA_DIRECTORY).join(IDENTITY_FILE)
}

fn state_path(vault_root: &Path) -> PathBuf {
    vault_root.join(METADATA_DIRECTORY).join(STATE_FILE)
}

/// Lê a identidade; no primeiro uso cria com `local_id` novo (offline, sem rede).
pub fn load_or_create_identity(vault_root: &Path, vault_name: &str) -> Result<CloudIdentity> {
    let path = identity_path(vault_root);
    if let Ok(bruto) = fs::read_to_string(&path) {
        return Ok(serde_json::from_str(&bruto).with_context(|| {
            format!("A identidade da nuvem está inválida: {}", path.display())
        })?);
    }

    let identidade = CloudIdentity {
        local_id: random_id(),
        vault_id: None,
        name: vault_name.to_string(),
    };
    save_identity(vault_root, &identidade)?;
    Ok(identidade)
}

pub fn save_identity(vault_root: &Path, identity: &CloudIdentity) -> Result<()> {
    let path = identity_path(vault_root);
    if let Some(pai) = path.parent() {
        fs::create_dir_all(pai)?;
    }
    fs::write(&path, serde_json::to_string_pretty(identity)?)?;
    Ok(())
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("o sistema precisa fornecer entropia");
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

// -----------------------------------------------------------------------------
// Estado do último sync
// -----------------------------------------------------------------------------

/// Hash de cada caminho **no momento em que os dois lados ficaram iguais**. É o
/// que permite dizer "o local mudou? o remoto mudou?" sem depender de relógio.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    #[serde(default)]
    pub last_synced: BTreeMap<String, String>,
}

pub fn load_state(vault_root: &Path) -> SyncState {
    fs::read_to_string(state_path(vault_root))
        .ok()
        .and_then(|bruto| serde_json::from_str(&bruto).ok())
        .unwrap_or_default()
}

pub fn save_state(vault_root: &Path, state: &SyncState) -> Result<()> {
    let path = state_path(vault_root);
    if let Some(pai) = path.parent() {
        fs::create_dir_all(pai)?;
    }
    fs::write(path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Plano de sincronização
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFile {
    pub path: String,
    pub kind: FileKind,
    pub hash: String,
    pub size_bytes: u64,
    /// Sempre `true` para o que existe no disco agora; o campo existe para o
    /// plano tratar "sumiu local" como exclusão em vez de ausência.
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    pub path: String,
    pub kind: FileKind,
    pub hash: String,
    pub size_bytes: u64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Note,
    Attachment,
}

impl FileKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FileKind::Note => "note",
            FileKind::Attachment => "attachment",
        }
    }

    pub fn from_str(valor: &str) -> FileKind {
        match valor {
            "attachment" => FileKind::Attachment,
            _ => FileKind::Note,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    /// Subir do local para a nuvem.
    Upload { path: String },
    /// Descer da nuvem para o local.
    Download { path: String },
    /// Marcar exclusão (o arquivo não existe mais de um lado).
    MarkDeleted { path: String },
    /// Os dois lados mudaram: a interface cria cópia marcada, não escolhe.
    Conflict { path: String },
    /// Reconhecer o hash atual como base (mesmo conteúdo nos dois lados).
    Settle { path: String },
}

/// Compara o que existe aqui com o que existe na nuvem e devolve o que fazer.
///
/// `last` é o mapa do último sync (`path -> hash`). Sem ele, todo arquivo
/// divergente viraria conflito — com ele, só vira conflito o que **realmente**
/// mudou dos dois lados.
pub fn plan_sync(
    local: &BTreeMap<String, LocalFile>,
    remote: &BTreeMap<String, RemoteFile>,
    last: &BTreeMap<String, String>,
) -> Vec<SyncAction> {
    let mut acoes = Vec::new();
    let mut caminhos: Vec<&String> = local.keys().chain(remote.keys()).collect();
    caminhos.sort();
    caminhos.dedup();

    for caminho in caminhos {
        match (local.get(caminho), remote.get(caminho)) {
            // Só aqui: arquivo novo ou criado neste computador.
            (Some(local), None) => acoes.push(SyncAction::Upload {
                path: local.path.clone(),
            }),

            // Só na nuvem: arquivo criado no outro computador.
            (None, Some(remote)) => {
                if !remote.deleted {
                    acoes.push(SyncAction::Download {
                        path: remote.path.clone(),
                    });
                }
                // já excluído na nuvem e ausente aqui: nada a fazer
            }

            (Some(local), Some(remote)) => {
                if remote.deleted {
                    // Excluído no outro lado. Se o local mudou depois, ele volta.
                    if last.get(caminho) != Some(&local.hash) {
                        acoes.push(SyncAction::Upload {
                            path: local.path.clone(),
                        });
                    } else {
                        acoes.push(SyncAction::MarkDeleted {
                            path: local.path.clone(),
                        });
                    }
                    continue;
                }

                if local.hash == remote.hash {
                    acoes.push(SyncAction::Settle {
                        path: local.path.clone(),
                    });
                    continue;
                }

                let local_mudou = last.get(caminho) != Some(&local.hash);
                let remoto_mudou = last.get(caminho) != Some(&remote.hash);

                acoes.push(match (local_mudou, remoto_mudou) {
                    (true, false) => SyncAction::Upload {
                        path: local.path.clone(),
                    },
                    (false, true) => SyncAction::Download {
                        path: local.path.clone(),
                    },
                    // Nenhum mudou mas os hashes diferem (estado perdido) e os
                    // dois mudaram: em ambos os casos, o usuário decide.
                    _ => SyncAction::Conflict {
                        path: local.path.clone(),
                    },
                });
            }

            (None, None) => {}
        }
    }

    acoes
}

/// Caminho do objeto no bucket: `<dono>/<vault>/<hash>`.
///
/// O nome do objeto é o **hash do conteúdo**, não o caminho da nota, e isso é
/// deliberado: um arquivo editado vira outro objeto. Guardar por caminho fazia o
/// segundo computador baixar a versão antiga — o Storage servia o objeto em cache
/// para o mesmo caminho enquanto o metadado já apontava para o hash novo. O hash no
/// nome elimina a classe do problema em vez de contorná-la com cache-busting: o
/// que se pede é sempre o que se quer, e conteúdo repetido é guardado uma vez só.
///
/// O primeiro segmento continua sendo o id do dono, que é o que a policy do bucket
/// confere (`foldername(name)[1] = auth.uid()`).
pub fn storage_path(owner_id: &str, vault_id: &str, content_hash: &str) -> String {
    format!("{owner_id}/{vault_id}/{content_hash}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arq_local(path: &str, hash: &str) -> (String, LocalFile) {
        (
            path.to_string(),
            LocalFile {
                path: path.to_string(),
                kind: FileKind::Note,
                hash: hash.to_string(),
                size_bytes: 10,
                exists: true,
            },
        )
    }

    fn arq_remoto(path: &str, hash: &str, deleted: bool) -> (String, RemoteFile) {
        (
            path.to_string(),
            RemoteFile {
                path: path.to_string(),
                kind: FileKind::Note,
                hash: hash.to_string(),
                size_bytes: 10,
                deleted,
            },
        )
    }

    #[test]
    fn hash_e_sha256_hex_sem_prefixo() {
        let hash = content_hash(b"conteudo");
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(hash, content_hash(b"conteudo"));
        assert_ne!(hash, content_hash(b"outro"));
    }

    #[test]
    fn arquivo_novo_sobe_e_arquivo_da_nuvem_desce() {
        let local: BTreeMap<_, _> = [arq_local("notas/a.md", "h1")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("notas/b.md", "h2", false)]
            .into_iter()
            .collect();
        let acoes = plan_sync(&local, &nuvem, &BTreeMap::new());
        assert!(acoes.contains(&SyncAction::Upload {
            path: "notas/a.md".into()
        }));
        assert!(acoes.contains(&SyncAction::Download {
            path: "notas/b.md".into()
        }));
    }

    #[test]
    fn mesmo_conteudo_so_reconhece_a_base() {
        let local: BTreeMap<_, _> = [arq_local("n.md", "igual")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("n.md", "igual", false)].into_iter().collect();
        assert_eq!(
            plan_sync(&local, &nuvem, &BTreeMap::new()),
            vec![SyncAction::Settle {
                path: "n.md".into()
            }]
        );
    }

    #[test]
    fn so_o_local_mudou_sobe_e_so_o_remoto_mudou_desce() {
        let local: BTreeMap<_, _> = [arq_local("n.md", "novo-local")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("n.md", "base", false)].into_iter().collect();
        let base: BTreeMap<String, String> = [("n.md".to_string(), "base".to_string())].into();

        assert_eq!(
            plan_sync(&local, &nuvem, &base),
            vec![SyncAction::Upload {
                path: "n.md".into()
            }]
        );

        let local: BTreeMap<_, _> = [arq_local("n.md", "base")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("n.md", "novo-nuvem", false)]
            .into_iter()
            .collect();
        assert_eq!(
            plan_sync(&local, &nuvem, &base),
            vec![SyncAction::Download {
                path: "n.md".into()
            }]
        );
    }

    #[test]
    fn os_dois_mudaram_e_conflito_e_nao_escolha() {
        let local: BTreeMap<_, _> = [arq_local("n.md", "aqui")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("n.md", "la", false)].into_iter().collect();
        let base: BTreeMap<String, String> = [("n.md".to_string(), "base".to_string())].into();
        assert_eq!(
            plan_sync(&local, &nuvem, &base),
            vec![SyncAction::Conflict {
                path: "n.md".into()
            }]
        );
    }

    #[test]
    fn exclusao_na_nuvem_apaga_ou_ressuscita_conforme_o_local() {
        let base: BTreeMap<String, String> = [("n.md".to_string(), "base".to_string())].into();

        // local intocado -> marca exclusão aqui também
        let local: BTreeMap<_, _> = [arq_local("n.md", "base")].into_iter().collect();
        let nuvem: BTreeMap<_, _> = [arq_remoto("n.md", "base", true)].into_iter().collect();
        assert_eq!(
            plan_sync(&local, &nuvem, &base),
            vec![SyncAction::MarkDeleted {
                path: "n.md".into()
            }]
        );

        // local editado depois -> volta para a nuvem
        let local: BTreeMap<_, _> = [arq_local("n.md", "editado")].into_iter().collect();
        assert_eq!(
            plan_sync(&local, &nuvem, &base),
            vec![SyncAction::Upload {
                path: "n.md".into()
            }]
        );
    }

    #[test]
    fn identidade_nasce_uma_vez_e_persiste() {
        let vault = tempfile::tempdir().expect("vault");
        let primeira = load_or_create_identity(vault.path(), "Estudo").expect("criar");
        assert_eq!(primeira.name, "Estudo");
        assert!(primeira.vault_id.is_none());
        assert!(!primeira.local_id.is_empty());

        let segunda = load_or_create_identity(vault.path(), "Outro nome").expect("ler");
        assert_eq!(segunda.local_id, primeira.local_id, "o id não pode mudar");
        assert_eq!(segunda.name, "Estudo", "o nome salvo vale");
    }

    #[test]
    fn estado_do_ultimo_sync_vai_e_volta() {
        let vault = tempfile::tempdir().expect("vault");
        assert!(load_state(vault.path()).last_synced.is_empty());

        let mut estado = SyncState::default();
        estado.last_synced.insert("n.md".into(), "h1".into());
        save_state(vault.path(), &estado).expect("salvar");
        assert_eq!(
            load_state(vault.path()).last_synced.get("n.md"),
            Some(&"h1".to_string())
        );
    }

    #[test]
    fn caminho_no_bucket_e_dono_vault_e_hash() {
        let hash = content_hash(b"conteudo");
        assert_eq!(
            storage_path("user-1", "vault-1", &hash),
            format!("user-1/vault-1/{hash}")
        );
        // duas notas com o mesmo conteúdo caem no mesmo objeto
        assert_eq!(
            storage_path("u", "v", &content_hash(b"igual")),
            storage_path("u", "v", &content_hash(b"igual"))
        );
    }
}
