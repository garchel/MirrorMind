//! Validacao do golden set e do relatorio do harness.
//!
//! Nenhum teste aqui chama modelo nem rede. O que se verifica e que o
//! conjunto e **integro** — que as notas existem, que os rotulos de
//! prontividade tem regra, e que o relatorio sai com o aviso certo. A medicao
//! de verdade vive em `tests/jev_eval.rs`, que e ignorado por padrao.
//!
//! A integridade importa tanto quanto a medicao: um conjunto com nota apagada
//! ou rotulo sem regra produz numeros que parecem honestos e nao sao.

use mirrormind_lib::review::calibrated::eval::golden::resolve_note_path;
use mirrormind_lib::review::calibrated::eval::{GoldenSet, Label, LabelProvenance};
use std::path::{Path, PathBuf};

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("jev-golden")
}

fn load() -> GoldenSet {
    let raw = std::fs::read_to_string(fixtures_root().join("golden.json"))
        .expect("golden.json deve existir e estar no caminho");
    serde_json::from_str(&raw).expect("golden.json deve seguir o formato declarado")
}

#[test]
fn the_golden_set_parses() {
    let set = load();
    assert!(!set.cases.is_empty(), "o conjunto nao pode estar vazio");
}

fn note_text(case_note: &str) -> String {
    let path = resolve_note_path(&fixtures_root(), case_note).expect("caminho de nota valido");
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("nota `{case_note}` ilegivel em {}: {error}", path.display())
    })
}

#[test]
fn every_note_referenced_by_a_case_exists_on_disk() {
    let set = load();
    for case in &set.cases {
        let path = resolve_note_path(&fixtures_root(), &case.note).expect("caminho valido");
        assert!(
            path.is_file(),
            "caso `{}` aponta para uma nota inexistente: {}",
            case.id,
            path.display()
        );
    }
}

#[test]
fn a_note_path_cannot_escape_the_fixtures_directory() {
    for escape in ["../Cargo.toml", "cases/../../Cargo.toml", "/etc/passwd"] {
        assert!(
            resolve_note_path(&fixtures_root(), escape).is_err(),
            "`{escape}` nao deveria ser aceito"
        );
    }
    assert!(resolve_note_path(&fixtures_root(), "ciclo-calvin.md").is_ok());
}

#[test]
fn case_ids_are_unique() {
    let set = load();
    let mut ids: Vec<&str> = set.cases.iter().map(|case| case.id.as_str()).collect();
    ids.sort_unstable();
    let total = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), total, "ha ids repetidos no golden set");
}

#[test]
fn every_readiness_label_states_the_rule_that_produced_it() {
    // Regra do golden set: um rotulo de prontibilidade sem justificativa e
    // opiniao disfarcada de dado. O harness nao pode deixar passar.
    let set = load();
    for case in &set.cases {
        assert!(
            case.readiness_rule().is_some(),
            "caso `{}` tem rotulo de prontidão sem regra",
            case.id
        );
    }
}

#[test]
fn every_construction_label_names_the_rule_that_produced_it() {
    // Uma justificativa em prosa e uma opinião bem escrita. O que torna o
    // golden set revisavel por um humano e a regra poder ser **conferida**: o
    // revisor le "REGRA A2" e vai olhar se ha contradicao, sem precisar
    // concordar com a interpretacao de quem escreveu.
    //
    // Este teste e o que mantem a rubrica viva: um caso novo sem codigo de
    // regra falha aqui.
    const RULES: [&str; 8] = [
        "REGRA R1", "REGRA R2", "REGRA R3", "REGRA R4", "REGRA A1", "REGRA A2", "REGRA A3",
        "REGRA I1",
    ];
    let set = load();
    for case in &set.cases {
        if case.readiness.provenance() != LabelProvenance::Construction {
            continue;
        }
        let why = case
            .readiness_rule()
            .unwrap_or_else(|| panic!("caso `{}` sem regra", case.id));
        assert!(
            RULES.iter().any(|rule| why.contains(rule)),
            "caso `{}`: a regra precisa citar um codigo da rubrica ({:?}), \
             para que a revisao humana seja mecanica. Texto: {why}",
            case.id,
            RULES
        );
    }
}

