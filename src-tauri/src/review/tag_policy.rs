use super::contract::{LearningDocument, PolicySource, PolicySourceKind, ReviewMode, ReviewPolicy};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagReviewPolicyRule {
    pub tag: String,
    pub auto_enroll: bool,
    pub first_review_interval_days: u64,
    pub target_retention: f64,
    pub priority_weight: f64,
    pub min_interval_days: u64,
    pub max_interval_days: u64,
    pub deadline_at_unix_ms: Option<u64>,
    /// Modo de revisao que a tag transmite para as notas correspondentes
    /// (None = a tag nao dita o modo; a nota usa o proprio ou o padrao Prova).
    #[serde(default)]
    pub preferred_mode: Option<ReviewMode>,
}

pub struct InheritedReviewPolicy {
    pub policy: ReviewPolicy,
    pub auto_enrollment_tag_ids: Vec<String>,
    /// Modo de revisao ditado pelas tags correspondentes (None quando nenhuma
    /// tag configura preferencia), respeitando a mesma precedencia da politica.
    pub preferred_mode: Option<ReviewMode>,
}

pub fn default_tag_review_rules() -> Vec<TagReviewPolicyRule> {
    vec![
        TagReviewPolicyRule {
            tag: "revisao/prova".to_string(),
            auto_enroll: true,
            first_review_interval_days: 1,
            target_retention: 0.90,
            priority_weight: 3.0,
            min_interval_days: 1,
            max_interval_days: 90,
            deadline_at_unix_ms: None,
            preferred_mode: Some(ReviewMode::Exam),
        },
        TagReviewPolicyRule {
            tag: "revisao/manter".to_string(),
            auto_enroll: true,
            first_review_interval_days: 2,
            target_retention: 0.80,
            priority_weight: 2.0,
            min_interval_days: 1,
            max_interval_days: 365,
            deadline_at_unix_ms: None,
            preferred_mode: None,
        },
        TagReviewPolicyRule {
            tag: "revisao/leve".to_string(),
            auto_enroll: true,
            first_review_interval_days: 7,
            target_retention: 0.70,
            priority_weight: 1.0,
            min_interval_days: 3,
            max_interval_days: 730,
            deadline_at_unix_ms: None,
            preferred_mode: None,
        },
    ]
}

pub fn resolve_inherited_review_policy(
    mut policy: ReviewPolicy,
    rules: &[TagReviewPolicyRule],
    markdown: &str,
    now_unix_ms: u64,
) -> Result<InheritedReviewPolicy> {
    let note_tags: HashSet<_> = crate::extract_tags(markdown)?.into_iter().collect();
    let matching_rules: Vec<&TagReviewPolicyRule> = rules
        .iter()
        .filter(|rule| note_tags.contains(&rule.tag))
        .collect();

    // Precedencia completa, da menor para a maior: padrao do Vault -> tag com
    // prazo encerrado -> tag sem prazo -> tag com prazo ativo -> nota (a nota
    // e aplicada fora daqui, campo a campo). A tag com prazo futuro mais
    // proximo define sozinha todos os campos, mesmo que sua politica seja mais
    // permissiva que as demais; tags sem prazo compoem campo a campo o valor
    // mais exigente; uma tag com prazo encerrado so vale quando nenhuma tag sem
    // prazo existe, e entao o prazo mais recentemente encerrado assume.
    let mut auto_enrollment_tag_ids: Vec<String> = matching_rules
        .iter()
        .filter(|rule| rule.auto_enroll)
        .map(|rule| rule.tag.clone())
        .collect();

    // O modo herdado segue a mesma precedencia da politica: a tag de prazo
    // ativo dita sozinha; na ausencia dela, entre tags sem prazo vence a de
    // maior prioridade que tenha preferencia; sem tags sem prazo, a tag de
    // prazo encerrado mais recente dita; sem nenhuma, None (a nota usa o
    // proprio modo ou o padrao Prova).
    let mut preferred_mode: Option<ReviewMode> = None;

    if let Some(active) = matching_rules
        .iter()
        .copied()
        .filter(|rule| {
            rule.deadline_at_unix_ms
                .is_some_and(|deadline| deadline > now_unix_ms)
        })
        .min_by_key(|rule| rule.deadline_at_unix_ms)
    {
        apply_rule_fields(&mut policy, active, PolicySourceKind::ActiveDeadlineTag);
        policy.deadline_at_unix_ms = active.deadline_at_unix_ms;
        let source = PolicySource {
            kind: PolicySourceKind::ActiveDeadlineTag,
            source_id: Some(active.tag.clone()),
        };
        policy.sources.deadline_at_unix_ms = Some(source.clone());
        policy.sources.active_deadline = Some(source);
        preferred_mode = active.preferred_mode.clone();
    } else {
        let no_deadline_rules: Vec<&&TagReviewPolicyRule> = matching_rules
            .iter()
            .filter(|rule| rule.deadline_at_unix_ms.is_none())
            .collect();
        if !no_deadline_rules.is_empty() {
            for (index, rule) in no_deadline_rules.iter().enumerate() {
                compose_strictest_fields(&mut policy, rule, index);
            }
            preferred_mode = pick_tag_mode(no_deadline_rules.iter().map(|rule| **rule));
        } else if let Some(expired) = matching_rules
            .iter()
            .copied()
            .filter(|rule| {
                rule.deadline_at_unix_ms
                    .is_some_and(|deadline| deadline <= now_unix_ms)
            })
            .max_by_key(|rule| rule.deadline_at_unix_ms)
        {
            apply_rule_fields(&mut policy, expired, PolicySourceKind::ExpiredDeadlineTag);
            policy.deadline_at_unix_ms = expired.deadline_at_unix_ms;
            policy.sources.deadline_at_unix_ms = Some(PolicySource {
                kind: PolicySourceKind::ExpiredDeadlineTag,
                source_id: Some(expired.tag.clone()),
            });
            policy.sources.active_deadline = None;
            preferred_mode = expired.preferred_mode.clone();
        }
    }

    auto_enrollment_tag_ids.sort();
    auto_enrollment_tag_ids.dedup();
    policy.validate()?;
    Ok(InheritedReviewPolicy {
        policy,
        auto_enrollment_tag_ids,
        preferred_mode,
    })
}

