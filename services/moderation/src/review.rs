//! Review endpoints for batch flag review.
//!
//! These endpoints are behind the same auth as admin endpoints.

use axum::{
    extract::{Path, State},
    http::header::CONTENT_TYPE,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::admin::FlaggedTrack;
use crate::state::{AppError, AppState};

/// Response for review page data.
#[derive(Debug, Serialize)]
pub struct ReviewPageData {
    pub batch_id: String,
    pub flags: Vec<FlaggedTrack>,
    pub status: String,
}

/// Request to submit review decisions.
#[derive(Debug, Deserialize)]
pub struct SubmitReviewRequest {
    pub decisions: Vec<ReviewDecision>,
}

/// A single review decision.
#[derive(Debug, Deserialize)]
pub struct ReviewDecision {
    pub uri: String,
    /// "clear" (false positive), "defer" (acknowledge, no action), "confirm" (real violation)
    pub decision: String,
}

/// Response after submitting review.
#[derive(Debug, Serialize)]
pub struct SubmitReviewResponse {
    pub resolved_count: usize,
    pub message: String,
}

/// Get review page HTML.
pub async fn review_page(
    State(state): State<AppState>,
    Path(batch_id): Path<String>,
) -> Result<Response, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    let batch = db
        .get_batch(&batch_id)
        .await?
        .ok_or(AppError::NotFound("batch not found".to_string()))?;

    let flags = db.get_batch_flags(&batch_id).await?;
    let html = render_review_page(&batch_id, &flags, &batch.status);

    Ok(([(CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response())
}

/// Get review data as JSON.
pub async fn review_data(
    State(state): State<AppState>,
    Path(batch_id): Path<String>,
) -> Result<Json<ReviewPageData>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    let batch = db
        .get_batch(&batch_id)
        .await?
        .ok_or(AppError::NotFound("batch not found".to_string()))?;

    let flags = db.get_batch_flags(&batch_id).await?;

    Ok(Json(ReviewPageData {
        batch_id,
        flags,
        status: batch.status,
    }))
}

/// Submit review decisions.
pub async fn submit_review(
    State(state): State<AppState>,
    Path(batch_id): Path<String>,
    Json(request): Json<SubmitReviewRequest>,
) -> Result<Json<SubmitReviewResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state
        .signer
        .as_ref()
        .ok_or(AppError::LabelerNotConfigured)?;

    let _batch = db
        .get_batch(&batch_id)
        .await?
        .ok_or(AppError::NotFound("batch not found".to_string()))?;

    let mut resolved_count = 0;

    for decision in &request.decisions {
        tracing::info!(
            batch_id = %batch_id,
            uri = %decision.uri,
            decision = %decision.decision,
            "processing review decision"
        );

        db.mark_flag_reviewed(&batch_id, &decision.uri, &decision.decision)
            .await?;

        match decision.decision.as_str() {
            "clear" => {
                // False positive - emit negation label to clear the flag
                let label =
                    crate::labels::Label::new(signer.did(), &decision.uri, "copyright-violation")
                        .negated();
                let label = signer.sign_label(label)?;
                let seq = db.store_label(&label).await?;

                db.store_resolution(
                    &decision.uri,
                    crate::db::ResolutionReason::FingerprintNoise,
                    Some("batch review: cleared"),
                )
                .await?;

                if let Some(tx) = &state.label_tx {
                    let _ = tx.send((seq, label));
                }

                resolved_count += 1;
            }
            "defer" => {
                // Acknowledge but take no action - flag stays active
                // Just mark as reviewed in the batch, no label changes
                tracing::info!(uri = %decision.uri, "deferred - no action taken");
            }
            "confirm" => {
                // Real violation - flag stays active, could add enforcement later
                tracing::info!(uri = %decision.uri, "confirmed as violation");
            }
            _ => {
                tracing::warn!(uri = %decision.uri, decision = %decision.decision, "unknown decision type");
            }
        }
    }

    let pending = db.get_batch_pending_uris(&batch_id).await?;
    if pending.is_empty() {
        db.update_batch_status(&batch_id, "completed").await?;
    }

    Ok(Json(SubmitReviewResponse {
        resolved_count,
        message: format!(
            "processed {} decisions, resolved {} flags",
            request.decisions.len(),
            resolved_count
        ),
    }))
}

/// Render the review page.
fn render_review_page(batch_id: &str, flags: &[FlaggedTrack], status: &str) -> String {
    let pending: Vec<_> = flags.iter().filter(|f| !f.resolved).collect();
    let resolved: Vec<_> = flags.iter().filter(|f| f.resolved).collect();

    let pending_cards: Vec<String> = pending.iter().map(|f| render_review_card(f)).collect();
    let resolved_cards: Vec<String> = resolved.iter().map(|f| render_review_card(f)).collect();

    let pending_html = if pending_cards.is_empty() {
        "<div class=\"empty\">all flags reviewed!</div>".to_string()
    } else {
        pending_cards.join("\n")
    };

    let resolved_html = if resolved_cards.is_empty() {
        String::new()
    } else {
        format!(
            r#"<details class="resolved-section">
                <summary>{} resolved</summary>
                {}
            </details>"#,
            resolved_cards.len(),
            resolved_cards.join("\n")
        )
    };

    let status_badge = if status == "completed" {
        r#"<span class="badge resolved">completed</span>"#
    } else {
        ""
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>review batch - plyr.fm</title>
    <link rel="stylesheet" href="/static/admin.css">
    <style>{}</style>
</head>
<body>
    <h1>plyr.fm moderation</h1>
    <p class="subtitle">
        <a href="/admin">← back to dashboard</a>
        <span style="margin: 0 12px; color: var(--text-muted);">|</span>
        batch review: {} pending {}
    </p>

    <div class="auth-section" id="auth-section">
        <input type="password" id="auth-token" placeholder="auth token"
               onkeyup="if(event.key==='Enter')authenticate()">
        <button class="btn btn-primary" onclick="authenticate()">authenticate</button>
    </div>

    <form id="review-form" style="display: none;">
        <div class="flags-list">
            {}
        </div>

        {}

        <div class="submit-bar">
            <button type="submit" class="btn btn-primary" id="submit-btn" disabled>
                submit decisions
            </button>
        </div>
    </form>

    <script>
        const form = document.getElementById('review-form');
        const submitBtn = document.getElementById('submit-btn');
        const authSection = document.getElementById('auth-section');
        const batchId = '{}';

        let currentToken = '';
        const decisions = {{}};

        function authenticate() {{
            const token = document.getElementById('auth-token').value;
            if (token && token !== '••••••••') {{
                localStorage.setItem('mod_token', token);
                currentToken = token;
                showReviewForm();
            }}
        }}

        function showReviewForm() {{
            authSection.style.display = 'none';
            form.style.display = 'block';
        }}

        // Check for saved token on load
        const savedToken = localStorage.getItem('mod_token');
        if (savedToken) {{
            currentToken = savedToken;
            document.getElementById('auth-token').value = '••••••••';
            showReviewForm();
        }}

        function updateSubmitBtn() {{
            const count = Object.keys(decisions).length;
            submitBtn.disabled = count === 0;
            submitBtn.textContent = count > 0 ? `submit ${{count}} decision${{count > 1 ? 's' : ''}}` : 'submit decisions';
        }}

        function setDecision(uri, decision) {{
            // Toggle off if clicking the same decision
            if (decisions[uri] === decision) {{
                delete decisions[uri];
                const card = document.querySelector(`[data-uri="${{CSS.escape(uri)}}"]`);
                if (card) card.classList.remove('decision-clear', 'decision-defer', 'decision-confirm');
            }} else {{
                decisions[uri] = decision;
                const card = document.querySelector(`[data-uri="${{CSS.escape(uri)}}"]`);
                if (card) {{
                    card.classList.remove('decision-clear', 'decision-defer', 'decision-confirm');
                    card.classList.add('decision-' + decision);
                }}
            }}
            updateSubmitBtn();
        }}

        form.addEventListener('submit', async (e) => {{
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'submitting...';

            try {{
                const response = await fetch(`/admin/review/${{batchId}}/submit`, {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json',
                        'X-Moderation-Key': currentToken
                    }},
                    body: JSON.stringify({{
                        decisions: Object.entries(decisions).map(([uri, decision]) => ({{ uri, decision }}))
                    }})
                }});

                if (response.status === 401) {{
                    localStorage.removeItem('mod_token');
                    currentToken = '';
                    authSection.style.display = 'block';
                    form.style.display = 'none';
                    document.getElementById('auth-token').value = '';
                    alert('invalid token');
                    return;
                }}

                if (response.ok) {{
                    const result = await response.json();
                    alert(result.message);
                    location.reload();
                }} else {{
                    const err = await response.json();
                    alert('error: ' + (err.message || 'unknown error'));
                    submitBtn.disabled = false;
                    updateSubmitBtn();
                }}
            }} catch (err) {{
                alert('network error: ' + err.message);
                submitBtn.disabled = false;
                updateSubmitBtn();
            }}
        }});
    </script>
