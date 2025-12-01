//! HTTP request handlers for core endpoints.

use axum::{extract::State, response::Html, Json};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::{CopyrightMatch, LabelContext};
use crate::labels::Label;
use crate::state::{AppError, AppState};

// --- types ---

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub labeler_enabled: bool,
}

/// Context info for display in admin UI.
#[derive(Debug, Deserialize)]
pub struct EmitLabelContext {
    pub track_title: Option<String>,
    pub artist_handle: Option<String>,
    pub artist_did: Option<String>,
    pub highest_score: Option<f64>,
    pub matches: Option<Vec<CopyrightMatch>>,
}

#[derive(Debug, Deserialize)]
pub struct EmitLabelRequest {
    /// AT URI of the resource to label (e.g., at://did:plc:xxx/fm.plyr.track/abc123)
    pub uri: String,
    /// Label value (e.g., "copyright-violation")
    #[serde(default = "default_label_val")]
    pub val: String,
    /// Optional CID of specific version
    pub cid: Option<String>,
    /// If true, negate an existing label
    #[serde(default)]
    pub neg: bool,
    /// Optional context for admin UI display
    pub context: Option<EmitLabelContext>,
}

fn default_label_val() -> String {
    "copyright-violation".to_string()
}

/// Normalize a score from integer (0-100) to float (0.0-1.0) range.
/// AuDD returns scores as integers like 85 meaning 85%.
fn normalize_score(score: f64) -> f64 {
    if score > 1.0 {
        score / 100.0
    } else {
        score
    }
}

#[derive(Debug, Serialize)]
pub struct EmitLabelResponse {
    pub seq: i64,
    pub label: Label,
}

// --- handlers ---

/// Health check endpoint.
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        labeler_enabled: state.db.is_some(),
    })
}

/// Landing page with service info.
pub async fn landing(State(state): State<AppState>) -> Html<String> {
    let labeler_did = state
        .signer
        .as_ref()
        .map(|s| s.did().to_string())
        .unwrap_or_else(|| "not configured".to_string());

    Html(format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>plyr.fm moderation</title>
    <style>
        body {{
            font-family: system-ui, -apple-system, sans-serif;
            background: #0a0a0a;
            color: #e5e5e5;
            max-width: 600px;
            margin: 80px auto;
            padding: 20px;
            line-height: 1.6;
        }}
        h1 {{ color: #fff; margin-bottom: 8px; }}
        .subtitle {{ color: #888; margin-bottom: 32px; }}
        a {{ color: #3b82f6; }}
        code {{
            background: #1a1a1a;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
        }}
        .endpoint {{
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
        }}
        .endpoint-name {{ color: #10b981; font-family: monospace; }}
    </style>
</head>
<body>
    <h1>plyr.fm moderation</h1>
    <p class="subtitle">ATProto labeler for audio content moderation</p>

    <p>This service provides content labels for <a href="https://plyr.fm">plyr.fm</a>,
    the music streaming platform on ATProto.</p>

    <p><strong>Labeler DID:</strong> <code>{}</code></p>

    <h2>Endpoints</h2>

    <div class="endpoint">
        <div class="endpoint-name">GET /xrpc/com.atproto.label.queryLabels</div>
        <p>Query labels by URI pattern</p>
    </div>

    <div class="endpoint">
        <div class="endpoint-name">GET /xrpc/com.atproto.label.subscribeLabels</div>
        <p>WebSocket subscription for real-time label updates</p>
    </div>

    <p style="margin-top: 32px; color: #666;">
        <a href="https://bsky.app/profile/moderation.plyr.fm">@moderation.plyr.fm</a>
    </p>
</body>
</html>"#,
        labeler_did
    ))
}

/// Emit a new label (internal API).
pub async fn emit_label(
    State(state): State<AppState>,
    Json(request): Json<EmitLabelRequest>,
) -> Result<Json<EmitLabelResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state
        .signer
        .as_ref()
        .ok_or(AppError::LabelerNotConfigured)?;

    info!(uri = %request.uri, val = %request.val, neg = request.neg, "emitting label");

    // Create and sign the label
    let mut label = Label::new(signer.did(), &request.uri, &request.val);
    if let Some(cid) = request.cid {
        label = label.with_cid(cid);
    }
    if request.neg {
        label = label.negated();
    }
    let label = signer.sign_label(label)?;

    // Store in database
    let seq = db.store_label(&label).await?;
    info!(seq, uri = %request.uri, "label stored");

    // Store context if provided (for admin UI)
    if let Some(ctx) = request.context {
        let label_ctx = LabelContext {
            track_title: ctx.track_title,
            artist_handle: ctx.artist_handle,
            artist_did: ctx.artist_did,
            highest_score: ctx.highest_score.map(normalize_score),
            matches: ctx.matches.map(|matches| {
                matches
                    .into_iter()
                    .map(|mut m| {
                        m.score = normalize_score(m.score);
                        m
                    })
                    .collect()
            }),
            resolution_reason: None,
            resolution_notes: None,
        };
        if let Err(e) = db.store_context(&request.uri, &label_ctx).await {
            // Log but don't fail - context is supplementary
            tracing::warn!(uri = %request.uri, error = %e, "failed to store label context");
        }
    }

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label.clone()));
    }

    Ok(Json(EmitLabelResponse { seq, label }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_score() {
        // Integer scores (0-100) should be converted to 0.0-1.0
        assert!((normalize_score(85.0) - 0.85).abs() < 0.001);
        assert!((normalize_score(100.0) - 1.0).abs() < 0.001);
        assert!((normalize_score(50.0) - 0.5).abs() < 0.001);

        // Scores already in 0.0-1.0 range should stay unchanged
        assert!((normalize_score(0.85) - 0.85).abs() < 0.001);
        assert!((normalize_score(1.0) - 1.0).abs() < 0.001);
        assert!((normalize_score(0.5) - 0.5).abs() < 0.001);
        assert!((normalize_score(0.0) - 0.0).abs() < 0.001);
    }
}
