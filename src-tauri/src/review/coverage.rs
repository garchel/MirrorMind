use super::contract::{
    LearningDocument, LearningUnit, LearningUnitKind, ReviewMode, UnitEvaluation,
};
use super::session::{is_enunciado_stopword, normalize_for_grounding};
use serde::Serialize;
use std::collections::HashSet;

/// Resultado da cobertura adaptativa de uma sessao: as unidades que a sessao
/// deve avaliar, os intervalos UTF-16 dessas unidades no Markdown original
/// (para fundamentar citacoes), o texto dessas unidades (o subset enviado a
/// IA, para que as perguntas nunca cubram conteudo fora do escopo da sessao)
/// e o plano estimado da sessao (duracao, cobertura e sessoes para cobrir).
pub struct SessionCoverage {
    pub target_unit_ids: Vec<String>,
    pub target_ranges_utf16: Vec<(u64, u64)>,
    pub session_markdown: String,
    pub plan: SessionPlan,
}

/// Pontos avaliáveis de uma unidade-alvo: frases substantivas extraidas
/// deterministicamente do texto da unidade (sem classificar central ou
/// secundario — a classificacao e a ponderacao por centralidade sao a V2,
/// linha `Identificacao e priorizacao do cerne`). Exibidos no plano da sessao
/// para o usuario ver o que sera testado antes de iniciar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitEvaluablePoints {
    pub unit_id: String,
    pub ordinal: u32,
    pub kind: LearningUnitKind,
    pub points: Vec<String>,
}

/// Plano estimado de uma sessao, derivado deterministicamente da selecao de
/// cobertura — sem consultar a IA. Exibido na preparacao da sessao para o
/// usuario calibrar a expectativa de duracao e cobertura.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlan {
    /// Quantas unidades a sessao cobre (o orcamento de respostas do modo).
    pub target_unit_count: u32,
    /// Total de unidades de revisao da nota.
    pub total_unit_count: u32,
    /// Fracao das unidades cobertas nesta sessao (0..=1, arredondada a 2 casas).
    pub coverage_fraction: f64,
    /// Estimativa de duracao em minutos (piso 1).
    pub estimated_minutes: u32,
    /// Sessoes estimadas para cobrir todas as unidades com este orcamento.
    pub expected_sessions_to_cover: u32,
    /// Pontos avaliáveis por unidade-alvo (frases substantivas do texto), para
    /// o plano mostrar o que a sessao testara. Sem classificacao na V1.
    pub unit_evaluable_points: Vec<UnitEvaluablePoints>,
}

