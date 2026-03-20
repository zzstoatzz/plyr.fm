//! Configuration loading from environment variables.

use anyhow::anyhow;
use std::env;

/// Service configuration loaded from environment.
pub struct Config {
    pub host: String,
    pub port: u16,
    pub auth_token: Option<String>,
    pub acoustid_api_key: String,
    pub database_url: Option<String>,
    pub labeler_did: Option<String>,
    pub labeler_signing_key: Option<String>,
    /// Anthropic API key for Claude image moderation
    pub claude_api_key: Option<String>,
    /// Claude model to use (default: claude-sonnet-4-5-20250929)
    pub claude_model: String,
    /// Minimum AcoustID score (0-100) to flag a track as a copyright match (default: 30)
    pub copyright_score_threshold: i32,
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
            acoustid_api_key: env::var("MODERATION_ACOUSTID_API_KEY")
                .map_err(|_| anyhow!("MODERATION_ACOUSTID_API_KEY is required"))?,
            database_url: env::var("MODERATION_DATABASE_URL").ok(),
            labeler_did: env::var("MODERATION_LABELER_DID").ok(),
            labeler_signing_key: env::var("MODERATION_LABELER_SIGNING_KEY").ok(),
            claude_api_key: env::var("ANTHROPIC_API_KEY").ok(),
            claude_model: env::var("MODERATION_CLAUDE_MODEL")
                .unwrap_or_else(|_| "claude-sonnet-4-5-20250929".to_string()),
            copyright_score_threshold: env::var("MODERATION_COPYRIGHT_SCORE_THRESHOLD")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
        })
    }

    /// Check if Claude image moderation is enabled.
    pub fn claude_enabled(&self) -> bool {
        self.claude_api_key.is_some() && self.database_url.is_some()
    }

    /// Check if labeler is fully configured.
    pub fn labeler_enabled(&self) -> bool {
        self.database_url.is_some()
            && self.labeler_did.is_some()
            && self.labeler_signing_key.is_some()
    }
}
