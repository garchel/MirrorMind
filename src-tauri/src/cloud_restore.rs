//! Trazer um vault **da nuvem para esta máquina**.
//!
//! Numa máquina nova, `account-vaults.json` não existe: o app pergunta "onde ficam
//! suas notas?" e não tem o que oferecer, porque as notas estão no servidor. Este
//! módulo baixa o conteúdo por hash e deixa a pasta igual à que foi sincronizada.
//!
//! Regras que vieram do motor de sync e valem aqui também:
//!
//! - **hash decide**: arquivo local com o mesmo hash não é baixado de novo;
//! - **nada do aluno é sobrescrito**: arquivo local diferente vira *cópia de
//!   conflito* ao lado, nunca substituição silenciosa;
//! - **caminho remoto não manda no disco**: nome vindo do servidor é validado
//!   componente por componente (sem `..`, sem absoluto), senão a nuvem escolheria
//!   onde escrever na sua máquina.

use crate::cloud::content_hash;
use crate::cloud_api::{self, CloudAuth};
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Teto por arquivo baixado (espelha o teto de upload do bucket).
const MAX_DOWNLOAD_BYTES: u64 = crate::cloud::MAX_UPLOAD_BYTES;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RestoreReport {
    pub baixados: usize,
    pub iguais: usize,
    pub conflitos: usize,
    pub bytes: u64,
}

/// Caminho local seguro para um caminho remoto.
///
/// Devolve `None` para qualquer coisa que tente sair da pasta escolhida — a
/// defesa é aqui, não em quem chama.
pub(crate) fn caminho_local(destino: &Path, remoto: &str) -> Option<PathBuf> {
    let normalizado = remoto.replace('\\', "/");
    if normalizado.is_empty() || normalizado.starts_with('/') {
        return None;
    }
    let mut resultado = destino.to_path_buf();
    for parte in normalizado.split('/') {
        if parte.is_empty() || parte == "." || parte == ".." {
            return None;
        }
        // Componentes que não são nome de arquivo simples (drive, raiz) caem aqui.
        if Path::new(parte).components().count() != 1 {
            return None;
        }
        if !matches!(Path::new(parte).components().next(), Some(Component::Normal(_))) {
            return None;
        }
        resultado.push(parte);
    }
    Some(resultado)
}

/// `nota (conflito - nuvem 2).md` quando já existe uma cópia de conflito.
pub(crate) fn nome_de_conflito(original: &Path, ocupados: usize) -> PathBuf {
    let pasta = original.parent().map(Path::to_path_buf).unwrap_or_default();
    let extensao = original
        .extension()
        .and_then(|valor| valor.to_str())
        .map(|valor| format!(".{valor}"))
        .unwrap_or_default();
    let nome = original
        .file_stem()
        .and_then(|valor| valor.to_str())
        .unwrap_or("nota");
    let sufixo = if ocupados == 0 {
        "(conflito - nuvem)".to_string()
    } else {
        format!("(conflito - nuvem {})", ocupados + 1)
    };
    pasta.join(format!("{nome} {sufixo}{extensao}"))
}

/// Escolhe onde gravar, sem sobrescrever trabalho local.
fn destino_sem_perder_trabalho(alvo: &Path, novo_hash: &str, bytes: &[u8]) -> Result<PathBuf> {
    if !alvo.exists() {
        return Ok(alvo.to_path_buf());
    }
    let atual = fs::read(alvo).with_context(|| format!("ler {}", alvo.display()))?;
    if content_hash(&atual) == novo_hash {
        // Igual ao da nuvem: nada a fazer.
        return Ok(alvo.to_path_buf());
    }
    // Diferente: o arquivo do aluno (ou o desta máquina) fica, e a versão da nuvem
    // entra ao lado com nome próprio.
    let _ = bytes;
    let mut ocupados = 0;
    loop {
        let candidato = nome_de_conflito(alvo, ocupados);
        if !candidato.exists() {
            return Ok(candidato);
        }
        ocupados += 1;
        if ocupados > 99 {
            bail!("Não foi possível achar um nome livre para a cópia de conflito.");
        }
    }
}

