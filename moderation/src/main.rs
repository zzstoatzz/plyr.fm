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
mod config;
mod db;
mod handlers;
mod labels;
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

    let state = AppState {
        audd_api_token: config.audd_api_token,
        audd_api_url: config.audd_api_url,
        db: db.map(Arc::new),
        signer: signer.map(Arc::new),
        label_tx,
    };

    let app = Router::new()
        // Landing page
        .route("/", get(handlers::landing))
        // Health check
        .route("/health", get(handlers::health))
        // Sensitive images (public)
        .route("/sensitive-images", get(handlers::get_sensitive_images))
        // AuDD scanning
        .route("/scan", post(audd::scan))
        // Label emission (internal API)
        .route("/emit-label", post(handlers::emit_label))
        // Admin UI and API
        .route("/admin", get(admin::admin_ui))
        .route("/admin/flags", get(admin::list_flagged))
        .route("/admin/flags-html", get(admin::list_flagged_html))
        .route("/admin/resolve", post(admin::resolve_flag))
        .route("/admin/resolve-htmx", post(admin::resolve_flag_htmx))
        .route("/admin/context", post(admin::store_context))
        .route("/admin/active-labels", post(admin::get_active_labels))
        .route("/admin/sensitive-images", post(admin::add_sensitive_image))
        .route(
            "/admin/sensitive-images/remove",
            post(admin::remove_sensitive_image),
        )
        .route("/admin/batches", post(admin::create_batch))
        // Review endpoints (auth protected)
        .route("/review/:id", get(review::review_page))
        .route("/review/:id/data", get(review::review_data))
        .route("/review/:id/submit", post(review::submit_review))
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
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| anyhow!("invalid bind addr: {e}"))?;
    info!(%addr, "moderation service listening");

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
