//! User report handlers for content moderation.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::UserReport;
use crate::AppState;

/// Request to create a new user report.
#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    pub reporter_did: String,
    pub target_type: String,
    pub target_id: String,
    #[serde(default)]
    pub target_uri: Option<String>,
    pub reason: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub screenshot_url: Option<String>,
}

/// Response after creating a report.
#[derive(Debug, Serialize)]
pub struct CreateReportResponse {
    pub report_id: i32,
}

/// Query parameters for listing reports.
#[derive(Debug, Deserialize)]
pub struct ListReportsParams {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

/// Response for listing reports.
#[derive(Debug, Serialize)]
pub struct ListReportsResponse {
    pub reports: Vec<UserReport>,
    pub count: usize,
}

/// Request to resolve a report.
#[derive(Debug, Deserialize)]
pub struct ResolveReportRequest {
    pub status: String,
    #[serde(default)]
    pub admin_notes: Option<String>,
    pub resolved_by: String,
}

/// Create a new user report.
///
/// POST /reports
pub async fn create_report(
    State(state): State<AppState>,
    Json(req): Json<CreateReportRequest>,
) -> Result<Json<CreateReportResponse>, (StatusCode, String)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "database not configured".to_string(),
        )
    })?;

    // Validate reason
    let valid_reasons = ["copyright", "abuse", "spam", "explicit", "other"];
    if !valid_reasons.contains(&req.reason.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("invalid reason: {}. valid: {:?}", req.reason, valid_reasons),
        ));
    }

    // Validate target_type
    let valid_types = ["track", "artist", "album", "playlist", "tag", "comment"];
    if !valid_types.contains(&req.target_type.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "invalid target_type: {}. valid: {:?}",
                req.target_type, valid_types
            ),
        ));
    }

    let report = db
        .create_report(
            &req.reporter_did,
            &req.target_type,
            &req.target_id,
            req.target_uri.as_deref(),
            &req.reason,
            req.description.as_deref(),
            req.screenshot_url.as_deref(),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to create report: {e}"),
            )
        })?;

    info!(
        report_id = report.id,
        reporter = %req.reporter_did,
        target_type = %req.target_type,
        target_id = %req.target_id,
        reason = %req.reason,
        "user report created"
    );

    Ok(Json(CreateReportResponse {
        report_id: report.id,
    }))
}

/// List user reports with optional filtering.
///
/// GET /admin/reports
pub async fn list_reports(
    State(state): State<AppState>,
    Query(params): Query<ListReportsParams>,
) -> Result<Json<ListReportsResponse>, (StatusCode, String)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "database not configured".to_string(),
        )
    })?;

    let limit = params.limit.min(100).max(1);
    let offset = params.offset.max(0);

    let reports = db
        .list_reports(
            params.status.as_deref(),
            params.target_type.as_deref(),
            limit,
            offset,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to list reports: {e}"),
            )
        })?;

    let count = reports.len();

    Ok(Json(ListReportsResponse { reports, count }))
}

/// Get a single report by ID.
///
/// GET /admin/reports/:id
pub async fn get_report(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<UserReport>, (StatusCode, String)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "database not configured".to_string(),
        )
    })?;

    let report = db.get_report(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to get report: {e}"),
        )
    })?;

    report.ok_or_else(|| (StatusCode::NOT_FOUND, "report not found".to_string()))
        .map(Json)
}

/// Resolve a user report.
///
/// POST /admin/reports/:id/resolve
pub async fn resolve_report(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(req): Json<ResolveReportRequest>,
) -> Result<Json<UserReport>, (StatusCode, String)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "database not configured".to_string(),
        )
    })?;

    // Validate status
    let valid_statuses = ["open", "investigating", "resolved", "dismissed"];
    if !valid_statuses.contains(&req.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "invalid status: {}. valid: {:?}",
                req.status, valid_statuses
            ),
        ));
    }

    let report = db
        .resolve_report(id, &req.status, req.admin_notes.as_deref(), &req.resolved_by)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to resolve report: {e}"),
            )
        })?;

    let report = report.ok_or_else(|| (StatusCode::NOT_FOUND, "report not found".to_string()))?;

    info!(
        report_id = id,
        status = %req.status,
        resolved_by = %req.resolved_by,
        "user report resolved"
    );

    Ok(Json(report))
}
