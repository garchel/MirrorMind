use super::contract::{LearningDocument, LearningUnit, ReviewMode, UnitEvaluation};

/// Resultado da cobertura adaptativa de uma sessao: as unidades que a sessao
/// deve avaliar, os intervalos UTF-16 dessas unidades no Markdown original
/// (para fundamentar citacoes) e o texto dessas unidades (o subset enviado a
/// IA, para que as perguntas nunca cubram conteudo fora do escopo da sessao).
pub struct SessionCoverage {
    pub target_unit_ids: Vec<String>,
    pub target_ranges_utf16: Vec<(u64, u64)>,
    pub session_markdown: String,
}

/// Limites de respostas de cada modo, compartilhados pela selecao de
/// cobertura e pela validacao de sessoes no dominio.
pub fn answer_bounds(mode: &ReviewMode) -> (u8, u8) {
    match mode {
        ReviewMode::Exam => (3, 5),
        ReviewMode::Conversation => (4, 6),
    }
}

fn answers_per_mode(mode: &ReviewMode) -> (usize, usize) {
    let (minimum, maximum) = answer_bounds(mode);
    (usize::from(minimum), usize::from(maximum))
}

/// Uma unidade foi efetivamente observada quando possui uma avaliacao
/// concluida persistida (nao inconclusiva). Unidades nunca observadas — ou com
/// a ultima avaliacao inconclusiva — precisam de uma observacao real.
fn is_observed(unit: &LearningUnit) -> bool {
    matches!(
        unit.latest_evaluation,
        Some(UnitEvaluation::Evaluated { .. })
    )
}

/// Uma unidade observada e historicamente fraca enquanto a ultima pontuacao
/// permanecer abaixo de 70 (resultado esquecida ou dificil).
fn is_weak(unit: &LearningUnit) -> bool {
    matches!(
        unit.latest_evaluation,
        Some(UnitEvaluation::Evaluated { score, .. }) if score < 70
    )
}

/// Momento (completed_at da sessao) em que a unidade participou pela ultima
/// vez de uma sessao. Zero quando nunca participou: e a base da rotacao, que
/// evita repetir unidades saudaveis antes de cobrir as restantes.
fn last_included_at(document: &LearningDocument, unit_id: &str) -> u64 {
    document
        .sessions
        .iter()
        .rev()
        .find(|session| {
            session
                .unit_results
                .iter()
                .any(|result| result.unit_snapshot.id == unit_id)
        })
        .map(|session| session.completed_at_unix_ms)
        .unwrap_or(0)
}

/// Seleciona as unidades que a sessao deve avaliar.
///
/// - Notas curtas (uma unidade ou ate o maximo de respostas do modo) avaliam
///   todas as unidades em cada sessao, como hoje.
/// - Notas segmentadas selecionam uma parte: garantem espaco para unidades
///   nunca avaliadas, incluem unidades historicamente fracas enquanto
///   permanecerem fracas e preenchem as demais vagas por rotacao (a unidade
///   que ha mais tempo nao participa entra primeiro).
pub fn select_session_units(
    document: &LearningDocument,
    markdown: &str,
    mode: ReviewMode,
) -> SessionCoverage {
    let (min_answers, max_answers) = answers_per_mode(&mode);
    let total = document.units.len();
    let target_ids: Vec<String> = if total <= max_answers {
        document.units.iter().map(|unit| unit.id.clone()).collect()
    } else {
        // O orcamento fica entre o minimo e o maximo de respostas do modo,
        // proporcional a 40% do total: cobre a nota em poucas sessoes sem
        // exigir mais perguntas do que o modo suporta.
        let budget = ((total as f64 * 0.4).ceil() as usize).clamp(min_answers, max_answers);
        let mut never_evaluated = document
            .units
            .iter()
            .filter(|unit| !is_observed(unit))
            .collect::<Vec<_>>();
        never_evaluated.sort_by_key(|unit| unit.ordinal);
        let mut weak = document
            .units
            .iter()
            .filter(|unit| is_observed(unit) && is_weak(unit))
            .collect::<Vec<_>>();
        weak.sort_by_key(|unit| (last_included_at(document, &unit.id), unit.ordinal));
        let mut rotation = document
            .units
            .iter()
            .filter(|unit| is_observed(unit) && !is_weak(unit))
            .collect::<Vec<_>>();
        rotation.sort_by_key(|unit| (last_included_at(document, &unit.id), unit.ordinal));

        // Nunca avaliadas recebem espaco garantido, mas nao exclusivo: as
        // fracas entram com uma reserva propria (ate metade do orcamento)
        // enquanto permanecerem fracas, em vez de esperarem a cobertura de
        // todas as nunca avaliadas em notas muito longas. O restante e
        // preenchido por rotacao, evitando repetir saudaveis antes do fim.
        let weak_budget = if weak.is_empty() {
            0
        } else {
            (budget / 2).clamp(1, weak.len())
        };
        let never_budget = budget.saturating_sub(weak_budget);
        let mut selected: Vec<&LearningUnit> = Vec::with_capacity(budget);
        selected.extend(never_evaluated.iter().take(never_budget));
        selected.extend(weak.iter().take(weak_budget));
        let remaining = budget.saturating_sub(selected.len());
        selected.extend(rotation.iter().take(remaining));
        selected.into_iter().map(|unit| unit.id.clone()).collect()
    };

    let target_ranges_utf16 = document
        .units
        .iter()
        .filter(|unit| target_ids.contains(&unit.id))
        .map(|unit| (unit.source_start_utf16, unit.source_end_utf16))
        .collect::<Vec<_>>();
    let session_markdown = slice_units_utf16(markdown, &target_ranges_utf16);
    SessionCoverage {
        target_unit_ids: target_ids,
        target_ranges_utf16,
        session_markdown,
    }
}

