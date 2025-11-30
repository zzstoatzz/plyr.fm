//! Admin API for reviewing and resolving copyright flags.

use axum::{extract::State, response::Html, Json};
use serde::{Deserialize, Serialize};

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
            max-width: 900px;
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
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid #222;
        }
        th { color: #888; font-weight: 500; }
        .uri {
            font-family: monospace;
            font-size: 0.85em;
            word-break: break-all;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.8em;
        }
        .badge.pending { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .badge.resolved { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .resolve-btn {
            background: #f59e0b;
            color: #000;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .resolve-btn:hover { background: #d97706; }
        .resolve-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
        .empty { color: #666; text-align: center; padding: 40px; }
        .loading { color: #888; }
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
        <table>
            <thead>
                <tr>
                    <th>seq</th>
                    <th>uri</th>
                    <th>label</th>
                    <th>status</th>
                    <th>action</th>
                </tr>
            </thead>
            <tbody id="flags-table">
                <tr><td colspan="5" class="loading">loading...</td></tr>
            </tbody>
        </table>
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
            const tbody = document.getElementById('flags-table');
            tbody.innerHTML = '<tr><td colspan="5" class="loading">loading...</td></tr>';

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
                    tbody.innerHTML = '<tr><td colspan="5" class="empty">no flagged tracks</td></tr>';
                    return;
                }

                tbody.innerHTML = data.tracks.map(track => `
                    <tr>
                        <td>${track.seq}</td>
                        <td class="uri">${escapeHtml(track.uri)}</td>
                        <td><span class="badge pending">${escapeHtml(track.val)}</span></td>
                        <td><span class="badge ${track.resolved ? 'resolved' : 'pending'}">${track.resolved ? 'resolved' : 'pending'}</span></td>
                        <td>
                            <button class="resolve-btn"
                                    onclick="resolveFlag('${escapeHtml(track.uri)}', '${escapeHtml(track.val)}')"
                                    ${track.resolved ? 'disabled' : ''}>
                                ${track.resolved ? 'resolved' : 'mark false positive'}
                            </button>
                        </td>
                    </tr>
                `).join('');

            } catch (err) {
                tbody.innerHTML = `<tr><td colspan="5" class="empty">error: ${err.message}</td></tr>`;
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