/// Modo herdado entre tags do mesmo nivel: a tag com preferencia de maior
/// prioridade dita o modo; empate mantem a primeira na ordem da configuracao.
fn pick_tag_mode<'a>(rules: impl Iterator<Item = &'a TagReviewPolicyRule>) -> Option<ReviewMode> {
    let mut best: Option<(f64, ReviewMode)> = None;
    for rule in rules {
        let Some(mode) = rule.preferred_mode.clone() else {
            continue;
        };
        let replaces = match &best {
            Some((weight, _)) => rule.priority_weight > *weight,
            None => true,
        };
        if replaces {
            best = Some((rule.priority_weight, mode));
        }
    }
    best.map(|(_, mode)| mode)
}

/// Aplica todos os campos de uma regra que define sozinha a politica (prazo
/// ativo ou prazo encerrado), registrando a origem da tag em cada campo.
fn apply_rule_fields(
    policy: &mut ReviewPolicy,
    rule: &TagReviewPolicyRule,
    kind: PolicySourceKind,
) {
    let source = || PolicySource {
        kind: kind.clone(),
        source_id: Some(rule.tag.clone()),
    };
    policy.first_review_interval_days = rule.first_review_interval_days;
    policy.sources.first_review_interval_days = source();
    policy.target_retention = rule.target_retention;
    policy.sources.target_retention = source();
    policy.priority_weight = rule.priority_weight;
    policy.sources.priority_weight = source();
    policy.min_interval_days = rule.min_interval_days;
    policy.sources.min_interval_days = source();
    policy.max_interval_days = rule.max_interval_days;
    policy.sources.max_interval_days = source();
}

