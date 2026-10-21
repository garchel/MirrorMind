//! C12 — "Melhorar a nota": diagnostico semantico com ancora propria.
//!
//! ## O que resolve
//!
//! O mecanismo de issue do JEV **confirmava** problemas que o legado ja tinha
//! proposto. E o legado nao propoe issue nenhuma nas notas que mais precisam
//! dela: nas 7 notas em que o JEV erra, o legado propos **zero** issues. Sem
//! issue, nao ha ancora, e sem ancora nao ha o que melhorar.
//!
//! A mudanca: os candidatos passam a vir da **segmentacao deterministica**
//! (como o plano previa na §4.4, "Candidatos vem da segmentacao
//! deterministica"), e o JEV julga cada secao. A ancora deixa de depender do
//! legado.
//!
//! ## Escopo: so definicoes
//!
//! A unica correcao que a maquina pode redigir e a **definicao**: um termo
//! usado como premissa sem ter sido definido. As outras situacoes nao admitem
//! edicao automatica:
//!
//! - **contradicao**: corrigir exige saber qual lado esta certo, e a maquina
//!   nao tem como saber. Vira aviso para o usuario resolver.
//! - **contexto ausente**: depende do caso; pode ser definicao, pode ser
//!   ejemplo, e o modelo nao distingue com seguranca.
//!
//! Entao a pergunta e binaria e verificavel: *esta secao usa um termo que
//! precisa de definicao e nao tem?*

//! ## Hipótese testada e refutada (2026-10-20)
//!
//! A primeira versão perguntou ao motor, **por seção**, "esta seção usa algum
//! termo como premissa sem defini-lo?". O resultado, medido contra os 22 casos
//! do golden set:
//!
//! - os 3 casos que de fato têm um termo indefinido foram apontados
//!   (`referencia-indefinida` 0,98; `passa-baixa-fronteira` 0,74;
//!   `termo-sem-definicao` 0,36);
//! - **mas 12 outras notas foram apontadas junto**, incluindo notas que estão
//!   ótimas (`ciclo-calvin` 0,90; `termodinamica` 0,82; `contexto-implicito`
//!   0,82).
//!
//! **A pergunta binária não discrimina.** Em qualquer nota técnica algum termo
//! é usado sem definição inline — é o que faz a nota ser técnica. "Sim" é a
//! resposta padrão, e a confiança não separa os casos certos dos errados
//! (0,98 no caso certo e 0,90 no caso errado).
//!
//! ## O que a limitação revela
//!
//! O `ChoiceAnswer` da API é `{type, choice, confidence, probabilities}` —
//! **não há texto livre**. O motor sabe *que* algo falta, mas não *o quê* nem
//! *por quê*. E uma pergunta que não pode pedir o defeito específico não
//! discrimina.
//!
//! A saída é inverter os papéis, como o Caminho A já faz nas assertions: o
//! provider **generativo** identifica o termo e redige a definição (ele escreve
//! texto, e pode); o JEV **confirma** se aquele termo é mesmo uma premissa sem
//! definição. E há checagens determinísticas que nem precisam de modelo: o
//! termo tem que aparecer na seção, e não pode já estar definido antes.
//!
//! A função deste módulo fica como a metade que o motor faz: confirmar. A
//! metade que propõe é do provider generativo.

use super::questions::{instructions_object, options_from_pairs, QuestionSpec};
use super::{state_object, Answer, CalibratedProvider};
use crate::review::provider::ProviderFailure;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

/// Uma secao que o motorJulga precisa de definicao.
#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionCandidate {
    /// O trecho da secao onde o termo aparece.
    pub source_quote: String,
    /// O caminho da secao, para o usuario saber onde esta.
    pub section_path: Vec<String>,
    pub start_utf16: u64,
    pub end_utf16: u64,
}

/// O veredito do motor sobre uma secao.
///
/// ## O motor **nao** diz qual termo falta
///
/// O `ChoiceAnswer` da API e `{type, choice, confidence, probabilities}` — nao
/// ha campo de texto livre. O motor sabe **que** a secao precisa de uma
/// definicao e **quao confiante** esta, mas nao sabe **qual** termo e nem
/// **por que**. Isso vem do provider generativo, que le a secao e escreve o
/// texto.
///
/// A separacao e a mesma do resto do sistema: o JEV julga, o modelo redige.
#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionVerdict {
    /// `true` quando a secao precisa de uma definicao.
    pub needs_definition: bool,
    pub confidence: f64,
}

