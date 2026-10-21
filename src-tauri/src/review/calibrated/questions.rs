//! Tipos das perguntas tipadas do System One.
//!
//! Uma pergunta e a unidade atomica de julgamento: pede UMA decisao, sobre UM
//! recorte do estado. A doc do JEV penaliza perguntas que escondem varios
//! julgamento dentro de um so ("rate este startup pitch") e recomenda
//! decompor e combinar em codigo. Os tipos abaixo sao deliberadamente
//! pequenos para tornar essa decomposicao natural na construcao.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// Numero maximo de opcoes de uma `choice` (limite da API).
pub const MAX_CHOICE_OPTIONS: usize = 255;
/// Numero minimo de niveis de um `score` (limite da API).
pub const MIN_SCORE_LEVELS: usize = 2;
/// Numero maximo de niveis de um `score` (limite da API).
pub const MAX_SCORE_LEVELS: usize = 10;

/// Uma opcao de `choice`.
///
/// A ordem do vetor e a ORDEM NO WIRE. Um `BTreeMap` nao serve aqui: ele se
/// reordena por chave no momento da serializacao, o que tornaria a rotacao de
/// opcoes um no-op silencioso — exatamente o vies sistematico que a rotacao
/// existe para eliminar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceOption {
    /// Identidade estavel da opcao (o valor do enum na aplicacao).
    pub key: String,
    /// Texto que o modelo le. Nunca vazio: opcao sem criterio e a opcao que
    /// o modelo preenche com o sentido que quiser.
    pub criteria: String,
}

impl ChoiceOption {
    pub fn new(key: impl Into<String>, criteria: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            criteria: criteria.into(),
        }
    }
}

/// Constrói as opcoes a partir de pares, preservando a ordem dada.
pub fn options_from_pairs<K, C>(pairs: impl IntoIterator<Item = (K, C)>) -> Vec<ChoiceOption>
where
    K: Into<String>,
    C: Into<String>,
{
    pairs
        .into_iter()
        .map(|(key, criteria)| ChoiceOption::new(key, criteria))
        .collect()
}

/// Uma pergunta tipada, pronta para o wire.
///
/// `instructions` pode ser texto simples ou estrutura. A forma estruturada
/// (objeto com campos nomeados) e a recomendada: o modelo passa a tratar o
/// estado como REFERENCIA DE DADOS nomeada em vez de texto solto, o que
/// reduz a chance de instrucao contida no estado ser seguida.
///
/// ## A forma no wire e implementada a mao
///
/// A API real (schema publicado em `https://api.typesafe.ai/openapi.json`)
/// define a pergunta como uma **uniao discriminada por `type`**, e cada
/// variante tem o payload **inline** — sem embrulho por variante:
///
/// - `noul`:  `{type, instructions, criteria?: {true, false}}`
/// - `choice`: `{type, instructions, criteria: {nome: descricao}}`
/// - `score`:  `{type, instructions, criteria: [descricao dos niveis]}`
///
/// Duas consequencias que o `#[derive(Serialize)]` nao daria:
///
/// 1. `choice.criteria` e um **mapa**, nao a lista de `{key, criteria}` que o
///    modelo interno usa. O mapa e o que a API pede, e o mapa nao preserva a
///    ordem — por isso a ordem continua mora no `Vec` interno e e montada aqui.
/// 2. `score.criteria` e uma **array**, nao o campo `levels`.
///
/// A primeira versao mandava `options: [{key, criteria}]` inline, e a API
/// respondia `422` com `missing: body.questions.<id>.choice.criteria`.
#[derive(Debug, Clone, PartialEq)]
pub enum QuestionSpec {
    /// Verdadeiro ou falso. Devolve a probabilidade de "sim".
    Noul {
        instructions: Value,
        criteria: Option<NoulCriteria>,
    },
    /// Uma opcao entre varias definidas de antemao.
    Choice {
        instructions: Value,
        /// Lista ordenada. Use `rotate_options` antes de enviar.
        options: Vec<ChoiceOption>,
    },
    /// Niveis ordenados de uma rubrica. O `score` devolvido e a ESPERANCA
    /// ponderada e pode cair entre niveis — mas a doc proibe explicitamente
    /// usar esses niveis para reconstruir uma magnitude exata. A aritmetica
    /// fica em Rust (ver `synthesis::SYNTHESIS_LEVEL_VALUES`).
    Score {
        instructions: Value,
        levels: Vec<String>,
    },
}

