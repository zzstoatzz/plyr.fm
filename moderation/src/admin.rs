//! Admin API for reviewing and resolving copyright flags.
//!
//! Uses htmx for interactivity with server-rendered HTML.

use axum::{
    extract::{Query, State},
    http::header::CONTENT_TYPE,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::db::LabelContext;
use crate::state::{AppError, AppState};

/// A flagged track pending review.
#[derive(Debug, Serialize)]
pub struct FlaggedTrack {
    pub seq: i64,
    pub uri: String,
    pub val: String,
    pub created_at: String,
    /// Track status: pending review, resolved (false positive), or confirmed (takedown).
    pub resolved: bool,
    /// Optional context about the track (title, artist, matches).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<LabelContext>,
}

/// Response for listing flagged tracks.
#[derive(Debug, Serialize)]
pub struct ListFlaggedResponse {
    pub tracks: Vec<FlaggedTrack>,
}

/// Query parameters for listing flags.
#[derive(Debug, Deserialize, Default)]
pub struct ListFlagsQuery {
    /// Filter: "pending" (default), "resolved", or "all"
    #[serde(default = "default_filter")]
    pub filter: String,
}

fn default_filter() -> String {
    "pending".to_string()
}

/// Request to resolve (negate) a flag.
#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub uri: String,
    #[serde(default = "default_val")]
    pub val: String,
    /// Reason for marking as false positive.
    pub reason: Option<String>,
    /// Additional notes about the resolution.
    pub notes: Option<String>,
}

fn default_val() -> String {
    "copyright-violation".to_string()
}

/// Response after resolving a flag.
#[derive(Debug, Serialize)]
pub struct ResolveResponse {
    pub seq: i64,
    pub message: String,
}

/// Request to store label context (for backfill).
#[derive(Debug, Deserialize)]
pub struct StoreContextRequest {
    pub uri: String,
    pub context: ContextPayload,
}

/// Context payload for storage.
#[derive(Debug, Deserialize)]
pub struct ContextPayload {
    pub track_id: Option<i64>,
    pub track_title: Option<String>,
    pub artist_handle: Option<String>,
    pub artist_did: Option<String>,
    pub highest_score: Option<f64>,
    pub matches: Option<Vec<crate::db::CopyrightMatch>>,
}

/// Response after storing context.
#[derive(Debug, Serialize)]
pub struct StoreContextResponse {
    pub message: String,
}

/// Request to check which URIs have active labels.
#[derive(Debug, Deserialize)]
pub struct ActiveLabelsRequest {
    pub uris: Vec<String>,
}

/// Response with active (non-negated) URIs.
#[derive(Debug, Serialize)]
pub struct ActiveLabelsResponse {
    pub active_uris: Vec<String>,
}

/// Request to add a sensitive image.
#[derive(Debug, Deserialize)]
pub struct AddSensitiveImageRequest {
    /// R2 storage ID (for track/album artwork)
    pub image_id: Option<String>,
    /// Full URL (for external images like avatars)
    pub url: Option<String>,
    /// Why this image was flagged
    pub reason: Option<String>,
    /// Admin who flagged it
    pub flagged_by: Option<String>,
}

/// Response after adding a sensitive image.
#[derive(Debug, Serialize)]
pub struct AddSensitiveImageResponse {
    pub id: i64,
    pub message: String,
}

/// Request to remove a sensitive image.
#[derive(Debug, Deserialize)]
pub struct RemoveSensitiveImageRequest {
    pub id: i64,
}

/// Response after removing a sensitive image.
#[derive(Debug, Serialize)]
pub struct RemoveSensitiveImageResponse {
    pub removed: bool,
    pub message: String,
}

/// Request to create a review batch.
#[derive(Debug, Deserialize)]
pub struct CreateBatchRequest {
    /// URIs to include. If empty, uses all pending flags.
    #[serde(default)]
    pub uris: Vec<String>,
    /// Who created this batch.
    pub created_by: Option<String>,
}

/// Response after creating a review batch.
#[derive(Debug, Serialize)]
pub struct CreateBatchResponse {
    pub id: String,
    pub url: String,
    pub flag_count: usize,
}

/// List all flagged tracks - returns JSON for API, HTML for htmx.
pub async fn list_flagged(
    State(state): State<AppState>,
    Query(query): Query<ListFlagsQuery>,
) -> Result<Json<ListFlaggedResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let all_tracks = db.get_pending_flags().await?;
    let tracks = filter_tracks(all_tracks, &query.filter);
    Ok(Json(ListFlaggedResponse { tracks }))
}

