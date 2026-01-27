//! User report handlers for content moderation.

use axum::{
    extract::{Path, Query, State},
    http::{header::CONTENT_TYPE, StatusCode},
    response::{IntoResponse, Response},
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

/// Query parameters for HTML reports listing.
#[derive(Debug, Deserialize)]
pub struct ListReportsHtmlParams {
    #[serde(default = "default_status_filter")]
    pub status: String,
}

fn default_status_filter() -> String {
    "open".to_string()
}

/// Render reports as HTML partial for htmx.
///
/// GET /admin/reports-html
pub async fn list_reports_html(
    State(state): State<AppState>,
    Query(params): Query<ListReportsHtmlParams>,
) -> Result<Response, (StatusCode, String)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "database not configured".to_string(),
        )
    })?;

    // Map "all" to None for status filter
    let status_filter = if params.status == "all" {
        None
    } else {
        Some(params.status.as_str())
    };

    let reports = db
        .list_reports(status_filter, None, 100, 0)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to list reports: {e}"),
            )
        })?;

    let html = render_reports_list(&reports, &params.status);

    Ok(([(CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
}

/// Render the reports list as HTML with filter controls.
fn render_reports_list(reports: &[UserReport], current_filter: &str) -> String {
    let open_active = if current_filter == "open" { " active" } else { "" };
    let resolved_active = if current_filter == "resolved" || current_filter == "dismissed" {
        " active"
    } else {
        ""
    };
    let all_active = if current_filter == "all" { " active" } else { "" };

    let count = reports.len();
    let count_label = match current_filter {
        "open" => format!("{} open", count),
        "resolved" | "dismissed" => format!("{} closed", count),
        _ => format!("{} total", count),
    };

    let filter_buttons = format!(
        "<div class=\"filter-row\">\
            <span class=\"filter-label\">show:</span>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/reports-html?status=open\" hx-target=\"#reports-list\">open</button>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/reports-html?status=resolved\" hx-target=\"#reports-list\">closed</button>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/reports-html?status=all\" hx-target=\"#reports-list\">all</button>\
            <span class=\"filter-count\">{}</span>\
        </div>",
        open_active, resolved_active, all_active, count_label,
    );

    if reports.is_empty() {
        let empty_msg = match current_filter {
            "open" => "no open reports",
            "resolved" | "dismissed" => "no closed reports",
            _ => "no reports",
        };
        return format!(
            "{}<div class=\"empty\">{}</div>",
            filter_buttons, empty_msg
        );
    }

    let cards: Vec<String> = reports.iter().map(render_report_card).collect();
    format!("{}\n{}", filter_buttons, cards.join("\n"))
}

/// Render a single report card as HTML.
fn render_report_card(report: &UserReport) -> String {
    let is_closed = report.status == "resolved" || report.status == "dismissed";
    let resolved_class = if is_closed { " resolved" } else { "" };

    // Status badge
    let status_badge = match report.status.as_str() {
        "open" => r#"<span class="badge pending">open</span>"#,
        "investigating" => r#"<span class="badge investigating">investigating</span>"#,
        "resolved" => r#"<span class="badge resolved">resolved</span>"#,
        "dismissed" => r#"<span class="badge dismissed">dismissed</span>"#,
        _ => r#"<span class="badge">unknown</span>"#,
    };

    // Reason badge
    let reason_badge = format!(
        r#"<span class="badge reason-{}">{}</span>"#,
        html_escape(&report.reason),
        html_escape(&report.reason)
    );

    // Target type badge
    let target_badge = format!(
        r#"<span class="badge target">{}</span>"#,
        html_escape(&report.target_type)
    );

    // Description (if any)
    let description_html = report
        .description
        .as_ref()
        .map(|d| {
            format!(
                r#"<div class="report-description">{}</div>"#,
                html_escape(d)
            )
        })
        .unwrap_or_default();

    // Admin notes (if resolved)
    let admin_notes_html = report
        .admin_notes
        .as_ref()
        .map(|n| {
            format!(
                r#"<div class="admin-notes"><strong>admin notes:</strong> {}</div>"#,
                html_escape(n)
            )
        })
        .unwrap_or_default();

    // Screenshot link (if any)
    let screenshot_html = report
        .screenshot_url
        .as_ref()
        .map(|url| {
            format!(
                r#"<a href="{}" target="_blank" rel="noopener" class="screenshot-link">view screenshot</a>"#,
                html_escape(url)
            )
        })
        .unwrap_or_default();

    // Action buttons for open reports
    let action_html = if is_closed {
        let resolved_by = report
            .resolved_by
            .as_deref()
            .unwrap_or("unknown");
        format!(
            r#"<div class="resolution-info">
                <span class="resolution-reason">{} by {}</span>
                {}
            </div>"#,
            html_escape(&report.status),
            html_escape(resolved_by),
            admin_notes_html
        )
    } else {
        format!(
            r#"<div class="report-actions-flow" data-id="{}">
                <button type="button" class="btn btn-secondary" onclick="showReportActions(this)">
                    take action
                </button>
            </div>"#,
            report.id
        )
    };

    // Format timestamp
    let created_at = report.created_at.format("%Y-%m-%d %H:%M UTC").to_string();

    format!(
        r#"<div class="report-card{}">
            <div class="report-header">
                <div class="report-info">
                    <div class="report-target">
                        <strong>{}</strong>: {}
                    </div>
                    <div class="report-meta">
                        reported by <code>{}</code> · {}
                    </div>
                    {}
                    {}
                </div>
                <div class="report-badges">
                    {}
                    {}
                    {}
                </div>
            </div>
            <div class="report-actions">
                {}
            </div>
        </div>"#,
        resolved_class,
        html_escape(&report.target_type),
        html_escape(&report.target_id),
        truncate_did(&report.reporter_did),
        created_at,
        description_html,
        screenshot_html,
        target_badge,
        reason_badge,
        status_badge,
        action_html
    )
}

/// Truncate DID for display (show first and last parts).
fn truncate_did(did: &str) -> String {
    if did.len() <= 24 {
        return html_escape(did);
    }
    let prefix = &did[..16];
    let suffix = &did[did.len() - 6..];
    format!("{}…{}", html_escape(prefix), html_escape(suffix))
}

/// Simple HTML escaping.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}