/// Compoe, campo a campo, a regra mais exigente entre tags sem prazo do mesmo
/// nivel: menor intervalo, maior retencao, maior prioridade e menor limite de
/// intervalo. A primeira regra substitui o padrao do Vault por completo.
fn compose_strictest_fields(policy: &mut ReviewPolicy, rule: &TagReviewPolicyRule, index: usize) {
    let source = || PolicySource {
        kind: PolicySourceKind::Tag,
        source_id: Some(rule.tag.clone()),
    };
    if index == 0 || rule.first_review_interval_days < policy.first_review_interval_days {
        policy.first_review_interval_days = rule.first_review_interval_days;
        policy.sources.first_review_interval_days = source();
    }
    if index == 0 || rule.target_retention > policy.target_retention {
        policy.target_retention = rule.target_retention;
        policy.sources.target_retention = source();
    }
    if index == 0 || rule.priority_weight > policy.priority_weight {
        policy.priority_weight = rule.priority_weight;
        policy.sources.priority_weight = source();
    }
    if index == 0 || rule.min_interval_days < policy.min_interval_days {
        policy.min_interval_days = rule.min_interval_days;
        policy.sources.min_interval_days = source();
    }
    if index == 0 || rule.max_interval_days < policy.max_interval_days {
        policy.max_interval_days = rule.max_interval_days;
        policy.sources.max_interval_days = source();
    }
}

pub fn apply_inherited_review_policy(
    document: &mut LearningDocument,
    inherited: InheritedReviewPolicy,
) -> Result<bool> {
    let before = serde_json::to_vec(&(
        &document.effective_policy,
        &document.note.enrollment.inherited_from_tag_ids,
        &document.note.enrollment.preferred_mode,
    ))?;
    let inherited_policy = inherited.policy;
    if !matches!(
        document
            .effective_policy
            .sources
            .first_review_interval_days
            .kind,
        PolicySourceKind::Note
    ) {
        document.effective_policy.first_review_interval_days =
            inherited_policy.first_review_interval_days;
        document.effective_policy.sources.first_review_interval_days =
            inherited_policy.sources.first_review_interval_days;
    }
    if !matches!(
        document.effective_policy.sources.target_retention.kind,
        PolicySourceKind::Note
    ) {
        document.effective_policy.target_retention = inherited_policy.target_retention;
        document.effective_policy.sources.target_retention =
            inherited_policy.sources.target_retention;
    }
    if !matches!(
        document.effective_policy.sources.priority_weight.kind,
        PolicySourceKind::Note
    ) {
        document.effective_policy.priority_weight = inherited_policy.priority_weight;
        document.effective_policy.sources.priority_weight =
            inherited_policy.sources.priority_weight;
    }
    if !matches!(
        document.effective_policy.sources.min_interval_days.kind,
        PolicySourceKind::Note
    ) {
        document.effective_policy.min_interval_days = inherited_policy.min_interval_days;
        document.effective_policy.sources.min_interval_days =
            inherited_policy.sources.min_interval_days;
    }
    if !matches!(
        document.effective_policy.sources.max_interval_days.kind,
        PolicySourceKind::Note
    ) {
        document.effective_policy.max_interval_days = inherited_policy.max_interval_days;
        document.effective_policy.sources.max_interval_days =
            inherited_policy.sources.max_interval_days;
    }
    let inherited_deadline_source = inherited_policy.sources.deadline_at_unix_ms.clone();
    if !inherited_deadline_source
        .as_ref()
        .is_some_and(|source| matches!(source.kind, PolicySourceKind::Note))
    {
        document.effective_policy.deadline_at_unix_ms = inherited_policy.deadline_at_unix_ms;
        document.effective_policy.sources.deadline_at_unix_ms = inherited_deadline_source;
        document.effective_policy.sources.active_deadline =
            inherited_policy.sources.active_deadline.clone();
    }
    document.note.enrollment.inherited_from_tag_ids = inherited.auto_enrollment_tag_ids;
    // Preferencia de modo herdada das tags: vale somente quando a nota nao
    // definiu a propria (mode_manual = false). Sem tag ditando modo, a nota
    // preserva o modo atual — escolhas feitas antes da feature (ou o padrao
    // Prova) nunca sao sobrescritas silenciosamente.
    if !document.note.enrollment.mode_manual {
        if let Some(inherited_mode) = inherited.preferred_mode {
            if document.note.enrollment.preferred_mode != inherited_mode {
                document.note.enrollment.preferred_mode = inherited_mode;
            }
        }
    }
    document.effective_policy.validate()?;
    let after = serde_json::to_vec(&(
        &document.effective_policy,
        &document.note.enrollment.inherited_from_tag_ids,
        &document.note.enrollment.preferred_mode,
    ))?;
    Ok(before != after)
}

#[cfg(test)]
mod tests {
    use super::{resolve_inherited_review_policy, TagReviewPolicyRule};
    use crate::review::contract::{PolicySourceKind, ReviewPolicy};
    use crate::review::policy_config::review_policy_from_defaults;

