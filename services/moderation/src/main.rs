//! plyr.fm moderation service
//!
//! Provides:
//! - AuDD audio fingerprinting for copyright detection
//! - ATProto labeler endpoints (queryLabels, subscribeLabels)
//! - Label emission for copyright violations
//! - Admin UI for reviewing and resolving flags

use std::{net::SocketAddr, sync::Arc};

use anyhow::anyhow;
use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use tokio::{net::TcpListener, sync::broadcast};
use tower_http::services::ServeDir;
use tracing::{info, warn};

mod admin;
mod audd;
mod auth;
mod claude;
mod config;
mod db;
mod events;
mod handlers;
mod labels;
mod reports;
mod review;
mod state;
mod xrpc;

pub use state::{AppError, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let config = config::Config::from_env()?;
    let auth_token = config.auth_token.clone();

    // Initialize labeler components if configured
    let (db, signer, label_tx) = if config.labeler_enabled() {
        let db = db::LabelDb::connect(config.database_url.as_ref().unwrap()).await?;
        db.migrate().await?;
        db.migrate_events().await?;
        info!("labeler database connected and migrated");

        let signer = labels::LabelSigner::from_hex(
            config.labeler_signing_key.as_ref().unwrap(),
            config.labeler_did.as_ref().unwrap(),
        )?;
        info!(did = %signer.did(), "labeler signer initialized");

        let (tx, _) = broadcast::channel::<(i64, labels::Label)>(1024);
        (Some(db), Some(signer), Some(tx))
    } else {
        warn!("labeler not configured - XRPC endpoints will return 503");
        (None, None, None)
    };

    // Initialize Claude client for image moderation if configured
    let claude_client = if config.claude_enabled() {
        let client = claude::ClaudeClient::new(
            config.claude_api_key.clone().unwrap(),
            Some(config.claude_model.clone()),
        );
        info!(model = %config.claude_model, "claude image moderation enabled");
        Some(client)
    } else {
        warn!("claude not configured - /scan-image endpoint will return 503");
        None
    };

    let state = AppState {
        audd_api_token: config.audd_api_token,
        audd_api_url: config.audd_api_url,
        db: db.map(Arc::new),
        signer: signer.map(Arc::new),
        label_tx,
        claude: claude_client.map(Arc::new),
        copyright_score_threshold: config.copyright_score_threshold,
        copyright_mix_song_threshold: config.copyright_mix_song_threshold,
    };

    let app = build_router(state, auth_token);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| anyhow!("invalid bind addr: {e}"))?;
    info!(%addr, "moderation service listening");

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// Service-to-service endpoints the backend calls.
///
/// Served under `/internal`, and — for one deploy cycle — also under the
/// legacy `/admin` prefix so the backend and this service can deploy
/// independently. Remove the `/admin` mount once the backend client has
/// moved (#1691).
fn machine_api() -> Router<AppState> {
    Router::new()
        .route("/active-labels", post(admin::get_active_labels))
        .route("/labels", post(admin::get_label_values))
        .route("/labels-by-value", post(admin::get_labels_by_value))
        .route("/negated-labels", post(admin::get_negated_labels))
        .route("/sensitive-images", post(admin::add_sensitive_image))
        .route(
            "/sensitive-images/remove",
            post(admin::remove_sensitive_image),
        )
}

/// Service-to-service endpoints added after the split.
///
/// Deliberately not aliased under `/admin`: the aliases exist only so the
/// endpoints that predate #1691 survive one deploy cycle, and a route born
/// on `/internal` has no legacy caller to keep working.
fn internal_only_api() -> Router<AppState> {
    Router::new()
        .route("/events", post(events::record_event))
        .route("/overrides", get(events::active_overrides))
        .route("/events-since", get(events::events_since))
        .route("/events-head", get(events::events_head))
}