impl Serialize for QuestionSpec {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(None)?;
        match self {
            QuestionSpec::Noul {
                instructions,
                criteria,
            } => {
                map.serialize_entry("type", "noul")?;
                map.serialize_entry("instructions", instructions)?;
                if let Some(criteria) = criteria {
                    // A API nomeia os lados `true` e `false`, nao `yes`/`no`.
                    // O nome interno e mais legivel; o wire segue a API.
                    let mut inner = serde_json::Map::new();
                    inner.insert("true".to_string(), serde_json::json!(criteria.yes));
                    inner.insert("false".to_string(), serde_json::json!(criteria.no));
                    map.serialize_entry("criteria", &inner)?;
                }
            }
            QuestionSpec::Choice {
                instructions,
                options,
            } => {
                map.serialize_entry("type", "choice")?;
                map.serialize_entry("instructions", instructions)?;
                let mut criteria = serde_json::Map::new();
                for option in options {
                    criteria.insert(option.key.clone(), serde_json::json!(option.criteria));
                }
                map.serialize_entry("criteria", &criteria)?;
            }
            QuestionSpec::Score {
                instructions,
                levels,
            } => {
                map.serialize_entry("type", "score")?;
                map.serialize_entry("instructions", instructions)?;
                map.serialize_entry("criteria", levels)?;
            }
        }
        map.end()
    }
}

/// Criterios de um `noul`: o que significa "sim" e o que significa "nao".
/// Escrever os dois lados explicitamente evita o caso degenerado em que
/// `true` mapeia para "nao" e o modelo classifica ao contrario.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoulCriteria {
    pub yes: String,
    pub no: String,
}

impl QuestionSpec {
    /// Descricao do tipo, para diagnostico e para a suite de contrato.
    pub fn kind(&self) -> QuestionKind {
        match self {
            QuestionSpec::Noul { .. } => QuestionKind::Noul,
            QuestionSpec::Choice { .. } => QuestionKind::Choice,
            QuestionSpec::Score { .. } => QuestionKind::Score,
        }
    }

    /// Verifica os limites da API antes de gastar uma chamada de rede.
    ///
    /// A API responde `422` para pergunta malformada, mas falconhar aqui
    /// transforma um erro de programacao (typo, lista vazia) em um erro
    /// local, instantaneo e com campo apontado.
    pub fn validate(&self, id: &str) -> Result<(), String> {
        if id.trim().is_empty() {
            return Err("O identificador da pergunta nao pode ser vazio.".to_string());
        }
        if instructions_are_empty(self.instructions()) {
            return Err(format!(
                "/questions/{id}: as instrucoes da pergunta nao podem ser vazias."
            ));
        }
        match self {
            QuestionSpec::Noul { .. } => Ok(()),
            QuestionSpec::Choice { options, .. } => {
                if options.is_empty() {
                    return Err(format!(
                        "/questions/{id}: uma choice precisa de pelo menos uma opcao."
                    ));
                }
                if options.len() > MAX_CHOICE_OPTIONS {
                    return Err(format!(
                        "/questions/{id}: uma choice aceita no maximo {MAX_CHOICE_OPTIONS} opcoes."
                    ));
                }
                let mut seen = BTreeMap::new();
                for (index, option) in options.iter().enumerate() {
                    if option.key.trim().is_empty() {
                        return Err(format!(
                            "/questions/{id}/options/{index}: a chave da opcao nao pode ser vazia."
                        ));
                    }
                    if option.criteria.trim().is_empty() {
                        return Err(format!(
                            "/questions/{id}/options/{index}: o criterio da opcao '{}' nao pode ser vazio.",
                            option.key
                        ));
                    }
                    if seen.insert(option.key.clone(), index).is_some() {
                        return Err(format!(
                            "/questions/{id}/options/{index}: a chave '{}' aparece mais de uma vez.",
                            option.key
                        ));
                    }
                }
                Ok(())
            }
            QuestionSpec::Score { levels, .. } => {
                if levels.len() < MIN_SCORE_LEVELS {
                    return Err(format!(
                        "/questions/{id}: um score precisa de pelo menos {MIN_SCORE_LEVELS} niveis."
                    ));
                }
                if levels.len() > MAX_SCORE_LEVELS {
                    return Err(format!(
                        "/questions/{id}: um score aceita no maximo {MAX_SCORE_LEVELS} niveis."
                    ));
                }
                if let Some(index) = levels.iter().position(|level| level.trim().is_empty()) {
                    return Err(format!(
                        "/questions/{id}/criteria/{index}: o nivel do score nao pode ser vazio."
                    ));
                }
                Ok(())
            }
        }
    }