/// Render flags as HTML partial for htmx.
pub async fn list_flagged_html(
    State(state): State<AppState>,
    Query(query): Query<ListFlagsQuery>,
) -> Result<Response, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let all_tracks = db.get_pending_flags().await?;
    let tracks = filter_tracks(all_tracks, &query.filter);

    let html = render_flags_list(&tracks, &query.filter);

    Ok(([(CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
}

/// Filter tracks based on filter parameter.
fn filter_tracks(tracks: Vec<FlaggedTrack>, filter: &str) -> Vec<FlaggedTrack> {
    match filter {
        "resolved" => tracks.into_iter().filter(|t| t.resolved).collect(),
        "all" => tracks,
        _ => tracks.into_iter().filter(|t| !t.resolved).collect(), // "pending" is default
    }
}

/// Resolve (negate) a copyright flag, marking it as a false positive.
pub async fn resolve_flag(
    State(state): State<AppState>,
    Json(request): Json<ResolveRequest>,
) -> Result<Json<ResolveResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state
        .signer
        .as_ref()
        .ok_or(AppError::LabelerNotConfigured)?;

    // Parse the reason
    let reason = request
        .reason
        .as_deref()
        .and_then(crate::db::ResolutionReason::from_str);

    tracing::info!(
        uri = %request.uri,
        val = %request.val,
        reason = ?reason,
        notes = ?request.notes,
        "resolving flag (creating negation)"
    );

    // Create a negation label
    let label = crate::labels::Label::new(signer.did(), &request.uri, &request.val).negated();
    let label = signer.sign_label(label)?;

    let seq = db.store_label(&label).await?;

    // Store resolution reason in context
    if let Some(r) = reason {
        db.store_resolution(&request.uri, r, request.notes.as_deref())
            .await?;
    }

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label));
    }

    Ok(Json(ResolveResponse {
        seq,
        message: format!("created negation label for {}", request.uri),
    }))
}

/// Resolve flag and return HTML response for htmx.
pub async fn resolve_flag_htmx(
    State(state): State<AppState>,
    axum::Form(request): axum::Form<ResolveRequest>,
) -> Result<Response, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state
        .signer
        .as_ref()
        .ok_or(AppError::LabelerNotConfigured)?;

    // Parse the reason
    let reason = request
        .reason
        .as_deref()
        .and_then(crate::db::ResolutionReason::from_str);

    tracing::info!(
        uri = %request.uri,
        val = %request.val,
        reason = ?reason,
        notes = ?request.notes,
        "resolving flag via htmx"
    );

    // Create a negation label
    let label = crate::labels::Label::new(signer.did(), &request.uri, &request.val).negated();
    let label = signer.sign_label(label)?;

    let seq = db.store_label(&label).await?;

    // Store resolution reason in context
    if let Some(r) = reason {
        db.store_resolution(&request.uri, r, request.notes.as_deref())
            .await?;
    }

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label));
    }

    // Return success toast + trigger refresh
    let reason_label = reason.map(|r| r.label()).unwrap_or("unknown");
    let html = format!(
        r#"<div id="toast" class="toast success" hx-swap-oob="true">resolved: {} (seq: {})</div>"#,
        reason_label, seq
    );

    Ok((
        [(CONTENT_TYPE, "text/html; charset=utf-8")],
        [(
            axum::http::header::HeaderName::from_static("hx-trigger"),
            "flagsUpdated",
        )],
        html,
    )
        .into_response())
}

/// Get which URIs have active (non-negated) copyright-violation labels.
///
/// Used by the backend to determine which tracks are still flagged.
pub async fn get_active_labels(
    State(state): State<AppState>,
    Json(request): Json<ActiveLabelsRequest>,
) -> Result<Json<ActiveLabelsResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::debug!(uri_count = request.uris.len(), "checking active labels");

    let active_uris = db.get_active_labels(&request.uris).await?;

    tracing::debug!(
        active_count = active_uris.len(),
        "returning active labels"
    );

    Ok(Json(ActiveLabelsResponse { active_uris }))
}

/// Store context for a label (for backfill without re-emitting labels).
pub async fn store_context(
    State(state): State<AppState>,
    Json(request): Json<StoreContextRequest>,
) -> Result<Json<StoreContextResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::info!(uri = %request.uri, "storing label context");

    let label_ctx = LabelContext {
        track_id: request.context.track_id,
        track_title: request.context.track_title,
        artist_handle: request.context.artist_handle,
        artist_did: request.context.artist_did,
        highest_score: request.context.highest_score,
        matches: request.context.matches,
        resolution_reason: None,
        resolution_notes: None,
    };

    db.store_context(&request.uri, &label_ctx).await?;

    Ok(Json(StoreContextResponse {
        message: format!("context stored for {}", request.uri),
    }))
}