fn build_router(state: AppState, auth_token: Option<String>) -> Router {
    Router::new()
        // Landing page
        .route("/", get(handlers::landing))
        // Health check
        .route("/health", get(handlers::health))
        // Sensitive images (public)
        .route("/sensitive-images", get(handlers::get_sensitive_images))
        // AuDD scanning
        .route("/scan", post(audd::scan))
        // Image moderation via Claude
        .route("/scan-image", post(handlers::scan_image))
        // Label emission (internal API)
        .route("/emit-label", post(handlers::emit_label))
        // Service-to-service API
        .nest("/internal", machine_api())
        .nest("/internal", internal_only_api())
        .nest("/admin", machine_api())
        // Admin UI and API
        .route("/admin", get(admin::admin_ui))
        .route("/admin/flags", get(admin::list_flagged))
        .route("/admin/flags-html", get(admin::list_flagged_html))
        .route("/admin/resolve", post(admin::resolve_flag))
        .route("/admin/resolve-htmx", post(admin::resolve_flag_htmx))
        .route("/admin/context", post(admin::store_context))
        .route("/admin/batches", post(admin::create_batch))
        // review queue + decision log
        .route("/admin/queue", get(events::review_queue))
        .route("/admin/events", post(events::record_event))
        .route("/admin/subject-events", post(events::subject_events))
        // User reports
        .route("/reports", post(reports::create_report))
        .route("/admin/reports", get(reports::list_reports))
        .route("/admin/reports-html", get(reports::list_reports_html))
        .route("/admin/reports/:id", get(reports::get_report))
        .route("/admin/reports/:id/resolve", post(reports::resolve_report))
        // Review endpoints (under admin, auth protected)
        .route("/admin/review/:id", get(review::review_page))
        .route("/admin/review/:id/data", get(review::review_data))
        .route("/admin/review/:id/submit", post(review::submit_review))
        // Static files (CSS, JS for admin UI)
        .nest_service("/static", ServeDir::new("static"))
        // ATProto XRPC endpoints (public)
        .route(
            "/xrpc/com.atproto.label.queryLabels",
            get(xrpc::query_labels),
        )
        .route(
            "/xrpc/com.atproto.label.subscribeLabels",
            get(xrpc::subscribe_labels),
        )
        .layer(middleware::from_fn(move |req, next| {
            auth::auth_middleware(req, next, auth_token.clone())
        }))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::*;

    /// (path, body) for every service-to-service endpoint, relative to its prefix.
    const MACHINE_ENDPOINTS: &[(&str, &str)] = &[
        ("/active-labels", r#"{"uris":[]}"#),
        ("/labels", r#"{"uris":[]}"#),
        ("/labels-by-value", r#"{"values":[]}"#),
        ("/negated-labels", r#"{"uris":[]}"#),
        ("/sensitive-images", r#"{"image_id":"x"}"#),
        ("/sensitive-images/remove", r#"{"id":1}"#),
    ];

    const TOKEN: &str = "test-token";

    fn test_state() -> AppState {
        AppState {
            audd_api_token: String::new(),
            audd_api_url: String::new(),
            db: None,
            signer: None,
            label_tx: None,
            claude: None,
            copyright_score_threshold: 50,
            copyright_mix_song_threshold: 3,
        }
    }

    async fn post(path: &str, body: &str, token: Option<&str>) -> StatusCode {
        let mut req = Request::post(path).header("content-type", "application/json");
        if let Some(token) = token {
            req = req.header("X-Moderation-Key", token);
        }
        build_router(test_state(), Some(TOKEN.to_string()))
            .oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
            .status()
    }

    /// Both prefixes must reach the same handler for the whole deploy-overlap
    /// window: the backend still calls `/admin/*` until its client moves.
    #[tokio::test]
    async fn machine_endpoints_are_served_under_both_prefixes() {
        for (path, body) in MACHINE_ENDPOINTS {
            for prefix in ["/internal", "/admin"] {
                let status = post(&format!("{prefix}{path}"), body, Some(TOKEN)).await;
                assert_eq!(
                    status,
                    StatusCode::SERVICE_UNAVAILABLE,
                    "{prefix}{path} should reach the handler (503 = no labeler db in tests)"
                );
            }
        }
    }

    #[tokio::test]
    async fn machine_endpoints_require_the_moderation_key() {
        for (path, body) in MACHINE_ENDPOINTS {
            let status = post(&format!("/internal{path}"), body, None).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "/internal{path}");
        }
    }

    /// Endpoints added after #1691 live only on `/internal`.
    ///
    /// The `/admin` aliases are a migration affordance for routes that predate
    /// the split, not a mirror of the machine surface. Aliasing new ones would
    /// re-create the mixed prefix the split removed.
    #[tokio::test]
    async fn post_split_machine_endpoints_are_not_aliased_under_admin() {
        assert_eq!(
            post(
                "/internal/events",
                r#"{"subject_uri":"at://x","action":"acknowledged","actor":"t"}"#,
                Some(TOKEN)
            )
            .await,
            StatusCode::SERVICE_UNAVAILABLE,
            "/internal/events should reach the handler"
        );
        assert_eq!(
            post(
                "/admin/events",
                r#"{"subject_uri":"at://x","action":"acknowledged","actor":"t"}"#,
                Some(TOKEN)
            )
            .await,
            StatusCode::SERVICE_UNAVAILABLE,
            "/admin/events is the operator route, not an alias"
        );
        assert_eq!(
            post("/admin/overrides", "{}", Some(TOKEN)).await,
            StatusCode::NOT_FOUND,
            "/overrides is service-to-service only"
        );
    }

    #[tokio::test]
    async fn event_writes_require_the_moderation_key() {
        let status = post(
            "/internal/events",
            r#"{"subject_uri":"at://x","action":"takedown","actor":"t"}"#,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn review_queue_route_resolves() {
        let status = build_router(test_state(), Some(TOKEN.to_string()))
            .oneshot(
                Request::get("/admin/queue")
                    .header("X-Moderation-Key", TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status();
        assert_ne!(status, StatusCode::NOT_FOUND);
    }

    /// The moderator UI is unaffected by the split.
    #[tokio::test]
    async fn admin_ui_routes_still_resolve() {
        let status = build_router(test_state(), Some(TOKEN.to_string()))
            .oneshot(Request::get("/admin/flags").body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status();
        assert_ne!(status, StatusCode::NOT_FOUND);
    }
}
