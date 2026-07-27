use super::evaluation::{ReadinessReport, ReadinessStatus};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

fn deserialize_nullable<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub const LEARNING_SCHEMA_VERSION: u16 = 1;
pub const MAX_LEARNING_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

const MAX_IDENTIFIER_LENGTH: usize = 256;
const MAX_TEXT_LENGTH: usize = 8_192;
const MAX_PATH_LENGTH: usize = 1_024;
const MAX_UNITS: usize = 2_000;
const MAX_SESSIONS: usize = 5_000;
const MAX_GAPS: usize = 200;
const MAX_TAGS: usize = 100;
const MAX_ISSUES: usize = 100;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const UINT32_MAX: u64 = 4_294_967_295;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearningDocument {
    pub schema_version: u16,
    pub revision: u64,
    pub note: LearningNote,
    pub units: Vec<LearningUnit>,
    pub effective_policy: ReviewPolicy,
    pub scheduling: SchedulingState,
    pub sessions: Vec<ReviewSession>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearningNote {
    pub id: String,
    pub relative_path: String,
    pub content_hash: String,
    pub readiness: ReadinessAssessment,
    pub enrollment: Enrollment,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReadinessAssessment {
    Unassessed {
        #[serde(deserialize_with = "deserialize_nullable")]
        assessed_at_unix_ms: Option<u64>,
        #[serde(deserialize_with = "deserialize_nullable")]
        assessed_content_hash: Option<String>,
        issues: Vec<ReadinessIssue>,
        report: Option<ReadinessReport>,
    },
    Ready {
        assessed_at_unix_ms: u64,
        assessed_content_hash: String,
        issues: Vec<ReadinessIssue>,
        report: Option<ReadinessReport>,
    },
    Ambiguous {
        assessed_at_unix_ms: u64,
        assessed_content_hash: String,
        issues: Vec<ReadinessIssue>,
        report: Option<ReadinessReport>,
    },
    Insufficient {
        assessed_at_unix_ms: u64,
        assessed_content_hash: String,
        issues: Vec<ReadinessIssue>,
        report: Option<ReadinessReport>,
    },
    Modified {
        assessed_at_unix_ms: u64,
        assessed_content_hash: String,
        issues: Vec<ReadinessIssue>,
        report: Option<ReadinessReport>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadinessIssue {
    #[serde(deserialize_with = "deserialize_nullable")]
    pub unit_id: Option<String>,
    pub code: ReadinessIssueCode,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Enrollment {
    pub manual: bool,
    #[serde(default)]
    pub manual_paused: bool,
    pub inherited_from_tag_ids: Vec<String>,
    pub preferred_mode: ReviewMode,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearningUnit {
    pub id: String,
    pub ordinal: u64,
    pub kind: LearningUnitKind,
    pub content_hash: String,
    pub section_path: Vec<String>,
    pub identity: UnitIdentity,
    pub source_start_utf16: u64,
    pub source_end_utf16: u64,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub fsrs: Option<FsrsState>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub latest_evaluation: Option<UnitEvaluation>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnitIdentity {
    pub signature_version: u8,
    pub normalized_content_hash: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub previous_context_hash: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub next_context_hash: Option<String>,
    pub approximate_start_utf16: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FsrsState {
    pub difficulty: f64,
    pub stability_days: f64,
    pub retrievability: f64,
    pub last_reviewed_at_unix_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UnitEvaluation {
    Evaluated {
        score: u8,
        outcome: RecallOutcome,
        evidence: EvidenceStrength,
        evaluated_at_unix_ms: u64,
        gaps: Vec<EvaluationGap>,
    },
    Inconclusive {
        evaluated_at_unix_ms: u64,
        reason: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluationGap {
    pub classification: GapClassification,
    pub source_quote: String,
    pub source_start_utf16: u64,
    pub source_end_utf16: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewPolicy {
    pub first_review_interval_days: u64,
    pub target_retention: f64,
    pub priority_weight: f64,
    pub min_interval_days: u64,
    pub max_interval_days: u64,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub deadline_at_unix_ms: Option<u64>,
    pub sources: PolicySources,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicySources {
    pub first_review_interval_days: PolicySource,
    pub target_retention: PolicySource,
    pub priority_weight: PolicySource,
    pub min_interval_days: PolicySource,
    pub max_interval_days: PolicySource,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub deadline_at_unix_ms: Option<PolicySource>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub active_deadline: Option<PolicySource>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicySource {
    pub kind: PolicySourceKind,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub source_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchedulingState {
    pub status: SchedulingStatus,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub first_review_at_unix_ms: Option<u64>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub last_review_at_unix_ms: Option<u64>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub next_review_at_unix_ms: Option<u64>,
    pub fsrs_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewSession {
    pub id: String,
    pub note_content_hash: String,
    pub mode: ReviewMode,
    pub provider: AiProvider,
    pub completed_at_unix_ms: u64,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub overall_score: Option<u8>,
    pub unit_results: Vec<SessionUnitResult>,
    pub effective_policy: ReviewPolicy,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub next_review_at_unix_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnitSnapshot {
    pub id: String,
    pub ordinal: u64,
    pub kind: LearningUnitKind,
    pub content_hash: String,
    pub section_path: Vec<String>,
    pub identity: UnitIdentity,
    pub source_start_utf16: u64,
    pub source_end_utf16: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionUnitResult {
    pub unit_snapshot: UnitSnapshot,
    pub evaluation: UnitEvaluation,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub fsrs_before: Option<FsrsState>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub fsrs_after: Option<FsrsState>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadinessIssueCode {
    Ambiguous,
    Insufficient,
    Contradictory,
    MissingContext,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewMode {
    Exam,
    Conversation,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LearningUnitKind {
    WholeNote,
    Section,
    Paragraph,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecallOutcome {
    Forgotten,
    Partial,
    Good,
    Complete,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceStrength {
    Recognition,
    FreeRecall,
    Conversation,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GapClassification {
    Forgotten,
    Confused,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PolicySourceKind {
    VaultDefault,
    ExpiredDeadlineTag,
    Tag,
    ActiveDeadlineTag,
    Note,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SchedulingStatus {
    NotScheduled,
    Scheduled,
    Due,
    Paused,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    Gemini,
    Ollama,
}

pub fn parse_learning_document(input: &str) -> Result<LearningDocument> {
    if input.len() > MAX_LEARNING_DOCUMENT_BYTES {
        bail!("O documento de aprendizado excede o tamanho maximo.");
    }
    let document: LearningDocument = serde_json::from_str(input)
        .context("O documento de aprendizado nao e um JSON V1 valido.")?;
    document.validate()?;
    Ok(document)
}

pub fn migrate_learning_document(input: &str) -> Result<LearningDocument> {
    if input.len() > MAX_LEARNING_DOCUMENT_BYTES {
        bail!("O documento de aprendizado excede o tamanho maximo.");
    }
    let mut value: serde_json::Value =
        serde_json::from_str(input).context("O documento legado nao e JSON valido.")?;
    match value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(version) if version == u64::from(LEARNING_SCHEMA_VERSION) => {
            return parse_learning_document(input);
        }
        Some(0) => {}
        _ => bail!("A versao do documento de aprendizado nao pode ser migrada."),
    }

    let root = value
        .as_object_mut()
        .context("O documento legado precisa ser um objeto.")?;
    if root
        .get("sessions")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|sessions| !sessions.is_empty())
    {
        bail!("Sessoes V0 nao podem ser migradas sem resultados por unidade.");
    }

    let readiness = root
        .get_mut("note")
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|note| note.get_mut("readiness"))
        .and_then(serde_json::Value::as_object_mut)
        .context("A prontidao V0 e obrigatoria.")?;
    let assessed_hash = readiness
        .remove("contentHash")
        .context("O hash avaliado V0 e obrigatorio.")?;
    readiness.insert("assessedContentHash".to_string(), assessed_hash);

    let units = root
        .get_mut("units")
        .and_then(serde_json::Value::as_array_mut)
        .context("As unidades V0 sao obrigatorias.")?;
    for unit in units {
        let unit = unit
            .as_object_mut()
            .context("Cada unidade V0 precisa ser um objeto.")?;
        let content_hash = unit
            .get("contentHash")
            .cloned()
            .context("O hash da unidade V0 e obrigatorio.")?;
        unit.insert(
            "identity".to_string(),
            serde_json::json!({
                "signatureVersion": 1,
                "normalizedContentHash": content_hash,
                "previousContextHash": null,
                "nextContextHash": null,
                "approximateStartUtf16": 0
            }),
        );
        unit.insert("sourceStartUtf16".to_string(), serde_json::json!(0));
        unit.insert("sourceEndUtf16".to_string(), serde_json::json!(1));
        if let Some(evaluation) = unit
            .get_mut("latestEvaluation")
            .and_then(serde_json::Value::as_object_mut)
        {
            if evaluation
                .get("outcome")
                .and_then(serde_json::Value::as_str)
                == Some("inconclusive")
            {
                let evaluated_at = evaluation
                    .get("evaluatedAtUnixMs")
                    .cloned()
                    .context("A data da avaliacao V0 e obrigatoria.")?;
                *evaluation = serde_json::Map::from_iter([
                    (
                        "kind".to_string(),
                        serde_json::Value::String("inconclusive".to_string()),
                    ),
                    ("evaluatedAtUnixMs".to_string(), evaluated_at),
                    (
                        "reason".to_string(),
                        serde_json::Value::String(
                            "Migrated from V0 without conclusive evidence.".to_string(),
                        ),
                    ),
                ]);
            } else {
                evaluation.insert(
                    "kind".to_string(),
                    serde_json::Value::String("evaluated".to_string()),
                );
            }
        }
    }

    let policy = root
        .get_mut("effectivePolicy")
        .and_then(serde_json::Value::as_object_mut)
        .context("A politica V0 e obrigatoria.")?;
    let source = policy
        .remove("source")
        .context("A origem da politica V0 e obrigatoria.")?;
    let has_deadline = policy
        .get("deadlineAtUnixMs")
        .is_some_and(|value| !value.is_null());
    let is_active_deadline =
        source.get("kind").and_then(serde_json::Value::as_str) == Some("activeDeadlineTag");
    policy.insert(
        "sources".to_string(),
        serde_json::json!({
            "firstReviewIntervalDays": source,
            "targetRetention": source,
            "priorityWeight": source,
            "minIntervalDays": source,
            "maxIntervalDays": source,
            "deadlineAtUnixMs": if has_deadline { source.clone() } else { serde_json::Value::Null },
            "activeDeadline": if is_active_deadline { source } else { serde_json::Value::Null }
        }),
    );
    root.insert("revision".to_string(), serde_json::json!(1));
    root.insert(
        "schemaVersion".to_string(),
        serde_json::Value::Number(LEARNING_SCHEMA_VERSION.into()),
    );

    parse_learning_document(&serde_json::to_string(&value)?)
}

pub fn validate_session_against_markdown(
    document: &LearningDocument,
    session_id: &str,
    markdown: &str,
    trusted_note_content_hash: &str,
    trusted_unit_content_hashes: &std::collections::HashMap<String, String>,
) -> Result<()> {
    let session = document
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .context("A sessao de revisao nao existe no documento.")?;
    if document.note.content_hash != trusted_note_content_hash
        || session.note_content_hash != trusted_note_content_hash
    {
        bail!("A sessao de revisao pertence a uma versao antiga da nota.");
    }

    for result in &session.unit_results {
        let snapshot = &result.unit_snapshot;
        let unit = document
            .units
            .iter()
            .find(|unit| unit.id == snapshot.id)
            .context("A sessao referencia uma unidade desconhecida.")?;
        if snapshot.content_hash != unit.content_hash
            || snapshot.source_start_utf16 != unit.source_start_utf16
            || snapshot.source_end_utf16 != unit.source_end_utf16
            || trusted_unit_content_hashes.get(&unit.id) != Some(&unit.content_hash)
        {
            bail!("O resultado pertence a uma versao antiga da unidade.");
        }
        if let UnitEvaluation::Evaluated { gaps, .. } = &result.evaluation {
            for gap in gaps {
                if gap.source_start_utf16 < snapshot.source_start_utf16
                    || gap.source_end_utf16 > snapshot.source_end_utf16
                    || !utf16_quote_matches(
                        markdown,
                        gap.source_start_utf16,
                        gap.source_end_utf16,
                        &gap.source_quote,
                    )
                {
                    bail!("A evidencia nao corresponde a unidade Markdown atual.");
                }
            }
        }
    }
    Ok(())
}

impl LearningDocument {
    fn validate(&self) -> Result<()> {
        if self.schema_version != LEARNING_SCHEMA_VERSION {
            bail!("A versao do documento de aprendizado nao e suportada.");
        }
        if self.revision == 0 || self.revision > MAX_SAFE_INTEGER {
            bail!("A revisao do documento e invalida.");
        }
        require_text(
            &self.note.id,
            MAX_IDENTIFIER_LENGTH,
            "O identificador da nota e invalido.",
        )?;
        require_text(
            &self.note.relative_path,
            MAX_PATH_LENGTH,
            "O caminho da nota e invalido.",
        )?;
        require_hash(&self.note.content_hash)?;
        self.note.enrollment.validate()?;
        self.note
            .readiness
            .validate(&self.note.content_hash, &self.scheduling)?;

        if self.units.is_empty() || self.units.len() > MAX_UNITS {
            bail!("A quantidade de unidades e invalida.");
        }

        let mut unit_ids = HashSet::new();
        let mut ordinals = HashSet::new();
        for unit in &self.units {
            unit.validate()?;
            if !unit_ids.insert(unit.id.as_str()) {
                bail!("Os identificadores das unidades devem ser unicos.");
            }
            if !ordinals.insert(unit.ordinal) {
                bail!("Os ordinais das unidades devem ser unicos.");
            }
        }
        for issue in self.note.readiness.issues() {
            if let Some(unit_id) = issue.unit_id.as_deref() {
                if !unit_ids.contains(unit_id) {
                    bail!("A prontidao referencia uma unidade desconhecida.");
                }
            }
        }

        self.effective_policy.validate()?;
        self.scheduling.validate()?;
        if self.sessions.len() > MAX_SESSIONS {
            bail!("A quantidade de sessoes e invalida.");
        }

        let mut session_ids = HashSet::new();
        let mut previous_completed_at = 0;
        for session in &self.sessions {
            session.validate()?;
            if !session_ids.insert(session.id.as_str()) {
                bail!("Os identificadores das sessoes devem ser unicos.");
            }
            if session.completed_at_unix_ms < previous_completed_at {
                bail!("As sessoes devem estar em ordem cronologica.");
            }
            previous_completed_at = session.completed_at_unix_ms;
        }

        if let Some(latest_session) = self.sessions.last() {
            if self.scheduling.last_review_at_unix_ms != Some(latest_session.completed_at_unix_ms) {
                bail!("O agendamento deve apontar para a sessao mais recente.");
            }
            let expected_next = if self.scheduling.status == SchedulingStatus::Paused {
                None
            } else {
                latest_session.next_review_at_unix_ms
            };
            let policy_changed_after_session = serde_json::to_value(&self.effective_policy)?
                != serde_json::to_value(&latest_session.effective_policy)?;
            if self.scheduling.next_review_at_unix_ms != expected_next
                && !policy_changed_after_session
            {
                bail!("O agendamento e a ultima sessao divergem sobre a proxima revisao.");
            }
        } else if self.scheduling.last_review_at_unix_ms.is_some() {
            bail!("Nao pode haver ultima revisao sem sessao persistida.");
        }

        for unit in &self.units {
            let latest_result = self
                .sessions
                .iter()
                .rev()
                .flat_map(|session| session.unit_results.iter())
                .find(|result| {
                    result.unit_snapshot.id == unit.id
                        && result.unit_snapshot.content_hash == unit.content_hash
                        && result.evaluation.is_evaluated()
                });
            match latest_result {
                Some(result) => {
                    if serde_json::to_value(&unit.latest_evaluation)?
                        != serde_json::to_value(Some(&result.evaluation))?
                        || unit.fsrs.as_ref() != result.fsrs_after.as_ref()
                    {
                        bail!("A projecao atual da unidade diverge do historico mais recente.");
                    }
                }
                None if unit.latest_evaluation.is_some() || unit.fsrs.is_some() => {
                    bail!("Uma unidade sem historico correspondente nao pode ter projecao.");
                }
                None => {}
            }
        }
        Ok(())
    }
}

impl ReadinessAssessment {
    fn issues(&self) -> &[ReadinessIssue] {
        match self {
            Self::Unassessed { issues, .. }
            | Self::Ready { issues, .. }
            | Self::Ambiguous { issues, .. }
            | Self::Insufficient { issues, .. }
            | Self::Modified { issues, .. } => issues,
        }
    }

    fn validate(&self, current_hash: &str, scheduling: &SchedulingState) -> Result<()> {
        if self.issues().len() > MAX_ISSUES {
            bail!("A quantidade de problemas de prontidao e invalida.");
        }
        for issue in self.issues() {
            if let Some(unit_id) = &issue.unit_id {
                require_text(
                    unit_id,
                    MAX_IDENTIFIER_LENGTH,
                    "O identificador do problema e invalido.",
                )?;
            }
            require_text(
                &issue.message,
                MAX_TEXT_LENGTH,
                "A mensagem do problema e invalida.",
            )?;
        }
        match self {
            Self::Unassessed {
                report: Some(_), ..
            } => {
                bail!("Uma nota nao avaliada nao pode conter relatorio.");
            }
            Self::Ready { report, .. } => {
                validate_readiness_report(report.as_ref(), Some(ReadinessStatus::Ready))?
            }
            Self::Ambiguous { report, .. } => {
                validate_readiness_report(report.as_ref(), Some(ReadinessStatus::Ambiguous))?
            }
            Self::Insufficient { report, .. } => {
                validate_readiness_report(report.as_ref(), Some(ReadinessStatus::Insufficient))?
            }
            Self::Modified { report, .. } => validate_readiness_report(report.as_ref(), None)?,
            Self::Unassessed { .. } => {}
        }

        match self {
            Self::Unassessed {
                assessed_at_unix_ms,
                assessed_content_hash,
                issues,
                ..
            } => {
                if assessed_at_unix_ms.is_some()
                    || assessed_content_hash.is_some()
                    || !issues.is_empty()
                    || scheduling.status != SchedulingStatus::NotScheduled
                {
                    bail!("Uma nota nao avaliada nao pode conter avaliacao ou agendamento.");
                }
            }
            Self::Modified {
                assessed_at_unix_ms,
                assessed_content_hash,
                ..
            } => {
                validate_timestamp(*assessed_at_unix_ms)?;
                require_hash(assessed_content_hash)?;
                if assessed_content_hash == current_hash
                    || scheduling.status != SchedulingStatus::Paused
                {
                    bail!("Uma nota modificada deve preservar o hash avaliado e pausar o agendamento.");
                }
            }
            Self::Ready {
                assessed_at_unix_ms,
                assessed_content_hash,
                ..
            }
            | Self::Ambiguous {
                assessed_at_unix_ms,
                assessed_content_hash,
                ..
            }
            | Self::Insufficient {
                assessed_at_unix_ms,
                assessed_content_hash,
                ..
            } => {
                validate_timestamp(*assessed_at_unix_ms)?;
                require_hash(assessed_content_hash)?;
                if assessed_content_hash != current_hash {
                    bail!("O hash de prontidao deve corresponder ao conteudo atual da nota.");
                }
                if matches!(self, Self::Ambiguous { .. } | Self::Insufficient { .. })
                    && scheduling.status != SchedulingStatus::Paused
                {
                    bail!("Uma nota que nao esta pronta deve pausar o agendamento.");
                }
            }
        }
        Ok(())
    }
}

fn validate_readiness_report(
    report: Option<&ReadinessReport>,
    expected_status: Option<ReadinessStatus>,
) -> Result<()> {
    let Some(report) = report else {
        return Ok(());
    };
    if expected_status.is_some_and(|status| status != report.status) {
        bail!("O status do relatorio diverge da prontidao persistida.");
    }
    require_text(
        &report.explanation,
        MAX_TEXT_LENGTH,
        "A explicacao da prontidao e invalida.",
    )?;
    if report.evaluable_points.len() > MAX_ISSUES || report.issues.len() > MAX_ISSUES {
        bail!("O relatorio de prontidao excede o limite permitido.");
    }
    let validate_source = |quote: &str, start: u32, end: u32| -> Result<()> {
        require_text(
            quote,
            MAX_TEXT_LENGTH,
            "A evidencia da prontidao e invalida.",
        )?;
        if end <= start {
            bail!("O intervalo UTF-16 da prontidao e invalido.");
        }
        Ok(())
    };
    if let Some(source) = &report.central_idea {
        validate_source(
            &source.source_quote,
            source.source_start_utf16,
            source.source_end_utf16,
        )?;
    }
    for source in &report.evaluable_points {
        validate_source(
            &source.source_quote,
            source.source_start_utf16,
            source.source_end_utf16,
        )?;
    }
    for issue in &report.issues {
        require_text(
            &issue.message,
            MAX_TEXT_LENGTH,
            "A mensagem do relatorio e invalida.",
        )?;
        require_text(
            &issue.suggestion,
            MAX_TEXT_LENGTH,
            "A sugestao do relatorio e invalida.",
        )?;
        match (
            issue.source_quote.as_deref(),
            issue.source_start_utf16,
            issue.source_end_utf16,
        ) {
            (Some(quote), Some(start), Some(end)) => validate_source(quote, start, end)?,
            (None, None, None) => {}
            _ => bail!("A evidencia do problema de prontidao esta incompleta."),
        }
    }
    Ok(())
}
impl Enrollment {
    pub(crate) fn is_enrolled(&self) -> bool {
        !self.manual_paused && (self.manual || !self.inherited_from_tag_ids.is_empty())
    }

    fn validate(&self) -> Result<()> {
        if self.inherited_from_tag_ids.len() > MAX_TAGS {
            bail!("A quantidade de tags herdadas e invalida.");
        }
        for tag_id in &self.inherited_from_tag_ids {
            require_text(
                tag_id,
                MAX_IDENTIFIER_LENGTH,
                "O identificador da tag e invalido.",
            )?;
        }
        Ok(())
    }
}

impl LearningUnit {
    fn validate(&self) -> Result<()> {
        validate_unit_snapshot_fields(
            &self.id,
            self.ordinal,
            &self.content_hash,
            &self.section_path,
            &self.identity,
            self.source_start_utf16,
            self.source_end_utf16,
        )?;
        if let Some(fsrs) = &self.fsrs {
            fsrs.validate()?;
        }
        if let Some(evaluation) = &self.latest_evaluation {
            evaluation.validate()?;
        }
        Ok(())
    }
}

impl UnitSnapshot {
    fn validate(&self) -> Result<()> {
        validate_unit_snapshot_fields(
            &self.id,
            self.ordinal,
            &self.content_hash,
            &self.section_path,
            &self.identity,
            self.source_start_utf16,
            self.source_end_utf16,
        )
    }
}

fn validate_unit_snapshot_fields(
    id: &str,
    ordinal: u64,
    content_hash: &str,
    section_path: &[String],
    identity: &UnitIdentity,
    source_start_utf16: u64,
    source_end_utf16: u64,
) -> Result<()> {
    require_text(
        id,
        MAX_IDENTIFIER_LENGTH,
        "O identificador da unidade e invalido.",
    )?;
    require_hash(content_hash)?;
    if ordinal > UINT32_MAX
        || section_path.len() > 32
        || source_start_utf16 > UINT32_MAX
        || source_end_utf16 > UINT32_MAX
        || source_end_utf16 <= source_start_utf16
    {
        bail!("A posicao, profundidade ou intervalo da unidade e invalido.");
    }
    for section in section_path {
        require_text(section, MAX_TEXT_LENGTH, "O caminho da secao e invalido.")?;
    }
    identity.validate()
}

impl UnitIdentity {
    fn validate(&self) -> Result<()> {
        if self.signature_version != 1 || self.approximate_start_utf16 > UINT32_MAX {
            bail!("A assinatura estrutural da unidade e invalida.");
        }
        require_hash(&self.normalized_content_hash)?;
        if let Some(hash) = &self.previous_context_hash {
            require_hash(hash)?;
        }
        if let Some(hash) = &self.next_context_hash {
            require_hash(hash)?;
        }
        Ok(())
    }
}

impl FsrsState {
    fn validate(&self) -> Result<()> {
        if !(1.0..=10.0).contains(&self.difficulty)
            || !self.stability_days.is_finite()
            || self.stability_days <= 0.0
            || !percentage(self.retrievability)
        {
            bail!("O estado FSRS da unidade e invalido.");
        }
        validate_timestamp(self.last_reviewed_at_unix_ms)
    }
}

impl UnitEvaluation {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Evaluated {
                score,
                outcome,
                evaluated_at_unix_ms,
                gaps,
                ..
            } => {
                validate_timestamp(*evaluated_at_unix_ms)?;
                let outcome_matches = match score {
                    0..=39 => matches!(outcome, RecallOutcome::Forgotten),
                    40..=69 => matches!(outcome, RecallOutcome::Partial),
                    70..=89 => matches!(outcome, RecallOutcome::Good),
                    90..=100 => matches!(outcome, RecallOutcome::Complete),
                    _ => false,
                };
                if !outcome_matches
                    || (matches!(outcome, RecallOutcome::Complete) && !gaps.is_empty())
                {
                    bail!("A pontuacao e o resultado da unidade sao inconsistentes.");
                }
                if gaps.len() > MAX_GAPS {
                    bail!("A quantidade de lacunas e invalida.");
                }
                for gap in gaps {
                    gap.validate()?;
                }
            }
            Self::Inconclusive {
                evaluated_at_unix_ms,
                reason,
            } => {
                validate_timestamp(*evaluated_at_unix_ms)?;
                require_text(reason, MAX_TEXT_LENGTH, "O motivo inconclusivo e invalido.")?;
            }
        }
        Ok(())
    }

    fn is_evaluated(&self) -> bool {
        matches!(self, Self::Evaluated { .. })
    }
}

impl EvaluationGap {
    fn validate(&self) -> Result<()> {
        require_text(
            &self.source_quote,
            MAX_TEXT_LENGTH,
            "Toda lacuna precisa citar a nota.",
        )?;
        if self.source_start_utf16 > UINT32_MAX
            || self.source_end_utf16 > UINT32_MAX
            || self.source_end_utf16 <= self.source_start_utf16
        {
            bail!("O intervalo UTF-16 da lacuna e invalido.");
        }
        Ok(())
    }
}

impl ReviewPolicy {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.first_review_interval_days == 0
            || self.first_review_interval_days > 3_650
            || self.min_interval_days == 0
            || self.min_interval_days > 3_650
            || self.max_interval_days < self.min_interval_days
            || self.max_interval_days > 36_500
            || !self.priority_weight.is_finite()
            || !(0.0..=100.0).contains(&self.priority_weight)
            || self.priority_weight == 0.0
            || !self.target_retention.is_finite()
            || !(0.5..=0.99).contains(&self.target_retention)
        {
            bail!("A politica efetiva de revisao e invalida.");
        }
        if let Some(deadline) = self.deadline_at_unix_ms {
            validate_timestamp(deadline)?;
        }
        self.sources.validate(self.deadline_at_unix_ms.is_some())
    }
}

impl PolicySources {
    fn validate(&self, has_deadline: bool) -> Result<()> {
        for source in [
            &self.first_review_interval_days,
            &self.target_retention,
            &self.priority_weight,
            &self.min_interval_days,
            &self.max_interval_days,
        ] {
            source.validate()?;
        }
        if has_deadline != self.deadline_at_unix_ms.is_some() {
            bail!("O prazo e sua proveniencia devem existir juntos.");
        }
        if let Some(source) = &self.deadline_at_unix_ms {
            source.validate()?;
        }
        if let Some(source) = &self.active_deadline {
            source.validate()?;
            if !matches!(source.kind, PolicySourceKind::ActiveDeadlineTag) {
                bail!("O prazo ativo deve apontar para uma tag de prazo ativa.");
            }
        }
        Ok(())
    }
}

impl PolicySource {
    fn validate(&self) -> Result<()> {
        match self.kind {
            PolicySourceKind::VaultDefault if self.source_id.is_some() => {
                bail!("A politica padrao do Vault nao possui identificador de origem.")
            }
            PolicySourceKind::VaultDefault => Ok(()),
            _ => require_text(
                self.source_id.as_deref().unwrap_or_default(),
                MAX_IDENTIFIER_LENGTH,
                "A origem da politica precisa de um identificador.",
            ),
        }
    }
}

impl SchedulingState {
    fn validate(&self) -> Result<()> {
        require_text(
            &self.fsrs_version,
            MAX_IDENTIFIER_LENGTH,
            "A versao FSRS e invalida.",
        )?;
        for timestamp in [
            self.first_review_at_unix_ms,
            self.last_review_at_unix_ms,
            self.next_review_at_unix_ms,
        ]
        .into_iter()
        .flatten()
        {
            validate_timestamp(timestamp)?;
        }
        match self.status {
            SchedulingStatus::NotScheduled
                if self.first_review_at_unix_ms.is_some()
                    || self.last_review_at_unix_ms.is_some()
                    || self.next_review_at_unix_ms.is_some() =>
            {
                bail!("Uma nota nao agendada nao pode conter datas de revisao.")
            }
            SchedulingStatus::Scheduled | SchedulingStatus::Due
                if self.first_review_at_unix_ms.is_none()
                    || self.next_review_at_unix_ms.is_none() =>
            {
                bail!("Uma nota agendada precisa da primeira e proxima revisao.")
            }
            SchedulingStatus::Paused if self.next_review_at_unix_ms.is_some() => {
                bail!("Uma nota pausada nao pode ter proxima revisao.")
            }
            _ => {}
        }
        if let (Some(first), Some(last)) =
            (self.first_review_at_unix_ms, self.last_review_at_unix_ms)
        {
            if last < first {
                bail!("A ultima revisao nao pode anteceder a primeira.");
            }
        }
        Ok(())
    }
}

impl ReviewSession {
    fn validate(&self) -> Result<()> {
        require_text(
            &self.id,
            MAX_IDENTIFIER_LENGTH,
            "O identificador da sessao e invalido.",
        )?;
        require_hash(&self.note_content_hash)?;
        validate_timestamp(self.completed_at_unix_ms)?;
        if self.unit_results.is_empty() || self.unit_results.len() > MAX_UNITS {
            bail!("A cobertura da sessao e invalida.");
        }

        let mut result_ids = HashSet::new();
        let mut evaluated_score_total = 0_u32;
        let mut evaluated_count = 0_u32;
        for result in &self.unit_results {
            result.validate()?;
            if !result_ids.insert(result.unit_snapshot.id.as_str()) {
                bail!("A sessao possui resultados duplicados para uma unidade.");
            }
            if let UnitEvaluation::Evaluated { score, gaps, .. } = &result.evaluation {
                evaluated_score_total += u32::from(*score);
                evaluated_count += 1;
                if gaps.iter().any(|gap| {
                    gap.source_start_utf16 < result.unit_snapshot.source_start_utf16
                        || gap.source_end_utf16 > result.unit_snapshot.source_end_utf16
                }) {
                    bail!("Uma lacuna saiu do intervalo do snapshot da unidade.");
                }
            }
        }

        match (evaluated_count, self.overall_score) {
            (0, None) => {}
            (0, Some(_)) | (_, None) => {
                bail!("A pontuacao geral deve existir exatamente quando houve avaliacao.")
            }
            (count, Some(overall)) => {
                let expected =
                    ((f64::from(evaluated_score_total) / f64::from(count)).round()) as u8;
                if overall != expected {
                    bail!("A pontuacao geral deve ser a media arredondada das unidades.");
                }
            }
        }

        self.effective_policy.validate()?;
        if let Some(next_review) = self.next_review_at_unix_ms {
            validate_timestamp(next_review)?;
            if next_review <= self.completed_at_unix_ms {
                bail!("A proxima revisao deve ocorrer depois da sessao.");
            }
        }
        Ok(())
    }
}

impl SessionUnitResult {
    fn validate(&self) -> Result<()> {
        self.unit_snapshot.validate()?;
        self.evaluation.validate()?;
        if let Some(fsrs) = &self.fsrs_before {
            fsrs.validate()?;
        }
        if let Some(fsrs) = &self.fsrs_after {
            fsrs.validate()?;
        }
        match &self.evaluation {
            UnitEvaluation::Inconclusive { .. } if self.fsrs_before != self.fsrs_after => {
                bail!("Uma avaliacao inconclusiva nao pode alterar o FSRS.");
            }
            UnitEvaluation::Evaluated { .. } if self.fsrs_after.is_none() => {
                bail!("Uma avaliacao concluida precisa produzir estado FSRS.");
            }
            _ => {}
        }
        Ok(())
    }
}
fn utf16_quote_matches(markdown: &str, start: u64, end: u64, quote: &str) -> bool {
    let utf16: Vec<u16> = markdown.encode_utf16().collect();
    let Ok(start) = usize::try_from(start) else {
        return false;
    };
    let Ok(end) = usize::try_from(end) else {
        return false;
    };
    utf16
        .get(start..end)
        .and_then(|slice| String::from_utf16(slice).ok())
        .is_some_and(|slice| slice == quote)
}

fn validate_timestamp(value: u64) -> Result<()> {
    if value > MAX_SAFE_INTEGER {
        bail!("O timestamp excede o limite inteiro seguro.");
    }
    Ok(())
}

fn percentage(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn require_hash(value: &str) -> Result<()> {
    require_text(value, MAX_IDENTIFIER_LENGTH, "O hash e invalido.")
}

fn require_text(value: &str, max_utf16_length: usize, message: &str) -> Result<()> {
    let length = value.encode_utf16().count();
    if value.trim().is_empty() || value != value.trim() || length > max_utf16_length {
        bail!(message.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        migrate_learning_document, parse_learning_document, validate_session_against_markdown,
    };
    use serde::Deserialize;
    use std::collections::HashMap;

    #[derive(Deserialize)]
    struct ConformanceCase {
        name: String,
        valid: bool,
        operations: Vec<ConformanceOperation>,
    }

    #[derive(Deserialize)]
    struct ConformanceOperation {
        path: Vec<serde_json::Value>,
        value: serde_json::Value,
        #[serde(default)]
        delete: bool,
    }

    const VALID_DOCUMENT: &str = include_str!("../../../tests/fixtures/review-learning-v1.json");

    #[test]
    fn parses_a_complete_version_1_learning_document() {
        let document = parse_learning_document(VALID_DOCUMENT).expect("valid learning document");
        assert_eq!(document.schema_version, 1);
        assert_eq!(document.note.id, "note-1");
        assert_eq!(document.units.len(), 2);
    }

    #[test]
    fn rejects_an_unsupported_schema_version() {
        let mut value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture JSON");
        value["schemaVersion"] = serde_json::json!(2);
        assert!(parse_learning_document(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_readiness_for_a_different_current_version() {
        let mut value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture JSON");
        value["note"]["readiness"]["assessedContentHash"] =
            serde_json::json!("sha256:stale-content");
        assert!(parse_learning_document(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_duplicate_learning_unit_ids() {
        let mut value: serde_json::Value =
            serde_json::from_str(VALID_DOCUMENT).expect("fixture JSON");
        let duplicate = value["units"][0].clone();
        value["units"]
            .as_array_mut()
            .expect("units")
            .push(duplicate);
        assert!(parse_learning_document(&value.to_string()).is_err());
    }

    #[test]
    fn accepts_evidence_only_when_it_matches_the_current_markdown() {
        let document = parse_learning_document(VALID_DOCUMENT).expect("valid document");
        let markdown = format!(
            "{}energia luminosa{}glicose e oxigênio",
            " ".repeat(24),
            " ".repeat(145 - 40)
        );
        let hashes = HashMap::from([
            ("unit-1".to_string(), "sha256:paragraph-1".to_string()),
            ("unit-2".to_string(), "sha256:paragraph-2".to_string()),
        ]);

        validate_session_against_markdown(
            &document,
            "session-1",
            &markdown,
            "sha256:note-content",
            &hashes,
        )
        .expect("matching evidence");

        let stale_markdown = markdown.replacen("energia luminosa", "energia química ", 1);
        assert!(validate_session_against_markdown(
            &document,
            "session-1",
            &stale_markdown,
            "sha256:note-content",
            &hashes,
        )
        .is_err());
    }

    #[test]
    fn migrates_v0_once_and_is_idempotent_for_v1() {
        let legacy = include_str!("../../../tests/fixtures/review-learning-v0.json");
        let migrated = migrate_learning_document(legacy).expect("V0 migration");
        let serialized = serde_json::to_string(&migrated).expect("serialize V1");
        let migrated_again = migrate_learning_document(&serialized).expect("V1 idempotence");

        assert_eq!(migrated.schema_version, 1);
        assert_eq!(
            serde_json::to_value(migrated).expect("first value"),
            serde_json::to_value(migrated_again).expect("second value")
        );
    }

    #[test]
    fn matches_the_shared_cross_runtime_conformance_corpus() {
        let cases: Vec<ConformanceCase> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/review-learning-conformance.json"
        ))
        .expect("conformance fixture");

        for test_case in cases {
            let mut value: serde_json::Value =
                serde_json::from_str(VALID_DOCUMENT).expect("base fixture");
            for operation in test_case.operations {
                if operation.delete {
                    remove_json_value(&mut value, &operation.path);
                } else {
                    set_json_value(&mut value, &operation.path, operation.value);
                }
            }
            assert_eq!(
                parse_learning_document(&value.to_string()).is_ok(),
                test_case.valid,
                "conformance case: {}",
                test_case.name
            );
        }
    }

    fn remove_json_value(target: &mut serde_json::Value, path: &[serde_json::Value]) {
        let (segment, remaining) = path.split_first().expect("non-empty path");
        if remaining.is_empty() {
            match segment {
                serde_json::Value::String(key) => {
                    target.as_object_mut().expect("object path").remove(key);
                }
                serde_json::Value::Number(index) => {
                    target
                        .as_array_mut()
                        .expect("array path")
                        .remove(index.as_u64().expect("index") as usize);
                }
                _ => panic!("unsupported path segment"),
            }
            return;
        }
        let child = match segment {
            serde_json::Value::String(key) => &mut target[key],
            serde_json::Value::Number(index) => {
                &mut target[index.as_u64().expect("index") as usize]
            }
            _ => panic!("unsupported path segment"),
        };
        remove_json_value(child, remaining);
    }

    fn set_json_value(
        target: &mut serde_json::Value,
        path: &[serde_json::Value],
        replacement: serde_json::Value,
    ) {
        let (segment, remaining) = path.split_first().expect("non-empty path");
        if remaining.is_empty() {
            match segment {
                serde_json::Value::String(key) => {
                    target
                        .as_object_mut()
                        .expect("object path")
                        .insert(key.clone(), replacement);
                }
                serde_json::Value::Number(index) => {
                    target.as_array_mut().expect("array path")
                        [index.as_u64().expect("index") as usize] = replacement;
                }
                _ => panic!("unsupported path segment"),
            }
            return;
        }

        let child = match segment {
            serde_json::Value::String(key) => &mut target[key],
            serde_json::Value::Number(index) => {
                &mut target[index.as_u64().expect("index") as usize]
            }
            _ => panic!("unsupported path segment"),
        };
        set_json_value(child, remaining, replacement);
    }
}