#[test]
fn the_rule_cited_matches_the_label_it_justifies() {
    // A rubrica so vale se o codigo e o rotulo concordarem. Um caso `ready` que
    // cita `REGRA A2` esta errado e nenhum teste acima pegaria.
    let set = load();
    for case in &set.cases {
        let Some(why) = case.readiness_rule() else {
            continue;
        };
        let label = case.readiness.value();
        let contradictions = why.contains("REGRA A2");
        let insufficiency = why.contains("REGRA I1");
        assert!(
            !(label == "ready" && (contradictions || insufficiency)),
            "caso `{}` e `ready` mas cita uma regra de defeito: {why}",
            case.id
        );
        assert!(
            !(label == "insufficient" && contradictions),
            "caso `{}` e `insufficient` mas cita contradicao — sao situacoes distintas: {why}",
            case.id
        );
    }
}

#[test]
fn the_readme_documents_the_review_state_of_the_set() {
    // A guarda original ("nenhum caso pode ser `human`") existia para
    // lembrar de atualizar o README e recalcular o baseline quando a
    // revisao chegasse. Ela fez o seu papel: a revisao chegou, o baseline
    // foi recalculado, e o estado do conjunto mudou.
    //
    // Agora a guarda e o **outro lado** da mesma coinidencia: o README tem
    // que descrever o conjunto que existe. Um README que diz "nenhum caso
    // foi revisado por humano" enquanto todos os 23 tem `provenance:
    // human` e uma mentira que faz o leitor duvidar do numero.
    let set = load();
    let reviewed = set
        .cases
        .iter()
        .filter(|case| case.readiness.provenance() == LabelProvenance::Human)
        .count();
    let readme =
        std::fs::read_to_string(fixtures_root().join("README.md")).expect("README do conjunto");

    if reviewed > 0 {
        assert!(
            !readme.contains("Nenhum caso tem `provenance: human`"),
            "o README diz que ninguem revisou, mas {reviewed} caso(s) tem `provenance: human`"
        );
    }
    if reviewed < set.cases.len() {
        assert!(
            readme.contains("Nenhum caso tem `provenance: human`"),
            "o README precisa dizer que ainda ha casos sem revisao humana"
        );
    }
}

#[test]
fn every_dimension_reports_whether_it_was_measured() {
    // Este e o **mecanismo de honestidade** do golden set, e ele mudou de
    // lugar depois da revisao.
    //
    // Antes: o conjunto tinha casos `disputed`, e a garantia era que pelo
    // menos um ficasse fora da metrica — para o conjunto nao fingir uma
    // certeza que nao tem.
    //
    // Agora: a revisao humana resolveu os dois casos `disputed`, entao nao
    // ha mais nenhum. Se a guarda continuasse exigindo um caso `disputed`,
    // ela estaria obrigando o conjunto a manter uma ambiguidade artificial
    // para satisfazer um teste — e isso seria pior que a honestidade.
    //
    // A garantia real e mais forte e mais honesta: **toda dimensao do
    // conjunto declara se foi medida**. Uma dimensao sem ground truth
    // (`definitions`, hoje) nao produz `0%`: produz "nao medido". E o
    // silencio e o que o leitor nao percebe.
    let set = load();
    let coverage = set.dimension_coverage();
    assert!(
        !coverage.is_empty(),
        "o conjunto precisa declarar as dimensoes que mede"
    );

    for dimension in &coverage {
        assert!(
            dimension.measured <= dimension.total,
            "a dimensao `{}` diz ter medido {} de {}: impossivel",
            dimension.dimension,
            dimension.measured,
            dimension.total
        );
    }

    // Toda dimensao com zero ground truth tem que ser declarada como nao
    // medida, e nao como medida com zero erro.
    let unmeasured = set.unmeasured_dimensions();
    for dimension in &unmeasured {
        assert_eq!(
            dimension.measured, 0,
            "`{}` foi listada como nao medida, mas diz ter medido {}",
            dimension.dimension, dimension.measured
        );
    }

    // E o inverso: se o conjunto tem uma dimensao sem ground truth, o
    // mecanismo de honestidade tem que estar ativo em algum lugar. Ou ha
    // um caso excluido da metrica, ou ha uma dimensao declarada nao
    // medida. As duas saidas sao honestas; a terceira — fingir que o
    // conjunto esta completo — nao.
    let excluded = !set.unscoreable().is_empty();
    assert!(
        excluded || !unmeasured.is_empty(),
        "o conjunto nao tem caso excluido nem dimensao nao medida: \
         parece mais confiante do que e"
    );
}

