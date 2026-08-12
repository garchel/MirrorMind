#[cfg(test)]
mod adversarial;
#[cfg(test)]
pub(crate) mod conformance;
pub mod contract;
pub mod coverage;
pub mod credentials;
pub mod dashboard;
#[cfg(feature = "e2e")]
pub mod e2e_mock;
pub mod evaluation;
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
pub mod reports;
pub mod retention_calibration;
mod schema;
pub mod segmentation;
pub mod session;
pub mod state;
pub mod storage;
pub mod structural_audit;
pub mod tag_policy;
pub mod workload;