    fn instructions(&self) -> &Value {
        match self {
            QuestionSpec::Noul { instructions, .. }
            | QuestionSpec::Choice { instructions, .. }
            | QuestionSpec::Score { instructions, .. } => instructions,
        }
    }
}

/// Tipo da pergunta, sem os dados. Usado pela suite de contrato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionKind {
    Noul,
    Choice,
    Score,
}

/// As instrucoes da pergunta, como serao serializadas.
///
/// Nao e so para diagnostico: os testes de F4 comparam o texto das perguntas
/// das quatro dimensoes para garantir que elas nao sejam a mesma pergunta com
/// nomes diferentes.
pub fn instructions_of(question: &QuestionSpec) -> &Value {
    match question {
        QuestionSpec::Noul { instructions, .. }
        | QuestionSpec::Choice { instructions, .. }
        | QuestionSpec::Score { instructions, .. } => instructions,
    }
}

/// `instructions` e aceito como texto, objeto ou lista pela API. Vazio em
/// qualquer uma das formas e erro de programacao.
fn instructions_are_empty(value: &Value) -> bool {
    match value {
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(fields) => fields.is_empty(),
        Value::Null => true,
        _ => false,
    }
}

/// Constroi `instructions` em texto simples.
pub fn instructions(text: impl Into<String>) -> Value {
    Value::String(text.into())
}

/// Constroi `instructions` estruturadas: a pergunta num campo, os dados que
/// ela referencia em outros.
///
/// ```ignore
/// instructions_object("A afirmacao em `claim` esta correta?", &json!({
///     "claim": "A agua ferve a 100 graus ao nivel do mar.",
///     "quote": "A agua ferve a 100 graus ao nivel do mar.",
/// }))
/// ```
///
/// Cada pergunta carrega os **seus** dados, e o `state` fica so com o que e
/// comum a todas. E o padrao recomendado pela doc: os dados deixam de ser
/// texto solto no estado e passam a ser referencia nomeada ao lado da
/// pergunta, o que tambem impede que duas perguntas se confundam por ordem.
pub fn instructions_object(question: &str, data: &Value) -> Value {
    let mut fields = match data {
        Value::Object(map) => map.clone(),
        _ => serde_json::Map::new(),
    };
    fields.insert("question".to_string(), Value::String(question.to_string()));
    Value::Object(fields)
}

/// Rotaciona determinsticamente as opcoes de uma `choice`.
///
/// A doc do JEV admite que `jev-1.13` "puxa para a opcao que vem primeiro".
/// Como as opcoes sao uma lista ordenada, deixar como esta produz um vies
/// SISTEMATICO e reproduzivel. Rotacionando por hash do identificador da
/// pergunta, cada opcao ocupa cada posicao com frequencia parecida ao longo de
/// muitas perguntas, e o vies se cancela na media.
///
/// Determinismo e obrigatorio: a mesma pergunta com o mesmo id tem de produzir
/// a mesma ordem, senao a comparacao entre execucoes perde sentido.
pub fn rotate_options(options: &[ChoiceOption], question_id: &str) -> Vec<ChoiceOption> {
    let mut rotated = options.to_vec();
    if rotated.len() < 2 {
        return rotated;
    }
    let shift = stable_hash(question_id) as usize % rotated.len();
    rotated.rotate_left(shift);
    rotated
}

