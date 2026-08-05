use super::contract::{LearningUnit, LearningUnitKind, UnitIdentity};
use super::evaluation::source_hash;
use std::collections::HashSet;

/// Limite padrao: notas com ate 800 palavras e seis blocos de conteudo permanecem uma unica unidade.
pub const DEFAULT_MAX_WHOLE_NOTE_WORDS: usize = 800;
/// Limite minimo aceitavel para a configuracao do Vault.
pub const MIN_MAX_WHOLE_NOTE_WORDS: usize = 50;
/// Limite maximo aceitavel para a configuracao do Vault.
pub const MAX_CONFIGURABLE_WHOLE_NOTE_WORDS: usize = 10_000;
pub const MAX_WHOLE_NOTE_BLOCKS: usize = 6;

/// Segmenta o Markdown com o limite padrao de palavras por nota inteira.
pub fn build_learning_units(
    markdown: &str,
    content_hash: &str,
    previous: &[LearningUnit],
) -> Vec<LearningUnit> {
    build_learning_units_with_limits(
        markdown,
        content_hash,
        previous,
        DEFAULT_MAX_WHOLE_NOTE_WORDS,
    )
}

/// Segmenta o Markdown em unidades de aprendizado e reconcilia as unidades anteriores.
///
/// Regras deterministas:
/// - Notas curtas (ate `max_whole_note_words` palavras e 6 blocos de conteudo) viram uma unica
///   unidade WholeNote.
/// - Acima de qualquer limite, a nota e dividida por paragrafos, com caminho de secao,
///   hash de conteudo normalizado, hashes de contexto anterior/proximo e posicao aproximada.
/// - Titulos, linhas vazias, divisores e frontmatter nao contam como blocos de conteudo.
/// - Unidades anteriores cujo conteudo normalizado e vizinhanca continuam iguais preservam
///   identidade, historico (FSRS) e ultima avaliacao. Mudancas apenas de espacos, quebras ou
///   finais de linha preservam o historico; mudancas textuais, divisao ou uniao reiniciam
///   somente as unidades envolvidas.
pub fn build_learning_units_with_limits(
    markdown: &str,
    content_hash: &str,
    previous: &[LearningUnit],
    max_whole_note_words: usize,
) -> Vec<LearningUnit> {
    let plan = segment_markdown(markdown, max_whole_note_words);
    if plan.whole_note {
        return vec![whole_note_unit(markdown, content_hash, previous)];
    }

    let mut used_ids: HashSet<String> = previous.iter().map(|unit| unit.id.clone()).collect();
    let mut available: Vec<&LearningUnit> = previous.iter().collect();
    let mut units = Vec::with_capacity(plan.segments.len());
    for (index, segment) in plan.segments.iter().enumerate() {
        let previous_context = index
            .checked_sub(1)
            .map(|previous| plan.segments[previous].normalized_hash.clone());
        let next_context = plan
            .segments
            .get(index + 1)
            .map(|next| next.normalized_hash.clone());
        let matched = best_match(
            segment,
            previous_context.as_deref(),
            next_context.as_deref(),
            &mut available,
        );
        let (id, content_hash, fsrs, latest_evaluation) = match matched {
            Some(previous) => (
                previous.id.clone(),
                previous.content_hash.clone(),
                previous.fsrs.clone(),
                previous.latest_evaluation.clone(),
            ),
            None => (
                fresh_unit_id(&mut used_ids),
                source_hash(&segment.content),
                None,
                None,
            ),
        };
        units.push(LearningUnit {
            id,
            ordinal: index as u64,
            kind: LearningUnitKind::Paragraph,
            content_hash,
            section_path: segment.section_path.clone(),
            identity: UnitIdentity {
                signature_version: 1,
                normalized_content_hash: segment.normalized_hash.clone(),
                previous_context_hash: previous_context,
                next_context_hash: next_context,
                approximate_start_utf16: segment.start_utf16,
            },
            source_start_utf16: segment.start_utf16,
            source_end_utf16: segment.end_utf16,
            fsrs,
            latest_evaluation,
        });
    }
    units
}

struct ContentBlock<'a> {
    start_byte: usize,
    lines: Vec<(usize, &'a str)>,
    section_path: Vec<String>,
}

struct SegmentSpec {
    section_path: Vec<String>,
    start_utf16: u64,
    end_utf16: u64,
    content: String,
    normalized_hash: String,
}

