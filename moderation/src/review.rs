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
    pub decision: String, // "approved" or "rejected"
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

        if decision.decision == "approved" {
            let label =
                crate::labels::Label::new(signer.did(), &decision.uri, "copyright-violation")
                    .negated();
            let label = signer.sign_label(label)?;
            let seq = db.store_label(&label).await?;

            db.store_resolution(
                &decision.uri,
                crate::db::ResolutionReason::FingerprintNoise,
                Some("batch review"),
            )
            .await?;

            if let Some(tx) = &state.label_tx {
                let _ = tx.send((seq, label));
            }

            resolved_count += 1;
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
        r#"<span class="status-badge completed">completed</span>"#
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
    <style>{}</style>
</head>
<body>
    <div class="container">
        <header>
            <h1>plyr.fm moderation</h1>
            <div class="batch-info">{} pending {}</div>
        </header>

        <div class="auth-section" id="auth-section">
            <input type="password" id="auth-token" placeholder="auth token"
                   onkeyup="if(event.key==='Enter')authenticate()">
            <button class="btn-submit" onclick="authenticate()">authenticate</button>
        </div>

        <form id="review-form" class="review-form" style="display: none;">
            <div class="flags-list">
                {}
            </div>

            {}

            <div class="submit-bar">
                <button type="submit" class="btn-submit" id="submit-btn" disabled>
                    submit decisions
                </button>
            </div>
        </form>
    </div>

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
            decisions[uri] = decision;
            const card = document.querySelector(`[data-uri="${{CSS.escape(uri)}}"]`);
            if (card) {{
                card.classList.remove('approved', 'rejected');
                card.classList.add(decision);
            }}
            updateSubmitBtn();
        }}

        form.addEventListener('submit', async (e) => {{
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'submitting...';

            try {{
                const response = await fetch(`/review/${{batchId}}/submit`, {{
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
                    authSection.style.display = 'flex';
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
                .take(2)
                .map(|m| {
                    format!(
                        r#"<span class="match">{} - {}</span>"#,
                        html_escape(&m.title),
                        html_escape(&m.artist)
                    )
                })
                .collect();
            format!(r#"<div class="matches">{}</div>"#, items.join(""))
        })
        .unwrap_or_default();

    let resolved_badge = if track.resolved {
        r#"<span class="badge resolved">resolved</span>"#
    } else {
        ""
    };

    let action_buttons = if !track.resolved {
        format!(
            r#"<div class="actions">
                <button type="button" class="btn-approve" onclick="setDecision('{}', 'approved')">approve</button>
                <button type="button" class="btn-reject" onclick="setDecision('{}', 'rejected')">reject</button>
            </div>"#,
            html_escape(&track.uri),
            html_escape(&track.uri)
        )
    } else {
        String::new()
    };

    format!(
        r#"<div class="review-card{}" data-uri="{}">
            <div class="track-info">
                <div class="title">{}</div>
                <div class="artist">@{}</div>
                {}
            </div>
            {}
            {}
        </div>"#,
        if track.resolved { " resolved" } else { "" },
        html_escape(&track.uri),
        title_html,
        html_escape(artist),
        matches_html,
        resolved_badge,
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

const REVIEW_CSS: &str = r#"
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    min-height: 100vh;
}

.container {
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
    padding-bottom: 80px;
}

header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid #333;
}

h1 { font-size: 1.25rem; font-weight: 600; color: #fff; }
.batch-info { font-size: 0.875rem; color: #888; }
.status-badge { font-size: 0.7rem; background: #1a3a1a; color: #6d9; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }

.auth-section {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    align-items: center;
}
.auth-section input[type="password"] {
    flex: 1;
    padding: 10px 12px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #fff;
    font-size: 0.875rem;
}
.auth-section input:focus {
    outline: none;
    border-color: #4a9eff;
}

.flags-list { display: flex; flex-direction: column; gap: 12px; }

.review-card {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 12px;
    transition: border-color 0.2s, background 0.2s;
}

.review-card.approved { border-color: #2d5a27; background: #1a2a18; }
.review-card.rejected { border-color: #5a2727; background: #2a1818; }
.review-card.resolved { opacity: 0.6; }
.track-info { margin-bottom: 8px; }
.title { font-weight: 600; font-size: 1rem; margin-bottom: 2px; }
.title a { color: inherit; text-decoration: none; }
.title a:hover { text-decoration: underline; }
.artist { font-size: 0.875rem; color: #888; }
.matches { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.match { font-size: 0.75rem; background: #2a2a2a; padding: 2px 6px; border-radius: 4px; color: #aaa; }
.badge { display: inline-block; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 500; }
.badge.resolved { background: #1a3a1a; color: #6d9; }
.actions { display: flex; gap: 8px; margin-top: 10px; }
.actions button { flex: 1; padding: 10px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
.btn-approve { background: #2d5a27; color: #fff; }
.btn-reject { background: #5a2727; color: #fff; }
.actions button:active { opacity: 0.8; }

.submit-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 12px 16px;
    background: #111;
    border-top: 1px solid #333;
}

.btn-submit {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    display: block;
    padding: 14px;
    background: #4a9eff;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
}

.btn-submit:disabled { background: #333; color: #666; cursor: not-allowed; }
.empty { text-align: center; padding: 40px 20px; color: #666; }
.resolved-section { margin-top: 20px; border-top: 1px solid #333; padding-top: 16px; }
.resolved-section summary { cursor: pointer; color: #888; font-size: 0.875rem; margin-bottom: 12px; }
"#;