/// Pergunta se a secao usa um termo que precisa de definicao e nao tem.
fn definition_question(candidate: &DefinitionCandidate) -> QuestionSpec {
    super::questions::rotate_question_options(
        QuestionSpec::Choice {
            instructions: instructions_object(
                &format!(
                    "A secao a seguir usa algum termo como premissa **sem que o termo esteja \
                     definido** antes? Julgue so isto: a nota precisa que o leitor ja \
                     conheca o termo, ou a nota o explica quando o usa?\n\
                     Trecho:\n{source}",
                    source = candidate.source_quote,
                ),
                &json!({
                    "sectionPath": candidate.section_path.join(" > "),
                }),
            ),
            options: options_from_pairs([
                (
                    "no",
                    "Nao: todo termo usado como premissa esta definido antes de ser usado.",
                ),
                (
                    "yes",
                    "Sim: algum termo e usado como premissa sem ter sido definido antes.",
                ),
            ]),
        },
        &candidate.source_quote,
    )
}

/// Os candidatos de definicao de uma nota, derivados da segmentacao.
///
/// Os candidatos vem da **segmentacao deterministica**, e nao do legado: o
/// legado nao propoe issue nenhuma nas notas que mais precisam dela, e um
/// diagnostico que depende dele nao funciona onde importa.
pub fn definition_candidates(
    markdown: &str,
    max_whole_note_words: usize,
) -> Vec<DefinitionCandidate> {
    let plan = crate::review::segmentation::segment_markdown(markdown, max_whole_note_words);
    let segments: Vec<DefinitionCandidate> = plan
        .segments
        .iter()
        .filter(|segment| !segment.content.trim().is_empty())
        .map(|segment| DefinitionCandidate {
            source_quote: segment.content.chars().take(400).collect(),
            section_path: segment.section_path.clone(),
            start_utf16: segment.start_utf16,
            end_utf16: segment.end_utf16,
        })
        .collect();
    if !segments.is_empty() {
        return segments;
    }
    // Nota curta demais para ser segmentada: e uma unica unidade, e a
    // definicao que falta pode estar em qualquer parte dela. Sem este
    // fallback, as notas curtas — que sao a maioria do conjunto — nunca
    // seriam examinadas.
    if markdown.trim().is_empty() {
        return Vec::new();
    }
    vec![DefinitionCandidate {
        source_quote: markdown.chars().take(400).collect(),
        section_path: Vec::new(),
        start_utf16: 0,
        end_utf16: markdown.chars().map(|c| c.len_utf16() as u64).sum(),
    }]
}

/// Uma definicao proposta pelo provider generativo.
///
/// ## O provider **propoe**, o motor **confirma**
///
/// O `ChoiceAnswer` da API nao tem texto livre, entao o motor nao consegue
/// dizer *qual* termo falta. Quem sabe e o provider generativo, que escreve
/// texto. Ele propoe o termo e a definicao; o motor confirma se aquilo e mesmo
/// uma premissa sem definicao.
///
/// E as checagens deterministicas (`validate_proposal`) rodam **antes** de
/// qualquer chamada: a maioria dos falsos positivos morre ali, sem gastar
/// token.
#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionProposal {
    /// O termo que precisa ser definido.
    pub term: String,
    /// A definicao redigida.
    pub definition: String,
    /// A citacao literal da nota onde o termo aparece sem definicao.
    ///
    /// E a ancora da sugestao: e o que permite a tela de lado a lado mostrar
    /// **qual** trecho a definicao explica.
    pub source_quote: String,
    /// Onde inserir, em offset UTF-16 do Markdown.
    pub start_utf16: u64,
    /// A secao, para o usuario saber onde a mudanca acontece.
    pub section_path: Vec<String>,
    /// Confianca do provider que propos.
    pub confidence: f64,
}

/// Por que uma proposta foi recusada.
#[derive(Debug, Clone, PartialEq)]
pub struct ProposalProblem {
    pub term: String,
    pub reason: String,
}