/// Create a review batch from pending flags.
pub async fn create_batch(
    State(state): State<AppState>,
    Json(request): Json<CreateBatchRequest>,
) -> Result<Json<CreateBatchResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    // Get URIs to include
    let uris = if request.uris.is_empty() {
        let pending = db.get_pending_flags().await?;
        pending
            .into_iter()
            .filter(|t| !t.resolved)
            .map(|t| t.uri)
            .collect()
    } else {
        request.uris
    };

    if uris.is_empty() {
        return Err(AppError::BadRequest("no flags to review".to_string()));
    }

    let id = generate_batch_id();
    let flag_count = uris.len();

    tracing::info!(
        batch_id = %id,
        flag_count = flag_count,
        "creating review batch"
    );

    db.create_batch(&id, &uris, request.created_by.as_deref())
        .await?;

    let url = format!("/admin/review/{}", id);

    Ok(Json(CreateBatchResponse { id, url, flag_count }))
}

/// Generate a short, URL-safe batch ID.
fn generate_batch_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let rand_part: u32 = rand::random();
    format!("{:x}{:x}", (now as u64) & 0xFFFFFFFF, rand_part & 0xFFFF)
}

/// Add a sensitive image entry.
pub async fn add_sensitive_image(
    State(state): State<AppState>,
    Json(request): Json<AddSensitiveImageRequest>,
) -> Result<Json<AddSensitiveImageResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    // Validate: at least one of image_id or url must be provided
    if request.image_id.is_none() && request.url.is_none() {
        return Err(AppError::BadRequest(
            "at least one of image_id or url must be provided".to_string(),
        ));
    }

    tracing::info!(
        image_id = ?request.image_id,
        url = ?request.url,
        reason = ?request.reason,
        flagged_by = ?request.flagged_by,
        "adding sensitive image"
    );

    let id = db
        .add_sensitive_image(
            request.image_id.as_deref(),
            request.url.as_deref(),
            request.reason.as_deref(),
            request.flagged_by.as_deref(),
        )
        .await?;

    Ok(Json(AddSensitiveImageResponse {
        id,
        message: "sensitive image added".to_string(),
    }))
}

/// Remove a sensitive image entry.
pub async fn remove_sensitive_image(
    State(state): State<AppState>,
    Json(request): Json<RemoveSensitiveImageRequest>,
) -> Result<Json<RemoveSensitiveImageResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::info!(id = request.id, "removing sensitive image");

    let removed = db.remove_sensitive_image(request.id).await?;

    let message = if removed {
        format!("sensitive image {} removed", request.id)
    } else {
        format!("sensitive image {} not found", request.id)
    };

    Ok(Json(RemoveSensitiveImageResponse { removed, message }))
}

