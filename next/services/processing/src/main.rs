//! Next's upload processing executor.
//!
//! The audio Worker's owner Durable Object dispatches one attempt at a time;
//! this service pulls the retained source, encodes the playback rendition and
//! uploads it back through per-attempt callbacks. See
//! `next/backend/docs/upload-processing.md` for the protocol. It owns no PDS
//! credentials and shares nothing with the legacy transcoder.

use std::{env, net::SocketAddr};

use anyhow::anyhow;
use axum::{routing::get, Json, Router};
use serde::Serialize;
use tokio::net::TcpListener;
use tracing::info;

mod processing;

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let app = Router::new()
        .route("/health", get(|| async { Json(Health { status: "ok" }) }))
        .merge(processing::configured_router()?);

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| anyhow!("invalid bind addr: {e}"))?;
    info!(%addr, "next processing listening");

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
