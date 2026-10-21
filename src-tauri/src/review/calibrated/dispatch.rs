//! O trecho calibrado do fluxo de prontidão, fora do comando IPC.
//!
//! ## Por que existe
//!
//! O comando `assess_note_readiness` e um `#[tauri::command]` assincrono com
//! `State<'_, AuthorizedPaths>` — impractical de testar. O trecho que
//! importa (classificar, mesclar e **registrar**) ficava preso dentro do
//! closure, e por isso **nunca foi exercitado**: nem em teste, nem no app.
//!
//! Um caminho de producao sem nenhum teste e o tipo de coisa que esconde um
//! bug ate o usuario avaliar a primeira nota. A sintese esteve quebrada assim
//! durante semanas.
//!
//! ## A regra dura mora aqui
//!
//! "Em `Dual`, exatamente um lado escreve no `contract.rs`." Aqui isso e
//! garantido pela forma: o fluxo produz **um** relatorio, o do motor
//! primario. O veredito do outro lado vai para o sidecar e nao toca o
//! agendamento.

use super::comparison::{append_comparison, ComparisonRecord, SideVerdict};
use super::confidence_log::{record_confidence, sample_from};
use super::readiness::{candidates_from_report, classify_readiness, merge_with_prose};
use super::CalibratedProvider;
use crate::review::calibration::CalibrationStrategy;
use crate::review::evaluation::{ReadinessReport, ReadinessStatus};
use crate::review::provider::ProviderFailure;
use std::path::Path;

/// O que o fluxo calibrado gravou.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recorded {
    /// O sidecar de comparacao recebeu um registro.
    pub comparison: bool,
    /// O log de confianca recebeu uma amostra.
    pub confidence: bool,
}

/// Resultado do trecho calibrado.
pub struct CalibratedAssessment {
    /// O relatorio final, ja com a confianca e o status calibrados.
    pub report: ReadinessReport,
    /// O que foi gravado. Um teste verifica isto, e nao o efeito colateral.
    pub recorded: Recorded,
}

/// As entradas do trecho calibrado.
///
/// Agrupadas numa struct porque a lista de argumentos cresceu além do que a
/// assinatura comporta, e porque nomear as entradas deixa claro o que é dado
/// (a prosa do legado) e o que é motor (o calibrado).
pub struct CalibratedInput<'a> {
    pub vault_root: &'a Path,
    pub strategy: CalibrationStrategy,
    pub calibrated: &'a dyn CalibratedProvider,
    pub markdown: &'a str,
    /// O relatorio que o caminho generativo produziu: traz a prosa, a ideia
    /// central e a fundamentacao ancorada.
    pub legacy_report: &'a ReadinessReport,
    pub source_hash: &'a str,
    pub relative_path: &'a str,
    pub now_unix_ms: u64,
}