/// Converte um deslocamento UTF-16 do Markdown para o deslocamento em bytes do
/// caractere que o contem (os intervalos das unidades caem sempre em fronteiras
/// de caractere, pois vem da segmentacao).
fn utf16_to_byte(markdown: &str, utf16_offset: u64) -> usize {
    let mut count = 0u64;
    for (byte_index, character) in markdown.char_indices() {
        if count >= utf16_offset {
            debug_assert!(
                count == utf16_offset,
                "o intervalo UTF-16 deve cair em fronteira de caractere"
            );
            return byte_index;
        }
        count += character.len_utf16() as u64;
    }
    debug_assert!(
        count == utf16_offset,
        "o intervalo UTF-16 deve cair em fronteira de caractere"
    );
    markdown.len()
}

/// Extrai e une o texto das unidades-alvo: e o unico Markdown que a IA recebe
/// na sessao, garantindo que perguntas e avaliacao fiquem dentro do escopo.
fn slice_units_utf16(markdown: &str, ranges: &[(u64, u64)]) -> String {
    ranges
        .iter()
        .map(|(start, end)| {
            let byte_start = utf16_to_byte(markdown, *start);
            let byte_end = utf16_to_byte(markdown, *end).min(markdown.len());
            if byte_start >= byte_end {
                return String::new();
            }
            markdown[byte_start..byte_end].trim().to_string()
        })
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::select_session_units;
    use crate::review::contract::{
        LearningDocument, LearningUnit, LearningUnitKind, ReviewMode, UnitEvaluation,
    };
    use crate::review::segmentation::build_learning_units;

    fn document_with_units(markdown: &str, previous: &[LearningUnit]) -> LearningDocument {
        let mut value: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/review-learning-v1.json"
        ))
        .unwrap();
        let hash = crate::review::evaluation::source_hash(markdown);
        value["note"]["contentHash"] = serde_json::json!(hash.clone());
        value["note"]["readiness"]["assessedContentHash"] = serde_json::json!(hash.clone());
        value["units"] = serde_json::json!(build_learning_units(markdown, &hash, previous)
            .iter()
            .map(|unit| {
                serde_json::json!({
                    "id": unit.id,
                    "ordinal": unit.ordinal,
                    "kind": match unit.kind {
                        LearningUnitKind::WholeNote => "wholeNote",
                        LearningUnitKind::Section => "section",
                        LearningUnitKind::Paragraph => "paragraph",
                    },
                    "contentHash": unit.content_hash,
                    "sectionPath": unit.section_path,
                    "identity": unit.identity,
                    "sourceStartUtf16": unit.source_start_utf16,
                    "sourceEndUtf16": unit.source_end_utf16,
                    "fsrs": unit.fsrs,
                    "latestEvaluation": unit.latest_evaluation,
                })
            })
            .collect::<Vec<_>>());
        value["sessions"] = serde_json::json!([]);
        serde_json::from_value(value).unwrap()
    }

    fn evaluated(score: u8) -> Option<UnitEvaluation> {
        Some(UnitEvaluation::Evaluated {
            score,
            outcome: crate::review::contract::RecallOutcome::Good,
            evidence: crate::review::contract::EvidenceStrength::FreeRecall,
            evaluated_at_unix_ms: 1_720_000_000_000,
            gaps: Vec::new(),
        })
    }

    #[test]
    fn a_single_unit_note_covers_everything_in_every_session() {
        let markdown = "# ATP\nATP armazena energia para uso celular.";
        let document = document_with_units(markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        assert_eq!(coverage.target_unit_ids, vec!["unit-1".to_string()]);
        assert_eq!(coverage.session_markdown, markdown);
    }

    #[test]
    fn a_note_up_to_the_mode_limit_covers_all_units() {
        // Blocos pesados (>800 palavras) forcam a segmentacao em paragrafos;
        // com cinco unidades, a nota cabe no limite do modo prova e a sessao
        // cobre tudo, sem cobertura adaptativa.
        let heavy_block = "palavra ".repeat(200);
        let markdown = (1..=5)
            .map(|_| heavy_block.clone())
            .collect::<Vec<_>>()
            .join("\n\n");
        let document = document_with_units(&markdown, &[]);
        assert_eq!(document.units.len(), 5);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        assert_eq!(coverage.target_unit_ids.len(), 5);
        assert_eq!(coverage.target_unit_ids[0], "unit-1");
        assert_eq!(coverage.target_unit_ids[4], "unit-5");
    }

    #[test]
    fn a_long_note_covers_never_evaluated_units_first_by_rotation() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let document = document_with_units(&markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // Orcamento = clamp(ceil(10*0.4)=4, 3, 5) = 4: os quatro primeiros
        // paragrafos (nunca avaliados, por ordem).
        assert_eq!(coverage.target_unit_ids.len(), 4);
        assert_eq!(
            coverage.target_unit_ids,
            vec!["unit-1", "unit-2", "unit-3", "unit-4"]
        );
        // O subset da IA contem exatamente o texto das unidades selecionadas.
        let expected = (1..=4)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        assert_eq!(coverage.session_markdown, expected);
    }

    #[test]
    fn weak_units_are_included_while_they_remain_weak() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let hash = crate::review::evaluation::source_hash(&markdown);
        let mut units = build_learning_units(&markdown, &hash, &[]);
        // Somente a unidade 2 nunca foi avaliada; as demais foram avaliadas.
        // A unidade 7 ficou fraca (50) e as outras estao saudaveis (88).
        for index in 0..units.len() {
            if index != 1 {
                units[index].latest_evaluation = evaluated(88);
            }
        }
        units[6].latest_evaluation = evaluated(50);
        let document = document_with_units(&markdown, &units);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // Orcamento 4: a nunca avaliada (unit-2) e a fraca (unit-7) entram
        // antes das saudaveis, mesmo com a rotacao disponivel.
        assert!(coverage.target_unit_ids.contains(&"unit-2".to_string()));
        assert!(coverage.target_unit_ids.contains(&"unit-7".to_string()));
    }

    #[test]
    fn weak_units_keep_a_reserved_slot_even_with_many_never_evaluated_units() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let hash = crate::review::evaluation::source_hash(&markdown);
        let mut units = build_learning_units(&markdown, &hash, &[]);
        // Seis unidades nunca avaliadas (1..=6), a unidade 7 fraca (50) e as
        // demais saudaveis: sem reserva, a fraca esperaria toda a cobertura
        // das nunca avaliadas para entrar na sessao.
        for index in 6..units.len() {
            if index != 6 {
                units[index].latest_evaluation = evaluated(88);
            }
        }
        units[6].latest_evaluation = evaluated(50);
        let document = document_with_units(&markdown, &units);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        assert_eq!(coverage.target_unit_ids.len(), 4);
        assert!(
            coverage.target_unit_ids.contains(&"unit-7".to_string()),
            "weak units must keep a reserved slot even while never-evaluated units remain"
        );
    }

    #[test]
    fn selection_is_deterministic_for_the_same_document() {
        let markdown = (1..=12)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let document = document_with_units(&markdown, &[]);
        let first = select_session_units(&document, &markdown, ReviewMode::Conversation);
        let second = select_session_units(&document, &markdown, ReviewMode::Conversation);
        assert_eq!(first.target_unit_ids, second.target_unit_ids);
        assert_eq!(first.session_markdown, second.session_markdown);
        // Conversa: orcamento = clamp(ceil(12*0.4)=5, 4, 6) = 5 unidades.
        assert_eq!(first.target_unit_ids.len(), 5);
    }

    #[test]
    fn slicing_preserves_accented_multibyte_content() {
        let markdown = (1..=8)
            .map(|index| {
                format!("A fotossíntese converte energia luminosa em glicose e oxigênio ({index}).")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let document = document_with_units(&markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // Orcamento = clamp(ceil(8*0.4)=4, 3, 5) = 4 unidades, texto exato.
        assert_eq!(coverage.target_unit_ids.len(), 4);
        assert!(coverage.session_markdown.contains("fotossíntese"));
        assert!(coverage.session_markdown.contains("oxigênio (1)"));
        assert!(!coverage.session_markdown.contains("(5)"));
    }
}
