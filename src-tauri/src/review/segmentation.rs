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
        // Migracao de segmentacao por secoes: sem casamento exato, uma secao
        // que agrupa varias unidades antigas (contidas no seu range) herda a
        // fusao conservadora delas — a secao e tao fragil quanto seu pior
        // paragrafo, e o agendamento nunca fica mais distante que o pior
        // estado contido. Apenas agrupamentos reais (mais de uma unidade)
        // disparam a fusao: um paragrafo unico inalterado ja casa por hash
        // normalizado, e conteudo alterado nunca herda memoria.
        let merged = matched
            .is_none()
            .then(|| merge_match(segment, &mut available))
            .flatten();
        let (id, content_hash, fsrs, latest_evaluation) = match matched {
            Some(previous) => (
                previous.id.clone(),
                previous.content_hash.clone(),
                previous.fsrs.clone(),
                previous.latest_evaluation.clone(),
            ),
            None => match merged {
                Some(contained) => {
                    let anchor = contained[0];
                    let projection = crate::review::contract::conservative_merge(
                        contained.iter().filter_map(|unit| {
                            unit.latest_evaluation
                                .as_ref()
                                .map(|evaluation| (evaluation, unit.fsrs.as_ref()))
                        }),
                    );
                    let (fsrs, latest_evaluation) = match projection {
                        Some((evaluation, fsrs)) => (Some(fsrs), Some(evaluation)),
                        None => (None, None),
                    };
                    (
                        anchor.id.clone(),
                        source_hash(&segment.content),
                        fsrs,
                        latest_evaluation,
                    )
                }
                None => (
                    fresh_unit_id(&mut used_ids),
                    source_hash(&segment.content),
                    None,
                    None,
                ),
            },
        };
        // Unidades agrupadas por secao carregam o tipo Section; blocos sem
        // heading (notas sem estrutura ou preambulo) permanecem Paragraph.
        let kind = if segment.section_path.is_empty() {
            LearningUnitKind::Paragraph
        } else {
            LearningUnitKind::Section
        };
        units.push(LearningUnit {
            id,
            ordinal: index as u64,
            kind,
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
    section_levels: Vec<usize>,
}

pub(crate) struct SegmentSpec {
    pub(crate) section_path: Vec<String>,
    pub(crate) start_utf16: u64,
    pub(crate) end_utf16: u64,
    /// Limites em bytes no Markdown original — usados pela auditoria estrutural
    /// para localizar os paragrafos dentro da secao (os offsets UTF-16 nao
    /// mapeiam 1:1 para o texto original porque o conteudo e normalizado).
    pub(crate) start_byte: usize,
    pub(crate) end_byte: usize,
    /// Nivel do heading proprio da secao (0 para preambulo sem titulo).
    pub(crate) heading_level: usize,
    pub(crate) content: String,
    pub(crate) normalized_hash: String,
}

pub(crate) struct SegmentationPlan {
    pub(crate) whole_note: bool,
    pub(crate) segments: Vec<SegmentSpec>,
}

pub(crate) fn segment_markdown(markdown: &str, max_whole_note_words: usize) -> SegmentationPlan {
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

    // Segmentacao por secoes: blocos consecutivos sob o mesmo caminho de
    // heading formam uma unica unidade (cada secao folha vira um segmento).
    // Blocos sem heading (preambulo antes do primeiro titulo) so agrupam entre
    // si quando a nota possui alguma secao — o preambulo vira uma unidade de
    // introducao. Sem nenhum heading nao ha estrutura para agrupar e cada
    // bloco permanece individual, preservando a granulacao atual.
    let has_any_heading = blocks.iter().any(|block| !block.section_path.is_empty());
    let mut segments = Vec::with_capacity(blocks.len());
    let mut group: Vec<&ContentBlock<'_>> = Vec::new();
    for block in &blocks {
        let groupable = !block.section_path.is_empty() || has_any_heading;
        let same_section = group
            .last()
            .is_some_and(|last: &&ContentBlock| last.section_path == block.section_path);
        if groupable && same_section {
            group.push(block);
            continue;
        }
        if !group.is_empty() {
            segments.push(segment_from_group(markdown, &group));
            group.clear();
        }
        group.push(block);
    }
    if !group.is_empty() {
        segments.push(segment_from_group(markdown, &group));
    }
    SegmentationPlan {
        whole_note: false,
        segments,
    }
}

/// Converte um grupo de blocos consecutivos da mesma secao em um segmento: o
/// conteudo e a concatenacao dos blocos, o range cobre do inicio do primeiro
/// bloco ao fim do ultimo e o caminho de secao e o do grupo (o mesmo para
/// todos).
fn segment_from_group(markdown: &str, group: &[&ContentBlock<'_>]) -> SegmentSpec {
    let content = group
        .iter()
        .map(|block| block_content(&block.lines))
        .collect::<Vec<_>>()
        .join("\n\n");
    SegmentSpec {
        section_path: group[0].section_path.clone(),
        start_utf16: utf16_offset(markdown, group[0].start_byte),
        end_utf16: utf16_offset(
            markdown,
            block_end_byte(&group.last().expect("group is never empty").lines),
        ),
        start_byte: group[0].start_byte,
        end_byte: block_end_byte(&group.last().expect("group is never empty").lines),
        heading_level: group[0].section_levels.last().copied().unwrap_or(0),
        normalized_hash: source_hash(&normalize(&content)),
        content,
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
        section_levels: sections.iter().map(|(level, _)| *level).collect(),
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

pub(crate) fn heading_text(trimmed: &str) -> Option<(usize, &str)> {
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

pub(crate) fn is_divider(trimmed: &str) -> bool {
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
    // A identidade da unidade de nota inteira e o corpo sem o frontmatter:
    // tags e aliases sao metadados, nao conteudo avaliado — altera-los nao
    // deve reiniciar o estado de memoria do paragrafo unico (o mesmo criterio
    // ja vale para paragrafos segmentados, que ignoram o frontmatter).
    let body = crate::split_frontmatter_for_tags(markdown)
        .map(|(_, body)| body)
        .unwrap_or(markdown);
    let normalized_hash = source_hash(&normalize(body));
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

/// Unidades antigas totalmente contidas no range do segmento (fusao por
/// migracao de segmentacao por secoes). Os contidos sao removidos do conjunto
/// disponivel para nunca serem reaproveitados por outra secao; o primeiro por
/// ordem de origem e o ancora (mantem o id). Devolve `None` sem alterar
/// `available` quando nao ha um agrupamento real (zero ou uma unidade).
fn merge_match<'a>(
    segment: &SegmentSpec,
    available: &mut Vec<&'a LearningUnit>,
) -> Option<Vec<&'a LearningUnit>> {
    let contained: Vec<&'a LearningUnit> = available
        .iter()
        .filter(|unit| {
            unit.source_start_utf16 >= segment.start_utf16
                && unit.source_end_utf16 <= segment.end_utf16
        })
        .copied()
        .collect();
    if contained.len() <= 1 {
        return None;
    }
    let removed: HashSet<&str> = contained.iter().map(|unit| unit.id.as_str()).collect();
    available.retain(|unit| !removed.contains(unit.id.as_str()));
    Some(contained)
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

pub(crate) fn utf16_offset(markdown: &str, byte: usize) -> u64 {
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
    use crate::review::contract::{FsrsState, LearningUnitKind, UnitEvaluation};
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
    fn whole_note_identity_ignores_frontmatter_changes() {
        // Tags e aliases no frontmatter sao metadados, nao conteudo avaliado:
        // altera-los nao deve reiniciar o estado de memoria do paragrafo unico.
        let markdown = "---\ntags: [revisao/prova]\n---\n# ATP\nATP armazena energia.";
        let mut units = build_learning_units(markdown, "sha256:one", &[]);
        assert_eq!(units.len(), 1);
        units[0].fsrs = Some(FsrsState {
            difficulty: 5.0,
            stability_days: 12.0,
            retrievability: 0.85,
            last_reviewed_at_unix_ms: 1_730_000_000_000,
        });
        units[0].latest_evaluation = Some(UnitEvaluation::Evaluated {
            evaluated_at_unix_ms: 1_730_000_000_000,
            score: 90,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::Conversation,
            gaps: Vec::new(),
            assertions: Vec::new(),
        });
        let changed_frontmatter =
            "---\ntags: [revisao/prova, revisao/manter]\n---\n# ATP\nATP armazena energia.";
        let rebuilt =
            build_learning_units_with_limits(changed_frontmatter, "sha256:two", &units, 800);
        assert_eq!(rebuilt.len(), 1);
        // Mesma identidade e mesmo estado de memoria, apesar do frontmatter
        // novo e do hash de conteudo novo.
        assert_eq!(rebuilt[0].id, "unit-1");
        assert!(rebuilt[0].fsrs.is_some());
        assert!(matches!(
            rebuilt[0].latest_evaluation,
            Some(UnitEvaluation::Evaluated { .. })
        ));
        assert_eq!(
            rebuilt[0].source_end_utf16,
            changed_frontmatter.encode_utf16().count() as u64
        );
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
        // Uma unidade por secao: Biologia (um paragrafo), Celula (um paragrafo)
        // e Quimica (cinco paragrafos agrupados).
        assert_eq!(units.len(), 3);
        assert_eq!(units[0].section_path, vec!["Biologia".to_string()]);
        assert_eq!(
            units[1].section_path,
            vec!["Biologia".to_string(), "Celula".to_string()]
        );
        assert_eq!(units[2].section_path, vec!["Quimica".to_string()]);
    }

    #[test]
    fn consecutive_paragraphs_under_a_heading_group_into_one_section_unit() {
        // 7 blocos (> 6) forcam a segmentacao; os paragrafos da mesma secao
        // viram uma unidade Section, nao tres unidades Paragraph soltas.
        let markdown = "# Fundamentos\n\nPrimeiro paragrafo da secao.\n\nSegundo paragrafo da secao.\n\nTerceiro paragrafo da secao.\n\n# Outra\n\nQuarto paragrafo.\n\nQuinto paragrafo.\n\nSexto paragrafo.\n\nSetimo paragrafo.";
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].kind, LearningUnitKind::Section);
        assert_eq!(units[0].section_path, vec!["Fundamentos".to_string()]);
        // O range de cada secao cobre do inicio do primeiro paragrafo ao fim do
        // ultimo paragrafo dela, sem invadir a secao seguinte.
        let utf16_len = |text: &str| text.encode_utf16().count() as u64;
        let first_start = markdown.find("Primeiro paragrafo").expect("first block");
        let first_end = markdown.find("Terceiro paragrafo").expect("third block")
            + "Terceiro paragrafo da secao.".len();
        assert_eq!(
            units[0].source_start_utf16,
            utf16_len(&markdown[..first_start])
        );
        assert_eq!(units[0].source_end_utf16, utf16_len(&markdown[..first_end]));
        let second_start = markdown.find("Quarto paragrafo").expect("fourth block");
        let second_end =
            markdown.find("Setimo paragrafo").expect("seventh block") + "Setimo paragrafo.".len();
        assert_eq!(units[1].kind, LearningUnitKind::Section);
        assert_eq!(units[1].section_path, vec!["Outra".to_string()]);
        assert_eq!(
            units[1].source_start_utf16,
            utf16_len(&markdown[..second_start])
        );
        assert_eq!(
            units[1].source_end_utf16,
            utf16_len(&markdown[..second_end])
        );
        // As secoes nao se sobrepoem e estao ordenadas.
        assert!(units[0].source_end_utf16 <= units[1].source_start_utf16);
    }

    #[test]
    fn paragraphs_before_the_first_heading_form_one_intro_unit() {
        // 7 blocos forcam a segmentacao; o preambulo sem heading agrupa em uma
        // unidade de introducao antes das secoes.
        let markdown = "Introducao um.\n\nIntroducao dois.\n\nIntroducao tres.\n\n# Secao\n\nConteudo um.\n\nConteudo dois.\n\nConteudo tres.\n\nConteudo quatro.";
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].section_path, Vec::<String>::new());
        assert_eq!(units[0].kind, LearningUnitKind::Paragraph);
        assert_eq!(units[1].section_path, vec!["Secao".to_string()]);
        assert_eq!(units[1].kind, LearningUnitKind::Section);
    }

    #[test]
    fn a_note_without_headings_stays_per_paragraph() {
        // Sem nenhum heading nao ha estrutura de secao: cada bloco permanece
        // individual, mantendo a granulacao de revisao das notas longas.
        let markdown = long_markdown(MAX_WHOLE_NOTE_BLOCKS + 1);
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        assert_eq!(units.len(), MAX_WHOLE_NOTE_BLOCKS + 1);
        assert!(units
            .iter()
            .all(|unit| unit.kind == LearningUnitKind::Paragraph));
        assert!(units.iter().all(|unit| unit.section_path.is_empty()));
    }

    #[test]
    fn headings_without_content_produce_no_section_unit() {
        // Um heading que so tem sub-headings (sem conteudo proprio) nao vira
        // unidade; apenas as secoes folha com conteudo aparecem.
        let markdown = "# Topico\n\n## Algoritmos\n\nConteudo de algoritmos.\n\n## Complexidade\n\nConteudo de complexidade.\n\n# Outro\n\nParagrafo um.\n\nParagrafo dois.\n\nParagrafo tres.\n\nParagrafo quatro.\n\nParagrafo cinco.";
        let units = build_learning_units(&markdown, "sha256:note", &[]);
        // Topico nao vira unidade (sem conteudo proprio); Algoritmos,
        // Complexidade e Outro aparecem.
        assert_eq!(units.len(), 3);
        assert_eq!(
            units[0].section_path,
            vec!["Topico".to_string(), "Algoritmos".to_string()]
        );
        assert_eq!(
            units[1].section_path,
            vec!["Topico".to_string(), "Complexidade".to_string()]
        );
        assert_eq!(units[2].section_path, vec!["Outro".to_string()]);
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
            assertions: Vec::new(),
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
    fn re_segmenting_paragraphs_into_sections_merges_projection_conservatively() {
        use crate::review::contract::{LearningUnit, RecallOutcome, UnitIdentity};
        // O mesmo markdown com headings: a nota longa agora segmenta em duas
        // secoes (A: 3 paragrafos, B: 4) em vez de sete paragrafos.
        let paragraphs = (1..=7)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>();
        let markdown = format!(
            "# A\n\n{}\n\n{}\n\n{}\n\n# B\n\n{}\n\n{}\n\n{}\n\n{}",
            paragraphs[0],
            paragraphs[1],
            paragraphs[2],
            paragraphs[3],
            paragraphs[4],
            paragraphs[5],
            paragraphs[6]
        );
        let content_hash = source_hash(&markdown);
        // Projecao: o pior dos tres primeiros e o unit-2 (30).
        let projection = |score: u8, stability: f64| {
            let outcome = if score <= 39 {
                RecallOutcome::Forgotten
            } else if score <= 69 {
                RecallOutcome::Partial
            } else {
                RecallOutcome::Good
            };
            let fsrs = FsrsState {
                difficulty: 5.0,
                stability_days: stability,
                retrievability: 0.7,
                last_reviewed_at_unix_ms: 1_720_000_000_000,
            };
            let evaluation = UnitEvaluation::Evaluated {
                score,
                outcome,
                evidence: crate::review::contract::EvidenceStrength::FreeRecall,
                evaluated_at_unix_ms: 1_720_000_000_000,
                gaps: Vec::new(),
                assertions: Vec::new(),
            };
            (fsrs, evaluation)
        };
        let (fsrs_80, eval_80) = projection(80, 8.0);
        let (fsrs_30, eval_30) = projection(30, 2.0);
        let (fsrs_60, eval_60) = projection(60, 5.0);
        // Unidades antigas do regime por paragrafo, com offsets no mesmo
        // markdown (a migracao re-segmenta conteudo inalterado).
        let mut old_units = Vec::new();
        for (index, paragraph) in paragraphs.iter().enumerate() {
            let start = u64::try_from(markdown.find(paragraph).expect("paragraph"))
                .expect("offset")
                .try_into()
                .expect("u64");
            let end = start + u64::try_from(paragraph.len()).expect("len");
            let (fsrs, latest_evaluation) = match index {
                0 => (Some(fsrs_80.clone()), Some(eval_80.clone())),
                1 => (Some(fsrs_30.clone()), Some(eval_30.clone())),
                2 => (Some(fsrs_60.clone()), Some(eval_60.clone())),
                _ => (None, None),
            };
            old_units.push(LearningUnit {
                id: format!("unit-{}", index + 1),
                ordinal: index as u64,
                kind: LearningUnitKind::Paragraph,
                content_hash: source_hash(paragraph),
                section_path: Vec::new(),
                identity: UnitIdentity {
                    signature_version: 1,
                    normalized_content_hash: source_hash(&normalize(paragraph)),
                    previous_context_hash: None,
                    next_context_hash: None,
                    approximate_start_utf16: start,
                },
                source_start_utf16: start,
                source_end_utf16: end,
                fsrs,
                latest_evaluation,
            });
        }

        let rebuilt = build_learning_units(&markdown, &content_hash, &old_units);
        assert_eq!(rebuilt.len(), 2);

        // A secao A herdou a identidade do primeiro contido e a projecao
        // conservadora (pior nota e menor estabilidade: unit-2).
        assert_eq!(rebuilt[0].id, "unit-1");
        assert_eq!(rebuilt[0].kind, LearningUnitKind::Section);
        assert_eq!(rebuilt[0].fsrs.as_ref(), Some(&fsrs_30));
        assert_eq!(
            serde_json::to_value(&rebuilt[0].latest_evaluation).expect("evaluation value"),
            serde_json::to_value(Some(eval_30.clone())).expect("evaluation value")
        );
        let section_a_content = format!(
            "{}\n\n{}\n\n{}",
            paragraphs[0], paragraphs[1], paragraphs[2]
        );
        assert_eq!(rebuilt[0].content_hash, source_hash(&section_a_content));

        // A secao B nao tinha projecao nos contidos: comeca sem memoria.
        assert_eq!(rebuilt[1].id, "unit-4");
        assert!(rebuilt[1].fsrs.is_none());
        assert!(rebuilt[1].latest_evaluation.is_none());
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