    const DAY_MS: u64 = 86_400_000;

    fn rule(tag: &str, deadline: Option<u64>) -> TagReviewPolicyRule {
        TagReviewPolicyRule {
            tag: tag.to_string(),
            auto_enroll: true,
            first_review_interval_days: 2,
            target_retention: 0.8,
            priority_weight: 2.0,
            min_interval_days: 1,
            max_interval_days: 365,
            deadline_at_unix_ms: deadline,
            preferred_mode: None,
        }
    }

    fn defaults() -> ReviewPolicy {
        review_policy_from_defaults(crate::review::policy_config::VaultReviewDefaultsInput {
            first_review_interval_days: 2,
            target_retention: 0.8,
            priority_weight: 1.0,
            min_interval_days: 1,
            max_interval_days: 365,
        })
    }

    #[test]
    fn the_soonest_future_deadline_wins_as_the_active_deadline() {
        let now = 1_730_000_000_000;
        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[
                rule("prova-a", Some(now + 10 * DAY_MS)),
                rule("prova-b", Some(now + 3 * DAY_MS)),
                rule("prova-c", Some(now - 2 * DAY_MS)),
            ],
            "# Titulo #prova-a #prova-b #prova-c",
            now,
        )
        .expect("resolve deadlines");

        assert_eq!(resolved.policy.deadline_at_unix_ms, Some(now + 3 * DAY_MS));
        assert!(matches!(
            resolved
                .policy
                .sources
                .deadline_at_unix_ms
                .as_ref()
                .unwrap()
                .kind,
            PolicySourceKind::ActiveDeadlineTag
        ));
        assert_eq!(
            resolved
                .policy
                .sources
                .deadline_at_unix_ms
                .as_ref()
                .unwrap()
                .source_id
                .as_deref(),
            Some("prova-b")
        );
        assert_eq!(
            resolved
                .policy
                .sources
                .active_deadline
                .as_ref()
                .unwrap()
                .source_id
                .as_deref(),
            Some("prova-b")
        );
    }

    #[test]
    fn an_expired_deadline_is_exposed_but_not_active() {
        let now = 1_730_000_000_000;
        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[rule("prova-antiga", Some(now - 5 * DAY_MS))],
            "# Titulo #prova-antiga",
            now,
        )
        .expect("resolve expired deadline");

        assert_eq!(resolved.policy.deadline_at_unix_ms, Some(now - 5 * DAY_MS));
        assert!(matches!(
            resolved
                .policy
                .sources
                .deadline_at_unix_ms
                .as_ref()
                .unwrap()
                .kind,
            PolicySourceKind::ExpiredDeadlineTag
        ));
        assert!(resolved.policy.sources.active_deadline.is_none());
    }

    #[test]
    fn tags_without_deadlines_leave_the_policy_unchanged() {
        let now = 1_730_000_000_000;
        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[rule("revisao/leve", None)],
            "# Titulo #revisao/leve",
            now,
        )
        .expect("resolve without deadlines");

        assert_eq!(resolved.policy.deadline_at_unix_ms, None);
        assert!(resolved.policy.sources.deadline_at_unix_ms.is_none());
        assert!(resolved.policy.sources.active_deadline.is_none());
    }

    #[test]
    fn unrelated_tags_never_contribute_deadlines() {
        let now = 1_730_000_000_000;
        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[rule("prazo-outro", Some(now + DAY_MS))],
            "# Titulo sem a tag",
            now,
        )
        .expect("resolve unrelated tag");

        assert_eq!(resolved.policy.deadline_at_unix_ms, None);
    }

    #[test]
    fn an_active_deadline_tag_beats_no_deadline_tags_even_when_more_permissive() {
        let now = 1_730_000_000_000;
        let mut permissive = rule("prova-proxima", Some(now + 2 * DAY_MS));
        permissive.target_retention = 0.7;
        permissive.priority_weight = 1.0;
        permissive.first_review_interval_days = 7;
        let mut strict = rule("revisao/manter", None);
        strict.target_retention = 0.9;
        strict.priority_weight = 5.0;
        strict.first_review_interval_days = 1;

        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[permissive, strict],
            "# Titulo #prova-proxima #revisao/manter",
            now,
        )
        .expect("resolve precedence");

        // A precedencia completa exige: prazo ativo > tag sem prazo, mesmo que
        // a politica do prazo ativo seja mais permissiva que a da tag sem prazo.
        assert_eq!(resolved.policy.target_retention, 0.7);
        assert_eq!(resolved.policy.priority_weight, 1.0);
        assert_eq!(resolved.policy.first_review_interval_days, 7);
        assert!(resolved
            .policy
            .sources
            .target_retention
            .source_id
            .is_some_and(|tag| tag == "prova-proxima"));
        assert!(matches!(
            resolved.policy.sources.priority_weight.kind,
            PolicySourceKind::ActiveDeadlineTag
        ));
        assert_eq!(resolved.policy.deadline_at_unix_ms, Some(now + 2 * DAY_MS));
    }

    #[test]
    fn no_deadline_tags_beat_an_expired_deadline_tag() {
        let now = 1_730_000_000_000;
        let mut expired = rule("prova-passada", Some(now - DAY_MS));
        expired.target_retention = 0.6;
        expired.priority_weight = 0.5;
        let no_deadline = rule("revisao/leve", None);

        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[expired, no_deadline],
            "# Titulo #prova-passada #revisao/leve",
            now,
        )
        .expect("resolve precedence");

        // O prazo encerrado nao influencia prioritariamente: a tag sem prazo
        // define os campos e nenhum prazo fica exposto.
        assert_eq!(resolved.policy.deadline_at_unix_ms, None);
        assert!(resolved.policy.sources.deadline_at_unix_ms.is_none());
        assert!(matches!(
            resolved.policy.sources.priority_weight.kind,
            PolicySourceKind::Tag
        ));
        assert!(resolved
            .policy
            .sources
            .priority_weight
            .source_id
            .is_some_and(|tag| tag == "revisao/leve"));
    }

    #[test]
    fn an_expired_deadline_tag_still_applies_above_the_vault_defaults() {
        let now = 1_730_000_000_000;
        let mut expired = rule("prova-passada", Some(now - 3 * DAY_MS));
        expired.first_review_interval_days = 4;
        expired.target_retention = 0.85;
        expired.priority_weight = 3.5;
        expired.min_interval_days = 2;
        expired.max_interval_days = 200;

        let resolved =
            resolve_inherited_review_policy(defaults(), &[expired], "# Titulo #prova-passada", now)
                .expect("resolve expired alone");

        assert_eq!(resolved.policy.first_review_interval_days, 4);
        assert_eq!(resolved.policy.target_retention, 0.85);
        assert_eq!(resolved.policy.priority_weight, 3.5);
        assert_eq!(resolved.policy.min_interval_days, 2);
        assert_eq!(resolved.policy.max_interval_days, 200);
        assert!(matches!(
            resolved.policy.sources.priority_weight.kind,
            PolicySourceKind::ExpiredDeadlineTag
        ));
        assert_eq!(
            resolved
                .policy
                .sources
                .deadline_at_unix_ms
                .as_ref()
                .unwrap()
                .source_id
                .as_deref(),
            Some("prova-passada")
        );
        assert!(resolved.policy.sources.active_deadline.is_none());
    }

    #[test]
    fn the_highest_priority_no_deadline_tag_dictates_the_inherited_mode() {
        let now = 1_730_000_000_000;
        let mut low = rule("revisao/leve", None);
        low.priority_weight = 1.0;
        low.preferred_mode = Some(crate::review::contract::ReviewMode::Exam);
        let mut high = rule("revisao/prova", None);
        high.priority_weight = 9.0;
        high.preferred_mode = Some(crate::review::contract::ReviewMode::Conversation);

        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[low, high],
            "# Titulo #revisao/leve #revisao/prova",
            now,
        )
        .expect("resolve modes");

        assert_eq!(
            resolved.preferred_mode,
            Some(crate::review::contract::ReviewMode::Conversation)
        );
    }

    #[test]
    fn tags_without_a_mode_preference_do_not_dictate_the_mode() {
        let now = 1_730_000_000_000;
        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[rule("revisao/leve", None), rule("revisao/manter", None)],
            "# Titulo #revisao/leve #revisao/manter",
            now,
        )
        .expect("resolve without mode");

        assert_eq!(resolved.preferred_mode, None);
    }

    #[test]
    fn an_active_deadline_tag_dictates_the_inherited_mode() {
        let now = 1_730_000_000_000;
        let mut active = rule("prova-ativa", Some(now + 3 * DAY_MS));
        active.preferred_mode = Some(crate::review::contract::ReviewMode::Conversation);
        let mut stronger_no_deadline = rule("revisao/manter", None);
        stronger_no_deadline.priority_weight = 10.0;
        stronger_no_deadline.preferred_mode = Some(crate::review::contract::ReviewMode::Exam);

        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[active, stronger_no_deadline],
            "# Titulo #prova-ativa #revisao/manter",
            now,
        )
        .expect("resolve active deadline mode");

        // A tag de prazo ativo define sozinha a politica e tambem o modo.
        assert_eq!(
            resolved.preferred_mode,
            Some(crate::review::contract::ReviewMode::Conversation)
        );
    }

    #[test]
    fn an_expired_deadline_tag_dictates_the_mode_when_no_no_deadline_tag_exists() {
        let now = 1_730_000_000_000;
        let mut expired = rule("prova-passada", Some(now - 2 * DAY_MS));
        expired.preferred_mode = Some(crate::review::contract::ReviewMode::Conversation);

        let resolved =
            resolve_inherited_review_policy(defaults(), &[expired], "# Titulo #prova-passada", now)
                .expect("resolve expired mode");

        assert_eq!(
            resolved.preferred_mode,
            Some(crate::review::contract::ReviewMode::Conversation)
        );
    }

    #[test]
    fn the_nearest_future_deadline_alone_defines_fields_even_against_a_stricter_later_one() {
        let now = 1_730_000_000_000;
        let mut nearest = rule("prova-cedo", Some(now + 2 * DAY_MS));
        nearest.target_retention = 0.7;
        nearest.priority_weight = 1.0;
        nearest.first_review_interval_days = 7;
        let mut later = rule("prova-tarde", Some(now + 20 * DAY_MS));
        later.target_retention = 0.95;
        later.priority_weight = 9.0;
        later.first_review_interval_days = 1;

        let resolved = resolve_inherited_review_policy(
            defaults(),
            &[nearest, later],
            "# Titulo #prova-cedo #prova-tarde",
            now,
        )
        .expect("resolve nearest deadline");

        // A politica da tag com prazo futuro mais proximo vale sozinha; as
        // politicas das tags com prazos posteriores nao sao combinadas, mesmo
        // que sejam mais rigorosas.
        assert_eq!(resolved.policy.deadline_at_unix_ms, Some(now + 2 * DAY_MS));
        assert_eq!(resolved.policy.target_retention, 0.7);
        assert_eq!(resolved.policy.priority_weight, 1.0);
        assert_eq!(resolved.policy.first_review_interval_days, 7);
        assert!(resolved
            .policy
            .sources
            .priority_weight
            .source_id
            .is_some_and(|tag| tag == "prova-cedo"));
    }

    #[test]
    fn when_the_active_deadline_expires_the_next_nearest_future_one_takes_over() {
        let now = 1_730_000_000_000;
        let sooner = rule("prova-cedo", Some(now + DAY_MS));
        let later = rule("prova-tarde", Some(now + 10 * DAY_MS));
        let first = resolve_inherited_review_policy(
            defaults(),
            &[sooner, later],
            "# Titulo #prova-cedo #prova-tarde",
            now,
        )
        .expect("resolve soonest deadline");
        assert_eq!(first.policy.deadline_at_unix_ms, Some(now + DAY_MS));

        let after = resolve_inherited_review_policy(
            defaults(),
            &[
                rule("prova-cedo", Some(now + DAY_MS)),
                rule("prova-tarde", Some(now + 10 * DAY_MS)),
            ],
            "# Titulo #prova-cedo #prova-tarde",
            now + 5 * DAY_MS,
        )
        .expect("resolve after the nearest deadline expires");
        assert_eq!(after.policy.deadline_at_unix_ms, Some(now + 10 * DAY_MS));
        assert!(matches!(
            after.policy.sources.active_deadline.as_ref().unwrap().kind,
            PolicySourceKind::ActiveDeadlineTag
        ));
        assert_eq!(
            after
                .policy
                .sources
                .active_deadline
                .unwrap()
                .source_id
                .as_deref(),
            Some("prova-tarde")
        );
    }
}