/// Segundos estimados por resposta, por modo: na prova, multipla escolha leva
/// menos tempo que uma resposta curta (media 90s); na conversa, a resposta
/// aberta progressiva gira em torno de 75s.
fn seconds_per_answer(mode: &ReviewMode) -> u32 {
    match mode {
        ReviewMode::Exam => 90,
        ReviewMode::Conversation => 75,
    }
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

/// Urgencia de dominio historico de uma unidade avaliada: menor recuperabilidade
/// primeiro (a unidade mais provavel de ter sido esquecida e a mais urgente),
/// depois menor pontuacao, depois a que ha mais tempo nao participa. Unidades
/// sem estado FSRS sao tratadas como recuperabilidade zero (mais urgentes).
fn mastery_urgency(unit: &LearningUnit, document: &LearningDocument) -> (u64, u8, u64, u64) {
    let retrievability_millis = unit
        .fsrs
        .as_ref()
        .map(|fsrs| (fsrs.retrievability * 1000.0).round() as u64)
        .unwrap_or(0);
    let score = match unit.latest_evaluation {
        Some(UnitEvaluation::Evaluated { score, .. }) => score,
        _ => 100,
    };
    (
        retrievability_millis,
        score,
        last_included_at(document, &unit.id),
        unit.ordinal,
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

/// Seleciona as unidades que a sessao deve avaliar e estima o plano.
///
/// - Notas curtas (uma unidade ou ate o maximo de respostas do modo) avaliam
///   todas as unidades em cada sessao, como hoje.
/// - Notas segmentadas selecionam uma parte com orcamento adaptativo: quanto
///   mais unidades precisam de atencao (nunca avaliadas ou fracas), maior a
///   fracao coberta na sessao (0.5 em recuperacao, 0.4 misto, 0.3 em
///   manutencao), sempre dentro dos limites de respostas do modo.
/// - A prioridade usa o dominio historico: nunca avaliadas primeiro, depois as
///   fracas ordenadas pela urgencia de memoria (menor recuperabilidade, menor
///   pontuacao) e o restante por rotacao (a unidade que ha mais tempo nao
///   participa entra primeiro).
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
        // Fracao adaptativa pela saude da nota: recuperacao quando metade ou
        // mais das unidades precisam de atencao, manutencao quando nenhuma
        // precisa, e misto no meio.
        let attention_needed = document
            .units
            .iter()
            .filter(|unit| !is_observed(unit) || is_weak(unit))
            .count();
        let fraction = if attention_needed == 0 {
            0.3
        } else if attention_needed * 2 >= total {
            0.5
        } else {
            0.4
        };
        let budget = ((total as f64 * fraction).ceil() as usize).clamp(min_answers, max_answers);
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
        weak.sort_by_key(|unit| mastery_urgency(unit, document));
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
    // Pontos avaliáveis por unidade-alvo: frases substantivas do texto de cada
    // unidade, extraidas deterministicamente (sem IA) para o plano mostrar o
    // que a sessao testara antes de iniciar.
    let unit_evaluable_points = document
        .units
        .iter()
        .filter(|unit| target_ids.contains(&unit.id))
        .map(|unit| UnitEvaluablePoints {
            unit_id: unit.id.clone(),
            ordinal: u32::try_from(unit.ordinal).unwrap_or(u32::MAX),
            kind: unit.kind.clone(),
            points: extract_evaluable_points(&slice_units_utf16(
                markdown,
                &[(unit.source_start_utf16, unit.source_end_utf16)],
            )),
        })
        .collect::<Vec<_>>();
    let plan = SessionPlan {
        target_unit_count: u32::try_from(target_ids.len()).unwrap_or(u32::MAX),
        total_unit_count: u32::try_from(total).unwrap_or(u32::MAX),
        coverage_fraction: rounded_fraction(target_ids.len(), total),
        estimated_minutes: estimated_minutes(&mode, target_ids.len()),
        expected_sessions_to_cover: expected_sessions(target_ids.len(), total),
        unit_evaluable_points,
    };
    SessionCoverage {
        target_unit_ids: target_ids,
        target_ranges_utf16,
        session_markdown,
        plan,
    }
}

/// Fracao de unidades cobertas, arredondada a 2 casas (0..=1).
fn rounded_fraction(target: usize, total: usize) -> f64 {
    if total == 0 {
        return 0.0;
    }
    ((target as f64 / total as f64) * 100.0).round() / 100.0
}

/// Estimativa de duracao em minutos a partir da contagem de respostas.
fn estimated_minutes(mode: &ReviewMode, answers: usize) -> u32 {
    let seconds = answers as u32 * seconds_per_answer(mode);
    (seconds / 60).max(1)
}

/// Sessoes estimadas para cobrir todas as unidades com este orcamento.
fn expected_sessions(target: usize, total: usize) -> u32 {
    if target == 0 {
        return 0;
    }
    ((total + target - 1) / target) as u32
}

/// Limite de pontos avaliáveis por unidade no plano da sessao (evita payloads
/// gigantes em notas longas).
const MAX_EVALUABLE_POINTS_PER_UNIT: usize = 8;
/// Comprimento maximo em caracteres de cada ponto exibido no plano.
const MAX_POINT_CHARS: usize = 160;
/// Comprimento minimo em caracteres de um ponto para nao virar fragmento.
const MIN_POINT_CHARS: usize = 10;

/// Limpa um fragmento do Markdown para exibicao como ponto avaliável: remove
/// marcadores de heading, enfase, codigo, riscado e LaTeX, e colapsa
/// whitespace. Mantem o texto e os acentos (diferente de
/// `normalize_for_grounding`, que e para comparacao).
fn clean_fragment_for_display(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len());
    let mut in_latex = false;
    let mut last_was_space = false;
    for ch in text.chars() {
        match ch {
            '#' | '*' | '`' | '_' | '~' | '>' => continue,
            '$' => {
                in_latex = !in_latex;
                continue;
            }
            _ if in_latex => continue,
            _ if ch.is_whitespace() => {
                if !last_was_space && !cleaned.is_empty() {
                    cleaned.push(' ');
                    last_was_space = true;
                }
            }
            _ => {
                cleaned.push(ch);
                last_was_space = false;
            }
        }
    }
    cleaned.trim().to_string()
}

/// Divide um texto limpo em sentencas, terminando em `.`, `!`, `?` ou `;`
/// (o terminador fica na propria sentenca).
fn split_sentences(text: &str) -> Vec<&str> {
    let mut sentences = Vec::new();
    let mut start = 0;
    for (index, ch) in text.char_indices() {
        if matches!(ch, '.' | '!' | '?' | ';') {
            let end = index + ch.len_utf8();
            sentences.push(&text[start..end]);
            start = end;
        }
    }
    if start < text.len() {
        sentences.push(&text[start..]);
    }
    sentences
}

/// Corta um texto em `max_chars` caracteres (fronteira de caractere), com
/// reticencias quando truncado.
fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut count = 0;
    let mut end = 0;
    for (index, ch) in text.char_indices() {
        if count >= max_chars {
            break;
        }
        count += 1;
        end = index + ch.len_utf8();
    }
    let mut result = text[..end].to_string();
    if result.len() < text.len() {
        result.push('…');
    }
    result
}

