//! Cliente HTTP da nuvem do vault.
//!
//! Fala com dois endpoints do Supabase: a API REST (`/rest/v1`) para os metadados
//! — quais arquivos existem, com que hash — e o Storage (`/storage/v1/object`)
//! para o conteúdo. Metadado e conteúdo são separados de propósito: dá para
//! decidir o que subir sem baixar nada.
//!
//! A autorização vai no `Authorization: Bearer <access token>`; o token vem do
//! cofre do sistema (`session.rs`), nunca do renderer. O `apikey` identifica o
//! projeto e sempre acompanha, como exige o Supabase.

use anyhow::{bail, Result};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};

use crate::account::{client, endpoint, json_body};
use crate::cloud::{FileKind, RemoteFile, StoredObject};

const BUCKET: &str = "vault-files";

#[derive(Debug, Clone)]
pub struct CloudAuth {
    pub base_url: String,
    pub api_key: String,
    pub access_token: String,
}

/// Id do usuário a partir do JWT (claim `sub`). O servidor valida a assinatura a
/// cada chamada; aqui só precisamos do id para montar o caminho no bucket.
pub fn user_id_from_jwt(access_token: &str) -> Option<String> {
    use base64::Engine;
    let payload = access_token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: Value = serde_json::from_slice(&decoded).ok()?;
    claims.get("sub")?.as_str().map(str::to_string)
}

fn http() -> Result<Client> {
    client()
}

fn rest(url: &str, caminho: &str) -> Result<String> {
    Ok(format!(
        "{}{}",
        endpoint(url, "")?,
        format!("/rest/v1{caminho}")
    ))
}

fn travar_se_erro(response: reqwest::blocking::Response) -> Result<reqwest::blocking::Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let body = json_body(response);
    let detalhe = body
        .get("message")
        .or_else(|| body.get("error_description"))
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("sem detalhe");
    if status == 402 || status == 413 {
        bail!("A nuvem recusou: {detalhe}. Verifique a cota de armazenamento.");
    }
    bail!("A nuvem respondeu {status}: {detalhe}")
}