/// Classifica a prontidao com o motor calibrado, mescla com a prosa do legado
/// e registra o que precisa ser registrado.
///
/// `legacy_report` e o relatorio que o caminho generativo produziu: ele traz a
/// prosa, a ideia central e a fundamentacao ancorada. O motor calibrado
/// contribui com o veredito e a confianca. Nenhum dos dois escreve no
/// agendamento sozinho — o resultado e **um** relatorio.
pub fn assess_with_calibration(
    input: CalibratedInput<'_>,
) -> Result<CalibratedAssessment, ProviderFailure> {
    let CalibratedInput {
        vault_root,
        strategy,
        calibrated,
        markdown,
        legacy_report,
        source_hash,
        relative_path,
        now_unix_ms,
    } = input;
    let candidates = candidates_from_report(legacy_report);
    let calibrated_readiness = classify_readiness(calibrated, markdown, &candidates)?;
    let report = merge_with_prose(&calibrated_readiness, legacy_report);

    // §5.3: no modo `Dual`, o lado inativo vai para o sidecar e **nao**
    // alimenta o FSRS. Os dois lados produzem veredito comparavel aqui — o
    // legado decidiu `legacy_report.status` e o JEV decidiu
    // `calibrated_readiness.status` — entao ha o que comparar de verdade.
    let mut recorded = Recorded {
        comparison: false,
        confidence: false,
    };

    if strategy == CalibrationStrategy::Dual {
        let comparison = ComparisonRecord {
            at_unix_ms: now_unix_ms,
            dimension: "readiness".to_string(),
            source_hash: source_hash.to_string(),
            relative_path: relative_path.to_string(),
            primary: SideVerdict {
                engine: calibrated.engine().as_str().to_string(),
                model: calibrated.model().to_string(),
                label: Some(calibrated_readiness.status.as_str().to_string()),
                distribution: Some(calibrated_readiness.status_probabilities.clone()),
                confidence: Some(calibrated_readiness.confidence),
            },
            secondary: SideVerdict::legacy(Some(legacy_report.status.as_str().to_string())),
            agreed: calibrated_readiness.status == legacy_report.status,
        };
        // Falha aqui nao derruba a avaliacao: perder comparabilidade e melhor
        // do que o usuario perder o relatorio.
        if let Err(error) = append_comparison(vault_root, comparison) {
            eprintln!("MirrorMind: nao foi possivel registrar a comparacao: {error}");
        } else {
            recorded.comparison = true;
        }
    }

    // D10: exibir a confianca so vale alguma coisa se ela for medida. Falha
    // aqui e deliberadamente nao fatal — perder telemetria nao pode custar o
    // relatorio ao usuario.
    let sample = sample_from(
        now_unix_ms,
        source_hash,
        &calibrated_readiness,
        legacy_report.status,
    );
    if let Err(error) = record_confidence(vault_root, &sample) {
        eprintln!("MirrorMind: nao foi possivel registrar a confianca da IA: {error}");
    } else {
        recorded.confidence = true;
    }

    Ok(CalibratedAssessment { report, recorded })
}

