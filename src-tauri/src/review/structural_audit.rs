//! Auditoria estrutural deterministica da nota, sem IA.
//!
//! Usa a mesma regra de segmentacao por secoes para detectar problemas de
//! estrutura que afetam a revisao: notas longas sem titulos (viram N unidades
//! de paragrafo solto), secoes grandes demais para uma pergunta, preambulos
//! sem titulo e titulos vazios. Cada achado traz uma sugestao concreta e, para
//! as correcoes deterministas, um `edit` (inserir titulo / remover linha) que
//! o frontend aplica ao rascunho do editor sem editar o Markdown sozinho.

use serde::{Deserialize, Serialize};

use super::segmentation::{heading_text, is_divider, segment_markdown, utf16_offset, SegmentSpec};

/// Uma insercao em um offset UTF-16 especifico (usada pela edicao de divisao
/// de secao, que insere varios titulos de uma vez).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralAuditEditOp {
    pub start_utf16: u64,
    pub insert: String,
}

/// Edicao determinista que corrige um achado: insere texto antes de um offset,
/// remove um intervalo de linhas ou insere varios titulos (divisao de secao).
/// O frontend aplica ao rascunho do editor; o usuario revisa e salva.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralAuditEdit {
    pub kind: String,
    pub start_utf16: u64,
    pub end_utf16: Option<u64>,
    pub insert: Option<String>,
    /// Para ``splitSection``: titulos a inserir antes de cada bloco, em ordem
    /// arbitraria (o frontend aplica do maior offset para o menor, mantendo
    /// todos os offsets validos).
    pub ops: Option<Vec<StructuralAuditEditOp>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralAuditFinding {
    /// Identificador estavel do tipo de achado.
    pub code: String,
    /// ``warning`` para problemas que degradam a revisao, ``info`` para
    /// oportunidades leves.
    pub severity: String,
    pub message: String,
    pub suggestion: String,
    /// Trecho afetado (titulo da secao, preambulo) quando existe.
    pub source_quote: Option<String>,
    pub source_start_utf16: Option<u64>,
    pub source_end_utf16: Option<u64>,
    pub edit: Option<StructuralAuditEdit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralAudit {
    pub note_words: usize,
    pub unit_count: usize,
    pub findings: Vec<StructuralAuditFinding>,
}

/// Preambulo com pelo menos dois paragrafos merece titulo proprio.
const PREAMBLE_MIN_PARAGRAPHS: usize = 2;

/// Recorte da citacao exibida no painel (limite de caracteres).
const QUOTE_LIMIT: usize = 1_600;

struct HeadingLine {
    level: usize,
    text: String,
    start_utf16: u64,
    end_utf16: u64,
    next_index: usize,
}

/// Auditoria deterministica: devolve os achados estruturais da nota.
pub fn audit_note_structure(markdown: &str, max_whole_note_words: usize) -> StructuralAudit {
    let plan = segment_markdown(markdown, max_whole_note_words);
    let note_words = count_words(markdown);
    let mut findings = Vec::new();
    if plan.whole_note {
        return StructuralAudit {
            note_words,
            unit_count: 1,
            findings,
        };
    }

    let has_any_heading = plan
        .segments
        .iter()
        .any(|segment| !segment.section_path.is_empty());

    // Nota longa sem nenhum titulo: vira N unidades de paragrafo solto.
    if !has_any_heading {
        findings.push(StructuralAuditFinding {
            code: "noHeadings".to_string(),
            severity: "warning".to_string(),
            message: format!(
                "A nota longa sera dividida em {} unidades de paragrafo sem titulos de secao.",
                plan.segments.len()
            ),
            suggestion: "Adicione titulos (##) agrupando os paragrafos em secoes coerentes — cada secao vira uma unidade de revisao com rotulo proprio.".to_string(),
            source_quote: None,
            source_start_utf16: None,
            source_end_utf16: None,
            edit: None,
        });
        return StructuralAudit {
            note_words,
            unit_count: plan.segments.len(),
            findings,
        };
    }

    // Preambulo sem titulo antes do primeiro heading (2+ paragrafos).
    if let Some(preamble) = plan.segments.first() {
        if preamble.section_path.is_empty()
            && paragraph_count(&preamble.content) >= PREAMBLE_MIN_PARAGRAPHS
        {
            findings.push(StructuralAuditFinding {
                code: "orphanPreamble".to_string(),
                severity: "info".to_string(),
                message: "Os paragrafos antes do primeiro titulo formam um preambulo sem rotulo de secao.".to_string(),
                suggestion: "De um titulo ao preambulo (ex.: ## Introducao) para ele virar uma secao nomeada na revisao.".to_string(),
                source_quote: Some(truncate_quote(&preamble.content)),
                source_start_utf16: Some(preamble.start_utf16),
                source_end_utf16: Some(preamble.end_utf16),
                edit: Some(StructuralAuditEdit {
                    kind: "insertHeadingBefore".to_string(),
                    start_utf16: preamble.start_utf16,
                    end_utf16: None,
                    insert: Some("## Introducao\n\n".to_string()),
                    ops: None,
                }),
            });
        }
    }

    // Secoes grandes demais para uma unica pergunta: quando ha edicao
    // determinista, o achado ganha o botao de aplicar (insere titulos de
    // subsecao nos cortes propostos).
    for segment in plan
        .segments
        .iter()
        .filter(|segment| !segment.section_path.is_empty())
    {
        let words = count_words(&segment.content);
        if words > max_whole_note_words {
            let path = segment.section_path.join(" > ");
            let split = split_section_edit(markdown, segment, max_whole_note_words);
            let suggestion = match &split {
                Some(edit) => format!(
                    "Aplicar no rascunho insere {} subsecao(ões) (###) nos cortes propostos; voce revisa e salva.",
                    edit.ops.as_ref().map_or(0, Vec::len)
                ),
                None => "Divida a secao em subsecoes (###) para cada topico virar uma unidade de revisao."
                    .to_string(),
            };
            findings.push(StructuralAuditFinding {
                code: "longSection".to_string(),
                severity: "warning".to_string(),
                message: format!(
                    "A secao «{path}» tem {words} palavras — grande demais para uma unica pergunta de revisao."
                ),
                suggestion,
                source_quote: Some(truncate_quote(&segment.content)),
                source_start_utf16: Some(segment.start_utf16),
                source_end_utf16: Some(segment.end_utf16),
                edit: split,
            });
        }
    }

    // Titulos sem conteudo nem subsecoes abaixo.
    for heading in empty_headings(markdown) {
        findings.push(StructuralAuditFinding {
            code: "emptyHeading".to_string(),
            severity: "info".to_string(),
            message: format!("O titulo «{}» nao tem conteudo abaixo dele.", heading.text),
            suggestion: "Adicione conteudo ao titulo ou remova a linha vazia.".to_string(),
            source_quote: Some(heading.text.clone()),
            source_start_utf16: Some(heading.start_utf16),
            source_end_utf16: Some(heading.end_utf16),
            edit: Some(StructuralAuditEdit {
                kind: "removeLines".to_string(),
                start_utf16: heading.start_utf16,
                end_utf16: Some(heading.end_utf16),
                insert: None,
                ops: None,
            }),
        });
    }

    StructuralAudit {
        note_words,
        unit_count: plan.segments.len(),
        findings,
    }
}

fn count_words(content: &str) -> usize {
    content.split_whitespace().count()
}

fn paragraph_count(content: &str) -> usize {
    content
        .split("\n\n")
        .filter(|block| !block.trim().is_empty())
        .count()
}

/// Propoe a divisao de uma secao longa em subsecoes: agrupa os paragrafos em
/// blocos de ate `max_words` palavras e devolve um titulo `###` para inserir
/// antes do primeiro paragrafo de cada bloco seguinte. Os offsets sao UTF-16 no
/// Markdown original — o frontend aplica do maior para o menor, entao todos
/// permanecem validos. Devolve `None` quando a secao nao tem paragrafos
/// suficientes para dividir (ou nao tem heading proprio).
fn split_section_edit(
    markdown: &str,
    segment: &SegmentSpec,
    max_words: usize,
) -> Option<StructuralAuditEdit> {
    if segment.heading_level == 0 || segment.start_byte >= segment.end_byte {
        return None;
    }
    let span = &markdown[segment.start_byte..segment.end_byte];

    // Inicio de cada paragrafo (linha nao vazia precedida de linha vazia ou do
    // inicio do span).
    let mut paragraph_starts: Vec<usize> = Vec::new();
    let mut cursor = 0usize;
    let mut prev_blank = true;
    for raw in span.split_inclusive('\n') {
        let content = raw.strip_suffix('\n').unwrap_or(raw);
        let blank = content.trim().is_empty();
        if !blank && prev_blank {
            paragraph_starts.push(cursor);
        }
        prev_blank = blank;
        cursor += raw.len();
    }
    if paragraph_starts.len() < 2 {
        return None;
    }

    // Empacota os paragrafos em blocos de ate `max_words` palavras.
    let mut chunks: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut current_words = 0usize;
    for (index, start) in paragraph_starts.iter().enumerate() {
        let end = paragraph_starts
            .get(index + 1)
            .copied()
            .unwrap_or(span.len());
        let words = span[*start..end].trim().split_whitespace().count();
        if !current.is_empty() && current_words + words > max_words {
            chunks.push(std::mem::take(&mut current));
            current_words = 0;
        }
        current.push(*start);
        current_words += words;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    if chunks.len() < 2 {
        return None;
    }

    let title = segment
        .section_path
        .last()
        .map(String::as_str)
        .unwrap_or("Secao");
    // Nivel do titulo de subsecao: um abaixo do da secao, sem nunca passar de
    // 6 (o maximo do Markdown) — nesse caso usa o mesmo nivel.
    let sub_level = (segment.heading_level + 1).min(6);
    let ops: Vec<StructuralAuditEditOp> = chunks
        .iter()
        .skip(1)
        .enumerate()
        .map(|(index, chunk)| StructuralAuditEditOp {
            start_utf16: utf16_offset(markdown, segment.start_byte + chunk[0]),
            insert: format!(
                "{} {title} — parte {}\n\n",
                "#".repeat(sub_level),
                index + 2
            ),
        })
        .collect();
    if ops.is_empty() {
        return None;
    }
    Some(StructuralAuditEdit {
        kind: "splitSection".to_string(),
        start_utf16: 0,
        end_utf16: None,
        insert: None,
        ops: Some(ops),
    })
}

/// Recorta a citacao do trecho afetado para o painel.
fn truncate_quote(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.chars().count() <= QUOTE_LIMIT {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(QUOTE_LIMIT).collect();
        format!("{cut}…")
    }
}

/// Varre os titulos e devolve os vazios: a proxima linha significativa apos o
/// titulo e um titulo de nivel igual ou superior (ou o fim da nota) — nao ha
/// conteudo proprio nem subsecao abaixo.
fn empty_headings(markdown: &str) -> Vec<HeadingLine> {
    let mut lines: Vec<(usize, String)> = Vec::new();
    let mut cursor = 0usize;
    for raw in markdown.split_inclusive('\n') {
        let content = raw.strip_suffix('\n').unwrap_or(raw);
        lines.push((cursor, content.to_string()));
        cursor += raw.len();
    }

    let mut headings: Vec<HeadingLine> = Vec::new();
    let mut skip_frontmatter = lines.first().is_some_and(|(_, line)| line.trim() == "---");
    for (index, (byte_start, line)) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if skip_frontmatter {
            if trimmed == "---" && index > 0 {
                skip_frontmatter = false;
            }
            continue;
        }
        if let Some((level, text)) = heading_text(trimmed) {
            headings.push(HeadingLine {
                level,
                text: text.to_string(),
                start_utf16: utf16_len(markdown, *byte_start),
                end_utf16: utf16_len(markdown, *byte_start + line.len()),
                next_index: index + 1,
            });
        }
    }

    let mut result = Vec::new();
    for heading in &headings {
        let mut empty = true;
        for (_, line) in &lines[heading.next_index..] {
            let trimmed = line.trim();
            if trimmed.is_empty() || is_divider(trimmed) {
                continue;
            }
            if let Some((level, _)) = heading_text(trimmed) {
                empty = level <= heading.level;
            } else {
                empty = false;
            }
            break;
        }
        if empty {
            result.push(HeadingLine {
                level: heading.level,
                text: heading.text.clone(),
                start_utf16: heading.start_utf16,
                end_utf16: heading.end_utf16,
                next_index: heading.next_index,
            });
        }
    }
    result
}

fn utf16_len(markdown: &str, byte: usize) -> u64 {
    u64::try_from(markdown[..byte].encode_utf16().count()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::audit_note_structure;

    fn long_paragraph(prefix: &str) -> String {
        format!("{prefix} ")
            + &(0..30)
                .map(|index| format!("palavra{index}"))
                .collect::<Vec<_>>()
                .join(" ")
    }

    fn codes(audit: &super::StructuralAudit) -> Vec<&str> {
        audit
            .findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect()
    }

    #[test]
    fn a_short_note_has_no_structural_findings() {
        let audit = audit_note_structure("# ATP\n\nATP armazena energia.", 800);
        assert_eq!(audit.unit_count, 1);
        assert!(audit.findings.is_empty());
    }

    #[test]
    fn a_long_note_without_headings_gets_the_no_headings_finding() {
        let markdown = (1..=8)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let audit = audit_note_structure(&markdown, 800);
        assert_eq!(codes(&audit), vec!["noHeadings"]);
        assert_eq!(audit.findings[0].severity, "warning");
        assert!(audit.findings[0].edit.is_none());
        assert_eq!(audit.unit_count, 8);
    }

    #[test]
    fn a_multi_paragraph_preamble_gets_a_titling_suggestion_with_edit() {
        let markdown = "Introducao um.\n\nIntroducao dois.\n\n# Secao\n\nConteudo um.\n\nConteudo dois.\n\nConteudo tres.\n\nConteudo quatro.\n\nConteudo cinco.";
        let audit = audit_note_structure(markdown, 800);
        let preamble = audit
            .findings
            .iter()
            .find(|finding| finding.code == "orphanPreamble");
        assert!(
            preamble.is_some(),
            "esperado preambulo sem titulo: {:?}",
            codes(&audit)
        );
        let preamble = preamble.expect("preamble");
        let edit = preamble.edit.as_ref().expect("edit");
        assert_eq!(edit.kind, "insertHeadingBefore");
        assert_eq!(edit.insert.as_deref(), Some("## Introducao\n\n"));
        assert_eq!(edit.start_utf16, 0);
    }

    #[test]
    fn a_single_paragraph_preamble_is_not_flagged() {
        let markdown = "Introducao rapida.\n\n# Secao\n\nConteudo um.\n\nConteudo dois.\n\nConteudo tres.\n\nConteudo quatro.\n\nConteudo cinco.\n\nConteudo seis.";
        let audit = audit_note_structure(markdown, 800);
        assert!(
            !audit
                .findings
                .iter()
                .any(|finding| finding.code == "orphanPreamble"),
            "preambulo de um paragrafo nao deve ser sinalizado: {:?}",
            codes(&audit)
        );
    }

    #[test]
    fn a_section_over_the_word_limit_gets_the_long_section_finding() {
        let markdown = format!(
            "# Topico\n\n{}\n\n# Outro\n\nConteudo um.\n\nConteudo dois.\n\nConteudo tres.\n\nConteudo quatro.",
            long_paragraph("pesado")
        );
        // O bloco pesado (31 palavras) nao passa de 6 blocos; reduzir o limite
        // para 20 palavras forca a divisao e deixa a secao acima do limite.
        let audit = audit_note_structure(&markdown, 20);
        assert!(audit
            .findings
            .iter()
            .any(|finding| finding.code == "longSection"));
        let long = audit
            .findings
            .iter()
            .find(|finding| finding.code == "longSection")
            .expect("long section");
        assert_eq!(long.severity, "warning");
        assert!(long.message.contains("Topico"));
        assert!(long.edit.is_none());
    }

    #[test]
    fn a_long_multi_paragraph_section_gets_a_split_edit() {
        let paragraph = "Um dois tres quatro cinco seis sete oito nove dez.";
        let markdown = format!(
            "# Topico\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}",
            paragraph, paragraph, paragraph, paragraph, paragraph
        );
        // Limite 20 palavras: 5 paragrafos de 10 palavras -> 3 blocos de 2/2/1
        // paragrafos e dois cortes (antes do 3o e do 5o paragrafo).
        let audit = audit_note_structure(&markdown, 20);
        let long = audit
            .findings
            .iter()
            .find(|finding| finding.code == "longSection")
            .expect("long section");
        let edit = long.edit.as_ref().expect("split edit");
        assert_eq!(edit.kind, "splitSection");
        let ops = edit.ops.as_ref().expect("ops");
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].insert, "## Topico — parte 2\n\n");
        assert_eq!(ops[1].insert, "## Topico — parte 3\n\n");

        // Aplicar do maior offset para o menor mantem os offsets validos e
        // insere os titulos exatamente nas fronteiras dos paragrafos.
        let mut result = markdown.clone();
        let mut sorted = ops.clone();
        sorted.sort_by_key(|op| std::cmp::Reverse(op.start_utf16));
        for op in &sorted {
            let start = usize::try_from(op.start_utf16).expect("offset");
            result.insert_str(start, &op.insert);
        }
        let occurrences: Vec<usize> = result
            .match_indices(paragraph)
            .map(|(index, _)| index)
            .collect();
        assert_eq!(occurrences.len(), 5);
        // O titulo inserido termina com a quebra de linha dupla, entao o trecho
        // imediatamente antes do paragrafo seguinte termina com ele completo.
        assert!(result[..occurrences[2]].ends_with("## Topico — parte 2\n\n"));
        assert!(result[..occurrences[4]].ends_with("## Topico — parte 3\n\n"));
    }

    #[test]
    fn an_empty_heading_gets_a_removal_edit() {
        let markdown = "# Secao\n\nConteudo um.\n\nConteudo dois.\n\n## Vazio\n\n## Preenchida\n\nConteudo tres.\n\nConteudo quatro.\n\nConteudo cinco.\n\nConteudo seis.\n\nConteudo sete.";
        let audit = audit_note_structure(markdown, 800);
        let empty = audit
            .findings
            .iter()
            .find(|finding| finding.code == "emptyHeading");
        assert!(
            empty.is_some(),
            "esperado titulo vazio: {:?}",
            codes(&audit)
        );
        let empty = empty.expect("empty heading");
        assert_eq!(empty.source_quote.as_deref(), Some("Vazio"));
        let edit = empty.edit.as_ref().expect("edit");
        assert_eq!(edit.kind, "removeLines");
        assert!(edit.end_utf16.is_some());
    }

    #[test]
    fn a_well_structured_sectioned_note_has_no_findings() {
        let markdown = "# Topico\n\nConteudo um.\n\n## Sub\n\nConteudo dois.\n\n# Outro\n\nConteudo tres.\n\nConteudo quatro.\n\nConteudo cinco.\n\nConteudo seis.\n\nConteudo sete.";
        let audit = audit_note_structure(markdown, 800);
        assert_eq!(audit.unit_count, 3);
        assert!(
            audit.findings.is_empty(),
            "nota bem estruturada nao deve ter achados: {:?}",
            codes(&audit)
        );
    }
}
