//! Fontes consideradas de uma sessao de revisao: extrai os anexos referenciados
//! pela nota (`![[imagem.png]]`, `![[documento.pdf]]`, `![[nota.md]]`) e os
//! resolve contra o inventario do Vault, de forma segura (sem symlink, dentro
//! do Vault, com limites de tamanho), para que a sessao indique claramente
//! quais fontes foram consideradas no material permitido.
//!
//! Limite honesto do prototipo: anexos de imagem e PDF sao listados como
//! fontes consideradas (caminho, tipo, tamanho) e o texto de notas embutidas
//! e incorporado ao material da sessao. A interpretacao visual do conteudo de
//! imagens/PDFs (OCR, layout) e uma evolucao futura — a lista de fontes deixa
//! explicito o que foi e o que nao foi interpretado.

use anyhow::{bail, Result};
use serde::Serialize;

/// Interpreta o conteudo visual de uma imagem (visao multimodal). O backend
/// usa o Gemini quando configurado e autorizado; provedores sem visao nao
/// implementam e as imagens permanecem listadas sem texto (honesto).
pub trait ImageDescriber {
    /// Devolve uma descricao textual objetiva da imagem.
    fn describe_image(&self, mime_type: &str, image_bytes: &[u8]) -> Result<String, String>;
}

/// Imagem considerada mas ainda nao interpretada visualmente.
pub const IMAGE_NOT_DESCRIBED: &str = "imagem listada sem interpretacao visual";

/// Extensao de anexo reconhecida como imagem pelo app.
pub fn is_image_extension(extension: &str) -> bool {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp"
    )
}