/// Identifica os pontos avaliáveis de uma unidade: frases substantivas do seu
/// texto, deterministicas e sem classificar central/secundario. Um ponto e uma
/// sentenca com conteudo — ao menos um termo significativo (4+ caracteres que
/// nao seja stopword de enunciado, apos normalizar) e comprimento minimo —,
/// deduplicada, truncada e limitada por unidade.
pub(crate) fn extract_evaluable_points(text: &str) -> Vec<String> {
    let cleaned = clean_fragment_for_display(text);
    let mut points = Vec::new();
    let mut seen = HashSet::new();
    for sentence in split_sentences(&cleaned) {
        let sentence = sentence.trim();
        if sentence.chars().count() < MIN_POINT_CHARS {
            continue;
        }
        // Titulos e fragmentos (``Fotossintese``, ``Paragrafo curto.``) nao
        // viram ponto: exige ao menos 4 palavras de conteudo.
        if sentence.split_whitespace().count() < 4 {
            continue;
        }
        let has_content = sentence.split_whitespace().any(|word| {
            let normalized = normalize_for_grounding(word);
            normalized.len() >= 4 && !is_enunciado_stopword(&normalized)
        });
        if !has_content {
            continue;
        }
        let point = truncate_chars(sentence, MAX_POINT_CHARS);
        if seen.insert(point.clone()) {
            points.push(point);
        }
        if points.len() >= MAX_EVALUABLE_POINTS_PER_UNIT {
            break;
        }
    }
    points
}

