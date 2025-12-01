//! Admin API for reviewing and resolving copyright flags.
//!
//! Uses htmx for interactivity with server-rendered HTML.

use axum::{
    extract::State,
    http::header::CONTENT_TYPE,
    response::{Html, IntoResponse, Response},
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

/// List all flagged tracks - returns JSON for API, HTML for htmx.
pub async fn list_flagged(
    State(state): State<AppState>,
) -> Result<Json<ListFlaggedResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let tracks = db.get_pending_flags().await?;
    Ok(Json(ListFlaggedResponse { tracks }))
}

/// Render flags as HTML partial for htmx.
pub async fn list_flagged_html(State(state): State<AppState>) -> Result<Response, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let tracks = db.get_pending_flags().await?;

    let html = render_flags_list(&tracks);

    Ok(([(CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
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

/// Resolve flag and return HTML response for htmx.
pub async fn resolve_flag_htmx(
    State(state): State<AppState>,
    axum::Form(request): axum::Form<ResolveRequest>,
) -> Result<Response, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state.signer.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    tracing::info!(uri = %request.uri, val = %request.val, "resolving flag via htmx");

    // Create a negation label
    let label = crate::labels::Label::new(signer.did(), &request.uri, &request.val).negated();
    let label = signer.sign_label(label)?;

    let seq = db.store_label(&label).await?;

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label));
    }

    // Return success toast + trigger refresh
    let html = format!(
        r#"<div id="toast" class="toast success" hx-swap-oob="true">resolved (seq: {})</div>"#,
        seq
    );

    Ok((
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
        ],
        [(axum::http::header::HeaderName::from_static("hx-trigger"), "flagsUpdated")],
        html,
    )
        .into_response())
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

/// Render the flags list as HTML.
fn render_flags_list(tracks: &[FlaggedTrack]) -> String {
    if tracks.is_empty() {
        return r#"<div class="empty">no flagged tracks</div>"#.to_string();
    }

    let cards: Vec<String> = tracks.iter().map(render_flag_card).collect();
    cards.join("\n")
}

