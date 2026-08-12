//! Provedor deterministico exclusivo dos builds E2E (`--features e2e`).
//!
//! Nenhuma chamada de rede acontece: o mock responde com conteudo literal
//! extraido do proprio `source_markdown`, de modo que qualquer nota com pelo
//! menos tres linhas gera um plano de prova valido (citacoes literais de uma
//! unica linha dentro das unidades-alvo). E ativado apenas quando a variavel
//! `MIRRORMIND_E2E_MOCK_AI` esta presente em um build com a feature `e2e`.

use super::provider::{
    ProviderFailure, ProviderKind, ProviderRequest, ProviderResponse, StructuredAiProvider,
};
use serde_json::{json, Value};

pub struct MockE2eProvider;

/// Linhas nao vazias e distintas do Markdown (ate 3), truncadas em 320
/// caracteres. Cada linha permanece um substring literal do Markdown, que e o
/// requisito de fundamentacao das citacoes.
fn distinct_lines(markdown: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for raw in markdown.split('\n') {
        let line = raw.trim();
        if line.is_empty() || line.chars().count() < 4 {
            continue;
        }
        let line: String = line.chars().take(320).collect();
        if seen.insert(line.clone()) {
            result.push(line);
        }
        if result.len() >= 3 {
            break;
        }
    }
    result
}

/// Garante tres citacoes distintas mesmo quando o Markdown tem poucas linhas:
/// recorta a primeira linha em prefixos literais de tamanhos diferentes (cada
/// um continua sendo um substring unico do Markdown).
fn distinct_quotes(markdown: &str) -> Vec<String> {
    let mut quotes = distinct_lines(markdown);
    if quotes.len() >= 3 {
        return quotes;
    }
    let Some(base) = quotes.first().cloned() else {
        return quotes;
    };
    let total = base.chars().count();
    let mut attempt = quotes.len();
    while quotes.len() < 3 && total > 8 && attempt < 8 {
        // Tamanhos decrescentes (3/4, 1/2, 1/4 ...) para nunca repetir prefixo.
        let take = (total * (4 - attempt)) / 4;
        let candidate: String = base.chars().take(take).collect();
        if take >= 4 && !quotes.contains(&candidate) {
            quotes.push(candidate);
        }
        attempt += 1;
    }
    quotes
}

/// Plano de prova mista (2 multipla escolha + 1 resposta curta), com
/// citacoes literais de linhas distintas da nota.
fn exam_plan(markdown: &str) -> Value {
    let quotes = distinct_quotes(markdown);
    let mut prompts = Vec::new();
    for (index, quote) in quotes.iter().enumerate() {
        if index % 2 == 0 {
            prompts.push(json!({
                "text": format!("Qual afirmacao sobre o trecho a seguir e correta? \"{}\"", quote),
                "assistance": "Releia o trecho citado e compare as alternativas.",
                "options": [
                    quote,
                    "Alternativa incorreta um.",
                    "Alternativa incorreta dois.",
                    "Alternativa incorreta tres.",
                ],
                "correctOptionIndex": 0,
                "sourceQuote": quote,
            }));
        } else {
            let mut words: Vec<&str> = quote.split_whitespace().collect();
            if words.len() > 3 {
                words.truncate(3);
            }
            prompts.push(json!({
                "text": format!("Escreva o termo central do trecho: \"{}\"", quote),
                "assistance": "O termo aparece literalmente no trecho citado.",
                "expectedAnswer": words.join(" "),
                "sourceQuote": quote,
            }));
        }
    }
    json!({ "prompts": prompts })
}

fn readiness_report(markdown: &str) -> Value {
    let quotes = distinct_quotes(markdown);
    let evaluable: Vec<Value> = quotes
        .iter()
        .map(|quote| json!({ "sourceQuote": quote }))
        .collect();
    json!({
        "status": "ready",
        "explanation": "A nota possui ideia central identificavel e pontos avaliaveis suficientes.",
        "centralIdeaQuote": quotes.first(),
        "evaluablePoints": evaluable,
        "issues": [],
    })
}

fn conversation_start() -> Value {
    json!({
        "prompts": [{
            "text": "Explique o conteudo da nota com as suas palavras.",
            "assistance": "Releia os trechos citados antes de responder.",
        }],
    })
}