/// Baixa o vault `vault_id` para `destino`.
pub fn restore(auth: &CloudAuth, vault_id: &str, destino: &Path) -> Result<RestoreReport> {
    let arquivos = cloud_api::list_files(auth, vault_id)?;
    let owner_id = cloud_api::user_id_from_jwt(&auth.access_token)
        .ok_or_else(|| anyhow::anyhow!("A sessão não tem identificação de conta."))?;

    fs::create_dir_all(destino)
        .with_context(|| format!("criar a pasta {}", destino.display()))?;

    let mut relatorio = RestoreReport::default();
    for arquivo in arquivos {
        if arquivo.deleted {
            continue;
        }
        let Some(alvo) = caminho_local(destino, &arquivo.path) else {
            // Caminho suspeito: ignora em vez de escrever fora da pasta.
            continue;
        };
        if arquivo.size_bytes > MAX_DOWNLOAD_BYTES {
            continue;
        }
        if let Some(pai) = alvo.parent() {
            fs::create_dir_all(pai).with_context(|| format!("criar {}", pai.display()))?;
        }

        let bytes = cloud_api::download_blob(auth, &owner_id, vault_id, &arquivo.hash)
            .with_context(|| format!("baixar {}", arquivo.path))?;
        if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
            bail!("O arquivo {} passou do limite de tamanho.", arquivo.path);
        }

        let gravado = destino_sem_perder_trabalho(&alvo, &arquivo.hash, &bytes)?;
        if gravado == alvo && alvo.exists() {
            // Hash igual: não reescreve nem conta bytes.
            relatorio.iguais += 1;
            continue;
        }
        if gravado != alvo {
            relatorio.conflitos += 1;
        }
        // Escrita atômica: queda no meio não deixa arquivo truncado no lugar.
        let temporario = gravado.with_extension("mirrormind-download");
        fs::write(&temporario, &bytes)
            .with_context(|| format!("gravar {}", temporario.display()))?;
        fs::rename(&temporario, &gravado)
            .with_context(|| format!("finalizar {}", gravado.display()))?;
        relatorio.baixados += 1;
        relatorio.bytes += bytes.len() as u64;
    }

    Ok(relatorio)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn caminho_remoto_nao_escapa_da_pasta() {
        let raiz = Path::new("C:/destino");
        assert_eq!(
            caminho_local(raiz, "Pasta/nota.md"),
            Some(PathBuf::from("C:/destino/Pasta/nota.md"))
        );
        // As três formas de sair da pasta.
        assert!(caminho_local(raiz, "../fora.md").is_none());
        assert!(caminho_local(raiz, "Pasta/../../fora.md").is_none());
        assert!(caminho_local(raiz, "/etc/passwd").is_none());
        assert!(caminho_local(raiz, "C:/Windows/system32").is_none());
        assert!(caminho_local(raiz, "").is_none());
    }

    #[test]
    fn copia_de_conflito_ganha_nome_livre_sem_apagar_nada() {
        let pasta = tempdir().expect("pasta");
        let original = pasta.path().join("Resumo.md");
        fs::write(&original, b"versao local").unwrap();

        let destino = destino_sem_perder_trabalho(&original, "hash-da-nuvem", b"versao nuvem")
            .expect("destino");
        assert_ne!(destino, original);
        assert_eq!(destino.file_name().unwrap().to_str().unwrap(), "Resumo (conflito - nuvem).md");

        fs::write(&destino, b"versao nuvem").unwrap();
        let segundo =
            destino_sem_perder_trabalho(&original, "outro-hash", b"outra").expect("segundo");
        assert_eq!(
            segundo.file_name().unwrap().to_str().unwrap(),
            "Resumo (conflito - nuvem 2).md"
        );
        // O trabalho local continua onde estava.
        assert_eq!(fs::read(&original).unwrap(), b"versao local");
    }

    #[test]
    fn arquivo_igual_nao_e_reescrito() {
        let pasta = tempdir().expect("pasta");
        let alvo = pasta.path().join("Igual.md");
        let conteudo = b"mesmo conteudo";
        fs::write(&alvo, conteudo).unwrap();

        let destino =
            destino_sem_perder_trabalho(&alvo, &content_hash(conteudo), conteudo).expect("destino");
        assert_eq!(destino, alvo, "hash igual grava no mesmo lugar (e o chamador pula)");
    }
}