struct SegmentationPlan {
    whole_note: bool,
    segments: Vec<SegmentSpec>,
}

fn segment_markdown(markdown: &str, max_whole_note_words: usize) -> SegmentationPlan {
    let mut lines = Vec::new();
    let mut byte_cursor = 0usize;
    for raw in markdown.split_inclusive('\n') {
        let content = raw.strip_suffix('\n').unwrap_or(raw);
        lines.push((byte_cursor, content));
        byte_cursor += raw.len();
    }

    let mut blocks: Vec<ContentBlock<'_>> = Vec::new();
    let mut current: Vec<(usize, &str)> = Vec::new();
    let mut sections: Vec<(usize, String)> = Vec::new();
    let mut skip_frontmatter = lines.first().is_some_and(|(_, line)| line.trim() == "---");
    let mut index = 0usize;
    while index < lines.len() {
        let (byte_start, line) = lines[index];
        if skip_frontmatter {
            if line.trim() == "---" && index > 0 {
                skip_frontmatter = false;
            }
            index += 1;
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            flush_block(&mut blocks, &mut current, &sections);
            index += 1;
            continue;
        }
        if let Some((level, text)) = heading_text(trimmed) {
            flush_block(&mut blocks, &mut current, &sections);
            while sections
                .last()
                .is_some_and(|(existing, _)| *existing >= level)
            {
                sections.pop();
            }
            sections.push((level, text.to_string()));
            index += 1;
            continue;
        }
        if is_divider(trimmed) {
            flush_block(&mut blocks, &mut current, &sections);
            index += 1;
            continue;
        }
        current.push((byte_start, line));
        index += 1;
    }
    flush_block(&mut blocks, &mut current, &sections);

    let words: usize = blocks
        .iter()
        .map(|block| block_content(&block.lines).split_whitespace().count())
        .sum();
    if blocks.len() <= MAX_WHOLE_NOTE_BLOCKS && words <= max_whole_note_words {
        return SegmentationPlan {
            whole_note: true,
            segments: Vec::new(),
        };
    }

    let segments = blocks
        .iter()
        .map(|block| {
            let content = block_content(&block.lines);
            SegmentSpec {
                section_path: block.section_path.clone(),
                start_utf16: utf16_offset(markdown, block.start_byte),
                end_utf16: utf16_offset(markdown, block_end_byte(&block.lines)),
                normalized_hash: source_hash(&normalize(&content)),
                content,
            }
        })
        .collect();
    SegmentationPlan {
        whole_note: false,
        segments,
    }
}

fn flush_block<'a>(
    blocks: &mut Vec<ContentBlock<'a>>,
    current: &mut Vec<(usize, &'a str)>,
    sections: &[(usize, String)],
) {
    if current.is_empty() {
        return;
    }
    let start_byte = current[0].0;
    let lines = std::mem::take(current);
    blocks.push(ContentBlock {
        start_byte,
        lines,
        section_path: sections.iter().map(|(_, text)| text.clone()).collect(),
    });
}