/// Vaults que a conta já tem, com a contagem de arquivos. A tela de vínculo usa
/// isto para dizer "já existe um vault na nuvem" antes de qualquer sincronização —
/// é o que evita a pessoa ligar dois vaults diferentes sem perceber.
pub fn list_vaults(auth: &CloudAuth) -> Result<Vec<VaultRow>> {
    let url = rest(
        &auth.base_url,
        "/vaults?select=id,name,last_synced_at,vault_files(count)&order=created_at.desc",
    )?;
    let response = http()?
        .get(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;

    let linhas = json_body(travar_se_erro(response)?);
    let linhas = linhas
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("A nuvem devolveu uma lista inválida."))?;

    Ok(linhas
        .iter()
        .filter_map(|linha| {
            let id = linha.get("id")?.as_str()?.to_string();
            let nome = linha.get("name")?.as_str()?.to_string();
            // o agregado vem como `[{ "count": N }]`
            let arquivos = linha
                .get("vault_files")
                .and_then(Value::as_array)
                .and_then(|lista| lista.first())
                .and_then(|primeiro| primeiro.get("count"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let ultima = linha
                .get("last_synced_at")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(VaultRow {
                id,
                name: nome,
                files: arquivos,
                last_synced_at: ultima,
            })
        })
        .collect())
}

/// Linha da tabela `vaults` que a interface consome.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRow {
    pub id: String,
    pub name: String,
    pub files: usize,
    /// ISO-8601 da última sincronização concluída (`None` = nunca).
    pub last_synced_at: Option<String>,
}

/// Marca agora como a última sincronização concluída deste vault.
pub fn touch_vault_synced(auth: &CloudAuth, vault_id: &str) -> Result<()> {
    let url = rest(&auth.base_url, &format!("/vaults?id=eq.{vault_id}"))?;
    let response = http()?
        .patch(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .header("Prefer", "return=minimal")
        .json(&json!({ "last_synced_at": iso8601_now() }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    travar_se_erro(response)?;
    Ok(())
}

/// Pede ao servidor a URL do Checkout do Stripe.
///
/// A chave secreta do Stripe fica só na Edge Function: um binário distribuído é
/// um arquivo que qualquer um abre, então preço e cobrança não podem depender do
/// que o app envia. Aqui só viaja o quê (mensal/anual).
pub fn create_checkout(auth: &CloudAuth, kind: &str) -> Result<String> {
    let base = endpoint(&auth.base_url, "")?;
    let response = http()?
        .post(format!("{base}/functions/v1/stripe-checkout"))
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .json(&json!({ "kind": kind }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com o servidor de cobrança."))?;

    let status = response.status().as_u16();
    let corpo = json_body(response);
    if !(200..300).contains(&status) {
        let detalhe = corpo
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("O servidor de cobrança não respondeu.");
        bail!("{detalhe}");
    }

    corpo
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("O servidor não devolveu o endereço do checkout."))
}

/// Direitos do usuário logado (plano de IA, add-on de nuvem e validade).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub plan: String,
    pub plan_status: String,
    pub plan_period_end: Option<String>,
    pub cloud_plan: String,
}

pub fn my_entitlements(auth: &CloudAuth) -> Result<Entitlements> {
    let url = rest(&auth.base_url, "/rpc/my_entitlements")?;
    let response = http()?
        .post(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;

    let corpo = json_body(travar_se_erro(response)?);
    let linha = corpo
        .as_array()
        .and_then(|linhas| linhas.first())
        .ok_or_else(|| anyhow::anyhow!("A conta não devolveu os direitos."))?;

    Ok(Entitlements {
        plan: linha
            .get("plan")
            .and_then(Value::as_str)
            .unwrap_or("gratis")
            .to_string(),
        plan_status: linha
            .get("plan_status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            .to_string(),
        plan_period_end: linha
            .get("plan_period_end")
            .and_then(Value::as_str)
            .map(str::to_string),
        cloud_plan: linha
            .get("cloud_plan")
            .and_then(Value::as_str)
            .unwrap_or("nenhum")
            .to_string(),
    })
}

/// Cria (ou reaproveita) o vault na nuvem e devolve o id remoto.
///
/// `local_id` é a chave de reconhecimento: o mesmo vault aberto em outro
/// computador manda o mesmo `local_id` e recebe o mesmo registro, em vez de
/// criar um segundo vault.
pub fn register_vault(auth: &CloudAuth, local_id: &str, name: &str) -> Result<String> {
    let Some(owner_id) = user_id_from_jwt(&auth.access_token) else {
        bail!("Sessão sem identificação de usuário. Entre na conta novamente.");
    };

    let url = rest(&auth.base_url, "/vaults?on_conflict=owner_id,local_id")?;
    let response = http()?
        .post(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .header(
            "Prefer",
            "resolution=merge-duplicates,return=representation",
        )
        .json(&json!({ "owner_id": owner_id, "name": name, "local_id": local_id }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;

    let response = travar_se_erro(response)?;
    let body = json_body(response);
    body.as_array()
        .and_then(|linhas| linhas.first())
        .and_then(|linha| linha.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("A nuvem não devolveu o vault criado."))
}

/// Metadados dos arquivos do vault (inclusive os marcados como excluídos).
pub fn list_files(auth: &CloudAuth, vault_id: &str) -> Result<Vec<RemoteFile>> {
    let url = rest(
        &auth.base_url,
        &format!(
            "/vault_files?select=path,kind,content_hash,size_bytes,deleted_at&vault_id=eq.{vault_id}"
        ),
    )?;
    let response = http()?
        .get(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;

    let body = json_body(travar_se_erro(response)?);
    let linhas = body
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("A nuvem devolveu uma lista inválida."))?;

    Ok(linhas
        .iter()
        .filter_map(|linha| {
            Some(RemoteFile {
                path: linha.get("path")?.as_str()?.to_string(),
                kind: FileKind::from_str(linha.get("kind")?.as_str()?),
                hash: linha.get("content_hash")?.as_str()?.to_string(),
                size_bytes: linha.get("size_bytes")?.as_u64()?,
                deleted: linha
                    .get("deleted_at")
                    .map(Value::is_string)
                    .unwrap_or(false),
            })
        })
        .collect())
}

/// Grava (ou atualiza) a linha de metadado de um arquivo.
pub fn upsert_file(auth: &CloudAuth, vault_id: &str, file: &RemoteFile) -> Result<()> {
    let url = rest(&auth.base_url, "/vault_files?on_conflict=vault_id,path")?;
    let response = http()?
        .post(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .json(&json!({
            "vault_id": vault_id,
            "path": file.path,
            "kind": file.kind.as_str(),
            "content_hash": file.hash,
            "size_bytes": file.size_bytes,
            // o objeto no bucket é nomeado pelo hash (ver cloud::storage_path)
            "storage_path": file.hash,
            "deleted_at": if file.deleted { Some(iso8601_now()) } else { None::<String> },
        }))
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    travar_se_erro(response)?;
    Ok(())
}

/// Data/hora atual em ISO-8601 UTC (`2026-11-19T18:30:00Z`).
///
/// `deleted_at` é `timestamptz`: mandar segundos desde a época faz o PostgREST
/// interpretar como ano 1970. Escrever o formatador à mão evita uma dependência
/// de data só para isto — o algoritmo abaixo (dias civis a partir da época) é o
/// mesmo que bibliotecas de data usam.
fn iso8601_now() -> String {
    let segundos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_secs() as i64)
        .unwrap_or(0);
    iso8601_from_unix(segundos)
}

/// Caminho inverso do formatador acima: `2026-11-19T19:06:48.123456+00:00` (e
/// variações com `Z`) viram segundos desde a época.
///
/// O Storage devolve a data nesse formato e a varredura de órfãos precisa dela
/// para não apagar conteúdo recém-enviado. Só a parte `YYYY-MM-DDTHH:MM:SS` é
/// lida: frações e fuso são irrelevantes para uma carência de horas ou dias.
pub fn parse_iso8601_to_unix(texto: &str) -> Option<i64> {
    let bytes = texto.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let numero = |inicio: usize, fim: usize| -> Option<i64> {
        let pedaco = texto.get(inicio..fim)?;
        if !pedaco.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        pedaco.parse::<i64>().ok()
    };
    if bytes[10] != b'T' && bytes[10] != b' ' {
        return None;
    }
    let (ano, mes, dia) = (numero(0, 4)?, numero(5, 7)?, numero(8, 10)?);
    let (hora, minuto, segundo) = (numero(11, 13)?, numero(14, 16)?, numero(17, 19)?);
    if !(1..=12).contains(&mes)
        || !(1..=31).contains(&dia)
        || hora > 23
        || minuto > 59
        || segundo > 60
    {
        return None;
    }

    // dias civis desde 1970-01-01 (inverso do algoritmo de `iso8601_from_unix`)
    let ano = if mes <= 2 { ano - 1 } else { ano };
    let era = if ano >= 0 { ano } else { ano - 399 } / 400;
    let yoe = ano - era * 400;
    let mp = if mes > 2 { mes - 3 } else { mes + 9 };
    let doy = (153 * mp + 2) / 5 + dia - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let dias = era * 146_097 + doe - 719_468;

    Some(dias * 86_400 + hora * 3_600 + minuto * 60 + segundo)
}

/// Lista **todos** os objetos do dono no bucket, descendo as pastas.
///
/// Tem de ser a conta inteira, não um vault: apagar um vault na nuvem remove as
/// linhas em cascata mas **não** os objetos, e um objeto de vault inexistente não
/// pertence a nenhuma varredura por vault. Foi assim que apareceram sobras reais
/// durante a implementação — vaults de teste apagados, conteúdo ainda no bucket.
///
/// A API de listagem é por pasta (prefixo), então a descida é explícita, com
/// profundidade limitada: o desenho é `<dono>/<vault>/<hash>`, e um layout antigo
/// (por caminho de nota) tem um nível a mais. Nada além disso é esperado, e o
/// limite evita laço infinito se algum dia aparecer uma pasta inesperada.
pub fn list_all_objects(auth: &CloudAuth, owner_id: &str) -> Result<Vec<StoredObject>> {
    const PROFUNDIDADE_MAXIMA: usize = 4;
    let mut todos: Vec<StoredObject> = Vec::new();
    let mut fila: Vec<(String, usize)> = vec![(owner_id.to_string(), 0)];

    while let Some((prefixo, nivel)) = fila.pop() {
        for entrada in list_prefix(auth, &prefixo)? {
            todos.push(entrada.clone());
            if let Some(pasta) = entrada.folder_name {
                if nivel + 1 < PROFUNDIDADE_MAXIMA {
                    fila.push((format!("{prefixo}/{pasta}"), nivel + 1));
                }
            }
        }
    }

    Ok(todos)
}

/// Uma página de listagem de um prefixo. `folder_name` vem preenchido quando a
/// entrada é uma pasta (`id = null` nesta API).
fn list_prefix(auth: &CloudAuth, prefixo: &str) -> Result<Vec<StoredObject>> {
    const PAGINA: usize = 1_000;
    let base = endpoint(&auth.base_url, "")?;
    let url = format!("{base}/storage/v1/object/list/{BUCKET}");

    let mut todos: Vec<StoredObject> = Vec::new();
    let mut deslocamento = 0usize;
    loop {
        let response = http()?
            .post(&url)
            .header("apikey", &auth.api_key)
            .bearer_auth(&auth.access_token)
            .json(&json!({
                "prefix": prefixo,
                "limit": PAGINA,
                "offset": deslocamento,
                "sortBy": { "column": "name", "order": "asc" },
            }))
            .send()
            .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;

        let linhas = json_body(travar_se_erro(response)?);
        let linhas = linhas
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("A nuvem devolveu uma lista inválida."))?;
        if linhas.is_empty() {
            break;
        }

        for linha in linhas {
            let Some(nome) = linha.get("name").and_then(Value::as_str) else {
                continue;
            };
            let eh_pasta = linha.get("id").map(Value::is_null).unwrap_or(false);
            if eh_pasta {
                todos.push(StoredObject {
                    full_path: format!("{prefixo}/{nome}"),
                    name: nome.to_string(),
                    size_bytes: 0,
                    updated_at_unix: None,
                    folder_name: Some(nome.to_string()),
                });
                continue;
            }
            let tamanho = linha
                .get("metadata")
                .and_then(|meta| meta.get("size"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let atualizado = linha
                .get("updated_at")
                .and_then(Value::as_str)
                .and_then(parse_iso8601_to_unix);
            todos.push(StoredObject {
                full_path: format!("{prefixo}/{nome}"),
                name: nome.to_string(),
                size_bytes: tamanho,
                updated_at_unix: atualizado,
                folder_name: None,
            });
        }

        deslocamento += linhas.len();
        if linhas.len() < PAGINA {
            break;
        }
    }

    Ok(todos)
}

fn iso8601_from_unix(segundos: i64) -> String {
    let dias = segundos.div_euclid(86_400);
    let resto = segundos.rem_euclid(86_400);
    let (hora, minuto, segundo) = (resto / 3600, (resto % 3600) / 60, resto % 60);

    // dias civis desde 1970-01-01 (Howard Hinnant, com o deslocamento de 719468)
    let z = dias + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let ano = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dia = doy - (153 * mp + 2) / 5 + 1;
    let mes = if mp < 10 { mp + 3 } else { mp - 9 };
    let ano = if mes <= 2 { ano + 1 } else { ano };

    format!("{ano:04}-{mes:02}-{dia:02}T{hora:02}:{minuto:02}:{segundo:02}Z")
}

/// Sobe o conteúdo para o bucket, nomeado pelo hash. Subir o mesmo conteúdo duas
/// vezes é inofensivo: cai no mesmo objeto.
pub fn upload_blob(
    auth: &CloudAuth,
    owner_id: &str,
    vault_id: &str,
    content_hash: &str,
    bytes: &[u8],
) -> Result<()> {
    let caminho = crate::cloud::storage_path(owner_id, vault_id, content_hash);
    let url = format!(
        "{}/storage/v1/object/{BUCKET}/{caminho}",
        endpoint(&auth.base_url, "")?
    );
    let response = http()?
        .post(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .header("Content-Type", "application/octet-stream")
        // Subir duas vezes o mesmo caminho é normal (arquivo editado); sem isso o
        // Storage responde 409 e o sync falha em vez de atualizar.
        .header("x-upsert", "true")
        .body(bytes.to_vec())
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    travar_se_erro(response)?;
    Ok(())
}

pub fn download_blob(
    auth: &CloudAuth,
    owner_id: &str,
    vault_id: &str,
    content_hash: &str,
) -> Result<Vec<u8>> {
    let caminho = crate::cloud::storage_path(owner_id, vault_id, content_hash);
    let url = format!(
        "{}/storage/v1/object/{BUCKET}/{caminho}",
        endpoint(&auth.base_url, "")?
    );
    let response = http()?
        .get(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    let response = travar_se_erro(response)?;
    let bytes = response
        .bytes()
        .map_err(|_| anyhow::anyhow!("A nuvem enviou um conteúdo ilegível."))?;
    Ok(bytes.to_vec())
}

/// Apaga um objeto pelo caminho completo dentro do bucket.
///
/// A varredura de órfãos precisa disto: o objeto sem dono pode estar em um vault
/// que já não existe, então montar o caminho a partir de `owner/vault/hash` não
/// serve — o caminho vem da listagem.
pub fn delete_object(auth: &CloudAuth, full_path: &str) -> Result<()> {
    let base = endpoint(&auth.base_url, "")?;
    let url = format!("{base}/storage/v1/object/{BUCKET}/{full_path}");
    let response = http()?
        .delete(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    // Apagar o que já não existe não é erro de varredura.
    if response.status().is_success() || response.status().as_u16() == 404 {
        return Ok(());
    }
    travar_se_erro(response)?;
    Ok(())
}

pub fn delete_blob(
    auth: &CloudAuth,
    owner_id: &str,
    vault_id: &str,
    content_hash: &str,
) -> Result<()> {
    let caminho = crate::cloud::storage_path(owner_id, vault_id, content_hash);
    let url = format!(
        "{}/storage/v1/object/{BUCKET}/{caminho}",
        endpoint(&auth.base_url, "")?
    );
    let response = http()?
        .delete(url)
        .header("apikey", &auth.api_key)
        .bearer_auth(&auth.access_token)
        .send()
        .map_err(|_| anyhow::anyhow!("Sem conexão com a nuvem."))?;
    // Apagar o que já não existe não é erro de sincronização.
    if response.status().is_success() || response.status().as_u16() == 404 {
        return Ok(());
    }
    travar_se_erro(response)?;
    Ok(())
}

/// Transporte real: liga o executor (`cloud_sync::CloudTransport`) ao cliente HTTP.
pub struct HttpTransport {
    auth: CloudAuth,
    vault_id: String,
    owner_id: String,
}

impl HttpTransport {
    pub fn new(auth: CloudAuth, vault_id: String) -> Result<Self> {
        let owner_id = user_id_from_jwt(&auth.access_token)
            .ok_or_else(|| anyhow::anyhow!("Sessão sem identificação de usuário."))?;
        Ok(Self {
            auth,
            vault_id,
            owner_id,
        })
    }
}

impl crate::cloud_sync::CloudTransport for HttpTransport {
    fn list(&self) -> Result<Vec<RemoteFile>> {
        list_files(&self.auth, &self.vault_id)
    }

    fn upsert_metadata(&self, file: &RemoteFile) -> Result<()> {
        upsert_file(&self.auth, &self.vault_id, file)
    }

    fn upload(&self, content_hash: &str, bytes: &[u8]) -> Result<()> {
        upload_blob(
            &self.auth,
            &self.owner_id,
            &self.vault_id,
            content_hash,
            bytes,
        )
    }

    fn download(&self, content_hash: &str) -> Result<Vec<u8>> {
        download_blob(&self.auth, &self.owner_id, &self.vault_id, content_hash)
    }

    fn delete_content(&self, content_hash: &str) -> Result<()> {
        delete_blob(&self.auth, &self.owner_id, &self.vault_id, content_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_com_sub(sub: &str) -> String {
        use base64::Engine;
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let header = engine.encode(br#"{"alg":"HS256"}"#);
        let payload = engine.encode(format!(r#"{{"sub":"{sub}","exp":9999999999}}"#).as_bytes());
        format!("{header}.{payload}.assinatura")
    }

    #[test]
    fn data_iso8601_bate_com_instantes_conhecidos() {
        // conferido contra a biblioteca de data do sistema, não de cabeça
        assert_eq!(iso8601_from_unix(1_795_046_400), "2026-11-19T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_794_960_000), "2026-11-18T00:00:00Z");
        assert_eq!(iso8601_from_unix(0), "1970-01-01T00:00:00Z");
        // ano bissexto
        assert_eq!(iso8601_from_unix(1_709_164_800), "2024-02-29T00:00:00Z");
    }

    /// Ciclo real contra a nuvem de teste: entrar, registrar o vault, subir uma
    /// nota, conferir metadado e baixar o mesmo byte a byte.
    ///
    /// Ignorado por padrão: fala com o servidor de verdade e precisa da conta de
    /// teste com o add-on ativo. Rodar com:
    ///   MIRRORMIND_TEST_SUPABASE_URL=... MIRRORMIND_TEST_SUPABASE_KEY=...     ///   MIRRORMIND_TEST_EMAIL=... MIRRORMIND_TEST_PASSWORD=...     ///   cargo test --lib cloud_api::tests::live_ciclo_de_sync -- --ignored --nocapture
    #[test]
    #[ignore = "rede: fala com o Supabase de verdade"]
    fn live_ciclo_de_sync() {
        let (Ok(url), Ok(key), Ok(email), Ok(senha)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        // 1. entrar (sem tocar no cofre: este teste não é o do app)
        let resposta = http()
            .expect("cliente")
            .post(format!(
                "{}/auth/v1/token?grant_type=password",
                endpoint(&url, "").expect("endpoint")
            ))
            .header("apikey", &key)
            .json(&serde_json::json!({ "email": email, "password": senha }))
            .send()
            .expect("login");
        assert!(
            resposta.status().is_success(),
            "login falhou: {:?}",
            resposta.status()
        );
        let token = json_body(resposta)
            .get("access_token")
            .and_then(Value::as_str)
            .expect("access_token")
            .to_string();

        let auth = CloudAuth {
            base_url: url.clone(),
            api_key: key.clone(),
            access_token: token.clone(),
        };
        let owner = user_id_from_jwt(&token).expect("sub do jwt");

        // 2. registrar o vault (idempotente: o mesmo local_id devolve o mesmo id)
        let local_id = "teste-sync-local-0001";
        let vault_id = register_vault(&auth, local_id, "Vault de teste").expect("registrar vault");
        let repetido =
            register_vault(&auth, local_id, "Vault de teste").expect("registrar de novo");
        assert_eq!(
            vault_id, repetido,
            "o mesmo local_id não pode criar outro vault"
        );

        // 3. subir uma nota
        let conteudo = b"# nota de teste do sync

conteudo qualquer"
            .to_vec();
        let hash = crate::cloud::content_hash(&conteudo);
        let arquivo = RemoteFile {
            path: "notas/teste-sync.md".to_string(),
            kind: FileKind::Note,
            hash: hash.clone(),
            size_bytes: conteudo.len() as u64,
            deleted: false,
        };
        upsert_file(&auth, &vault_id, &arquivo).expect("gravar metadado");
        upload_blob(&auth, &owner, &vault_id, &arquivo.hash, &conteudo).expect("subir conteudo");

        // 4. o metadado volta na listagem, com o mesmo hash
        let lista = list_files(&auth, &vault_id).expect("listar");
        let remoto = lista
            .iter()
            .find(|f| f.path == arquivo.path)
            .expect("arquivo na lista");
        assert_eq!(remoto.hash, hash);
        assert_eq!(remoto.size_bytes, conteudo.len() as u64);
        assert!(!remoto.deleted);

        // 5. o conteúdo volta byte a byte
        let baixado = download_blob(&auth, &owner, &vault_id, &arquivo.hash).expect("baixar");
        assert_eq!(baixado, conteudo, "o conteúdo baixado tem que ser idêntico");

        // 6. limpeza: apaga o blob e o vault (metadados caem em cascata)
        delete_blob(&auth, &owner, &vault_id, &arquivo.hash).expect("apagar blob");
        let apagado = http()
            .expect("cliente")
            .delete(format!(
                "{}/rest/v1/vaults?id=eq.{vault_id}",
                endpoint(&url, "").expect("endpoint")
            ))
            .header("apikey", &key)
            .bearer_auth(&token)
            .send()
            .expect("apagar vault");
        assert!(
            apagado.status().is_success(),
            "limpeza falhou: {:?}",
            apagado.status()
        );
    }

    /// Simula **dois computadores** com o mesmo vault: sobe da máquina A, desce
    /// na B, edita na B e a alteração volta para a A. É o ciclo que o produto
    /// promete, contra a nuvem de verdade.
    #[test]
    #[ignore = "rede: fala com o Supabase de verdade"]
    fn live_duas_maquinas() {
        use crate::cloud::content_hash;
        use crate::cloud_sync::SyncOptions;

        let (Ok(url), Ok(key), Ok(email), Ok(senha)) = (
            std::env::var("MIRRORMIND_TEST_SUPABASE_URL"),
            std::env::var("MIRRORMIND_TEST_SUPABASE_KEY"),
            std::env::var("MIRRORMIND_TEST_EMAIL"),
            std::env::var("MIRRORMIND_TEST_PASSWORD"),
        ) else {
            panic!("defina MIRRORMIND_TEST_SUPABASE_URL/KEY/EMAIL/PASSWORD");
        };

        let resposta = http()
            .expect("cliente")
            .post(format!(
                "{}/auth/v1/token?grant_type=password",
                endpoint(&url, "").expect("endpoint")
            ))
            .header("apikey", &key)
            .json(&serde_json::json!({ "email": email, "password": senha }))
            .send()
            .expect("login");
        assert!(resposta.status().is_success(), "login falhou");
        let token = json_body(resposta)
            .get("access_token")
            .and_then(Value::as_str)
            .expect("access_token")
            .to_string();

        let auth = CloudAuth {
            base_url: url.clone(),
            api_key: key.clone(),
            access_token: token.clone(),
        };
        // id único por execução: rodar duas vezes não pode reaproveitar o vault
        // da execução anterior (os arquivos já estariam lá e o plano viria vazio)
        let local_id = format!(
            "live-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        );
        // nome fixo não serve: o teste roda várias vezes e o vault anterior fica
        let nome = format!("Vault duas maquinas {}", &local_id[5..]);
        let vault_id = register_vault(&auth, &local_id, &nome).expect("registrar");

        let maquina_a = tempfile::tempdir().expect("a");
        let maquina_b = tempfile::tempdir().expect("b");
        for (dir, nota, texto) in [
            (&maquina_a, "estudo/nota-1.md", "# nota um"),
            (&maquina_a, "estudo/nota-2.md", "# nota dois"),
        ] {
            let caminho = dir.path().join(nota);
            std::fs::create_dir_all(caminho.parent().expect("pai")).expect("pasta");
            std::fs::write(caminho, texto).expect("escrever");
        }

        let transporte = HttpTransport::new(
            CloudAuth {
                base_url: url.clone(),
                api_key: key.clone(),
                access_token: token.clone(),
            },
            vault_id.clone(),
        )
        .expect("transporte");

        // A sobe as duas notas
        let envio =
            crate::cloud_sync::run_sync(maquina_a.path(), &transporte, &SyncOptions::default())
                .expect("sync A");
        assert_eq!(envio.uploaded.len(), 2);
        assert!(envio.failed.is_empty(), "{:?}", envio.failed);

        // B baixa as duas
        let recebimento =
            crate::cloud_sync::run_sync(maquina_b.path(), &transporte, &SyncOptions::default())
                .expect("sync B");
        assert_eq!(recebimento.downloaded.len(), 2);
        assert_eq!(
            std::fs::read_to_string(maquina_b.path().join("estudo/nota-1.md")).expect("nota"),
            "# nota um"
        );

        // B edita; A recebe a alteração
        std::fs::write(
            maquina_b.path().join("estudo/nota-1.md"),
            "# nota um editada",
        )
        .expect("editar");
        let envio_b =
            crate::cloud_sync::run_sync(maquina_b.path(), &transporte, &SyncOptions::default())
                .expect("sync B 2");
        assert_eq!(envio_b.uploaded, vec!["estudo/nota-1.md".to_string()]);

        let recebimento_a =
            crate::cloud_sync::run_sync(maquina_a.path(), &transporte, &SyncOptions::default())
                .expect("sync A 2");
        assert_eq!(
            recebimento_a.downloaded,
            vec!["estudo/nota-1.md".to_string()]
        );
        assert_eq!(
            std::fs::read_to_string(maquina_a.path().join("estudo/nota-1.md")).expect("nota"),
            "# nota um editada"
        );

        // nada mudou: a terceira passada não faz nada
        let ociosa =
            crate::cloud_sync::run_sync(maquina_a.path(), &transporte, &SyncOptions::default())
                .expect("sync A 3");
        assert!(ociosa.is_empty(), "{ociosa:?}");

        // limpeza (o conteúdo do bucket cai junto com o vault? não: apaga antes)
        for conteudo in ["# nota um editada", "# nota dois"] {
            let _ = delete_blob(
                &auth,
                &user_id_from_jwt(&token).expect("sub"),
                &vault_id,
                &crate::cloud::content_hash(conteudo.as_bytes()),
            );
        }
        let apagado = http()
            .expect("cliente")
            .delete(format!(
                "{}/rest/v1/vaults?id=eq.{vault_id}",
                endpoint(&url, "").expect("endpoint")
            ))
            .header("apikey", &key)
            .bearer_auth(&token)
            .send()
            .expect("apagar vault");
        assert!(apagado.status().is_success());
        let _ = content_hash(b"");
    }

    #[test]
    fn le_a_data_que_o_storage_devolve() {
        // formato do Storage: com fração e fuso
        assert_eq!(
            parse_iso8601_to_unix("2026-11-19T00:00:00.123456+00:00"),
            Some(1_795_046_400)
        );
        // 19:06:48 = 68 808 s depois da meia-noite
        assert_eq!(
            parse_iso8601_to_unix("2026-11-19T19:06:48.081564+00:00"),
            Some(1_795_046_400 + 68_808)
        );
        assert_eq!(parse_iso8601_to_unix("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_iso8601_to_unix("2024-02-29T12:00:00Z"),
            Some(1_709_208_000)
        );

        // e o caminho de ida e volta fecha
        for instante in [0, 1_795_046_400, 1_709_208_000] {
            let texto = iso8601_from_unix(instante);
            assert_eq!(parse_iso8601_to_unix(&texto), Some(instante), "{texto}");
        }

        // lixo não vira data
        assert_eq!(parse_iso8601_to_unix(""), None);
        assert_eq!(parse_iso8601_to_unix("ontem"), None);
        assert_eq!(parse_iso8601_to_unix("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn le_o_id_do_usuario_do_jwt() {
        assert_eq!(
            user_id_from_jwt(&jwt_com_sub("user-123")),
            Some("user-123".to_string())
        );
        assert_eq!(user_id_from_jwt("nao-e-jwt"), None);
        assert_eq!(user_id_from_jwt(""), None);
    }
}
