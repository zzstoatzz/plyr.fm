//! Admin API for reviewing and resolving copyright flags.

use axum::{extract::State, response::Html, Json};
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
    /// If there's a negation label for this URI+val, it's been resolved.
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

/// Request to resolve (negate) a flag.
#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub uri: String,
    #[serde(default = "default_val")]
    pub val: String,
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

/// List all flagged tracks (copyright-violation labels without negations).
pub async fn list_flagged(
    State(state): State<AppState>,
) -> Result<Json<ListFlaggedResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    let tracks = db.get_pending_flags().await?;

    Ok(Json(ListFlaggedResponse { tracks }))
}

/// Resolve (negate) a copyright flag, marking it as a false positive.
pub async fn resolve_flag(
    State(state): State<AppState>,
    Json(request): Json<ResolveRequest>,
) -> Result<Json<ResolveResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state.signer.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::info!(uri = %request.uri, val = %request.val, "resolving flag (creating negation)");

    // Create a negation label
    let label = crate::labels::Label::new(signer.did(), &request.uri, &request.val).negated();
    let label = signer.sign_label(label)?;

    let seq = db.store_label(&label).await?;

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label));
    }

    Ok(Json(ResolveResponse {
        seq,
        message: format!("created negation label for {}", request.uri),
    }))
}

/// Store context for a label (for backfill without re-emitting labels).
pub async fn store_context(
    State(state): State<AppState>,
    Json(request): Json<StoreContextRequest>,
) -> Result<Json<StoreContextResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::info!(uri = %request.uri, "storing label context");

    let label_ctx = LabelContext {
        track_title: request.context.track_title,
        artist_handle: request.context.artist_handle,
        artist_did: request.context.artist_did,
        highest_score: request.context.highest_score,
        matches: request.context.matches,
    };

    db.store_context(&request.uri, &label_ctx).await?;

    Ok(Json(StoreContextResponse {
        message: format!("context stored for {}", request.uri),
    }))
}

/// Serve the admin UI HTML.
pub async fn admin_ui() -> Html<&'static str> {
    Html(ADMIN_HTML)
}