/// Serve the admin UI HTML from static file.
pub async fn admin_ui() -> Result<Response, AppError> {
    let html = tokio::fs::read_to_string("static/admin.html").await?;
    Ok(([(CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
}

/// Render the flags list as HTML with filter controls.
fn render_flags_list(tracks: &[FlaggedTrack], current_filter: &str) -> String {
    let pending_active = if current_filter == "pending" { " active" } else { "" };
    let resolved_active = if current_filter == "resolved" { " active" } else { "" };
    let all_active = if current_filter == "all" { " active" } else { "" };

    let filter_buttons = format!(
        "<div class=\"filter-row\">\
            <span class=\"filter-label\">show:</span>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/flags-html?filter=pending\" hx-target=\"#flags-list\">pending</button>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/flags-html?filter=resolved\" hx-target=\"#flags-list\">resolved</button>\
            <button type=\"button\" class=\"filter-btn{}\" hx-get=\"/admin/flags-html?filter=all\" hx-target=\"#flags-list\">all</button>\
        </div>",
        pending_active,
        resolved_active,
        all_active,
    );

    if tracks.is_empty() {
        let empty_msg = match current_filter {
            "pending" => "no pending flags",
            "resolved" => "no resolved flags",
            _ => "no flagged tracks",
        };
        return format!(
            "{}<div class=\"empty\">{}</div>",
            filter_buttons, empty_msg
        );
    }

    let cards: Vec<String> = tracks.iter().map(render_flag_card).collect();
    format!("{}\n{}", filter_buttons, cards.join("\n"))
}

/// Extract namespace from AT URI (e.g., "fm.plyr.dev" from "at://did:plc:xxx/fm.plyr.dev.track/yyy")
fn extract_namespace(uri: &str) -> Option<&str> {
    // URI format: at://did:plc:xxx/fm.plyr[.env].track/rkey
    let collection = uri.split('/').nth(3)?;
    // Strip ".track" suffix to get namespace
    collection.strip_suffix(".track")
}

/// Determine environment from namespace
fn namespace_to_env(namespace: &str) -> Option<(&'static str, &'static str)> {
    match namespace {
        "fm.plyr" => None, // production - no badge needed
        "fm.plyr.stg" => Some(("staging", "stg")),
        "fm.plyr.dev" => Some(("development", "dev")),
        _ => Some(("unknown", "?")),
    }
}

/// Render a single flag card as HTML.
fn render_flag_card(track: &FlaggedTrack) -> String {
    let ctx = track.context.as_ref();
    let has_context = ctx.is_some_and(|c| c.track_title.is_some() || c.artist_handle.is_some());

    let track_info = if has_context {
        let c = ctx.unwrap();
        let handle = c.artist_handle.as_deref().unwrap_or("unknown");
        let title = c.track_title.as_deref().unwrap_or("unknown track");

        // Link to track if we have track_id
        let title_html = if let Some(track_id) = c.track_id {
            format!(
                r#"<a href="https://plyr.fm/track/{}" target="_blank" rel="noopener">{}</a>"#,
                track_id,
                html_escape(title)
            )
        } else {
            html_escape(title)
        };

        // Link to artist if we have handle
        let artist_link = if handle != "unknown" {
            format!(
                r#"<a href="https://plyr.fm/u/{}" target="_blank" rel="noopener">@{}</a>"#,
                html_escape(handle),
                html_escape(handle)
            )
        } else {
            format!("@{}", html_escape(handle))
        };
        format!(
            r#"<h3>{}</h3>
            <div class="artist">by {}</div>"#,
            title_html,
            artist_link
        )
    } else {
        r#"<div class="no-context">no track info available</div>"#.to_string()
    };

    // Add environment badge for non-production namespaces
    let env_badge = extract_namespace(&track.uri)
        .and_then(namespace_to_env)
        .map(|(label, short)| {
            format!(
                r#"<span class="badge env" title="{}">{}</span>"#,
                label, short
            )
        })
        .unwrap_or_default();

    // Show match count instead of score (AuDD doesn't provide scores in accurate_offsets mode)
    let match_count_badge = ctx
        .and_then(|c| c.matches.as_ref())
        .filter(|m| !m.is_empty())
        .map(|matches| {
            format!(
                r#"<span class="badge matches">{} matches</span>"#,
                matches.len()
            )
        })
        .unwrap_or_default();

    let status_badge = if track.resolved {
        r#"<span class="badge resolved">resolved</span>"#
    } else {
        r#"<span class="badge pending">pending</span>"#
    };

    let matches_html = ctx
        .and_then(|c| c.matches.as_ref())
        .filter(|m| !m.is_empty())
        .map(|matches| {
            let items: Vec<String> = matches
                .iter()
                .take(3)
                .map(|m| {
                    format!(
                        r#"<div class="match-item">
                            <span class="title">{}</span> <span class="artist">by {}</span>
                        </div>"#,
                        html_escape(&m.title),
                        html_escape(&m.artist),
                    )
                })
                .collect();
            format!(
                r#"<div class="matches">
                    <h4>potential matches</h4>
                    {}
                </div>"#,
                items.join("\n")
            )
        })
        .unwrap_or_default();

    let action_button = if track.resolved {
        // Show the resolution reason and notes if available
        let reason_text = ctx
            .and_then(|c| c.resolution_reason.as_ref())
            .map(|r| r.label())
            .unwrap_or("resolved");
        let notes_html = ctx
            .and_then(|c| c.resolution_notes.as_ref())
            .map(|n| format!(r#"<div class="resolution-notes">{}</div>"#, html_escape(n)))
            .unwrap_or_default();
        format!(
            r#"<div class="resolution-info">
                <span class="resolution-reason">{}</span>
                {}
            </div>"#,
            reason_text, notes_html
        )
    } else {
        // Multi-step flow: button -> reason select -> confirm
        format!(
            r#"<div class="resolve-flow" data-uri="{}" data-val="{}">
                <button type="button" class="btn btn-warning" onclick="showReasonSelect(this)">
                    mark false positive
                </button>
            </div>"#,
            html_escape(&track.uri),
            html_escape(&track.val)
        )
    };

    let resolved_class = if track.resolved { " resolved" } else { "" };

    format!(
        r#"<div class="flag-card{}">
            <div class="flag-header">
                <div class="track-info">
                    {}
                    <div class="uri">{}</div>
                </div>
                <div class="flag-badges">
                    {}
                    {}
                    {}
                </div>
            </div>
            {}
            <div class="flag-actions">
                {}
            </div>
        </div>"#,
        resolved_class,
        track_info,
        html_escape(&track.uri),
        env_badge,
        match_count_badge,
        status_badge,
        matches_html,
        action_button
    )
}

/// Simple HTML escaping.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}