/// Verificacoes deterministicas sobre uma proposta.
///
/// Nenhuma delas usa modelo: sao o filtro barato que vem antes da chamada
/// cara. Cada uma existe porque um falso positivo aqui vira uma sugestão
/// irrelevante na tela — e suggestions irrelevantes fazem o usuario parar de
/// ler as Suggestions.
pub fn validate_proposal(
    markdown: &str,
    proposal: &DefinitionProposal,
) -> Result<(), ProposalProblem> {
    let term = proposal.term.trim();
    if term.is_empty() {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "o termo esta vazio".to_string(),
        });
    }
    if term.len() < 3 {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "o termo e curto demais para ser um termo".to_string(),
        });
    }
    let definition = proposal.definition.trim();
    if definition.is_empty() {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "a definicao esta vazia".to_string(),
        });
    }
    if definition.chars().count() > MAX_DEFINITION_CHARS {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "a definicao e longa demais para uma nota".to_string(),
        });
    }
    // A definicao nao pode ser a mesma frase que ja esta na nota: repetir
    // texto e a forma mais comum de uma "sugestao" nao sugerir nada.
    if contains_ignoring_case(markdown, definition) {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "a definicao ja aparece na nota".to_string(),
        });
    }
    // O termo precisa aparecer na nota, e **antes** de onde a definicao sera
    // inserida — senao a definicao chega depois do uso.
    let first_use = first_use_offset(markdown, term);
    let Some(first_use) = first_use else {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "o termo nao aparece na nota".to_string(),
        });
    };
    if proposal.start_utf16 > first_use {
        return Err(ProposalProblem {
            term: proposal.term.clone(),
            reason: "a insercao vem depois do primeiro uso do termo".to_string(),
        });
    }
    Ok(())
}

/// O inicio do bloco (paragrafo) que contem o offset.
///
/// A insercao de uma definicao tem de acontecer **no inicio do paragrafo**,
/// e nao no offset do termo: o offset do termo aponta para o meio da frase, e
/// inserir ali partiria a sentenca ao meio.
///
/// O bloco comeca depois de uma linha em branco, ou no comeco do texto.
pub fn block_start_offset(markdown: &str, offset: u64) -> u64 {
    // A posicao em bytes do offset UTF-16.
    let mut utf16 = 0u64;
    let mut byte = 0usize;
    while byte < markdown.len() && utf16 < offset {
        let character = markdown[byte..].chars().next().unwrap_or('\u{FFFD}');
        utf16 += character.len_utf16() as u64;
        byte += character.len_utf8();
    }
    let byte = byte.min(markdown.len());

    // Volta ate o inicio do paragrafo: a ultima posicao que nao estava
    // precedida por linha em branco.
    let prefix = &markdown[..byte];
    let mut block_start = 0usize;
    let mut cursor = 0usize;
    for line in prefix.split_inclusive('\n') {
        if !line.trim().is_empty() {
            block_start = cursor;
        }
        cursor += line.len();
    }
    utf16_len(&markdown[..block_start])
}

/// O comprimento em UTF-16 de um texto.
fn utf16_len(text: &str) -> u64 {
    text.chars()
        .map(|character| character.len_utf16() as u64)
        .sum()
}

