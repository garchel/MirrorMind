#[cfg(test)]
mod adversarial;
#[cfg(test)]
pub(crate) mod comparability;
#[cfg(test)]
pub(crate) mod conformance;
pub mod contract;
pub mod coverage;
pub mod credentials;
pub mod dashboard;
#[cfg(feature = "e2e")]
pub mod e2e_mock;
pub mod evaluation;
pub mod fact_check;
pub mod gaps;
pub mod gemini;
#[cfg(test)]
mod integration;
pub mod ipc;
pub mod notifications;
pub mod policy;

pub mod policy_config;
pub mod provider;
pub mod queue;
pub mod rename_journal;
pub mod reports;
pub mod retention_calibration;
mod schema;
pub mod segmentation;
pub mod session;
pub mod session_sources;
pub mod state;
pub mod storage;
pub mod structural_audit;
pub mod synthesis;
pub mod tag_policy;
pub(crate) mod usage;
pub mod wikilink_index;
pub mod workload;