/// Converte um deslocamento UTF-16 do Markdown para o deslocamento em bytes do
/// caractere que o contem (os intervalos das unidades caem sempre em fronteiras
/// de caractere, pois vem da segmentacao).
pub(crate) fn utf16_to_byte(markdown: &str, utf16_offset: u64) -> usize {
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
pub(crate) fn slice_units_utf16(markdown: &str, ranges: &[(u64, u64)]) -> String {
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
        FsrsState, LearningDocument, LearningUnit, LearningUnitKind, ReviewMode, UnitEvaluation,
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
            assertions: Vec::new(),
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
        // Nota nova (todas nunca avaliadas) esta em recuperacao: fracao 0.5,
        // orcamento = clamp(ceil(10*0.5)=5, 3, 5) = 5 — os cinco primeiros
        // paragrafos (nunca avaliados, por ordem).
        assert_eq!(coverage.target_unit_ids.len(), 5);
        assert_eq!(
            coverage.target_unit_ids,
            vec!["unit-1", "unit-2", "unit-3", "unit-4", "unit-5"]
        );
        // O subset da IA contem exatamente o texto das unidades selecionadas.
        let expected = (1..=5)
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
        // 7 de 10 unidades precisam de atencao -> fracao 0.5, orcamento 5.
        assert_eq!(coverage.target_unit_ids.len(), 5);
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
        // Conversa, nota nova (recuperacao): fracao 0.5,
        // orcamento = clamp(ceil(12*0.5)=6, 4, 6) = 6 unidades.
        assert_eq!(first.target_unit_ids.len(), 6);
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
        // Nota nova (recuperacao): fracao 0.5, orcamento = clamp(ceil(8*0.5)=4, 3, 5) = 4.
        assert_eq!(coverage.target_unit_ids.len(), 4);
        assert!(coverage.session_markdown.contains("fotossíntese"));
        assert!(coverage.session_markdown.contains("oxigênio (1)"));
        assert!(!coverage.session_markdown.contains("(5)"));
    }

    fn with_fsrs(unit: &mut LearningUnit, retrievability: f64) {
        unit.fsrs = Some(FsrsState {
            difficulty: 5.0,
            stability_days: 10.0,
            retrievability,
            last_reviewed_at_unix_ms: 1_720_000_000_000,
        });
    }

    #[test]
    fn healthy_notes_use_a_lighter_maintenance_budget() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let hash = crate::review::evaluation::source_hash(&markdown);
        let mut units = build_learning_units(&markdown, &hash, &[]);
        for unit in &mut units {
            unit.latest_evaluation = evaluated(88);
        }
        let document = document_with_units(&markdown, &units);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // Nenhuma unidade precisa de atencao -> manutencao: fracao 0.3,
        // orcamento = clamp(ceil(10*0.3)=3, 3, 5) = 3 unidades.
        assert_eq!(coverage.target_unit_ids.len(), 3);
    }

    #[test]
    fn weak_units_are_ordered_by_mastery_urgency() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let hash = crate::review::evaluation::source_hash(&markdown);
        let mut units = build_learning_units(&markdown, &hash, &[]);
        for (index, unit) in units.iter_mut().enumerate() {
            unit.latest_evaluation = evaluated(88);
            match index {
                // Tres fracas com recuperabilidades e scores diferentes: a
                // mais urgente e a de menor recuperabilidade, depois menor
                // score (empate de recuperabilidade), depois a mais antiga.
                2 => {
                    unit.latest_evaluation = evaluated(60);
                    with_fsrs(unit, 0.9);
                }
                4 => {
                    unit.latest_evaluation = evaluated(50);
                    with_fsrs(unit, 0.5);
                }
                6 => {
                    unit.latest_evaluation = evaluated(55);
                    with_fsrs(unit, 0.2);
                }
                _ => {}
            }
        }
        let document = document_with_units(&markdown, &units);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // 3 fracas -> misto (0.4), orcamento 4; reserva de fracas = 2: as duas
        // mais urgentes entram na ordem de urgencia (unit-7 ret 0.2 antes de
        // unit-5 ret 0.5), e a menos urgente (unit-3 ret 0.9) fica para a
        // proxima sessao em vez de ocupar vaga de saudavel.
        assert!(coverage.target_unit_ids.len() == 4);
        let position = |id: &str| {
            coverage
                .target_unit_ids
                .iter()
                .position(|candidate| candidate == id)
                .expect("selected unit")
        };
        assert!(position("unit-7") < position("unit-5"));
        assert!(!coverage.target_unit_ids.contains(&"unit-3".to_string()));
    }

    #[test]
    fn the_session_plan_reports_duration_coverage_and_expected_sessions() {
        let markdown = (1..=10)
            .map(|index| format!("Paragrafo {index} com conteudo substantivo para revisao."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let document = document_with_units(&markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        let plan = &coverage.plan;
        assert_eq!(plan.target_unit_count, 5);
        assert_eq!(plan.total_unit_count, 10);
        assert_eq!(plan.coverage_fraction, 0.5);
        // 5 respostas * 90s = 450s = 7 min (piso de 1).
        assert_eq!(plan.estimated_minutes, 7);
        assert_eq!(plan.expected_sessions_to_cover, 2);
        // Conversa usa outra duracao; orcamento = clamp(ceil(10*0.5)=5, 4, 6) = 5.
        let conversation = select_session_units(&document, &markdown, ReviewMode::Conversation);
        assert_eq!(conversation.plan.target_unit_count, 5);
        assert_eq!(conversation.plan.estimated_minutes, 6);
        assert_eq!(conversation.plan.expected_sessions_to_cover, 2);
    }

    #[test]
    fn a_whole_note_plan_covers_everything_in_one_session() {
        let markdown = "# ATP\nATP armazena energia para uso celular.";
        let document = document_with_units(&markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        assert_eq!(coverage.plan.target_unit_count, 1);
        assert_eq!(coverage.plan.total_unit_count, 1);
        assert_eq!(coverage.plan.coverage_fraction, 1.0);
        assert_eq!(coverage.plan.expected_sessions_to_cover, 1);
        assert_eq!(coverage.plan.estimated_minutes, 1);
    }

    #[test]
    fn the_session_plan_carries_evaluable_points_per_target_unit() {
        let markdown = "# Fotossintese\n\nA fotossintese transforma energia luminosa em energia quimica.\nO processo ocorre nos cloroplastos e libera oxigenio.\n\nParagrafo curto.";
        let document = document_with_units(&markdown, &[]);
        let coverage = select_session_units(&document, &markdown, ReviewMode::Exam);
        // As unidades-alvo trazem seus pontos; a nota inteira (nota curta) e
        // uma unica unidade, e o paragrafo curto nao gera ponto (fragmento).
        assert_eq!(coverage.plan.unit_evaluable_points.len(), 1);
        let unit = &coverage.plan.unit_evaluable_points[0];
        assert_eq!(unit.kind, LearningUnitKind::WholeNote);
        assert_eq!(unit.points.len(), 2);
        assert!(unit.points[0].contains("transforma energia luminosa"));
        assert!(unit.points[1].contains("cloroplastos"));
    }

    #[test]
    fn extract_evaluable_points_splits_cleans_dedupes_and_caps() {
        // Marcacao Markdown e LaTeX sao removidos para exibicao.
        let text = "**Local:** Tilacoides.\n\nA fotolise libera $\\text{O}_2$ e protons.\n\nA fotolise libera $\\text{O}_2$ e protons.\n\n# Titulo sem corpo.";
        let points = super::extract_evaluable_points(text);
        // A primeira sentenca e curta demais? "Local: Tilacoides." tem 17
        // caracteres — suficiente; a duplicada e deduplicada; o heading nao
        // gera sentenca propria (fica unido ao paragrafo seguinte ou e curto).
        assert!(!points.is_empty());
        assert!(points.len() <= super::MAX_EVALUABLE_POINTS_PER_UNIT);
        // Nenhum ponto exibe marcacao ou LaTeX.
        for point in &points {
            assert!(!point.contains('$'));
            assert!(!point.contains("**"));
            assert!(!point.contains('#'));
        }
        // Sem conteudo substantivo: so conectivos e curtas.
        assert!(super::extract_evaluable_points("Sim. Nao. Talvez.").is_empty());
        assert!(super::extract_evaluable_points("# Apenas um titulo").is_empty());
        // Truncamento: sentenca longa e cortada com reticencias.
        let long = format!("{}", "x".repeat(10)) + &"a ".repeat(100);
        let truncated = super::truncate_chars(&long, 40);
        assert!(truncated.chars().count() <= 41);
        assert!(truncated.ends_with('…'));
    }
}