const ADMIN_HTML: &str = r##"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>plyr.fm moderation admin</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #0a0a0a;
            color: #e5e5e5;
            max-width: 1100px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
        }
        h1 { color: #fff; margin-bottom: 8px; }
        .subtitle { color: #888; margin-bottom: 24px; }
        .auth-form {
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }
        .auth-form input {
            background: #1a1a1a;
            border: 1px solid #333;
            color: #fff;
            padding: 8px 12px;
            border-radius: 4px;
            width: 300px;
            margin-right: 8px;
        }
        .auth-form button {
            background: #3b82f6;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        .auth-form button:hover { background: #2563eb; }
        .status {
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 16px;
            display: none;
        }
        .status.error { display: block; background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        .status.success { display: block; background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .flags-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .flag-card {
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            padding: 16px;
        }
        .flag-card.resolved { opacity: 0.6; }
        .flag-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        .track-info h3 {
            margin: 0 0 4px 0;
            color: #fff;
            font-size: 1.1em;
        }
        .track-info .artist {
            color: #888;
            font-size: 0.9em;
        }
        .track-info .uri {
            font-family: monospace;
            font-size: 0.75em;
            color: #666;
            word-break: break-all;
            margin-top: 4px;
        }
        .flag-badges {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.8em;
        }
        .badge.pending { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .badge.resolved { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .badge.score { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        .matches {
            background: #0a0a0a;
            border-radius: 4px;
            padding: 12px;
            margin-top: 12px;
        }
        .matches h4 {
            margin: 0 0 8px 0;
            color: #888;
            font-size: 0.85em;
            font-weight: 500;
        }
        .match-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid #1a1a1a;
            font-size: 0.9em;
        }
        .match-item:last-child { border-bottom: none; }
        .match-item .title { color: #e5e5e5; }
        .match-item .artist { color: #888; }
        .match-item .score {
            color: #ef4444;
            font-family: monospace;
        }
        .flag-actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #222;
        }
        .resolve-btn {
            background: #f59e0b;
            color: #000;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            font-weight: 500;
        }
        .resolve-btn:hover { background: #d97706; }
        .resolve-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
        .empty { color: #666; text-align: center; padding: 40px; }
        .loading { color: #888; text-align: center; padding: 40px; }
        .refresh-btn {
            background: #333;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-left: auto;
        }
        .refresh-btn:hover { background: #444; }
        .header-row {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
        }
        .header-row h2 { margin: 0; }
        .no-context { color: #666; font-style: italic; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>moderation admin</h1>
    <p class="subtitle">review and resolve copyright flags</p>

    <div class="auth-form">
        <input type="password" id="token" placeholder="moderation auth token">
        <button onclick="authenticate()">authenticate</button>
    </div>

    <div id="status" class="status"></div>

    <div id="content" style="display: none;">
        <div class="header-row">
            <h2>flagged tracks</h2>
            <button class="refresh-btn" onclick="loadFlags()">refresh</button>
        </div>
        <div id="flags-list" class="flags-list">
            <div class="loading">loading...</div>
        </div>
    </div>

    <script>
        let authToken = localStorage.getItem('moderation_token') || '';

        if (authToken) {
            document.getElementById('token').value = '••••••••';
            showContent();
            loadFlags();
        }

        function authenticate() {
            authToken = document.getElementById('token').value;
            localStorage.setItem('moderation_token', authToken);
            showContent();
            loadFlags();
        }

        function showContent() {
            document.getElementById('content').style.display = 'block';
        }

        function showStatus(message, type) {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = 'status ' + type;
        }

        async function loadFlags() {
            const container = document.getElementById('flags-list');
            container.innerHTML = '<div class="loading">loading...</div>';

            try {
                const res = await fetch('/admin/flags', {
                    headers: { 'X-Moderation-Key': authToken }
                });

                if (!res.ok) {
                    if (res.status === 401) {
                        showStatus('invalid token', 'error');
                        localStorage.removeItem('moderation_token');
                        return;
                    }
                    throw new Error('failed to load flags');
                }

                const data = await res.json();

                if (data.tracks.length === 0) {
                    container.innerHTML = '<div class="empty">no flagged tracks</div>';
                    return;
                }

                container.innerHTML = data.tracks.map(track => {
                    const ctx = track.context || {};
                    const hasContext = ctx.track_title || ctx.artist_handle;
                    const matches = ctx.matches || [];

                    return `
                        <div class="flag-card ${track.resolved ? 'resolved' : ''}">
                            <div class="flag-header">
                                <div class="track-info">
                                    ${hasContext ? `
                                        <h3>${escapeHtml(ctx.track_title || 'unknown track')}</h3>
                                        <div class="artist">by @${escapeHtml(ctx.artist_handle || 'unknown')}</div>
                                    ` : `
                                        <div class="no-context">no track info available</div>
                                    `}
                                    <div class="uri">${escapeHtml(track.uri)}</div>
                                </div>
                                <div class="flag-badges">
                                    ${ctx.highest_score ? `<span class="badge score">${(ctx.highest_score * 100).toFixed(0)}% match</span>` : ''}
                                    <span class="badge ${track.resolved ? 'resolved' : 'pending'}">${track.resolved ? 'resolved' : 'pending'}</span>
                                </div>
                            </div>
                            ${matches.length > 0 ? `
                                <div class="matches">
                                    <h4>potential matches</h4>
                                    ${matches.slice(0, 3).map(m => `
                                        <div class="match-item">
                                            <span><span class="title">${escapeHtml(m.title)}</span> <span class="artist">by ${escapeHtml(m.artist)}</span></span>
                                            <span class="score">${(m.score * 100).toFixed(0)}%</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                            <div class="flag-actions">
                                <button class="resolve-btn"
                                        onclick="resolveFlag('${escapeHtml(track.uri)}', '${escapeHtml(track.val)}')"
                                        ${track.resolved ? 'disabled' : ''}>
                                    ${track.resolved ? 'resolved' : 'mark false positive'}
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

            } catch (err) {
                container.innerHTML = `<div class="empty">error: ${err.message}</div>`;
            }
        }

        async function resolveFlag(uri, val) {
            try {
                const res = await fetch('/admin/resolve', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Moderation-Key': authToken
                    },
                    body: JSON.stringify({ uri, val })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.message || 'failed to resolve');
                }

                showStatus('flag resolved successfully', 'success');
                loadFlags();

            } catch (err) {
                showStatus(err.message, 'error');
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
        }
    </script>
</body>
</html>
"##;