/// A posicao da primeira ocorrencia do termo, em offset UTF-16.
///
/// A busca e por **sequencia de palavras**: o termo pode ter varias palavras
/// ("fase clara", "pH otimo"), e a comparacao respeita a fronteira â€” "CO2"
/// dentro de "CO2S" nao e o mesmo termo.
///
/// ## A comparacao palavra a palavra
///
/// A primeira versao comparava uma unica palavra contra o termo inteiro, e
/// isso recusava **todo** termo de mais de uma palavra. Contra o golden set,
/// isso significava perder "fase clara", "pH otimo" e "sistema isolado" â€” que
/// sao exatamente os termos que precisavam de definicao.
pub fn first_use_offset(markdown: &str, term: &str) -> Option<u64> {
    let needle = normalize_term(term);
    if needle.is_empty() {
        return None;
    }
    // As palavras do termo, normalizadas.
    let needle_words: Vec<String> = needle
        .split_whitespace()
        .map(normalize_term)
        .filter(|word| !word.is_empty())
        .collect();
    if needle_words.is_empty() {
        return None;
    }

    // As palavras do texto, com o offset de inicio de cada uma.
    let mut words: Vec<(String, u64)> = Vec::new();
    let mut utf16 = 0u64;
    let mut current = String::new();
    let mut current_start = 0u64;
    for character in markdown.chars() {
        if character.is_alphanumeric() {
            if current.is_empty() {
                current_start = utf16;
            }
            current.push(character);
        } else if !current.is_empty() {
            words.push((normalize_term(&current), current_start));
            current.clear();
        }
        utf16 += character.len_utf16() as u64;
    }
    if !current.is_empty() {
        words.push((normalize_term(&current), current_start));
    }

    for (index, (word, start)) in words.iter().enumerate() {
        if index + needle_words.len() > words.len() {
            break;
        }
        let matches = needle_words
            .iter()
            .enumerate()
            .all(|(offset, expected)| &words[index + offset].0 == expected);
        if matches {
            let _ = word;
            return Some(*start);
        }
    }
    None
}

/// Compara ignorando caixa e acentos.
fn normalize_term(text: &str) -> String {
    text.trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
        .nfd()
        .filter(|c| !matches!(c, '\u{0300}'..='\u{036f}'))
        .collect()
}

/// Se o texto contem o trecho, ignorando caixa e acentos.
fn contains_ignoring_case(haystack: &str, needle: &str) -> bool {
    let needle = normalize_term(needle);
    if needle.is_empty() {
        return false;
    }
    normalize_term(haystack).contains(&needle)
}

/// Teto do tamanho de uma definicao inserida.
const MAX_DEFINITION_CHARS: usize = 600;

///
/// Uma chamada com uma pergunta por secao: a API trata perguntas extras quase
/// sem custo de tempo, entao o ganho de paralelismo e de graca.
pub fn classify_missing_definitions(
    provider: &dyn CalibratedProvider,
    markdown: &str,
    candidates: &[DefinitionCandidate],
) -> Result<Vec<DefinitionVerdict>, ProviderFailure> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let state = state_object(&[(
        "untrusted_note_markdown",
        Value::String(markdown.to_string()),
    )]);
    let mut questions = BTreeMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        questions.insert(
            definition_question_id(index),
            definition_question(candidate),
        );
    }
    let response = provider.evaluate(&state, &questions)?;

    let mut verdicts = Vec::with_capacity(candidates.len());
    for index in 0..candidates.len() {
        let id = definition_question_id(index);
        let Some(answer) = response.answers.get(&id) else {
            return Err(ProviderFailure {
                message: format!("A resposta nao traz a pergunta {id}."),
                raw_response: None,
                validation_errors: vec![format!("/answers/{id}: ausente.")],
            });
        };
        let Answer::Choice(choice) = answer else {
            return Err(ProviderFailure {
                message: format!("A resposta de {id} nao e uma escolha."),
                raw_response: None,
                validation_errors: vec![format!("/answers/{id}: tipo invalido.")],
            });
        };
        let needs_definition = choice.choice == "yes";
        verdicts.push(DefinitionVerdict {
            needs_definition,
            confidence: choice.confidence,
        });
    }
    Ok(verdicts)
}

fn definition_question_id(index: usize) -> String {
    format!("definition_{index}")
}

/// Pergunta se um termo nomeado e mesmo uma premissa sem definicao.
fn proposal_question(proposal: &DefinitionProposal) -> QuestionSpec {
    super::questions::rotate_question_options(
        QuestionSpec::Choice {
            instructions: instructions_object(
                &format!(
                    "Na nota abaixo, o termo `{term}` e usado como premissa **sem que a \
                     nota o defina antes**? Isto e: um leitor que so tem este texto \
                     precisaria saber o que e `{term}` para aproveitar a secao?\n\
                     Se a nota define `{term}` em algum momento antes de usa-lo, ou se \
                     `{term}` nao precisa ser definido para a secao fazer sentido, a \
                     resposta e `no`.",
                    term = proposal.term,
                ),
                &json!({
                    "sectionPath": proposal.section_path.join(" > "),
                }),
            ),
            options: options_from_pairs([
                ("no", "Nao: o termo nao e uma premissa sem definicao."),
                (
                    "yes",
                    "Sim: o termo e usado como premissa e a nota nao o define antes.",
                ),
            ]),
        },
        &proposal.term,
    )
}