</body>
</html>"#,
        REVIEW_CSS,
        pending.len(),
        status_badge,
        pending_html,
        resolved_html,
        html_escape(batch_id)
    )
}

/// Render a single review card.
fn render_review_card(track: &FlaggedTrack) -> String {
    let ctx = track.context.as_ref();

    let title = ctx
        .and_then(|c| c.track_title.as_deref())
        .unwrap_or("unknown track");
    let artist = ctx
        .and_then(|c| c.artist_handle.as_deref())
        .unwrap_or("unknown");
    let track_id = ctx.and_then(|c| c.track_id);

    let title_html = if let Some(id) = track_id {
        format!(
            r#"<a href="https://plyr.fm/track/{}" target="_blank">{}</a>"#,
            id,
            html_escape(title)
        )
    } else {
        html_escape(title)
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
                        r#"<div class="match-item"><span class="title">{}</span> <span class="artist">by {}</span></div>"#,
                        html_escape(&m.title),
                        html_escape(&m.artist)
                    )
                })
                .collect();
            format!(
                r#"<div class="matches"><h4>potential matches</h4>{}</div>"#,
                items.join("\n")
            )
        })
        .unwrap_or_default();

    let resolved_badge = if track.resolved {
        r#"<span class="badge resolved">resolved</span>"#
    } else {
        r#"<span class="badge pending">pending</span>"#
    };

    let action_buttons = if !track.resolved {
        format!(
            r#"<div class="flag-actions">
                <button type="button" class="btn btn-clear" onclick="setDecision('{}', 'clear')">clear</button>
                <button type="button" class="btn btn-defer" onclick="setDecision('{}', 'defer')">defer</button>
                <button type="button" class="btn btn-confirm" onclick="setDecision('{}', 'confirm')">confirm</button>
            </div>"#,
            html_escape(&track.uri),
            html_escape(&track.uri),
            html_escape(&track.uri)
        )
    } else {
        String::new()
    };

    format!(
        r#"<div class="flag-card{}" data-uri="{}">
            <div class="flag-header">
                <div class="track-info">
                    <h3>{}</h3>
                    <div class="artist">@{}</div>
                </div>
                <div class="flag-badges">
                    {}
                </div>
            </div>
            {}
            {}
        </div>"#,
        if track.resolved { " resolved" } else { "" },
        html_escape(&track.uri),
        title_html,
        html_escape(artist),
        resolved_badge,
        matches_html,
        action_buttons
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}

