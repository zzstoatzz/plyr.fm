//! Configuration loading from environment variables.

use anyhow::anyhow;
use std::env;

/// Service configuration loaded from environment.
pub struct Config {
    pub host: String,
    pub port: u16,
    pub auth_token: Option<String>,
    pub audd_api_token: String,
    pub audd_api_url: String,
    pub database_url: Option<String>,
    pub labeler_did: Option<String>,
    pub labeler_signing_key: Option<String>,
}

impl Config {
    /// Load configuration from environment variables.
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            host: env::var("MODERATION_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("MODERATION_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8083),
            auth_token: env::var("MODERATION_AUTH_TOKEN").ok(),
            audd_api_token: env::var("MODERATION_AUDD_API_TOKEN")
                .map_err(|_| anyhow!("MODERATION_AUDD_API_TOKEN is required"))?,
            audd_api_url: env::var("MODERATION_AUDD_API_URL")
                .unwrap_or_else(|_| "https://enterprise.audd.io/".to_string()),
            database_url: env::var("MODERATION_DATABASE_URL").ok(),
            labeler_did: env::var("MODERATION_LABELER_DID").ok(),
            labeler_signing_key: env::var("MODERATION_LABELER_SIGNING_KEY").ok(),
        })
    }

    /// Check if labeler is fully configured.
    pub fn labeler_enabled(&self) -> bool {
        self.database_url.is_some()
            && self.labeler_did.is_some()
            && self.labeler_signing_key.is_some()
    }
}