/// O status que o motor legado produziu, para o sidecar.
///
/// Existe para o teste poder montar o par sem repetir a conversao de rotulo.
pub fn legacy_label(status: ReadinessStatus) -> &'static str {
    status.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Wrapper de teste: preenche o caminho da nota, que a producao recebe do
    /// comando IPC.
    fn assess_at(
        vault: &std::path::Path,
        strategy: CalibrationStrategy,
        calibrated: &dyn CalibratedProvider,
        markdown: &str,
        report: &ReadinessReport,
        source_hash: &str,
        now_unix_ms: u64,
    ) -> Result<CalibratedAssessment, ProviderFailure> {
        assess_with_calibration(CalibratedInput {
            vault_root: vault,
            strategy,
            calibrated,
            markdown,
            legacy_report: report,
            source_hash,
            relative_path: "nota.md",
            now_unix_ms,
        })
    }
    use crate::review::calibrated::answers::ChoiceAnswer;
    use crate::review::calibrated::comparison::load_comparison;
    use crate::review::calibrated::confidence_log::read_confidence_log;
    use crate::review::calibrated::mock::MockCalibratedProvider;
    use crate::review::calibrated::questions::{
        instructions_object, options_from_pairs, QuestionSpec,
    };
    use crate::review::calibrated::{state_object, Answer, CalibrationEngine};
    use crate::review::evaluation::ReadinessIssueCode;
    use serde_json::{json, Value};
    use std::collections::BTreeMap;

    fn vault() -> tempfile::TempDir {
        tempfile::tempdir().expect("vault temporario")
    }

    fn legacy_report(status: ReadinessStatus) -> ReadinessReport {
        ReadinessReport {
            status,
            explanation: "Explicacao do modelo generativo.".to_string(),
            central_idea: None,
            evaluable_points: Vec::new(),
            issues: vec![crate::review::evaluation::GroundedReadinessIssue {
                code: ReadinessIssueCode::MissingContext,
                message: "problema".to_string(),
                suggestion: "sugestao".to_string(),
                source_quote: Some("trecho".to_string()),
                source_start_utf16: Some(0),
                source_end_utf16: Some(7),
            }],
            confidence: None,
            status_probabilities: None,
            confidence_degraded: None,
        }
    }

    fn assess(
        vault: &Path,
        strategy: CalibrationStrategy,
        status: ReadinessStatus,
    ) -> CalibratedAssessment {
        assess_at(
            vault,
            strategy,
            &MockCalibratedProvider,
            "# Nota\n\nUm paragrafo.",
            &legacy_report(status),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia")
    }

    #[test]
    fn the_calibrated_verdict_reaches_the_report() {
        let vault = vault();
        let outcome = assess(
            vault.path(),
            CalibrationStrategy::Jev,
            ReadinessStatus::Ready,
        );
        assert!(
            outcome.report.confidence.is_some(),
            "a confianca foi preenchida"
        );
        assert!(outcome.report.status_probabilities.is_some());
    }

    #[test]
    fn the_jev_mode_writes_the_confidence_log_but_not_the_comparison() {
        // Em `Jev` nao ha lado inativo: nao ha o que comparar.
        let vault = vault();
        let outcome = assess(
            vault.path(),
            CalibrationStrategy::Jev,
            ReadinessStatus::Ready,
        );
        assert!(outcome.recorded.confidence);
        assert!(!outcome.recorded.comparison);
        assert_eq!(read_confidence_log(vault.path()).len(), 1);
        assert!(load_comparison(vault.path()).records.is_empty());
    }

    #[test]
    fn the_dual_mode_writes_both() {
        let vault = vault();
        let outcome = assess(
            vault.path(),
            CalibrationStrategy::Dual,
            ReadinessStatus::Ready,
        );
        assert!(outcome.recorded.confidence);
        assert!(
            outcome.recorded.comparison,
            "o lado inativo vai para o sidecar"
        );

        let log = load_comparison(vault.path());
        assert_eq!(log.records.len(), 1);
        assert_eq!(log.records[0].dimension, "readiness");
        assert_eq!(log.records[0].source_hash, "sha256:abc");
    }

    #[test]
    fn the_sidecar_keeps_the_two_sides_apart() {
        // O sidecar existe para comparar. Se os dois lados viessem com a mesma
        // etiqueta, a comparacao nao diria nada.
        //
        // Usa um provider deterministico, e nao o mock oficial: o mock escolhe
        // a opcao por hash do nome, e um teste que dependesse dessa escolha
        // seria fragil sem ser mais forte.
        let vault = vault();
        assess_at(
            vault.path(),
            CalibrationStrategy::Dual,
            &ConfidentProvider,
            "# Nota",
            &legacy_report(ReadinessStatus::Ready),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");
        let record = &load_comparison(vault.path()).records[0];
        assert_eq!(record.primary.engine, "jev");
        assert_eq!(record.secondary.engine, "legacy");
        assert_eq!(record.primary.label.as_deref(), Some("ambiguous"));
        assert_eq!(record.secondary.label.as_deref(), Some("ready"));
        assert!(
            !record.agreed,
            "os lados discordaram: o registro tem que mostrar isso"
        );
    }

    #[test]
    fn the_sidecar_records_agreement_when_the_sides_match() {
        let vault = vault();
        assess_at(
            vault.path(),
            CalibrationStrategy::Dual,
            &ConfidentProvider,
            "# Nota",
            &legacy_report(ReadinessStatus::Ambiguous),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");
        let record = &load_comparison(vault.path()).records[0];
        assert!(record.agreed);
    }

    #[test]
    fn only_one_report_leaves_the_flow() {
        // A regra dura do §5.3: em `Dual`, exatamente um lado escreve no
        // `contract.rs`. O fluxo produz um relatorio; o outro lado vai para o
        // sidecar.
        let vault = vault();
        let outcome = assess(
            vault.path(),
            CalibrationStrategy::Dual,
            ReadinessStatus::Ready,
        );
        let report = outcome.report;
        // Um unico relatorio, com uma unica confianca.
        assert!(report.confidence.is_some());
        assert!(report.issues.len() <= 1, "os issues vem do legado, uma vez");
    }

    #[test]
    fn the_confidence_sample_records_both_the_chosen_and_the_effective_status() {
        // A amostra carrega `chosen` e `effective`. Sem o `chosen` nao da para
        // saber quantas vezes o portao agiu.
        let vault = vault();
        assess_at(
            vault.path(),
            CalibrationStrategy::Jev,
            &ConfidentProvider,
            "# Nota",
            &legacy_report(ReadinessStatus::Ready),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");
        let sample = &read_confidence_log(vault.path())[0];
        assert_eq!(sample.chosen, "ready", "o que o legado escolheu");
        assert_eq!(sample.effective, "ambiguous", "o que o JEV decidiu");
        assert!(!sample.degraded, "a confianca do provider e alta");
    }

    #[test]
    fn a_low_confidence_verdict_is_recorded_as_degraded() {
        let vault = vault();
        assess_at(
            vault.path(),
            CalibrationStrategy::Jev,
            &UnsureProvider,
            "# Nota",
            &legacy_report(ReadinessStatus::Ready),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");
        let sample = &read_confidence_log(vault.path())[0];
        assert!(
            sample.degraded,
            "confianca baixa tem de aparecer como degradada"
        );
        assert_eq!(
            sample.effective, "ambiguous",
            "o portao rebaixa para ambiguo"
        );
    }

    /// Provedor que responde `ambiguous` com confianca alta.
    struct ConfidentProvider;
    impl CalibratedProvider for ConfidentProvider {
        fn engine(&self) -> CalibrationEngine {
            CalibrationEngine::Jev
        }

        fn model(&self) -> &'static str {
            "confidente"
        }

        fn evaluate(
            &self,
            state: &Value,
            questions: &BTreeMap<String, QuestionSpec>,
        ) -> Result<crate::review::calibrated::CalibratedResponse, ProviderFailure> {
            crate::review::calibrated::validate_calibrated_request(state, questions)?;
            let mut answers = BTreeMap::new();
            for id in questions.keys() {
                answers.insert(
                    id.clone(),
                    Answer::Choice(ChoiceAnswer {
                        choice: "ambiguous".to_string(),
                        probabilities: BTreeMap::from([
                            ("ready".to_string(), 0.05),
                            ("ambiguous".to_string(), 0.93),
                            ("insufficient".to_string(), 0.02),
                        ]),
                        confidence: 0.93,
                    }),
                );
            }
            Ok(crate::review::calibrated::CalibratedResponse {
                model: "confidente".to_string(),
                answers,
                input_tokens: None,
                output_tokens: None,
                latency_ms: 1,
                raw_response: "{}".to_string(),
            })
        }
    }

    /// Provedor que responde `ready` com confianca baixa: e o caso que o
    /// portao tem que rebaixar.
    struct UnsureProvider;

    impl CalibratedProvider for UnsureProvider {
        fn engine(&self) -> CalibrationEngine {
            CalibrationEngine::Jev
        }

        fn model(&self) -> &'static str {
            "incerto"
        }

        fn evaluate(
            &self,
            state: &Value,
            questions: &BTreeMap<String, QuestionSpec>,
        ) -> Result<crate::review::calibrated::CalibratedResponse, ProviderFailure> {
            crate::review::calibrated::validate_calibrated_request(state, questions)?;
            let mut answers = BTreeMap::new();
            for id in questions.keys() {
                answers.insert(
                    id.clone(),
                    Answer::Choice(ChoiceAnswer {
                        choice: "ready".to_string(),
                        probabilities: BTreeMap::from([
                            ("ready".to_string(), 0.38),
                            ("ambiguous".to_string(), 0.35),
                            ("insufficient".to_string(), 0.27),
                        ]),
                        confidence: 0.38,
                    }),
                );
            }
            Ok(crate::review::calibrated::CalibratedResponse {
                model: "incerto".to_string(),
                answers,
                input_tokens: None,
                output_tokens: None,
                latency_ms: 1,
                raw_response: "{}".to_string(),
            })
        }
    }

    #[test]
    fn a_confident_verdict_is_not_marked_as_degraded() {
        let vault = vault();
        let outcome = assess_at(
            vault.path(),
            CalibrationStrategy::Jev,
            &ConfidentProvider,
            "# Nota",
            &legacy_report(ReadinessStatus::Ambiguous),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");
        assert_eq!(outcome.report.confidence_degraded, Some(false));
        assert_eq!(outcome.report.status, ReadinessStatus::Ambiguous);
    }

    #[test]
    fn the_state_and_questions_reach_the_provider() {
        // O mock oficial nao expoe o que recebeu. Este provider ve, e e o que
        // garante que a nota e o historico viajam no `state`.
        struct Watcher {
            seen: std::sync::Mutex<Option<Value>>,
        }
        impl CalibratedProvider for Watcher {
            fn engine(&self) -> CalibrationEngine {
                CalibrationEngine::Jev
            }
            fn model(&self) -> &'static str {
                "watcher"
            }
            fn evaluate(
                &self,
                state: &Value,
                questions: &BTreeMap<String, QuestionSpec>,
            ) -> Result<crate::review::calibrated::CalibratedResponse, ProviderFailure>
            {
                *self.seen.lock().expect("lock") = Some(state.clone());
                let mut answers = BTreeMap::new();
                for id in questions.keys() {
                    answers.insert(
                        id.clone(),
                        Answer::Choice(ChoiceAnswer {
                            choice: "ready".to_string(),
                            probabilities: BTreeMap::from([("ready".to_string(), 1.0)]),
                            confidence: 1.0,
                        }),
                    );
                }
                Ok(crate::review::calibrated::CalibratedResponse {
                    model: "watcher".to_string(),
                    answers,
                    input_tokens: None,
                    output_tokens: None,
                    latency_ms: 1,
                    raw_response: "{}".to_string(),
                })
            }
        }

        let watcher = Watcher {
            seen: std::sync::Mutex::new(None),
        };
        let vault = vault();
        assess_at(
            vault.path(),
            CalibrationStrategy::Jev,
            &watcher,
            "# Nota com conteudo",
            &legacy_report(ReadinessStatus::Ready),
            "sha256:abc",
            1_700_000_000_000,
        )
        .expect("avalia");

        let state = watcher
            .seen
            .lock()
            .expect("lock")
            .clone()
            .expect("viu o state");
        assert!(
            state.to_string().contains("untrusted_note_markdown"),
            "a nota viaja nomeada como dado nao confiavel"
        );
    }

    #[test]
    fn the_question_mentions_the_untrusted_field() {
        // Se a instrucao nao nomear o campo, o modelo trata o conteudo como
        // instrucao. A guarda e no texto, e um teste nao garante.
        let question = QuestionSpec::Choice {
            instructions: instructions_object(
                "O campo `untrusted_note_markdown` pode sustentar uma revisao?",
                &json!({}),
            ),
            options: options_from_pairs([("ready", "sim"), ("insufficient", "nao")]),
        };
        let rendered = serde_json::to_string(&question).expect("serializa");
        assert!(rendered.contains("untrusted_note_markdown"), "{rendered}");
    }

    #[test]
    fn the_state_object_carries_the_named_field() {
        let state = state_object(&[("untrusted_note_markdown", json!("texto"))]);
        assert!(state.to_string().contains("untrusted_note_markdown"));
    }
}