/// Additional CSS for review page (supplements admin.css)
const REVIEW_CSS: &str = r#"
/* review page specific styles */
body { padding-bottom: 80px; }

.subtitle a {
    color: var(--accent);
    text-decoration: none;
}
.subtitle a:hover { text-decoration: underline; }

/* action buttons */
.btn-clear {
    background: rgba(74, 222, 128, 0.15);
    color: var(--success);
    border: 1px solid rgba(74, 222, 128, 0.3);
}
.btn-clear:hover {
    background: rgba(74, 222, 128, 0.25);
}

.btn-defer {
    background: rgba(251, 191, 36, 0.15);
    color: var(--warning);
    border: 1px solid rgba(251, 191, 36, 0.3);
}
.btn-defer:hover {
    background: rgba(251, 191, 36, 0.25);
}

.btn-confirm {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error);
    border: 1px solid rgba(239, 68, 68, 0.3);
}
.btn-confirm:hover {
    background: rgba(239, 68, 68, 0.25);
}

/* card selection states */
.flag-card.decision-clear {
    border-color: var(--success);
    background: rgba(74, 222, 128, 0.05);
}
.flag-card.decision-defer {
    border-color: var(--warning);
    background: rgba(251, 191, 36, 0.05);
}
.flag-card.decision-confirm {
    border-color: var(--error);
    background: rgba(239, 68, 68, 0.05);
}

/* submit bar */
.submit-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 16px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-subtle);
}
.submit-bar .btn {
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    display: block;
    padding: 14px;
}

/* resolved section */
.resolved-section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
}
.resolved-section summary {
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: 0.85rem;
    margin-bottom: 12px;
}
"#;