/// Confirma, com o JEV, as propostas de definicao.
///
/// Uma pergunta por **proposta**, e nao por secao: nomear o termo e o que faz
/// a pergunta discriminar (ver a hipotese refutada no topo deste modulo).
pub fn confirm_definition_proposals(
    provider: &dyn CalibratedProvider,
    markdown: &str,
    proposals: &[DefinitionProposal],
) -> Result<Vec<DefinitionVerdict>, ProviderFailure> {
    if proposals.is_empty() {
        return Ok(Vec::new());
    }
    let state = state_object(&[(
        "untrusted_note_markdown",
        Value::String(markdown.to_string()),
    )]);
    let mut questions = BTreeMap::new();
    for (index, proposal) in proposals.iter().enumerate() {
        questions.insert(proposal_question_id(index), proposal_question(proposal));
    }
    let response = provider.evaluate(&state, &questions)?;

    let mut verdicts = Vec::with_capacity(proposals.len());
    for index in 0..proposals.len() {
        let id = proposal_question_id(index);
        let Some(answer) = response.answers.get(&id) else {
            return Err(ProviderFailure {
                message: format!("A resposta nao traz a pergunta {id}."),
                raw_response: None,
                validation_errors: vec![format!("/answers/{id}: ausente.")],
            });
        };
        let Answer::Choice(choice) = answer else {
            return Err(ProviderFailure {
                message: format!("A resposta de {id} nao e uma escolha."),
                raw_response: None,
                validation_errors: vec![format!("/answers/{id}: tipo invalido.")],
            });
        };
        verdicts.push(DefinitionVerdict {
            needs_definition: choice.choice == "yes",
            confidence: choice.confidence,
        });
    }
    Ok(verdicts)
}