fn block_content(lines: &[(usize, &str)]) -> String {
    lines
        .iter()
        .map(|(_, line)| line.strip_suffix('\r').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn block_end_byte(lines: &[(usize, &str)]) -> usize {
    let (byte_start, line) = lines.last().expect("block is never empty");
    let content = line.strip_suffix('\r').unwrap_or(line);
    byte_start + content.len()
}

fn heading_text(trimmed: &str) -> Option<(usize, &str)> {
    let hash_count = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if hash_count == 0 || hash_count > 6 {
        return None;
    }
    let rest = &trimmed[hash_count..];
    if !rest.starts_with(' ') && !rest.is_empty() {
        return None;
    }
    let text = rest.trim();
    if text.is_empty() {
        return None;
    }
    Some((hash_count, text))
}

fn is_divider(trimmed: &str) -> bool {
    if trimmed.len() < 3 {
        return false;
    }
    let first = trimmed.chars().next().expect("non-empty trimmed line");
    if !matches!(first, '-' | '*' | '_') {
        return false;
    }
    trimmed.chars().all(|character| character == first)
}

fn whole_note_unit(markdown: &str, content_hash: &str, previous: &[LearningUnit]) -> LearningUnit {
    let end = u64::try_from(markdown.encode_utf16().count()).unwrap_or(u64::MAX);
    let normalized_hash = source_hash(&normalize(markdown));
    let matched = previous
        .iter()
        .find(|unit| unit.identity.normalized_content_hash == normalized_hash);
    let (id, content_hash, fsrs, latest_evaluation) = match matched {
        Some(previous) => (
            previous.id.clone(),
            previous.content_hash.clone(),
            previous.fsrs.clone(),
            previous.latest_evaluation.clone(),
        ),
        None => ("unit-1".to_string(), content_hash.to_string(), None, None),
    };
    LearningUnit {
        id,
        ordinal: 0,
        kind: LearningUnitKind::WholeNote,
        content_hash,
        section_path: Vec::new(),
        identity: UnitIdentity {
            signature_version: 1,
            normalized_content_hash: normalized_hash,
            previous_context_hash: None,
            next_context_hash: None,
            approximate_start_utf16: 0,
        },
        source_start_utf16: 0,
        source_end_utf16: end,
        fsrs,
        latest_evaluation,
    }
}

fn best_match<'a>(
    segment: &SegmentSpec,
    previous_context: Option<&str>,
    next_context: Option<&str>,
    available: &mut Vec<&'a LearningUnit>,
) -> Option<&'a LearningUnit> {
    let mut best: Option<(usize, i32, u64)> = None;
    for (index, candidate) in available.iter().enumerate() {
        if candidate.identity.normalized_content_hash != segment.normalized_hash {
            continue;
        }
        let mut score = 1;
        if candidate.identity.previous_context_hash.as_deref() == previous_context {
            score += 4;
        }
        if candidate.identity.next_context_hash.as_deref() == next_context {
            score += 2;
        }
        let distance = candidate
            .identity
            .approximate_start_utf16
            .abs_diff(segment.start_utf16);
        if best.is_none_or(|(_, best_score, best_distance)| {
            score > best_score || (score == best_score && distance < best_distance)
        }) {
            best = Some((index, score, distance));
        }
    }
    let Some((index, _, _)) = best else {
        return None;
    };
    let matched = available.remove(index);
    Some(matched)
}

fn fresh_unit_id(used_ids: &mut HashSet<String>) -> String {
    // Alocacao monotônica: nunca reutiliza um id, evitando colidir com snapshots
    // historicos de unidades removidas que ainda existem em sessoes antigas.
    let max_counter = used_ids
        .iter()
        .filter_map(|id| id.strip_prefix("unit-"))
        .filter_map(|suffix| suffix.parse::<usize>().ok())
        .max()
        .unwrap_or(0);
    let id = format!("unit-{}", max_counter + 1);
    used_ids.insert(id.clone());
    id
}

fn utf16_offset(markdown: &str, byte: usize) -> u64 {
    u64::try_from(markdown[..byte].encode_utf16().count()).unwrap_or(u64::MAX)
}

