//! Application state and error types.

use std::sync::Arc;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tokio::sync::broadcast;
use tracing::error;

use crate::claude::ClaudeClient;
use crate::db::LabelDb;
use crate::labels::{Label, LabelError, LabelSigner};

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub acoustid_api_key: String,
    pub db: Option<Arc<LabelDb>>,
    pub signer: Option<Arc<LabelSigner>>,
    pub label_tx: Option<broadcast::Sender<(i64, Label)>>,
    /// Claude client for image moderation (if configured)
    pub claude: Option<Arc<ClaudeClient>>,
    /// Minimum AcoustID score (0-100) to flag a track as a copyright match
    pub copyright_score_threshold: i32,
}

/// Application error type.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("scan error: {0}")]
    Scan(String),

    #[error("claude error: {0}")]
    Claude(String),

    #[error("image moderation not configured")]
    ImageModerationNotConfigured,

    #[error("labeler not configured")]
    LabelerNotConfigured,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("label error: {0}")]
    Label(#[from] LabelError),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!(error = %self, "request failed");
        let (status, error_type) = match &self {
            AppError::Scan(_) => (StatusCode::BAD_GATEWAY, "ScanError"),
            AppError::Claude(_) => (StatusCode::BAD_GATEWAY, "ClaudeError"),
            AppError::ImageModerationNotConfigured => {
                (StatusCode::SERVICE_UNAVAILABLE, "ImageModerationNotConfigured")
            }
            AppError::LabelerNotConfigured => {
                (StatusCode::SERVICE_UNAVAILABLE, "LabelerNotConfigured")
            }
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BadRequest"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "NotFound"),
            AppError::Label(_) => (StatusCode::INTERNAL_SERVER_ERROR, "LabelError"),
            AppError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DatabaseError"),
            AppError::Io(_) => (StatusCode::INTERNAL_SERVER_ERROR, "IoError"),
        };
        let body = serde_json::json!({
            "error": error_type,
            "message": self.to_string()
        });
        (status, Json(body)).into_response()
    }
}
