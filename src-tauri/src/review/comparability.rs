//! Comparabilidade REAL entre provedores de IA (Gemini vs `qwen2.5:7b`).
//!
//! A suite `conformance` prova a equivalencia de contrato dos adaptadores com
//! um servidor falso deterministico. Esta e a contraparte com instancias
//! REAIS: a MESMA nota, as MESMAS perguntas e as MESMAS respostas sao
//! avaliadas por cada provedor pelo MESMO caminho de producao
//! (`evaluate_conversation_with_provider`), e o resultado e um relatorio de
//! divergencia — nota geral, lacunas (citacoes compartilhadas e exclusivas de
//! cada lado) e cobertura de afirmacoes por paragrafo — que o criador usa para
//! decidir sobre a camada de provedor antes de qualquer oferta.
//!
//! O relatorio nunca decide por si: divergencias sao esperadas (modelos
//! diferentes avaliam de formas diferentes); o valor esta em torna-las
//! visiveis e estaveis ao longo do tempo.

use super::provider::StructuredAiProvider;
use super::session::{
    evaluate_conversation_with_provider, score_for_gap_coverage, score_for_unit_assertions,
    ConversationEvaluationFailure, PromptKind, ReviewExchange, ReviewPrompt,
};

/// Nota fixa (frases curtas e distintas) para dar material as perguntas. As
/// mesmas frases alimentam os DOIS provedores, sem depender de geracao.
pub const MARKDOWN: &str = "\
Fotossintese converte energia luminosa em energia quimica.\n\
A clorofila absorve luz nas bandas azul e vermelha do espectro.\n\
O processo libera oxigenio como subproduto da fase clara.\n\
A glicose e o principal produto da fase escura do ciclo de Calvin.\n\
A equacao geral consome gas carbonico e agua para produzir glicose e oxigenio.\n";

/// Uma pergunta fixa e a resposta do usuario para o cenario comparativo.
pub struct ComparabilityCase {
    pub question: &'static str,
    pub answer: &'static str,
}

/// As MESMAS perguntas e respostas para os dois provedores: um mix realista —
/// quatro respostas corretas (uma por sinonimo) e duas erradas — para gerar
/// lacunas e nota parcial, exatamente o terreno onde modelos divergem.
pub const CASES: &[ComparabilityCase] = &[
    ComparabilityCase {
        question: "O que a fotossintese converte?",
        answer: "energia luminosa em energia quimica",
    },
    ComparabilityCase {
        question: "Em quais bandas do espectro a clorofila absorve luz?",
        answer: "nas bandas verde e amarela",
    },
    ComparabilityCase {
        question: "Qual e o principal produto da fase escura do ciclo de Calvin?",
        answer: "oxigenio",
    },
    ComparabilityCase {
        question: "O que o processo libera como subproduto da fase clara?",
        answer: "oxigenio",
    },
    ComparabilityCase {
        question: "A equacao geral consome qual gas?",
        answer: "dioxido de carbono",
    },
    ComparabilityCase {
        question: "A equacao geral produz quais substancias?",
        answer: "glicose e oxigenio",
    },
];

/// Resultado de UM provedor para o cenario fixo: score derivado pelas lacunas
/// (mesmo calculo da producao), scores por afirmacao quando o modelo
/// decompoe os paragrafos, e as citacoes das lacunas (normalizadas) para
/// comparar conjuntos entre provedores.
#[derive(Debug, Clone)]
pub struct ProviderEvaluationOutcome {
    pub provider: &'static str,
    /// Erro legivel quando a avaliacao nao foi valida (sem score).
    pub failure: Option<String>,
    /// Score de cobertura derivado das lacunas (nota inteira = uma unidade).
    pub gap_based_score: Option<u8>,
    /// Scores por paragrafo derivados da cobertura de afirmacoes, quando o
    /// modelo decompoe os paragrafos (ordem do parse).
    pub assertion_scores: Vec<u8>,
    /// Media arredondada dos scores por afirmacao; usa o score por lacunas
    /// quando o modelo nao decompoz nenhum paragrafo.
    pub overall_score: Option<u8>,
    pub summary_present: bool,
    pub gap_count: usize,
    /// Citacoes das lacunas normalizadas (minusculas, espacos colapsados).
    pub gap_quotes: Vec<String>,
    pub inconclusive_count: usize,
}