/// Colapsa qualquer sequencia de espacos, tabulacoes ou quebras em um espaco unico.
fn normalize(content: &str) -> String {
    content.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::{
        build_learning_units, build_learning_units_with_limits, normalize, MAX_WHOLE_NOTE_BLOCKS,
    };
    use crate::review::contract::{LearningUnitKind, UnitEvaluation};
    use crate::review::evaluation::source_hash;

    fn long_markdown(block_count: usize) -> String {
        (1..=block_count)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    #[test]
    fn a_short_note_is_a_single_whole_note_unit() {
        let markdown = "# ATP\nATP armazena energia para uso celular.";
        let units = build_learning_units(markdown, "sha256:note", &[]);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].kind, LearningUnitKind::WholeNote);
        assert_eq!(units[0].id, "unit-1");
        assert_eq!(units[0].source_start_utf16, 0);
        assert_eq!(
            units[0].source_end_utf16,
            markdown.encode_utf16().count() as u64
        );
        assert!(units[0].identity.previous_context_hash.is_none());
        assert!(units[0].identity.next_context_hash.is_none());
    }

    #[test]
    fn six_content_blocks_stay_whole_but_seven_split_into_paragraphs() {
        let whole = build_learning_units(&long_markdown(MAX_WHOLE_NOTE_BLOCKS), "sha256:note", &[]);
        assert_eq!(whole.len(), 1);
        assert_eq!(whole[0].kind, LearningUnitKind::WholeNote);

        let split = build_learning_units(
            &long_markdown(MAX_WHOLE_NOTE_BLOCKS + 1),
            "sha256:note",
            &[],
        );
        assert_eq!(split.len(), MAX_WHOLE_NOTE_BLOCKS + 1);
        assert!(split
            .iter()
            .all(|unit| unit.kind == LearningUnitKind::Paragraph));
        assert_eq!(split[0].ordinal, 0);
        assert_eq!(split[split.len() - 1].ordinal, MAX_WHOLE_NOTE_BLOCKS as u64);
    }

    #[test]
    fn more_than_eight_hundred_words_split_even_with_few_blocks() {
        let heavy_block = "palavra ".repeat(400 + 1);
        let markdown = format!("{heavy_block}\n\n{heavy_block}");
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units.len(), 2);
        assert!(units
            .iter()
            .all(|unit| unit.kind == LearningUnitKind::Paragraph));
    }

    #[test]
    fn the_word_limit_is_configurable_per_vault() {
        let heavy_block = "palavra ".repeat(300);
        let markdown = format!("{heavy_block}\n\n{heavy_block}");
        let content_hash = source_hash(&markdown);

        // Com limite 800 as 600 palavras ainda formam uma nota inteira.
        let whole = build_learning_units_with_limits(&markdown, &content_hash, &[], 800);
        assert_eq!(whole.len(), 1);
        assert_eq!(whole[0].kind, LearningUnitKind::WholeNote);

        // Com limite 400 a mesma nota e dividida em dois paragrafos.
        let split = build_learning_units_with_limits(&markdown, &content_hash, &[], 400);
        assert_eq!(split.len(), 2);
        assert!(split
            .iter()
            .all(|unit| unit.kind == LearningUnitKind::Paragraph));
    }

    #[test]
    fn headings_dividers_and_frontmatter_do_not_count_as_content_blocks() {
        let markdown = "---\ntitle: Nota\n---\n\n# Secao\n\n---\n\nParagrafo um.\n\n## Subsecao\n\nParagrafo dois.";
        let units = build_learning_units(markdown, "sha256:note", &[]);
        // Apenas dois paragrafos de conteudo: permanece nota inteira.
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].kind, LearningUnitKind::WholeNote);
    }

    #[test]
    fn duplicate_paragraphs_share_normalized_hash_and_keep_context_chain() {
        let markdown = (1..=7)
            .map(|index| {
                if index % 2 == 1 {
                    "A energia e conservada."
                } else {
                    "A celula transforma energia."
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units.len(), 7);
        assert_eq!(
            units[0].identity.normalized_content_hash,
            units[2].identity.normalized_content_hash
        );
        assert_eq!(
            units[0].identity.next_context_hash.as_deref(),
            Some(units[1].identity.normalized_content_hash.as_str())
        );
        assert_eq!(
            units[1].identity.previous_context_hash.as_deref(),
            Some(units[0].identity.normalized_content_hash.as_str())
        );
        assert!(units[0].identity.previous_context_hash.is_none());
        assert!(units[units.len() - 1].identity.next_context_hash.is_none());
        assert_eq!(units[0].identity.approximate_start_utf16, 0);
    }

    #[test]
    fn section_path_tracks_the_heading_stack() {
        let markdown = "# Biologia\n\nParagrafo um.\n\n## Celula\n\nParagrafo dois.\n\n# Quimica\n\nParagrafo tres.\n\nParagrafo quatro.\n\nParagrafo cinco.\n\nParagrafo seis.\n\nParagrafo sete.";
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units[0].section_path, vec!["Biologia".to_string()]);
        assert_eq!(
            units[1].section_path,
            vec!["Biologia".to_string(), "Celula".to_string()]
        );
        assert_eq!(units[2].section_path, vec!["Quimica".to_string()]);
        assert_eq!(units[3].section_path, vec!["Quimica".to_string()]);
    }

    #[test]
    fn whitespace_only_changes_preserve_identity_and_history() {
        let original = long_markdown(MAX_WHOLE_NOTE_BLOCKS + 1);
        let content_hash = source_hash(&original);
        let mut units = build_learning_units(&original, &content_hash, &[]);
        units[2].fsrs = Some(crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 12.0,
            retrievability: 0.8,
            last_reviewed_at_unix_ms: 1_720_000_000_000,
        });
        units[2].latest_evaluation = Some(UnitEvaluation::Evaluated {
            score: 80,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: 1_720_000_000_000,
            gaps: Vec::new(),
        });

        let edited = original.replace(
            "Paragrafo 3 com conteudo substantivo para revisao.",
            "Paragrafo  3  com   conteudo substantivo para  revisao.  ",
        );
        let rebuilt = build_learning_units(&edited, &source_hash(&edited), &units);

        assert_eq!(rebuilt.len(), units.len());
        assert_eq!(
            rebuilt[2].id, units[2].id,
            "id must survive whitespace edits"
        );
        assert!(
            rebuilt[2].fsrs.is_some(),
            "fsrs must survive whitespace edits"
        );
        assert!(
            rebuilt[2].latest_evaluation.is_some(),
            "evaluation must survive whitespace edits"
        );
        assert_eq!(
            rebuilt[2].identity.normalized_content_hash,
            units[2].identity.normalized_content_hash
        );
    }

    #[test]
    fn textual_changes_reset_only_the_involved_paragraph() {
        let original = long_markdown(MAX_WHOLE_NOTE_BLOCKS + 1);
        let content_hash = source_hash(&original);
        let mut units = build_learning_units(&original, &content_hash, &[]);
        units[3].fsrs = Some(crate::review::contract::FsrsState {
            difficulty: 4.0,
            stability_days: 9.0,
            retrievability: 0.75,
            last_reviewed_at_unix_ms: 1_720_000_000_000,
        });

        let edited = original.replacen(
            "Paragrafo 4 com conteudo substantivo para revisao.",
            "Paragrafo 4 completamente reescrito com outra ideia.",
            1,
        );
        let rebuilt = build_learning_units(&edited, &source_hash(&edited), &units);

        assert_eq!(rebuilt.len(), units.len());
        assert_eq!(rebuilt[0].id, units[0].id);
        assert_eq!(rebuilt[5].id, units[5].id);
        assert!(
            rebuilt[3].fsrs.is_none(),
            "changed paragraph must reset its memory"
        );
        assert_ne!(rebuilt[3].content_hash, units[3].content_hash);
    }

    #[test]
    fn inserting_a_paragraph_keeps_existing_identities() {
        let original = long_markdown(MAX_WHOLE_NOTE_BLOCKS + 1);
        let content_hash = source_hash(&original);
        let units = build_learning_units(&original, &content_hash, &[]);

        let edited = original.replacen(
            "Paragrafo 3 com conteudo substantivo para revisao.",
            "PARAGRAFO NOVO inserido no meio.\n\nParagrafo 3 com conteudo substantivo para revisao.",
            1,
        );
        let rebuilt = build_learning_units(&edited, &source_hash(&edited), &units);

        assert_eq!(rebuilt.len(), units.len() + 1);
        // O novo paragrafo entra como unidade nova; os demais preservam identidade.
        assert!(rebuilt
            .iter()
            .any(|unit| unit.content_hash == source_hash("PARAGRAFO NOVO inserido no meio.")));
    }

    #[test]
    fn whole_note_transition_reconciles_only_when_content_is_unchanged() {
        let markdown = "# ATP\nATP armazena energia para uso celular.";
        let content_hash = source_hash(markdown);
        let mut units = build_learning_units(markdown, &content_hash, &[]);
        units[0].fsrs = Some(crate::review::contract::FsrsState {
            difficulty: 5.0,
            stability_days: 10.0,
            retrievability: 0.9,
            last_reviewed_at_unix_ms: 1_720_000_000_000,
        });

        let whitespace = markdown.replace("ATP armazena", "ATP  armazena");
        let rebuilt = build_learning_units(&whitespace, &source_hash(&whitespace), &units);
        assert_eq!(rebuilt.len(), 1);
        assert!(rebuilt[0].fsrs.is_some());

        let changed = format!("{markdown}\n\nConteudo adicional totalmente novo.");
        let rebuilt = build_learning_units(&changed, &source_hash(&changed), &units);
        assert_eq!(rebuilt.len(), 1);
        assert!(
            rebuilt[0].fsrs.is_none(),
            "changed whole note must reset memory"
        );
    }

    #[test]
    fn normalization_collapses_whitespace_but_preserves_case() {
        assert_eq!(
            normalize("A  energia\n\ne conservada."),
            "A energia e conservada."
        );
        assert_ne!(normalize("ATP"), normalize("atp"));
    }
}