fn proposal_question_id(index: usize) -> String {
    format!("proposal_{index}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::calibrated::answers::ChoiceAnswer;
    use crate::review::calibrated::mock::MockCalibratedProvider;
    use crate::review::calibrated::{CalibratedResponse, CalibrationEngine};

    const NOTA: &str = "# Ciclo de Calvin\n\nA fixacao de carbono ocorre no estroma dos cloroplastos.\n\nA glicose e o produto final.\n";

    /// Um candidato de secao, para a pergunta por secao.
    fn candidate() -> DefinitionCandidate {
        DefinitionCandidate {
            source_quote: "A fixacao ocorre no estroma.".to_string(),
            section_path: vec!["Fotossintese".to_string()],
            start_utf16: 0,
            end_utf16: 26,
        }
    }

    fn proposal(term: &str, definition: &str, start_utf16: u64) -> DefinitionProposal {
        DefinitionProposal {
            term: term.to_string(),
            definition: definition.to_string(),
            source_quote: String::new(),
            start_utf16,
            section_path: vec!["Ciclo de Calvin".to_string()],
            confidence: 0.8,
        }
    }

    // --- as checagens deterministicas -------------------------------------

    #[test]
    fn uma_termo_que_nao_aparece_na_nota_e_recusada() {
        let error = validate_proposal(NOTA, &proposal("ribulose", "Um acucar de 5 carbonos.", 0))
            .expect_err("termo ausente");
        assert!(error.reason.contains("nao aparece"), "{}", error.reason);
    }

    #[test]
    fn uma_insercao_depois_do_primeiro_uso_e_recusada() {
        // A definicao precisa chegar ANTES do uso, senao e inútil.
        let first_use = first_use_offset(NOTA, "estroma").expect("o termo aparece");
        let error = validate_proposal(NOTA, &proposal("estroma", "Uma organela.", first_use + 10))
            .expect_err("insercao tardia");
        assert!(
            error.reason.contains("depois do primeiro uso"),
            "{}",
            error.reason
        );
    }

    #[test]
    fn uma_insercao_antes_do_primeiro_uso_e_aceita() {
        let first_use = first_use_offset(NOTA, "estroma").expect("o termo aparece");
        assert!(validate_proposal(NOTA, &proposal("estroma", "Uma organela.", first_use)).is_ok());
    }

    #[test]
    fn uma_definicao_que_ja_esta_na_nota_e_recusada() {
        // Repetir texto e a forma mais comum de uma sugestao nao sugerir nada.
        let error = validate_proposal(
            NOTA,
            &proposal("glicose", "A glicose e o produto final.", 0),
        )
        .expect_err("definicao repetida");
        assert!(error.reason.contains("ja aparece"), "{}", error.reason);
    }

    #[test]
    fn uma_definicao_vazia_ou_curta_e_recusada() {
        let erro_vazia =
            validate_proposal(NOTA, &proposal("estroma", "   ", 0)).expect_err("vazia");
        assert!(erro_vazia.reason.contains("vazia"), "{}", erro_vazia.reason);

        let erro_curta =
            validate_proposal(NOTA, &proposal("CO", "Uma sigla.", 0)).expect_err("curta");
        assert!(erro_curta.reason.contains("curto"), "{}", erro_curta.reason);
    }

    #[test]
    fn a_comparacao_ignora_caixa_e_acentos() {
        // "Estroma" e "estroma" sao o mesmo termo, e o usuario pode escrever
        // qualquer um dos dois.
        let with_accents =
            "A fixacao ocorre no estroma dos cloroplastos, e o processo gera glicose.";
        assert!(first_use_offset(with_accents, "ESTROMA").is_some());
        assert!(first_use_offset(with_accents, "estroma").is_some());
    }

    #[test]
    fn um_termo_de_varias_palavras_encontra_a_primeira_ocorrencia() {
        // A primeira versao comparava uma unica palavra contra o termo
        // inteiro, e recusava todo termo com mais de uma palavra — o que
        // descartava "fase clara", "pH otimo" e "sistema isolado", que sao
        // exatamente os termos que precisavam de definicao.
        let note = "A fixacao ocorre no estroma.\n\nA fase clara captura a luz.";
        let offset = first_use_offset(note, "fase clara").expect("o termo aparece");
        assert!(offset > 0);
        let rest = &note.chars().skip(offset as usize).collect::<String>();
        assert!(rest.starts_with("fase clara"), "{rest}");
    }

    #[test]
    fn um_termo_de_varias_palavras_que_nao_aparece_e_recusado() {
        let error = validate_proposal(
            NOTA,
            &proposal("fase escura", "A etapa que consome ATP.", 0),
        )
        .expect_err("ausente");
        assert!(error.reason.contains("nao aparece"), "{}", error.reason);
    }

    #[test]
    fn um_termo_dentro_de_outro_nao_conta() {
        // "CO2" dentro de "CO2S" nao e o mesmo termo.
        let note = "A reacao de CO2S e complexa, e produz glicose.";
        assert_eq!(first_use_offset(note, "CO2"), None);
    }

    // --- a confirmacao do motor -------------------------------------------

    /// Provedor que responde "yes" para as propostas impares.
    struct Scripted;

    impl CalibratedProvider for Scripted {
        fn engine(&self) -> CalibrationEngine {
            CalibrationEngine::Jev
        }

        fn model(&self) -> &'static str {
            "scripted"
        }

        fn evaluate(
            &self,
            _state: &Value,
            questions: &BTreeMap<String, QuestionSpec>,
        ) -> Result<CalibratedResponse, ProviderFailure> {
            let mut answers = BTreeMap::new();
            for (index, id) in questions.keys().enumerate() {
                let yes = index % 2 == 0;
                answers.insert(
                    id.clone(),
                    Answer::Choice(ChoiceAnswer {
                        choice: if yes {
                            "yes".to_string()
                        } else {
                            "no".to_string()
                        },
                        probabilities: BTreeMap::from([
                            ("yes".to_string(), if yes { 0.9 } else { 0.1 }),
                            ("no".to_string(), if yes { 0.1 } else { 0.9 }),
                        ]),
                        confidence: if yes { 0.9 } else { 0.8 },
                    }),
                );
            }
            Ok(CalibratedResponse {
                model: "scripted".to_string(),
                answers,
                input_tokens: None,
                output_tokens: None,
                latency_ms: 1,
                raw_response: "{}".to_string(),
            })
        }
    }

    #[test]
    fn a_confirmacao_responde_por_proposta() {
        let proposals = vec![
            proposal("estroma", "Uma organela.", 0),
            proposal("glicose", "Um acucar simples.", 0),
        ];
        let verdicts = confirm_definition_proposals(&Scripted, NOTA, &proposals).expect("confirma");
        assert_eq!(verdicts.len(), 2);
        assert!(verdicts[0].needs_definition);
        assert!(!verdicts[1].needs_definition);
    }

    #[test]
    fn a_pergunta_nomeia_o_termo() {
        // A pergunta que **nao** nomeia o termo nao discrimina (ver a hipotese
        // refutada no topo do modulo). Esta e a garantia de que a pergunta
        // mudou.
        let question = proposal_question(&proposal("estroma", "Uma organela.", 0));
        let rendered = serde_json::to_string(&question).expect("serializa");
        assert!(rendered.contains("estroma"), "{rendered}");
    }

    #[test]
    fn nenhuma_proposta_means_nenhuma_chamada() {
        let verdicts =
            confirm_definition_proposals(&MockCalibratedProvider, NOTA, &[]).expect("confirma");
        assert!(verdicts.is_empty());
    }

    // --- a pergunta por secao (a versao que nao discrimina) ---------------
    //
    // A pergunta por secao continua no codigo porque e a que o **diagnostico
    // de prontidao** usa. Aqui ela so e testada no que faz: responder por
    // secao, e falhar em vez de responder "nao" por padrao.

    /// Provedor que responde "yes" para a primeira secao.
    struct SectionScripted;

    impl CalibratedProvider for SectionScripted {
        fn engine(&self) -> CalibrationEngine {
            CalibrationEngine::Jev
        }

        fn model(&self) -> &'static str {
            "scripted"
        }

        fn evaluate(
            &self,
            _state: &Value,
            questions: &BTreeMap<String, QuestionSpec>,
        ) -> Result<CalibratedResponse, ProviderFailure> {
            let mut answers = BTreeMap::new();
            for (index, id) in questions.keys().enumerate() {
                let yes = index == 0;
                answers.insert(
                    id.clone(),
                    Answer::Choice(ChoiceAnswer {
                        choice: if yes {
                            "yes".to_string()
                        } else {
                            "no".to_string()
                        },
                        probabilities: BTreeMap::from([
                            ("yes".to_string(), if yes { 0.9 } else { 0.1 }),
                            ("no".to_string(), if yes { 0.1 } else { 0.9 }),
                        ]),
                        confidence: 0.85,
                    }),
                );
            }
            Ok(CalibratedResponse {
                model: "scripted".to_string(),
                answers,
                input_tokens: None,
                output_tokens: None,
                latency_ms: 1,
                raw_response: "{}".to_string(),
            })
        }
    }

    #[test]
    fn a_pergunta_por_secao_responde_por_secao() {
        let verdicts = classify_missing_definitions(
            &SectionScripted,
            NOTA,
            &[candidate(), candidate(), candidate()],
        )
        .expect("classifica");
        assert_eq!(verdicts.len(), 3);
        assert!(verdicts[0].needs_definition);
        assert!(!verdicts[1].needs_definition);
        assert!(!verdicts[2].needs_definition);
    }

    #[test]
    fn a_pergunta_por_secao_precisa_da_resposta() {
        // Falhar e melhor que responder "nao" por padrao: "nao precisa de
        // definicao" e uma decisao, nao um default seguro.
        struct Silent;
        impl CalibratedProvider for Silent {
            fn engine(&self) -> CalibrationEngine {
                CalibrationEngine::Jev
            }
            fn model(&self) -> &'static str {
                "silent"
            }
            fn evaluate(
                &self,
                _state: &Value,
                _questions: &BTreeMap<String, QuestionSpec>,
            ) -> Result<CalibratedResponse, ProviderFailure> {
                Ok(CalibratedResponse {
                    model: "silent".to_string(),
                    answers: BTreeMap::new(),
                    input_tokens: None,
                    output_tokens: None,
                    latency_ms: 1,
                    raw_response: "{}".to_string(),
                })
            }
        }
        assert!(classify_missing_definitions(&Silent, "# Nota", &[candidate()]).is_err());
    }
}