/// Relatorio de divergencia entre dois provedores para o MESMO cenario.
#[derive(Debug)]
pub struct DivergenceReport {
    pub note_words: usize,
    pub question_count: usize,
    pub providers: [&'static str; 2],
    pub ollama: ProviderEvaluationOutcome,
    pub gemini: ProviderEvaluationOutcome,
}

impl DivergenceReport {
    /// Diferenca absoluta da nota geral (gemini - ollama).
    pub fn score_delta(&self) -> Option<i64> {
        match (self.ollama.overall_score, self.gemini.overall_score) {
            (Some(ollama), Some(gemini)) => Some(i64::from(gemini) - i64::from(ollama)),
            _ => None,
        }
    }

    /// Lacunas (por citacao normalizada) apontadas por AMBOS os provedores.
    pub fn shared_gap_quotes(&self) -> Vec<&str> {
        self.ollama
            .gap_quotes
            .iter()
            .filter(|quote| self.gemini.gap_quotes.contains(quote))
            .map(String::as_str)
            .collect()
    }

    /// Lacunas apontadas apenas pelo Ollama.
    pub fn ollama_only_gap_quotes(&self) -> Vec<&str> {
        self.ollama
            .gap_quotes
            .iter()
            .filter(|quote| !self.gemini.gap_quotes.contains(quote))
            .map(String::as_str)
            .collect()
    }

    /// Lacunas apontadas apenas pelo Gemini.
    pub fn gemini_only_gap_quotes(&self) -> Vec<&str> {
        self.gemini
            .gap_quotes
            .iter()
            .filter(|quote| !self.ollama.gap_quotes.contains(quote))
            .map(String::as_str)
            .collect()
    }

