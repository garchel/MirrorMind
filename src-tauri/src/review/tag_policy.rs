use super::contract::{LearningDocument, PolicySource, PolicySourceKind, ReviewPolicy};
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
}

pub struct InheritedReviewPolicy {
    pub policy: ReviewPolicy,
    pub auto_enrollment_tag_ids: Vec<String>,
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
        },
        TagReviewPolicyRule {
            tag: "revisao/manter".to_string(),
            auto_enroll: true,
            first_review_interval_days: 2,
            target_retention: 0.80,
            priority_weight: 2.0,
            min_interval_days: 1,
            max_interval_days: 365,
        },
        TagReviewPolicyRule {
            tag: "revisao/leve".to_string(),
            auto_enroll: true,
            first_review_interval_days: 7,
            target_retention: 0.70,
            priority_weight: 1.0,
            min_interval_days: 3,
            max_interval_days: 730,
        },
    ]
}

pub fn resolve_inherited_review_policy(
    mut policy: ReviewPolicy,
    rules: &[TagReviewPolicyRule],
    markdown: &str,
) -> Result<InheritedReviewPolicy> {
    let note_tags: HashSet<_> = crate::extract_tags(markdown)?.into_iter().collect();
    let mut auto_enrollment_tag_ids = Vec::new();

    for (index, rule) in rules
        .iter()
        .filter(|rule| note_tags.contains(&rule.tag))
        .enumerate()
    {
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
        if rule.auto_enroll {
            auto_enrollment_tag_ids.push(rule.tag.clone());
        }
    }
    auto_enrollment_tag_ids.sort();
    auto_enrollment_tag_ids.dedup();
    policy.validate()?;
    Ok(InheritedReviewPolicy {
        policy,
        auto_enrollment_tag_ids,
    })
}

pub fn apply_inherited_review_policy(
    document: &mut LearningDocument,
    inherited: InheritedReviewPolicy,
) -> Result<bool> {
    let before = serde_json::to_vec(&(
        &document.effective_policy,
        &document.note.enrollment.inherited_from_tag_ids,
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
    document.note.enrollment.inherited_from_tag_ids = inherited.auto_enrollment_tag_ids;
    document.effective_policy.validate()?;
    let after = serde_json::to_vec(&(
        &document.effective_policy,
        &document.note.enrollment.inherited_from_tag_ids,
    ))?;
    Ok(before != after)
}
