//! Application state and error types.

use std::sync::Arc;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tokio::sync::broadcast;
use tracing::error;

use crate::db::LabelDb;
use crate::labels::{Label, LabelError, LabelSigner};

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub audd_api_token: String,
    pub audd_api_url: String,
    pub db: Option<Arc<LabelDb>>,
    pub signer: Option<Arc<LabelSigner>>,
    pub label_tx: Option<broadcast::Sender<(i64, Label)>>,
}

/// Application error type.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("audd error: {0}")]
    Audd(String),

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
            AppError::Audd(_) => (StatusCode::BAD_GATEWAY, "AuddError"),
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
