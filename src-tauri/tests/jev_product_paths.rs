//! Os caminhos REAIS do produto contra a TypeSafe de verdade.
//!
//! O harness de medicao (`jev_eval.rs`) constroi as perguntas com as proprias
//! maos. O produto usa `classify_readiness`, `classify_assertions`,
//! `calibrate_scores`, `decide_finish` e `classify_and_ground` — codigo
//! diferente, com perguntas diferentes, que **nunca** falara com a API.
//!
//! ## Por que este arquivo existe
//!
//! A primeira versao do adapter mandava `options: [{key, criteria}]` e a API
//! respondia `422`. O harness de medicao — o unico caminho testado contra o
//! servico real — estava errado, e o teste de contrato passava, porque fixava
//! a forma errada.
//!
//! Este arquivo fecha esse buraco: ele exercita as features como o usuario
//! as encountera. Na primeira execucao, achou um bug que quebraria a sintese
//! em producao: a validacao do `score` exigia igualdade exata com a media
//! ponderada das probabilidades devolvidas, mas a API calcula o score com
//! precisao interna e devolve as probabilidades arredondadas. A sintese
//! falhava em **toda** avaliacao.
//!
//! ## Como rodar
//!
//! ```text
//! MIRRORMIND_JEV_EVAL=1 cargo test --test jev_product_paths -- --ignored --nocapture
//! ```
//!
//! Custa poucos centavoes por rodada. Requer a chave TypeSafe no cofre
//! nativo e o consentimento de egresso concedido.

use mirrormind_lib::review::calibrated::assertions::classify_assertions;
use mirrormind_lib::review::calibrated::fact_check::classify_and_ground;
use mirrormind_lib::review::calibrated::finish::decide_finish;
use mirrormind_lib::review::calibrated::readiness::classify_readiness;
use mirrormind_lib::review::calibrated::typesafe::TypeSafeProvider;
use mirrormind_lib::review::credentials::{
    has_typesafe_consent, load_typesafe_api_key, NativeCredentialStore,
};
use mirrormind_lib::review::evaluation::ReadinessStatus;
use mirrormind_lib::review::fact_check::ExtractedClaim;
use serde_json::json;

const ENV_EVAL: &str = "MIRRORMIND_JEV_EVAL";

/// Serializa as chamadas deste arquivo.
///
/// A API **limita a taxa**, e cinco chamadas reais em paralelo fazem o teste
/// falhar de forma intermitente com `429` — que nao e um defeito do produto,
/// e a caracteristica documentada do servico. O produto trata isso como falha
/// de transporte com mensagem explicita, sem queda silenciosa; aqui o que
/// atrapalha e a flakiness do teste.
///
/// Este e um arquivo de integracao com chamada paga: serializar custa alguns
/// segundos e devolve um resultado confiavel.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const NOTA: &str = "\
# Ciclo de Calvin

A glicose e o principal produto da fase escura.

A fixacao de carbono ocorre no estroma dos cloroplastos.

Cada molecula de CO2 fixado consome 3 ATP e 2 NADPH.";

fn provider() -> TypeSafeProvider {
    let store = NativeCredentialStore::new();
    let api_key = load_typesafe_api_key(&store)
        .expect("chave legivel")
        .expect("a chave da TypeSafe AI precisa estar no cofre antes de rodar");
    TypeSafeProvider::new(api_key).expect("provider JEV")
}

fn require_eval() {
    if std::env::var(ENV_EVAL).as_deref() != Ok("1") {
        panic!("rode com MIRRORMIND_JEV_EVAL=1");
    }
}

/// Um `#[test]` por caminho: quando um quebrar, o nome diz qual feature
/// quebrou, e nao "o probe falhou".
#[test]
#[ignore = "chama a TypeSafe real; rode com MIRRORMIND_JEV_EVAL=1"]
fn readiness_classifies_against_the_real_api() {
    require_eval();
    let _guard = serial();
    assert!(
        has_typesafe_consent(&NativeCredentialStore::new()).expect("consentimento legivel"),
        "a egresso para a TypeSafe AI precisa de autorizacao previa"
    );
    let provider = provider();

    let result =
        classify_readiness(&provider, NOTA, &[]).expect("classify_readiness fala com a API");
    assert!(
        matches!(result.status, ReadinessStatus::Ready),
        "a nota de teste e pronta: {:?}",
        result.status
    );
    assert!(
        (0.0..=1.0).contains(&result.confidence),
        "confianca fora de 0..1: {}",
        result.confidence
    );
}

#[test]
#[ignore = "chama a TypeSafe real; rode com MIRRORMIND_JEV_EVAL=1"]
fn assertions_classify_against_the_real_api() {
    require_eval();
    let _guard = serial();
    let provider = provider();
    let transcript =
        json!([{ "prompt": "Qual e o produto da fase escura?", "answer": "A glicose." }]);

    classify_assertions(&provider, NOTA, &transcript, &[])
        .expect("classify_assertions fala com a API");
}

#[test]
#[ignore = "chama a TypeSafe real; rode com MIRRORMIND_JEV_EVAL=1"]
fn finish_decides_against_the_real_api() {
    require_eval();
    let _guard = serial();
    let provider = provider();
    let transcript = json!([{ "prompt": "P?", "answer": "A." }]);

    let decision =
        decide_finish(&provider, NOTA, &transcript, 5).expect("decide_finish fala com a API");
    assert!(
        (0.0..=1.0).contains(&decision.noul),
        "noul fora de 0..1: {}",
        decision.noul
    );
}

#[test]
#[ignore = "chama a TypeSafe real; rode com MIRRORMIND_JEV_EVAL=1"]
fn fact_check_classifies_against_the_real_api() {
    require_eval();
    let _guard = serial();
    let provider = provider();
    let claims = vec![ExtractedClaim {
        claim: "A glicose e o principal produto da fase escura.".to_string(),
        quote: "A glicose e o principal produto da fase escura.".to_string(),
    }];

    classify_and_ground(&provider, NOTA, &claims).expect("classify_and_ground fala com a API");
}