/// Rotaciona as opcoes de uma pergunta, se ela for uma `choice`.
///
/// `noul` e `score` passam intactos: os dois tem a ordem definida pela
/// estrutura (niveis sao ordenados por natureza), e so a ordem das opcoes de
/// uma `choice` carrega o vies de posicao.
///
/// A semente e a string passada: passar o indice da afirmacao mantem a MESMA
/// ordem para a MESMA afirmacao entre chamadas, e muda entre afirmacoes
/// diferentes.
pub fn rotate_question_options(question: QuestionSpec, seed: &str) -> QuestionSpec {
    match question {
        QuestionSpec::Choice {
            instructions,
            options,
        } => QuestionSpec::Choice {
            instructions,
            options: rotate_options(&options, seed),
        },
        other => other,
    }
}

/// Hash estavel e barato (FNV-1a). `DefaultHasher` nao serve: nao e garantido
/// estavel entre versoes do Rust, e a ordem das opcoes precisa ser
/// reproduzivel entre processos e entre builds.
fn stable_hash(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn noul() -> QuestionSpec {
        QuestionSpec::Noul {
            instructions: instructions("A nota esta pronta?"),
            criteria: None,
        }
    }

    fn choice(options: &[&str]) -> QuestionSpec {
        QuestionSpec::Choice {
            instructions: instructions("Qual e o status?"),
            options: options_from_pairs(
                options
                    .iter()
                    .map(|option| (option.to_string(), format!("quando {option}"))),
            ),
        }
    }

    fn score(levels: &[&str]) -> QuestionSpec {
        QuestionSpec::Score {
            instructions: instructions("Qual o nivel?"),
            levels: levels.iter().map(|level| level.to_string()).collect(),
        }
    }

    #[test]
    fn kind_reflects_the_primitive() {
        assert_eq!(noul().kind(), QuestionKind::Noul);
        assert_eq!(choice(&["a"]).kind(), QuestionKind::Choice);
        assert_eq!(score(&["a", "b"]).kind(), QuestionKind::Score);
    }

    #[test]
    fn empty_question_id_is_rejected() {
        assert!(noul().validate("  ").is_err());
    }

    #[test]
    fn empty_instructions_are_rejected_in_every_shape() {
        for empty in [
            Value::String(String::new()),
            Value::String("   ".to_string()),
            Value::Array(vec![]),
            Value::Object(serde_json::Map::new()),
            Value::Null,
        ] {
            let question = QuestionSpec::Noul {
                instructions: empty,
                criteria: None,
            };
            assert!(
                question.validate("q").is_err(),
                "instrucao vazia deveria ser rejeitada"
            );
        }
    }

    #[test]
    fn choice_needs_at_least_one_option() {
        assert!(choice(&[]).validate("q").is_err());
        assert!(choice(&["a"]).validate("q").is_ok());
    }

    #[test]
    fn choice_rejects_an_empty_criterion() {
        let question = QuestionSpec::Choice {
            instructions: instructions("Qual?"),
            options: options_from_pairs([
                ("ok".to_string(), "quando ok".to_string()),
                ("vazio".to_string(), "   ".to_string()),
            ]),
        };
        let error = question.validate("q").expect_err("criterio vazio");
        assert!(error.contains("vazio"), "{error}");
    }

    #[test]
    fn score_enforces_the_api_level_bounds() {
        assert!(score(&["so um nivel"]).validate("q").is_err());
        assert!(score(&["baixo", "alto"]).validate("q").is_ok());
        let too_many = QuestionSpec::Score {
            instructions: instructions("Qual?"),
            levels: (0..=MAX_SCORE_LEVELS).map(|i| i.to_string()).collect(),
        };
        assert!(too_many.validate("q").is_err());
    }

    #[test]
    fn score_rejects_an_empty_level() {
        let error = score(&["baixo", "  "])
            .validate("q")
            .expect_err("nivel vazio");
        assert!(error.contains("/1"), "{error}");
    }

    #[test]
    fn serialization_uses_the_wire_shape() {
        // Esta e a forma que a API real aceita, lida do schema publicado em
        // `https://api.typesafe.ai/openapi.json`. A versao anterior deste
        // teste fixava `options: [{key, criteria}]`, que a API rejeita com
        // `422 missing: body.questions.<id>.choice.criteria` — e o teste
        // passava, porque fixava a forma errada.
        let json = serde_json::to_value(choice(&["ready", "ambiguous"])).expect("serializa");
        assert_eq!(json["type"], "choice");
        assert!(
            json.get("options").is_none(),
            "`options` nao existe na API: o campo e `criteria`"
        );
        assert_eq!(json["criteria"]["ready"], "quando ready");
        assert_eq!(json["criteria"]["ambiguous"], "quando ambiguous");

        let json = serde_json::to_value(noul()).expect("serializa");
        assert_eq!(json["type"], "noul");
        assert!(
            json.get("criteria").is_none(),
            "criteria omitido quando ausente"
        );

        let json = serde_json::to_value(score(&["baixo", "alto"])).expect("serializa");
        assert_eq!(json["type"], "score");
        assert!(
            json.get("levels").is_none(),
            "`levels` nao existe na API: o campo e `criteria`"
        );
        assert_eq!(json["criteria"], json!(["baixo", "alto"]));
    }

    #[test]
    fn the_noul_criteria_use_the_names_the_api_expects() {
        // A API nomeia os lados `true` e `false`. O modelo interno usa
        // `yes`/`no`, que e mais legivel, mas o wire segue a API.
        let question = QuestionSpec::Noul {
            instructions: instructions("Sim?"),
            criteria: Some(NoulCriteria {
                yes: "quando sim".to_string(),
                no: "quando nao".to_string(),
            }),
        };
        let json = serde_json::to_value(question).expect("serializa");
        assert_eq!(json["criteria"]["true"], "quando sim");
        assert_eq!(json["criteria"]["false"], "quando nao");
        assert!(
            json["criteria"].get("yes").is_none(),
            "`yes`/`no` sao o modelo interno, nao o wire"
        );
    }

    #[test]
    fn choice_rejects_a_duplicated_key() {
        let question = QuestionSpec::Choice {
            instructions: instructions("Qual?"),
            options: vec![
                ChoiceOption::new("igual", "primeiro criterio"),
                ChoiceOption::new("igual", "segundo criterio"),
            ],
        };
        let error = question.validate("q").expect_err("chave repetida");
        assert!(error.contains("mais de uma vez"), "{error}");
    }

    /// Opcoes com criterio derivado do nome, para os testes de rotacao.
    fn options_with_criteria(names: &[&str]) -> Vec<ChoiceOption> {
        names
            .iter()
            .map(|name| ChoiceOption::new(name.to_string(), format!("criterio de {name}")))
            .collect()
    }

    fn keys(options: &[ChoiceOption]) -> Vec<&str> {
        options.iter().map(|option| option.key.as_str()).collect()
    }

    #[test]
    fn rotation_is_deterministic_for_the_same_id() {
        let options = options_with_criteria(&["a", "b", "c", "d"]);
        assert_eq!(
            keys(&rotate_options(&options, "status_7")),
            keys(&rotate_options(&options, "status_7"))
        );
    }

    #[test]
    fn rotation_preserves_every_option_and_its_criterion() {
        let options = options_with_criteria(&["a", "b", "c", "d"]);
        let rotated = rotate_options(&options, "q1");
        assert_eq!(rotated.len(), options.len());
        for option in &options {
            let found = rotated
                .iter()
                .find(|candidate| candidate.key == option.key)
                .unwrap_or_else(|| panic!("opcao {} perdida", option.key));
            assert_eq!(found.criteria, option.criteria, "criterio preservado");
        }
    }

    /// Este teste e o que impediu o no-op silencioso: `BTreeMap` reordena na
    /// serializacao, entao a Needs de uma estrutura ordenada.
    #[test]
    fn rotation_actually_reorders_the_wire() {
        let options = options_with_criteria(&["a", "b", "c", "d"]);
        let baseline = keys(&options);
        let total = 80;
        let moved = (0..total)
            .map(|index| format!("status_{index}"))
            .filter(|id| keys(&rotate_options(&options, id)) != baseline)
            .count();
        // Com 4 opcoes, um em cada quatro ids cai na rotacao identidade
        // (shift 0). Os outros tres quartos tem de mover.
        assert!(
            moved >= total * 3 / 4 - 1,
            "esperado ~3/4 dos ids rotacionarem, moveram {moved}/{total}"
        );
    }

    /// A propriedade que importa nao e "rotaciona", e "distribui": cada opcao
    /// precisa ocupar cada posicao com frequencia parecida, senao o vies
    /// sistematico do modelo nao se cancela.
    #[test]
    fn rotation_spreads_each_option_across_positions() {
        let options = options_with_criteria(&["a", "b", "c", "d"]);
        let total = 400;
        let mut first_counts: BTreeMap<String, usize> = BTreeMap::new();
        for option in &options {
            first_counts.insert(option.key.clone(), 0);
        }
        for index in 0..total {
            let rotated = rotate_options(&options, &format!("q{index}"));
            let first = rotated.first().expect("pelo menos uma opcao").key.clone();
            first_counts
                .entry(first)
                .and_modify(|count| *count += 1)
                .or_insert(1);
        }
        // Distribuicao ideal: 1/4 dos ids. Tolerancia de 15 pontos percentuais
        // absorve a granularidade do FNV-1a sem esconder um vies real.
        let expected = total as f64 / options.len() as f64;
        for (key, count) in &first_counts {
            let ratio = *count as f64 / total as f64;
            assert!(
                (ratio - 1.0 / options.len() as f64).abs() < 0.15,
                "a opcao {key} foi primeira em {ratio:.3} dos ids, esperado ~0.25"
            );
        }
        assert!(expected > 0.0);
    }

    #[test]
    fn rotation_is_a_no_op_below_two_options() {
        let single = vec![ChoiceOption::new("a", "criterio")];
        assert_eq!(rotate_options(&single, "q"), single);
    }

    #[test]
    fn rotating_a_question_leaves_noul_and_score_untouched() {
        let noul = QuestionSpec::Noul {
            instructions: instructions("pergunta?"),
            criteria: None,
        };
        assert_eq!(rotate_question_options(noul.clone(), "q"), noul);

        let score = QuestionSpec::Score {
            instructions: instructions("pergunta?"),
            levels: vec!["baixo".to_string(), "alto".to_string()],
        };
        assert_eq!(rotate_question_options(score.clone(), "q"), score);
    }

    #[test]
    fn rotating_a_choice_question_actually_reorders_it() {
        let question = choice(&["a", "b", "c", "d"]);
        let rotated = rotate_question_options(question.clone(), "q1");
        assert_ne!(rotated, question, "a ordem deveria ter mudado");
    }

    #[test]
    fn instruction_object_carries_the_question_and_its_data() {
        let value = instructions_object(
            "A glicose em `candidate` e o produto da fase escura?",
            &json!({ "candidate": "A glicose e o produto da fase escura" }),
        );
        assert_eq!(
            value["question"],
            "A glicose em `candidate` e o produto da fase escura?"
        );
        assert_eq!(value["candidate"], "A glicose e o produto da fase escura");
    }

    #[test]
    fn a_non_object_payload_yields_just_the_question() {
        let value = instructions_object("pergunta", &Value::Null);
        assert_eq!(value.as_object().expect("objeto").len(), 1);
    }
}