/// Extensao de anexo reconhecida como documento.
pub fn is_document_extension(extension: &str) -> bool {
    matches!(extension.to_ascii_lowercase().as_str(), "pdf")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Image,
    Document,
    Markdown,
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedAttachment {
    pub raw_target: String,
    pub extension: Option<String>,
    pub kind: AttachmentKind,
}

/// Extrai as referencias de anexos `![[...]]` do Markdown, ignorando blocos de
/// codigo, comentarios HTML/Obsidian e links escapados — o mesmo escaneamento
/// de linhas dos wikilinks, restrito a `![[` (embed) com alvo nao vazio.
pub fn extract_attachment_references(content: &str) -> Vec<ExtractedAttachment> {
    let mut attachments = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut in_html_comment = false;
    let mut in_obsidian_comment = false;
    let mut html_block: Option<String> = None;

    for line in content.lines() {
        let lower_line = line.to_lowercase();
        if let Some(tag) = html_block.as_ref() {
            if lower_line.contains(&format!("</{tag}")) {
                html_block = None;
            }
            continue;
        }
        if let Some((marker, minimum_length)) = fence {
            if markdown_fence_closes(line, marker, minimum_length) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = markdown_fence_marker(line) {
            fence = Some(marker);
            continue;
        }
        if line.starts_with("    ") || line.starts_with('\t') {
            continue;
        }
        if let Some(tag) = markdown_html_block_tag(line) {
            if !lower_line.contains(&format!("</{tag}")) {
                html_block = Some(tag);
            }
            continue;
        }
        scan_line_for_embeds(
            line,
            &mut in_html_comment,
            &mut in_obsidian_comment,
            &mut attachments,
        );
    }
    attachments
}

fn scan_line_for_embeds(
    line: &str,
    in_html_comment: &mut bool,
    in_obsidian_comment: &mut bool,
    attachments: &mut Vec<ExtractedAttachment>,
) {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if *in_html_comment {
            let Some(comment_end) = line[index..].find("-->") else {
                return;
            };
            index += comment_end + 3;
            *in_html_comment = false;
            continue;
        }
        if bytes[index..].starts_with(b"<!--") {
            *in_html_comment = true;
            index += 4;
            continue;
        }
        if *in_obsidian_comment {
            let Some(comment_end) = line[index..].find("%%") else {
                return;
            };
            index += comment_end + 2;
            *in_obsidian_comment = false;
            continue;
        }
        if bytes[index..].starts_with(b"%%") && !is_escaped_at(bytes, index) {
            *in_obsidian_comment = true;
            index += 2;
            continue;
        }
        if bytes[index] == b'`' {
            let delimiter_length = bytes[index..]
                .iter()
                .take_while(|byte| **byte == b'`')
                .count();
            let mut closing_index = index + delimiter_length;
            let mut closing_delimiter = None;
            while closing_index < bytes.len() {
                if bytes[closing_index] == b'`' {
                    let candidate_length = bytes[closing_index..]
                        .iter()
                        .take_while(|byte| **byte == b'`')
                        .count();
                    if candidate_length == delimiter_length {
                        closing_delimiter = Some(closing_index + candidate_length);
                        break;
                    }
                    closing_index += candidate_length;
                } else {
                    closing_index += 1;
                }
            }
            index = closing_delimiter.unwrap_or(index + delimiter_length);
            continue;
        }
        if bytes[index] == b'<' {
            if let Some(tag_end) = bytes[index..].iter().position(|byte| *byte == b'>') {
                index += tag_end + 1;
                continue;
            }
        }
        // Embed `![[...]]`: o `!` imediatamente antes do `[[`, sem escape.
        if bytes[index..].starts_with(b"![[") && !is_escaped_at(bytes, index) {
            let content_start = index + 3;
            let Some(relative_end) = line[content_start..].find("]]") else {
                return;
            };
            let content_end = content_start + relative_end;
            let raw = line[content_start..content_end].trim();
            let target = raw.split('|').next().unwrap_or_default().trim();
            let target = target.split('#').next().unwrap_or_default().trim();
            if !target.is_empty() && !target.contains("..") && !target.starts_with('/') {
                let extension = std::path::Path::new(target)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(str::to_lowercase);
                // Em Obsidian, `![[alvo]]` sem extensao embute uma nota
                // (Markdown implicito); extensao conhecida e anexo.
                let kind = match extension.as_deref() {
                    None | Some("md") => AttachmentKind::Markdown,
                    Some(extension) if is_image_extension(extension) => AttachmentKind::Image,
                    Some(extension) if is_document_extension(extension) => AttachmentKind::Document,
                    _ => AttachmentKind::Unknown,
                };
                attachments.push(ExtractedAttachment {
                    raw_target: target.to_string(),
                    extension,
                    kind,
                });
            }
            index = content_end + 2;
            continue;
        }
        index += 1;
    }
}

fn is_escaped_at(bytes: &[u8], index: usize) -> bool {
    let preceding_backslashes = bytes[..index]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count();
    preceding_backslashes % 2 == 1
}

/// Heuristica de abertura/fechamento de cerca de codigo (mesma regra dos
/// wikilinks do vault).
fn markdown_fence_marker(line: &str) -> Option<(u8, usize)> {
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    if indentation > 3 {
        return None;
    }
    let bytes = line.as_bytes();
    let marker = *bytes.get(indentation)?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let length = bytes[indentation..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    (length >= 3).then_some((marker, length))
}

fn markdown_fence_closes(line: &str, marker: u8, minimum_length: usize) -> bool {
    let indentation = line.bytes().take_while(|byte| *byte == b' ').count();
    let Some((candidate, length)) = markdown_fence_marker(line) else {
        return false;
    };
    candidate == marker
        && length >= minimum_length
        && line[indentation + length..].trim().is_empty()
}

fn markdown_html_block_tag(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('<') {
        return None;
    }
    let rest = &trimmed[1..];
    let name = rest
        .chars()
        .take_while(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    if name.is_empty() {
        return None;
    }
    let mut known = false;
    for tag in [
        "div",
        "p",
        "table",
        "ul",
        "ol",
        "blockquote",
        "pre",
        "section",
        "article",
        "aside",
        "header",
        "footer",
        "figure",
        "details",
    ] {
        if name.eq_ignore_ascii_case(tag) {
            known = true;
            break;
        }
    }
    known.then_some(name)
}

/// Fonte considerada de uma sessao, resolvida com seguranca contra o Vault.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSessionSource {
    /// Referencia como aparece na nota (`![[arquivo.png]]` sem os colchetes).
    pub raw_target: String,
    pub kind: &'static str,
    /// Caminho relativo resolvido (null quando o alvo nao foi encontrado).
    pub relative_path: Option<String>,
    pub size_bytes: Option<u64>,
    /// Razao de indisponibilidade quando nao faz parte do material permitido.
    pub reason: Option<&'static str>,
    /// Texto extraido do anexo (PDF) ou da nota embutida, incorporado ao
    /// material permitido da sessao. `None` quando nao ha texto extraivel
    /// (imagens) ou o anexo nao foi encontrado.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extracted_text: Option<String>,
}

/// Resolve anexos extraidos contra a lista real de anexos do Vault, de forma
/// segura e sem tocar em arquivos fora do inventario. A lista de anexos deve
/// vir de `collect_attachment_files` (ja autorizada e limitada); as notas
/// embutidas sao resolvidas contra a lista de Markdown.
pub fn resolve_session_sources(
    attachments: &[ExtractedAttachment],
    attachment_paths: &[String],
    markdown_paths: &[String],
) -> Vec<ResolvedSessionSource> {
    let attachment_normalized = attachment_paths
        .iter()
        .map(|path| path.replace('\\', "/").to_lowercase())
        .collect::<Vec<_>>();
    let markdown_normalized = markdown_paths
        .iter()
        .map(|path| path.replace('\\', "/").to_lowercase())
        .collect::<Vec<_>>();

    attachments
        .iter()
        .map(|attachment| {
            let normalized = attachment.raw_target.replace('\\', "/").to_lowercase();
            let (kind, pool) = match attachment.kind {
                AttachmentKind::Image => ("image", &attachment_normalized),
                AttachmentKind::Document => ("document", &attachment_normalized),
                AttachmentKind::Markdown => ("markdown", &markdown_normalized),
                AttachmentKind::Unknown => ("unknown", &attachment_normalized),
            };
            // Nota implicita: `![[alvo]]` resolve para `alvo.md` quando o alvo
            // exato nao existe (regra dos wikilinks).
            let candidates = if attachment.kind == AttachmentKind::Markdown
                && !normalized.to_ascii_lowercase().ends_with(".md")
            {
                vec![normalized.clone(), format!("{normalized}.md")]
            } else {
                vec![normalized.clone()]
            };
            let found = candidates
                .iter()
                .enumerate()
                .find_map(|(candidate_index, candidate)| {
                    pool.iter()
                        .position(|path| path == candidate)
                        .map(|pool_index| (candidate_index, pool_index))
                });
            match found {
                Some((_, pool_index)) => {
                    let path = if attachment.kind == AttachmentKind::Markdown {
                        markdown_paths[pool_index].clone()
                    } else {
                        attachment_paths[pool_index].clone()
                    };
                    ResolvedSessionSource {
                        raw_target: attachment.raw_target.clone(),
                        kind,
                        relative_path: Some(path),
                        size_bytes: None,
                        reason: None,
                        extracted_text: None,
                    }
                }
                None => ResolvedSessionSource {
                    raw_target: attachment.raw_target.clone(),
                    kind,
                    relative_path: None,
                    size_bytes: None,
                    reason: Some("anexo nao encontrado no inventario do Vault"),
                    extracted_text: None,
                },
            }
        })
        .collect()
}

/// Monta o material permitido de uma sessao a partir do Markdown da nota e do
/// texto extraido dos anexos referenciados (`![[...]]` de PDFs, notas
/// embutidas e, quando um descritor visual esta disponivel, imagens),
/// rotulado por fonte. Retorna o Markdown aumentado, com cada anexo
/// claramente delimitado.
pub fn build_session_material(
    root: &std::path::Path,
    markdown: &str,
    describer: Option<&dyn ImageDescriber>,
    reserve_vision: &mut dyn FnMut(usize) -> Result<()>,
) -> Result<String> {
    let extracted = extract_attachment_references(markdown);
    let attachment_paths = crate::collect_attachment_files(root)?
        .into_iter()
        .map(|path| crate::to_relative_display(root, &path))
        .collect::<Vec<_>>();
    let markdown_paths = crate::collect_markdown_files(root)?
        .into_iter()
        .map(|path| crate::to_relative_display(root, &path))
        .collect::<Vec<_>>();
    let mut sources = resolve_session_sources(&extracted, &attachment_paths, &markdown_paths);
    enrich_sources_with_extracted_text(root, &mut sources);
    if let Some(describer) = describer {
        enrich_sources_with_image_descriptions(root, &mut sources, describer, reserve_vision);
    }

    let mut material = markdown.trim_end().to_string();
    for source in sources
        .into_iter()
        .filter(|source| source.extracted_text.is_some())
    {
        material.push_str("\n\n---\n");
        material.push_str(&format!(
            "Anexo considerado: {} ({}). Texto extraido:\n",
            source.raw_target,
            source.relative_path.as_deref().unwrap_or("fonte")
        ));
        material.push_str(source.extracted_text.as_deref().unwrap_or_default());
    }
    Ok(material)
}

/// Interpreta as imagens resolvidas com o descritor visual (visao): le o
/// anexo com seguranca, chama `reserve` (parada dura de orcamento) ANTES de
/// enviar os bytes e preenche `extracted_text` com a descricao. Falhas — de
/// leitura, de orcamento ou do provedor — nunca removem a fonte: apenas
/// deixam a descricao ausente (a lista continua honesta sobre o que foi
/// considerado).
pub fn enrich_sources_with_image_descriptions(
    root: &std::path::Path,
    sources: &mut [ResolvedSessionSource],
    describer: &dyn ImageDescriber,
    reserve: &mut dyn FnMut(usize) -> anyhow::Result<()>,
) {
    for source in sources.iter_mut() {
        if source.kind != "image" {
            continue;
        }
        let Some(relative_path) = source.relative_path.as_deref() else {
            continue;
        };
        let Ok(bytes) = read_resolved_source(root, relative_path) else {
            continue;
        };
        // Parada dura de custo ANTES da chamada: sem reserva, a imagem fica
        // listada sem descricao e nenhum byte sai do Vault.
        if reserve(bytes.len()).is_err() {
            continue;
        }
        let mime_type = image_mime_type(relative_path);
        if let Ok(description) = describer.describe_image(&mime_type, &bytes) {
            let description = description.trim();
            if !description.is_empty() {
                source.extracted_text = Some(format!(
                    "[Interpretacao visual da imagem {}] {}",
                    source.raw_target, description
                ));
            }
        }
    }
}

/// MIME aproximado a partir da extensao do anexo (para `inline_data`).
pub fn image_mime_type(relative_path: &str) -> String {
    let extension = std::path::Path::new(relative_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "gif" => "image/gif".to_string(),
        "webp" => "image/webp".to_string(),
        "bmp" => "image/bmp".to_string(),
        "svg" => "image/svg+xml".to_string(),
        _ => "image/png".to_string(),
    }
}

/// Incorpora o texto extraivel de cada fonte resolvida ao material permitido:
/// PDFs tem o texto extraido dos streams; notas embutidas tem o conteudo
/// lido; imagens ficam sem texto (a interpretacao visual nao e possivel sem
/// OCR). Falhas de leitura nunca removem a fonte — apenas deixam o texto
/// ausente, mantendo a lista honesta do que foi considerado.
pub fn enrich_sources_with_extracted_text(
    root: &std::path::Path,
    sources: &mut [ResolvedSessionSource],
) {
    for source in sources.iter_mut() {
        let Some(relative_path) = source.relative_path.as_deref() else {
            continue;
        };
        match source.kind {
            "document" => {
                if let Ok(bytes) = read_resolved_source(root, relative_path) {
                    if let Ok(text) = extract_pdf_text(&bytes) {
                        let text = text.trim();
                        if !text.is_empty() {
                            source.extracted_text = Some(text.to_string());
                        }
                    }
                }
            }
            "markdown" => {
                if let Ok(bytes) = read_resolved_source(root, relative_path) {
                    if let Ok(text) = String::from_utf8(bytes) {
                        let text = text.trim();
                        if !text.is_empty() {
                            source.extracted_text = Some(text.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Limite de bytes de um anexo de imagem/documento para o material da sessao.
pub const MAX_SOURCE_BYTES: u64 = 8 * 1024 * 1024;

/// Le os bytes de um anexo resolvido com seguranca: arquivo regular, sem
/// symlink, dentro do Vault e abaixo do limite de tamanho.
pub fn read_resolved_source(root: &std::path::Path, relative_path: &str) -> Result<Vec<u8>> {
    let canonical_root = crate::canonicalize_directory(root)?;
    let normalized = relative_path.trim().replace('\\', "/");
    let candidate = std::path::Path::new(&normalized);
    if normalized.is_empty()
        || candidate.is_absolute()
        || candidate.components().any(|component| match component {
            std::path::Component::Normal(segment) => segment.to_string_lossy().starts_with('.'),
            _ => true,
        })
    {
        bail!("Escolha um anexo valido do inventario.");
    }
    let requested = canonical_root.join(candidate);
    if fs_symlink_metadata(&requested)?.file_type().is_symlink() {
        bail!("Links simbolicos nao podem ser usados como anexos.");
    }
    let canonical_requested = requested
        .canonicalize()
        .map_err(|error| anyhow::anyhow!(error).context("Anexo indisponivel."))?;
    if !canonical_requested.starts_with(&canonical_root) {
        bail!("O anexo precisa permanecer dentro do Vault.");
    }
    let metadata = std::fs::metadata(&canonical_requested)
        .map_err(|error| anyhow::anyhow!(error).context("Nao foi possivel inspecionar o anexo."))?;
    if !metadata.is_file() {
        bail!("O caminho escolhido nao e um arquivo regular.");
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        bail!("O anexo e grande demais para o material da sessao.");
    }
    use std::io::Read;
    let file = std::fs::File::open(&canonical_requested)
        .map_err(|error| anyhow::anyhow!(error).context("Nao foi possivel abrir o anexo."))?;
    let mut bytes = Vec::new();
    file.take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| anyhow::anyhow!(error).context("Nao foi possivel ler o anexo."))?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        bail!("O anexo e grande demais para o material da sessao.");
    }
    Ok(bytes)
}

fn fs_symlink_metadata(path: &std::path::Path) -> Result<std::fs::Metadata> {
    std::fs::symlink_metadata(path)
        .map_err(|error| anyhow::anyhow!(error).context("Nao foi possivel inspecionar o anexo."))
}

/// Limite de caracteres de texto extraido de um PDF para o material da sessao.
pub const MAX_EXTRACTED_PDF_CHARS: usize = 60_000;

/// Extrai o texto de um PDF a partir dos bytes (streams de conteudo das
/// paginas), com `lopdf` (puro Rust, sem binarios externos). Retorna o texto
/// bruto concatenado por pagina; PDFs sem texto extraivel (escaneados, apenas
/// imagens) retornam uma string vazia — a fonte continua listada, mas sem
/// conteudo incorporado.
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String> {
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|error| anyhow::anyhow!(error).context("PDF invalido ou nao suportado."))?;
    let mut extracted = String::new();
    let pages = document.get_pages();
    for page_id in pages.values() {
        // `get_page_content` junta todos os streams de `Contents` da pagina e
        // decodifica FlateDecode/etc.; falhas de leitura pulam a pagina.
        let Ok(content_bytes) = document.get_page_content(*page_id) else {
            continue;
        };
        let page_text = extract_text_operators(&content_bytes);
        let trimmed = page_text.trim();
        if !trimmed.is_empty() {
            if !extracted.is_empty() {
                extracted.push('\n');
            }
            extracted.push_str(trimmed);
        }
    }
    // Limite conservador de tamanho para o material permitido da sessao.
    if extracted.chars().count() > MAX_EXTRACTED_PDF_CHARS {
        extracted = extracted.chars().take(MAX_EXTRACTED_PDF_CHARS).collect();
    }
    Ok(extracted)
}

/// Extrai strings de texto dos operadores de desenho de texto do PDF
/// (`Tj` e `TJ`) de um stream de conteudo bruto (ja decodificado). Operadores
/// fora do escopo de texto (`BT`..`ET`) sao ignorados; strings hex e literais
/// sao decodificadas. Nenhuma instrucao e executada.
fn extract_text_operators(content: &[u8]) -> String {
    let text = String::from_utf8_lossy(content);
    let mut result = String::new();
    let mut in_text = false;
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        // Inicio/fim de bloco de texto.
        if bytes[index..].starts_with(b"BT") && is_operator_boundary(bytes, index + 2) {
            in_text = true;
            index += 2;
            continue;
        }
        if bytes[index..].starts_with(b"ET") && is_operator_boundary(bytes, index + 2) {
            in_text = false;
            index += 2;
            continue;
        }
        if !in_text {
            index += 1;
            continue;
        }
        // Tj: string unica — o texto literal vem antes do operador.
        if bytes[index..].starts_with(b"Tj") && is_operator_boundary(bytes, index + 2) {
            if let Some(literal) = literal_before_operator(&text[..index]) {
                result.push_str(&literal);
            }
            index += 2;
            continue;
        }
        // TJ: array de strings e ajustes numericos.
        if bytes[index..].starts_with(b"TJ") && is_operator_boundary(bytes, index + 2) {
            if let Some(array_start) = bytes[..index].iter().rposition(|byte| *byte == b'[') {
                let mut cursor = array_start + 1;
                while cursor < index {
                    if bytes[cursor] == b'(' {
                        if let Some(close) =
                            bytes[cursor..index].iter().position(|byte| *byte == b')')
                        {
                            let close = cursor + close;
                            if let Some(decoded) = decode_pdf_literal(&text[cursor + 1..close]) {
                                result.push_str(&decoded);
                            }
                            cursor = close + 1;
                            continue;
                        }
                    }
                    cursor += 1;
                }
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    result
}

/// Procura a string literal `(...)` imediatamente antes de um operador e
/// decodifica seu conteudo (ignora espacos entre o `)` e o operador).
fn literal_before_operator(prefix: &str) -> Option<String> {
    let bytes = prefix.as_bytes();
    let mut index = bytes.len();
    // Pula espacos finais.
    while index > 0 && bytes[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    // Precisa terminar com `)`. Percorre de tras para frente encontrando o
    // `(` que abre o literal, respeitando parenteses aninhados e escapes.
    let close = index.checked_sub(1)?;
    if bytes[close] != b')' {
        return None;
    }
    let mut depth = 1usize;
    let mut cursor = close;
    while cursor > 0 {
        cursor -= 1;
        let byte = bytes[cursor];
        if byte == b'\\' {
            // Escape: pula o caractere escapado (retrocede mais um).
            if cursor > 0 {
                cursor -= 1;
            }
            continue;
        }
        if byte == b')' {
            depth += 1;
            continue;
        }
        if byte == b'(' {
            depth -= 1;
            if depth == 0 {
                let literal = &prefix[cursor + 1..close];
                return decode_pdf_literal(literal);
            }
        }
    }
    None
}

fn is_operator_boundary(bytes: &[u8], index: usize) -> bool {
    if index >= bytes.len() {
        return true;
    }
    let byte = bytes[index];
    byte.is_ascii_whitespace() || matches!(byte, b'(' | b'[' | b'/') || byte.is_ascii_digit()
}

/// Decodifica uma string literal de PDF (entre parenteses) com escapes `\n`,
/// `\r`, `\t`, `\(`, `\)`, `\\` e octal `\ddd`. Retorna `None` se a
/// string contem parenteses nao balanceados de forma a invalidar a leitura.
fn decode_pdf_literal(literal: &str) -> Option<String> {
    let mut decoded = String::with_capacity(literal.len());
    let bytes = literal.as_bytes();
    let mut index = 0;
    let mut depth = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => {
                let next = *bytes.get(index + 1)?;
                match next {
                    b'n' => decoded.push('\n'),
                    b'r' => decoded.push('\r'),
                    b't' => decoded.push('\t'),
                    b'(' => decoded.push('('),
                    b')' => decoded.push(')'),
                    b'\\' => decoded.push('\\'),
                    b'0'..=b'7' => {
                        let mut octal = 0u32;
                        let mut count = 0;
                        while count < 3 {
                            let Some(digit) = bytes.get(index + 1 + count) else {
                                break;
                            };
                            if !(b'0'..=b'7').contains(digit) {
                                break;
                            }
                            octal = octal * 8 + u32::from(*digit - b'0');
                            count += 1;
                        }
                        decoded.push(char::from_u32(octal).unwrap_or('?'));
                        index += count;
                    }
                    other => decoded.push(other as char),
                }
                index += 2;
            }
            b'(' => {
                depth += 1;
                decoded.push('(');
                index += 1;
            }
            b')' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                decoded.push(')');
                index += 1;
            }
            byte => {
                decoded.push(byte as char);
                index += 1;
            }
        }
    }
    Some(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_embeds_ignoring_code_comments_and_escaped_links() {
        let content = "# Nota\n\nVeja ![[grafico.png]] e ![[manual.pdf]].\n\n```md\n![[ignorado.png]]\n```\n\n%% ![[tambem-nao.png]] %%\n\n\\![[escapado.png]]\n\n![[outra-nota]]\n\nTexto com [[wikilink normal]] (nao e embed).\n";
        let attachments = extract_attachment_references(content);
        let targets = attachments
            .iter()
            .map(|attachment| attachment.raw_target.as_str())
            .collect::<Vec<_>>();
        assert_eq!(targets, vec!["grafico.png", "manual.pdf", "outra-nota"]);
        assert!(matches!(attachments[0].kind, AttachmentKind::Image));
        assert!(matches!(attachments[1].kind, AttachmentKind::Document));
        assert!(matches!(attachments[2].kind, AttachmentKind::Markdown));
    }

    #[test]
    fn ignores_targets_with_parent_traversal_or_absolute_paths() {
        let content = "![[../fora.png]]\n![[/absoluto.pdf]]\n![[ok.png]]\n";
        let attachments = extract_attachment_references(content);
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].raw_target, "ok.png");
    }

    fn make_pdf(content: &[u8]) -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let stream_id = document.add_object(Stream::new(dictionary! {}, content.to_vec()));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => resources_id,
            "Contents" => stream_id,
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        };
        document.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).expect("save pdf");
        bytes
    }

    #[test]
    fn extracts_text_from_a_generated_pdf() {
        let bytes = make_pdf(b"BT /F1 12 Tf 50 700 Td (Fotossintese usa luz e clorofila) Tj ET");
        let extracted = extract_pdf_text(&bytes).expect("extract text");
        assert!(
            extracted.contains("Fotossintese usa luz e clorofila"),
            "texto extraido deve conter o conteudo do PDF: {extracted}"
        );
    }

    #[test]
    fn extracts_text_from_tj_arrays() {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        // TJ com array de strings + ajuste numerico.
        let content = b"BT /F1 12 Tf 50 700 Td [(H) -100 (2O)] TJ ET";
        let stream_id = document.add_object(Stream::new(dictionary! {}, content.to_vec()));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => resources_id,
            "Contents" => stream_id,
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        };
        document.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).expect("save pdf");

        let extracted = extract_pdf_text(&bytes).expect("extract text");
        assert!(extracted.contains("H2O"), "TJ array: {extracted}");
    }

    #[test]
    fn empty_or_invalid_pdf_returns_an_error_or_empty_text() {
        assert!(extract_pdf_text(b"nao-e-um-pdf").is_err());
        // PDF valido sem texto extraivel retorna vazio, sem erro.
        let bytes = make_pdf(b"BT /F1 12 Tf 50 700 Td ( ) Tj ET");
        let extracted = extract_pdf_text(&bytes).expect("extract empty pdf");
        assert!(extracted.trim().is_empty());
    }

    #[test]
    fn builds_session_material_including_extracted_pdf_text() {
        use std::fs;

        let temporary_directory = tempfile::tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical");
        // Nota referenciando um PDF (material que a sessao deve incorporar).
        fs::write(root.join("nota.md"), "# Nota\n\nVeja ![[manual.pdf]].\n").expect("write note");
        // PDF com texto extraivel, gerado com lopdf.
        let pdf_bytes =
            make_pdf(b"BT /F1 12 Tf 50 700 Td (Texto do manual: reacoes quimicas) Tj ET");
        fs::write(root.join("manual.pdf"), &pdf_bytes).expect("write pdf");

        let markdown = fs::read_to_string(root.join("nota.md")).expect("read note");
        let material = build_session_material(&root, &markdown, None, &mut |_| Ok(()))
            .expect("build material");
        assert!(material.contains("# Nota"));
        assert!(material.contains("Anexo considerado: manual.pdf"));
        assert!(
            material.contains("reacoes quimicas"),
            "o texto extraido do PDF deve entrar no material: {material}"
        );
    }

    struct FakeDescriber;

    impl ImageDescriber for FakeDescriber {
        fn describe_image(&self, _mime_type: &str, _image_bytes: &[u8]) -> Result<String, String> {
            Ok("Diagrama de setas ligando fotossintese a glicose.".to_string())
        }
    }

    #[test]
    fn image_descriptions_enter_the_session_material_when_a_describer_exists() {
        use std::fs;

        let temporary_directory = tempfile::tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical");
        fs::write(root.join("nota.md"), "# Nota\n\nVeja ![[diagrama.png]].\n").expect("write note");
        fs::write(root.join("diagrama.png"), b"\x89PNG fake bytes").expect("write image");

        let markdown = fs::read_to_string(root.join("nota.md")).expect("read note");
        let material =
            build_session_material(&root, &markdown, Some(&FakeDescriber), &mut |_| Ok(()))
                .expect("build material");
        assert!(material.contains("# Nota"));
        assert!(material.contains("Anexo considerado: diagrama.png"));
        assert!(
            material.contains("Diagrama de setas ligando fotossintese a glicose."),
            "a descricao da imagem deve entrar no material: {material}"
        );

        // Sem descritor, a imagem permanece listada sem texto (honesto).
        let without_vision = build_session_material(&root, &markdown, None, &mut |_| Ok(()))
            .expect("build material");
        assert!(!without_vision.contains("Diagrama de setas"));
    }

    #[test]
    fn vision_reservation_failure_keeps_the_image_listed_without_description() {
        use std::fs;

        let temporary_directory = tempfile::tempdir().expect("temp dir");
        let root = temporary_directory
            .path()
            .canonicalize()
            .expect("canonical");
        fs::write(root.join("nota.md"), "# Nota\n\nVeja ![[diagrama.png]].\n").expect("write note");
        fs::write(root.join("diagrama.png"), b"\x89PNG fake bytes").expect("write image");

        let markdown = fs::read_to_string(root.join("nota.md")).expect("read note");
        // A reserva sempre falha: a imagem nao pode ser enviada ao provedor.
        let mut deny_all =
            |_bytes: usize| -> anyhow::Result<()> { bail!("Orcamento mensal de IA atingido.") };
        let material =
            build_session_material(&root, &markdown, Some(&FakeDescriber), &mut deny_all)
                .expect("build material");
        assert!(
            !material.contains("Diagrama de setas"),
            "sem reserva, nenhum byte deve sair do Vault: {material}"
        );
    }

    #[test]
    fn image_mime_type_maps_common_extensions() {
        assert_eq!(image_mime_type("media/grafico.png"), "image/png");
        assert_eq!(image_mime_type("foto.JPG"), "image/jpeg");
        assert_eq!(image_mime_type("anima.webp"), "image/webp");
        assert_eq!(image_mime_type("vetor.svg"), "image/svg+xml");
        assert_eq!(image_mime_type("sem-extensao"), "image/png");
    }

    #[test]
    fn resolves_sources_against_the_inventory() {
        let attachments = vec![
            ExtractedAttachment {
                raw_target: "media/grafico.png".to_string(),
                extension: Some("png".to_string()),
                kind: AttachmentKind::Image,
            },
            ExtractedAttachment {
                raw_target: "manual.pdf".to_string(),
                extension: Some("pdf".to_string()),
                kind: AttachmentKind::Document,
            },
            ExtractedAttachment {
                raw_target: "ausente.png".to_string(),
                extension: Some("png".to_string()),
                kind: AttachmentKind::Image,
            },
        ];
        let sources =
            resolve_session_sources(&attachments, &["media/grafico.png".to_string()], &[]);
        assert_eq!(sources.len(), 3);
        assert_eq!(
            sources[0].relative_path.as_deref(),
            Some("media/grafico.png")
        );
        assert!(sources[0].reason.is_none());
        assert!(sources[1].reason.is_some());
        assert!(sources[2].reason.is_some());
    }
}
