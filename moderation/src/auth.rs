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
    // Note: /admin serves HTML, auth is handled client-side for API calls
    if path == "/"
        || path == "/health"
        || path == "/admin"
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