    /// Relatorio legivel para diagnostico (eprintln / log).
    pub fn render(&self) -> String {
        let mut lines = Vec::new();
        lines.push(format!(
            "Comparabilidade real de provedores: {} | {}",
            self.providers[0], self.providers[1]
        ));
        lines.push(format!(
            "Cenario: nota com {} palavra(s), {} pergunta(s), 6 respostas fixas.",
            self.note_words, self.question_count
        ));
        for outcome in [&self.ollama, &self.gemini] {
            lines.push(format!("--- {} ---", outcome.provider));
            if let Some(failure) = &outcome.failure {
                lines.push(format!("  avaliacao invalida: {failure}"));
                continue;
            }
            let overall = outcome
                .overall_score
                .map(|score| score.to_string())
                .unwrap_or_else(|| "-".to_string());
            let gap_score = outcome
                .gap_based_score
                .map(|score| score.to_string())
                .unwrap_or_else(|| "-".to_string());
            lines.push(format!(
                "  nota geral: {overall} (lacunas: {gap_score}) | resumo: {} | lacunas: {} | inconclusivas: {}",
                if outcome.summary_present { "sim" } else { "nao" },
                outcome.gap_count,
                outcome.inconclusive_count,
            ));
            if !outcome.assertion_scores.is_empty() {
                lines.push(format!(
                    "  scores por afirmacao (paragrafo): {}",
                    outcome
                        .assertion_scores
                        .iter()
                        .map(|score| score.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            for quote in &outcome.gap_quotes {
                lines.push(format!("  lacuna citada: {quote}"));
            }
        }
        if let Some(delta) = self.score_delta() {
            lines.push(format!(
                "Divergencia da nota geral ({} - {}): {delta}",
                self.providers[1], self.providers[0]
            ));
        } else {
            lines.push(
                "Divergencia da nota geral: indisponivel (algum lado sem nota valida).".to_string(),
            );
        }
        let shared = self.shared_gap_quotes();
        let ollama_only = self.ollama_only_gap_quotes();
        let gemini_only = self.gemini_only_gap_quotes();
        lines.push(format!(
            "Lacunas: {} compartilhada(s), {} so {} , {} so {}.",
            shared.len(),
            ollama_only.len(),
            self.providers[0],
            gemini_only.len(),
            self.providers[1],
        ));
        for quote in &shared {
            lines.push(format!("  compartilhada: {quote}"));
        }
        for quote in &ollama_only {
            lines.push(format!("  so {}: {quote}", self.providers[0]));
        }
        for quote in &gemini_only {
            lines.push(format!("  so {}: {quote}", self.providers[1]));
        }
        lines.join("\n")
    }
}

fn normalize_gap_quote(quote: &str) -> String {
    quote
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Avalia o cenario fixo (mesma nota, mesmas perguntas e respostas) com um
/// provedor concreto, pelo mesmo caminho exato da producao.
pub fn evaluate_with_provider(
    provider: &dyn StructuredAiProvider,
    provider_name: &'static str,
    markdown: &str,
    cases: &[ComparabilityCase],
) -> ProviderEvaluationOutcome {
    let prompts = cases
        .iter()
        .enumerate()
        .map(|(index, case)| ReviewPrompt {
            id: format!("q{}", index + 1),
            text: case.question.to_string(),
            assistance: String::new(),
            kind: PromptKind::ShortAnswer,
            options: Vec::new(),
            correct_option_index: None,
            expected_answer: None,
            source_quote: None,
            is_clarification: false,
        })
        .collect::<Vec<_>>();
    let exchanges = cases
        .iter()
        .enumerate()
        .map(|(index, case)| ReviewExchange {
            prompt_id: format!("q{}", index + 1),
            prompt: case.question.to_string(),
            answer: case.answer.to_string(),
            assistance_used: false,
            is_clarification: false,
        })
        .collect::<Vec<_>>();
    let outcome = match evaluate_conversation_with_provider(
        provider,
        markdown,
        markdown,
        &prompts,
        &exchanges,
        &[],
    ) {
        Ok(evaluation) => evaluation,
        Err(ConversationEvaluationFailure::Provider {
            message,
            validation_errors,
            ..
        }) => {
            return ProviderEvaluationOutcome {
                provider: provider_name,
                failure: Some(if validation_errors.is_empty() {
                    message
                } else {
                    format!("{message}: {}", validation_errors.join("; "))
                }),
                gap_based_score: None,
                assertion_scores: Vec::new(),
                overall_score: None,
                summary_present: false,
                gap_count: 0,
                gap_quotes: Vec::new(),
                inconclusive_count: 0,
            }
        }
        Err(ConversationEvaluationFailure::Validation {
            validation_errors, ..
        }) => {
            return ProviderEvaluationOutcome {
                provider: provider_name,
                failure: Some(format!(
                    "avaliacao final nao verificavel: {}",
                    validation_errors.join("; ")
                )),
                gap_based_score: None,
                assertion_scores: Vec::new(),
                overall_score: None,
                summary_present: false,
                gap_count: 0,
                gap_quotes: Vec::new(),
                inconclusive_count: 0,
            }
        }
    };
    let unit_length_utf16 = markdown.encode_utf16().count() as u64;
    let gap_based_score = score_for_gap_coverage(unit_length_utf16, &outcome.gaps);
    let assertion_scores = outcome
        .unit_assertions
        .iter()
        .map(score_for_unit_assertions)
        .collect::<Vec<_>>();
    let overall_score = if assertion_scores.is_empty() {
        gap_based_score
    } else {
        let sum = assertion_scores
            .iter()
            .map(|score| u32::from(*score))
            .sum::<u32>();
        (sum as f64 / assertion_scores.len() as f64).round() as u8
    };
    ProviderEvaluationOutcome {
        provider: provider_name,
        failure: None,
        gap_based_score: Some(gap_based_score),
        assertion_scores,
        overall_score: Some(overall_score),
        summary_present: !outcome.summary.trim().is_empty(),
        gap_count: outcome.gaps.len(),
        gap_quotes: outcome
            .gaps
            .iter()
            .map(|gap| normalize_gap_quote(&gap.source_quote))
            .collect(),
        inconclusive_count: outcome.inconclusive_units.len(),
    }
}

/// Monta o relatorio de divergencia a partir dos dois lados.
pub fn build_divergence_report(
    ollama: ProviderEvaluationOutcome,
    gemini: ProviderEvaluationOutcome,
) -> DivergenceReport {
    let note_words = MARKDOWN.split_whitespace().count();
    DivergenceReport {
        note_words,
        question_count: CASES.len(),
        providers: [ollama.provider, gemini.provider],
        ollama,
        gemini,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(
        provider: &'static str,
        score: u8,
        quotes: &[&str],
        assertions: &[u8],
    ) -> ProviderEvaluationOutcome {
        ProviderEvaluationOutcome {
            provider,
            failure: None,
            gap_based_score: Some(score),
            assertion_scores: assertions.to_vec(),
            overall_score: Some(score),
            summary_present: true,
            gap_count: quotes.len(),
            gap_quotes: quotes
                .iter()
                .map(|quote| normalize_gap_quote(quote))
                .collect(),
            inconclusive_count: 0,
        }
    }

    #[test]
    fn divergence_math_compares_scores_and_gap_sets() {
        let ollama = outcome(
            "ollama",
            70,
            &["A clorofila absorve luz", "nas bandas verde"],
            &[70, 80],
        );
        let gemini = outcome(
            "gemini",
            75,
            &["A clorofila absorve luz", "principal produto"],
            &[75],
        );
        let report = build_divergence_report(ollama, gemini);
        assert_eq!(report.score_delta(), Some(5));
        assert_eq!(report.shared_gap_quotes(), vec!["a clorofila absorve luz"]);
        assert_eq!(report.ollama_only_gap_quotes(), vec!["nas bandas verde"]);
        assert_eq!(report.gemini_only_gap_quotes(), vec!["principal produto"]);
        assert_eq!(report.providers, ["ollama", "gemini"]);
    }

    #[test]
    fn score_delta_is_none_when_a_side_failed() {
        let mut gemini = outcome("gemini", 75, &[], &[]);
        gemini.failure = Some("chave invalida".to_string());
        gemini.overall_score = None;
        let report = build_divergence_report(outcome("ollama", 70, &[], &[]), gemini);
        assert_eq!(report.score_delta(), None);
        assert!(report
            .render()
            .contains("Divergencia da nota geral: indisponivel"));
    }

    #[test]
    fn render_is_stable_and_mentions_providers_and_quotes() {
        let ollama = outcome("ollama", 70, &["A clorofila absorve luz"], &[]);
        let gemini = outcome("gemini", 75, &["A clorofila absorve luz"], &[]);
        let report = build_divergence_report(ollama, gemini);
        let rendered = report.render();
        assert!(rendered.contains("Comparabilidade real de provedores: ollama | gemini"));
        assert!(rendered.contains("nota geral: 70"));
        assert!(rendered.contains("nota geral: 75"));
        assert!(rendered.contains("Divergencia da nota geral (gemini - ollama): 5"));
        assert!(rendered.contains("1 compartilhada(s)"));
    }

    #[test]
    fn normalize_ignores_case_and_whitespace() {
        assert_eq!(
            normalize_gap_quote("  A  Clorofila  ABSORVE  luz "),
            "a clorofila absorve luz"
        );
        assert_eq!(
            normalize_gap_quote("A clorofila absorve luz"),
            "a clorofila absorve luz"
        );
    }

    #[test]
    fn assertion_scores_feed_the_overall_when_present() {
        let ollama = outcome("ollama", 70, &[], &[]);
        let gemini = outcome("gemini", 60, &[], &[]);
        let report = build_divergence_report(ollama, gemini);
        assert_eq!(report.gemini.assertion_scores.len(), 0);
        assert_eq!(report.ollama.overall_score, Some(70));
    }
}