/// Render a single flag card as HTML.
fn render_flag_card(track: &FlaggedTrack) -> String {
    let ctx = track.context.as_ref();
    let has_context = ctx.map_or(false, |c| c.track_title.is_some() || c.artist_handle.is_some());

    let track_info = if has_context {
        let c = ctx.unwrap();
        format!(
            r#"<h3>{}</h3>
            <div class="artist">by @{}</div>"#,
            html_escape(c.track_title.as_deref().unwrap_or("unknown track")),
            html_escape(c.artist_handle.as_deref().unwrap_or("unknown"))
        )
    } else {
        r#"<div class="no-context">no track info available</div>"#.to_string()
    };

    let score_badge = ctx
        .and_then(|c| c.highest_score)
        .filter(|&s| s > 0.0)
        .map(|s| format!(r#"<span class="badge score">{}% match</span>"#, (s * 100.0) as i32))
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
                            <span><span class="title">{}</span> <span class="artist">by {}</span></span>
                            <span class="score">{}%</span>
                        </div>"#,
                        html_escape(&m.title),
                        html_escape(&m.artist),
                        (m.score * 100.0) as i32
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
        r#"<button class="btn btn-secondary" disabled>resolved</button>"#.to_string()
    } else {
        format!(
            r#"<form hx-post="/admin/resolve-htmx" hx-swap="none" style="display:inline">
                <input type="hidden" name="uri" value="{}">
                <input type="hidden" name="val" value="{}">
                <button type="submit" class="btn btn-warning">mark false positive</button>
            </form>"#,
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
        score_badge,
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

const ADMIN_HTML: &str = r##"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>moderation · plyr.fm</title>
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
    <style>
        /* plyr.fm design tokens */
        :root {
            --accent: #6a9fff;
            --accent-hover: #8ab3ff;
            --accent-muted: #4a7ddd;

            --bg-primary: #0a0a0a;
            --bg-secondary: #141414;
            --bg-tertiary: #1a1a1a;
            --bg-hover: #1f1f1f;

            --border-subtle: #282828;
            --border-default: #333333;
            --border-emphasis: #444444;

            --text-primary: #e8e8e8;
            --text-secondary: #b0b0b0;
            --text-tertiary: #808080;
            --text-muted: #666666;

            --success: #4ade80;
            --warning: #fbbf24;
            --error: #ef4444;
        }

        * { box-sizing: border-box; }

        body {
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
            background: var(--bg-primary);
            color: var(--text-primary);
            max-width: 900px;
            margin: 0 auto;
            padding: 24px;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }

        h1 {
            color: var(--text-primary);
            font-size: 1.5rem;
            font-weight: 600;
            margin: 0 0 4px 0;
        }

        .subtitle {
            color: var(--text-tertiary);
            margin: 0 0 32px 0;
            font-size: 0.9rem;
        }

        /* auth form */
        .auth-section {
            background: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }

        .auth-section input[type="password"] {
            font-family: inherit;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-default);
            color: var(--text-primary);
            padding: 10px 14px;
            border-radius: 6px;
            width: 280px;
            font-size: 0.9rem;
        }

        .auth-section input:focus {
            outline: none;
            border-color: var(--accent);
        }

        /* buttons */
        .btn {
            font-family: inherit;
            font-size: 0.85rem;
            font-weight: 500;
            padding: 10px 16px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .btn-primary {
            background: var(--accent);
            color: var(--bg-primary);
        }
        .btn-primary:hover { background: var(--accent-hover); }

        .btn-secondary {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border: 1px solid var(--border-default);
        }
        .btn-secondary:hover {
            background: var(--bg-hover);
            border-color: var(--border-emphasis);
        }

        .btn-warning {
            background: var(--warning);
            color: var(--bg-primary);
        }
        .btn-warning:hover {
            background: #d97706;
        }

        .btn:disabled {
            background: var(--bg-tertiary);
            color: var(--text-muted);
            cursor: not-allowed;
            border: 1px solid var(--border-subtle);
        }

        /* header row */
        .header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
        }

        .header-row h2 {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 500;
            color: var(--text-primary);
        }

        /* flags list */
        .flags-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .flag-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: 8px;
            padding: 20px;
        }

        .flag-card.resolved {
            opacity: 0.5;
        }

        .flag-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
        }

        .track-info {
            flex: 1;
            min-width: 0;
        }

        .track-info h3 {
            margin: 0 0 4px 0;
            font-size: 1rem;
            font-weight: 500;
            color: var(--text-primary);
        }

        .track-info .artist {
            color: var(--text-secondary);
            font-size: 0.9rem;
        }

        .track-info .uri {
            font-size: 0.75rem;
            color: var(--text-muted);
            word-break: break-all;
            margin-top: 8px;
        }

        .flag-badges {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }

        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .badge.pending {
            background: rgba(251, 191, 36, 0.15);
            color: var(--warning);
        }

        .badge.resolved {
            background: rgba(74, 222, 128, 0.15);
            color: var(--success);
        }

        .badge.score {
            background: rgba(239, 68, 68, 0.15);
            color: var(--error);
        }

        /* matches section */
        .matches {
            background: var(--bg-primary);
            border-radius: 6px;
            padding: 14px;
            margin-top: 16px;
        }

        .matches h4 {
            margin: 0 0 10px 0;
            color: var(--text-tertiary);
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: lowercase;
        }

        .match-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-subtle);
            font-size: 0.85rem;
        }

        .match-item:last-child { border-bottom: none; }

        .match-item .title {
            color: var(--text-primary);
        }

        .match-item .artist {
            color: var(--text-tertiary);
        }

        .match-item .score {
            color: var(--error);
            font-weight: 500;
        }

        /* actions */
        .flag-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border-subtle);
        }

        /* states */
        .empty, .loading {
            color: var(--text-muted);
            text-align: center;
            padding: 48px 24px;
        }

        .no-context {
            color: var(--text-muted);
            font-style: italic;
        }

        /* toast */
        .toast {
            position: fixed;
            bottom: 24px;
            left: 24px;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 0.85rem;
            animation: fadeInUp 0.2s ease, fadeOut 0.3s ease 2.7s forwards;
        }

        .toast.success {
            background: rgba(74, 222, 128, 0.15);
            color: var(--success);
            border: 1px solid rgba(74, 222, 128, 0.3);
        }

        .toast.error {
            background: rgba(239, 68, 68, 0.15);
            color: var(--error);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeOut {
            to { opacity: 0; }
        }

        /* htmx indicator */
        .htmx-indicator {
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .htmx-request .htmx-indicator {
            opacity: 1;
        }
        .htmx-request.htmx-indicator {
            opacity: 1;
        }

        /* mobile */
        @media (max-width: 640px) {
            body { padding: 16px; }
            .auth-section input[type="password"] { width: 100%; margin-bottom: 12px; }
            .flag-header { flex-direction: column; }
            .flag-badges { margin-top: 12px; }
        }
    </style>
</head>
<body>
    <h1>moderation</h1>
    <p class="subtitle">review and resolve copyright flags</p>

    <div class="auth-section">
        <input type="password"
               id="auth-token"
               placeholder="auth token"
               onkeyup="if(event.key==='Enter')authenticate()">
        <button class="btn btn-primary" onclick="authenticate()" style="margin-left: 10px">
            authenticate
        </button>
    </div>

    <div id="main-content" style="display: none;">
        <div class="header-row">
            <h2>flagged tracks</h2>
            <button class="btn btn-secondary"
                    hx-get="/admin/flags-html"
                    hx-target="#flags-list"
                    hx-indicator="#refresh-indicator">
                <span id="refresh-indicator" class="htmx-indicator">...</span>
                refresh
            </button>
        </div>

        <div id="flags-list" class="flags-list"
             hx-get="/admin/flags-html"
             hx-trigger="load, flagsUpdated from:body"
             hx-indicator="#loading">
            <div id="loading" class="loading htmx-indicator">loading...</div>
        </div>
    </div>

    <div id="toast"></div>

    <script>
        // Check for saved token
        const savedToken = localStorage.getItem('mod_token');
        if (savedToken) {
            document.getElementById('auth-token').value = '••••••••';
            showMain();
            setAuthHeader(savedToken);
        }

        function authenticate() {
            const token = document.getElementById('auth-token').value;
            if (token && token !== '••••••••') {
                localStorage.setItem('mod_token', token);
                setAuthHeader(token);
                showMain();
                htmx.trigger('#flags-list', 'load');
            }
        }

        function showMain() {
            document.getElementById('main-content').style.display = 'block';
        }

        function setAuthHeader(token) {
            document.body.addEventListener('htmx:configRequest', function(evt) {
                evt.detail.headers['X-Moderation-Key'] = token;
            });
        }

        // Handle auth errors
        document.body.addEventListener('htmx:responseError', function(evt) {
            if (evt.detail.xhr.status === 401) {
                localStorage.removeItem('mod_token');
                showToast('invalid token', 'error');
            }
        });

        function showToast(message, type) {
            const toast = document.getElementById('toast');
            toast.className = 'toast ' + type;
            toast.textContent = message;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 3000);
        }
    </script>
</body>
</html>
"##;
