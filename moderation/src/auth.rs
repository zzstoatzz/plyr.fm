//! Authentication middleware.

use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use tracing::warn;

/// Auth middleware that checks X-Moderation-Key header for protected endpoints.
pub async fn auth_middleware(
    req: Request,
    next: Next,
    auth_token: Option<String>,
) -> Result<Response, StatusCode> {
    let path = req.uri().path();

    // Public endpoints - no auth required
    // Note: /admin and /review/:id serve HTML, auth is handled client-side for API calls
    // Static files must be public for admin UI CSS/JS to load
    let is_review_page = path.starts_with("/review/")
        && !path.ends_with("/data")
        && !path.ends_with("/submit");
    if path == "/"
        || path == "/health"
        || path == "/sensitive-images"
        || path == "/admin"
        || is_review_page
        || path.starts_with("/static/")
        || path.starts_with("/xrpc/com.atproto.label.")
    {
        return Ok(next.run(req).await);
    }

    let Some(expected_token) = auth_token else {
        warn!("no MODERATION_AUTH_TOKEN set - rejecting protected request");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };

    let token = req
        .headers()
        .get("X-Moderation-Key")
        .and_then(|v| v.to_str().ok());

    match token {
        Some(t) if t == expected_token => Ok(next.run(req).await),
        Some(_) => {
            warn!("invalid auth token provided");
            Err(StatusCode::UNAUTHORIZED)
        }
        None => {
            warn!("missing X-Moderation-Key header");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}