fn conversation_turn() -> Value {
    json!({
        "shouldFinish": false,
        "prompt": "Continue a explicacao, aprofundando o que ficou pendente.",
        "assistance": "Nao ha resposta certa aqui; apenas aprofunde.",
    })
}

fn evaluation_payload() -> Value {
    json!({
        "score": 100,
        "summary": "Resumo E2E: sem lacunas identificadas.",
        "gaps": [],
        "inconclusiveUnits": [],
    })
}

impl StructuredAiProvider for MockE2eProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    fn generate_structured(
        &self,
        request: ProviderRequest,
    ) -> std::result::Result<ProviderResponse, ProviderFailure> {
        let structured = if request.system_instructions.contains("Crie uma prova") {
            exam_plan(&request.source_markdown)
        } else if request
            .system_instructions
            .contains("Avalie somente se o Markdown")
        {
            readiness_report(&request.source_markdown)
        } else if request
            .system_instructions
            .contains("Continue uma conversa")
        {
            conversation_turn()
        } else if request.system_instructions.contains("Avalie a memoria") {
            evaluation_payload()
        } else {
            conversation_start()
        };
        let raw_response = structured.to_string();
        Ok(ProviderResponse {
            raw_response,
            structured,
        })
    }
}

#[cfg(all(feature = "e2e", test))]
mod tests {
    use super::*;

    const MARKDOWN: &str = "Fotossintese converte energia luminosa em energia quimica.\nA clorofila absorve luz nas bandas azul e vermelha.\nO processo libera oxigenio como subproduto.\nA glicose e o principal produto da fase escura.\n";

    #[test]
    fn exam_plan_mixes_types_and_grounds_quotes_literally() {
        let plan = exam_plan(MARKDOWN);
        let prompts = plan["prompts"].as_array().expect("prompts list");
        assert_eq!(prompts.len(), 3);
        let kinds: Vec<&str> = prompts
            .iter()
            .map(|prompt| {
                if prompt.get("options").is_some() {
                    "multipleChoice"
                } else {
                    "shortAnswer"
                }
            })
            .collect();
        assert!(kinds.contains(&"multipleChoice"));
        assert!(kinds.contains(&"shortAnswer"));
        let mut seen = std::collections::HashSet::new();
        for prompt in prompts {
            let quote = prompt["sourceQuote"].as_str().expect("sourceQuote");
            assert!(
                MARKDOWN.contains(quote),
                "a citacao '{quote}' deve ser literal no Markdown"
            );
            assert!(seen.insert(quote.to_string()), "citacoes distintas");
            assert!(!quote.contains('\n'), "citacao de uma unica linha");
            if prompt.get("options").is_some() {
                assert_eq!(prompt["correctOptionIndex"], 0);
                assert_eq!(prompt["options"].as_array().expect("options").len(), 4);
            } else {
                let expected = prompt["expectedAnswer"].as_str().expect("expectedAnswer");
                assert!(!expected.trim().is_empty());
            }
        }
    }

    #[test]
    fn readiness_report_is_ready_with_literal_points() {
        let report = readiness_report(MARKDOWN);
        assert_eq!(report["status"], "ready");
        let points = report["evaluablePoints"].as_array().expect("points");
        assert_eq!(points.len(), 3);
        for point in points {
            let quote = point["sourceQuote"].as_str().expect("sourceQuote");
            assert!(MARKDOWN.contains(quote));
        }
        let central = report["centralIdeaQuote"]
            .as_str()
            .expect("centralIdeaQuote");
        assert!(MARKDOWN.contains(central));
    }

    #[test]
    fn single_line_notes_still_produce_three_distinct_quotes() {
        let plan =
            exam_plan("Uma unica linha longa o suficiente para servir de base a prova inteira.");
        let prompts = plan["prompts"].as_array().expect("prompts list");
        assert_eq!(prompts.len(), 3);
        let mut seen = std::collections::HashSet::new();
        for prompt in prompts {
            let quote = prompt["sourceQuote"].as_str().expect("sourceQuote");
            assert!(seen.insert(quote.to_string()), "citacoes distintas");
        }
    }
}