#[test]
fn a_case_listed_as_unscoreable_really_is_unscoreable() {
    let set = load();
    assert!(
        set.unscoreable()
            .iter()
            .all(|(_, _, provenance)| !provenance.is_scorable()),
        "todo caso listado como nao pontuavel precisa realmente ser nao pontuavel"
    );
}

#[test]
fn every_scored_readiness_label_is_one_of_the_three_statuses() {
    let set = load();
    for case in &set.cases {
        let label = case.readiness.value();
        assert!(
            matches!(label, "ready" | "ambiguous" | "insufficient"),
            "caso `{}` tem rotulo de prontidão invalido: {label}",
            case.id
        );
    }
}

#[test]
fn every_claim_quote_appears_verbatim_in_its_note() {
    // Um `quote` que nao esta na nota ancoraria a afirmacao no nada. E o
    // mesmo requisito de grounding que o caminho legado exige.
    let set = load();
    for case in &set.cases {
        let markdown = note_text(&case.note);
        for claim in &case.claims {
            assert!(
                markdown.contains(&claim.quote),
                "caso `{}`: citacao ausente da nota: {}",
                case.id,
                claim.quote
            );
        }
    }
}

#[test]
fn every_claim_label_is_a_known_status() {
    let set = load();
    for case in &set.cases {
        for claim in &case.claims {
            assert!(
                matches!(claim.label.value(), "confirmed" | "divergent" | "uncertain"),
                "caso `{}`: status factual invalido: {}",
                case.id,
                claim.label.value()
            );
        }
    }
}

#[test]
fn every_exchange_status_is_known_and_declares_its_provenance() {
    let set = load();
    for case in &set.cases {
        for exchange in &case.exchanges {
            assert!(
                matches!(
                    exchange.status.as_str(),
                    "remembered" | "partial" | "missing" | "contradicted"
                ),
                "caso `{}`: status de asserticao invalido: {}",
                case.id,
                exchange.status
            );
            assert!(
                exchange.status_provenance.is_scorable(),
                "caso `{}`: troco com status disputed nao entra na metrica de assertions",
                case.id
            );
            assert!(
                !exchange.prompt.trim().is_empty() && !exchange.answer.trim().is_empty(),
                "caso `{}`: pergunta ou resposta vazia",
                case.id
            );
        }
    }
}

#[test]
fn the_set_covers_every_readiness_status() {
    // Sem cobertura dos tres status, um report pode parecer bom so porque o
    // conjunto so tem o caso facil.
    let set = load();
    for status in ["ready", "ambiguous", "insufficient"] {
        assert!(
            set.cases
                .iter()
                .any(|case| case.readiness.value() == status),
            "o conjunto nao tem nenhum caso `{status}`"
        );
    }
}

#[test]
fn the_set_covers_every_factual_status() {
    let set = load();
    for status in ["confirmed", "divergent", "uncertain"] {
        assert!(
            set.cases
                .iter()
                .flat_map(|case| case.claims.iter())
                .any(|claim| claim.label.value() == status),
            "o conjunto nao tem nenhuma afirmacao `{status}`"
        );
    }
}

#[test]
fn short_labels_parse_as_construction() {
    let parsed: Label = serde_json::from_str("\"ready\"").expect("forma curta");
    assert_eq!(parsed.value(), "ready");
    assert_eq!(parsed.provenance(), LabelProvenance::Construction);
}

#[test]
fn the_readme_documents_the_provenance_rule() {
    let readme =
        std::fs::read_to_string(fixtures_root().join("README.md")).expect("README do conjunto");
    for provenance in ["construction", "commonFact", "human", "disputed"] {
        assert!(
            readme.contains(provenance),
            "o README nao documenta `{provenance}`"
        );
    }
}
