//! plyr.fm moderation service
//!
//! Provides:
//! - AuDD audio fingerprinting for copyright detection
//! - ATProto labeler endpoints (queryLabels, subscribeLabels)
//! - Label emission for copyright violations

use std::{env, net::SocketAddr, sync::Arc};

use anyhow::anyhow;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, Request, State,
    },
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::broadcast};
use tokio_stream::wrappers::BroadcastStream;
use tracing::{error, info, warn};

mod admin;
mod db;
mod labels;

use db::LabelDb;
use labels::{Label, LabelSigner};

// --- config ---

struct Config {
    host: String,
    port: u16,
    auth_token: Option<String>,
    audd_api_token: String,
    audd_api_url: String,
    database_url: Option<String>,
    labeler_did: Option<String>,
    labeler_signing_key: Option<String>,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            host: env::var("MODERATION_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("MODERATION_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8083),
            auth_token: env::var("MODERATION_AUTH_TOKEN").ok(),
            audd_api_token: env::var("MODERATION_AUDD_API_TOKEN")
                .map_err(|_| anyhow!("MODERATION_AUDD_API_TOKEN is required"))?,
            audd_api_url: env::var("MODERATION_AUDD_API_URL")
                .unwrap_or_else(|_| "https://enterprise.audd.io/".to_string()),
            database_url: env::var("MODERATION_DATABASE_URL").ok(),
            labeler_did: env::var("MODERATION_LABELER_DID").ok(),
            labeler_signing_key: env::var("MODERATION_LABELER_SIGNING_KEY").ok(),
        })
    }

    fn labeler_enabled(&self) -> bool {
        self.database_url.is_some()
            && self.labeler_did.is_some()
            && self.labeler_signing_key.is_some()
    }
}

// --- request/response types ---

#[derive(Debug, Deserialize)]
struct ScanRequest {
    audio_url: String,
}

#[derive(Debug, Serialize)]
struct ScanResponse {
    matches: Vec<AuddMatch>,
    is_flagged: bool,
    highest_score: i32,
    raw_response: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
struct AuddMatch {
    artist: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    isrc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timecode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    offset_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    labeler_enabled: bool,
}

// --- emit label request ---

#[derive(Debug, Deserialize)]
struct EmitLabelRequest {
    /// AT URI of the resource to label (e.g., at://did:plc:xxx/fm.plyr.track/abc123)
    uri: String,
    /// Label value (e.g., "copyright-violation")
    #[serde(default = "default_label_val")]
    val: String,
    /// Optional CID of specific version
    cid: Option<String>,
    /// If true, negate an existing label
    #[serde(default)]
    neg: bool,
}

fn default_label_val() -> String {
    "copyright-violation".to_string()
}

#[derive(Debug, Serialize)]
struct EmitLabelResponse {
    seq: i64,
    label: Label,
}

// --- xrpc types ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryLabelsParams {
    uri_patterns: String, // comma-separated
    sources: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct QueryLabelsResponse {
    cursor: Option<String>,
    labels: Vec<Label>,
}

#[derive(Debug, Deserialize)]
struct SubscribeLabelsParams {
    cursor: Option<i64>,
}

// --- audd api types ---

#[derive(Debug, Deserialize)]
struct AuddResponse {
    status: Option<String>,
    result: Option<AuddResult>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AuddResult {
    Groups(Vec<AuddGroup>),
    Single(AuddSong),
}

#[derive(Debug, Deserialize)]
struct AuddGroup {
    offset: Option<serde_json::Value>,
    songs: Option<Vec<AuddSong>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct AuddSong {
    artist: Option<String>,
    title: Option<String>,
    album: Option<String>,
    score: Option<i32>,
    isrc: Option<String>,
    timecode: Option<String>,
    release_date: Option<String>,
    label: Option<String>,
    song_link: Option<String>,
}

// --- main ---

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let config = Config::from_env()?;
    let auth_token = config.auth_token.clone();

    // Initialize labeler components if configured
    let (db, signer, label_tx) = if config.labeler_enabled() {
        let db = LabelDb::connect(config.database_url.as_ref().unwrap()).await?;
        db.migrate().await?;
        info!("labeler database connected and migrated");

        let signer = LabelSigner::from_hex(
            config.labeler_signing_key.as_ref().unwrap(),
            config.labeler_did.as_ref().unwrap(),
        )?;
        info!(did = %signer.did(), "labeler signer initialized");

        let (tx, _) = broadcast::channel::<(i64, Label)>(1024);
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
        .route("/", get(landing))
        // Health check
        .route("/health", get(health))
        // AuDD scanning (existing)
        .route("/scan", post(scan))
        // Label emission (internal API)
        .route("/emit-label", post(emit_label))
        // Admin UI and API
        .route("/admin", get(admin::admin_ui))
        .route("/admin/flags", get(admin::list_flagged))
        .route("/admin/resolve", post(admin::resolve_flag))
        // ATProto XRPC endpoints (public)
        .route("/xrpc/com.atproto.label.queryLabels", get(query_labels))
        .route(
            "/xrpc/com.atproto.label.subscribeLabels",
            get(subscribe_labels),
        )
        .layer(middleware::from_fn(move |req, next| {
            auth_middleware(req, next, auth_token.clone())
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

// --- state ---

#[derive(Clone)]
struct AppState {
    audd_api_token: String,
    audd_api_url: String,
    db: Option<Arc<LabelDb>>,
    signer: Option<Arc<LabelSigner>>,
    label_tx: Option<broadcast::Sender<(i64, Label)>>,
}

// --- middleware ---

async fn auth_middleware(
    req: Request,
    next: Next,
    auth_token: Option<String>,
) -> Result<Response, StatusCode> {
    let path = req.uri().path();

    // Public endpoints - no auth required
    if path == "/"
        || path == "/health"
        || path.starts_with("/xrpc/com.atproto.label.")
    {
        return Ok(next.run(req).await);
    }

    let Some(expected_token) = auth_token else {
        warn!("no MODERATION_AUTH_TOKEN set - accepting all requests");
        return Ok(next.run(req).await);
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

// --- handlers ---

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        labeler_enabled: state.db.is_some(),
    })
}

async fn landing(State(state): State<AppState>) -> axum::response::Html<String> {
    let labeler_did = state
        .signer
        .as_ref()
        .map(|s| s.did().to_string())
        .unwrap_or_else(|| "not configured".to_string());

    axum::response::Html(format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>plyr.fm moderation</title>
    <style>
        body {{
            font-family: system-ui, -apple-system, sans-serif;
            background: #0a0a0a;
            color: #e5e5e5;
            max-width: 600px;
            margin: 80px auto;
            padding: 20px;
            line-height: 1.6;
        }}
        h1 {{ color: #fff; margin-bottom: 8px; }}
        .subtitle {{ color: #888; margin-bottom: 32px; }}
        a {{ color: #3b82f6; }}
        code {{
            background: #1a1a1a;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
        }}
        .endpoint {{
            background: #111;
            border: 1px solid #222;
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
        }}
        .endpoint-name {{ color: #10b981; font-family: monospace; }}
    </style>
</head>
<body>
    <h1>plyr.fm moderation</h1>
    <p class="subtitle">ATProto labeler for audio content moderation</p>

    <p>This service provides content labels for <a href="https://plyr.fm">plyr.fm</a>,
    the music streaming platform on ATProto.</p>

    <p><strong>Labeler DID:</strong> <code>{}</code></p>

    <h2>Endpoints</h2>

    <div class="endpoint">
        <div class="endpoint-name">GET /xrpc/com.atproto.label.queryLabels</div>
        <p>Query labels by URI pattern</p>
    </div>

    <div class="endpoint">
        <div class="endpoint-name">GET /xrpc/com.atproto.label.subscribeLabels</div>
        <p>WebSocket subscription for real-time label updates</p>
    </div>

    <p style="margin-top: 32px; color: #666;">
        <a href="https://bsky.app/profile/moderation.plyr.fm">@moderation.plyr.fm</a>
    </p>
</body>
</html>"#,
        labeler_did
    ))
}

async fn scan(
    State(state): State<AppState>,
    Json(request): Json<ScanRequest>,
) -> Result<Json<ScanResponse>, AppError> {
    info!(audio_url = %request.audio_url, "scanning audio");

    let client = reqwest::Client::new();
    let response = client
        .post(&state.audd_api_url)
        .form(&[
            ("api_token", &state.audd_api_token),
            ("url", &request.audio_url),
            ("accurate_offsets", &"1".to_string()),
        ])
        .send()
        .await
        .map_err(|e| AppError::Audd(format!("request failed: {e}")))?;

    let raw_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Audd(format!("failed to parse response: {e}")))?;

    let audd_response: AuddResponse = serde_json::from_value(raw_response.clone())
        .map_err(|e| AppError::Audd(format!("failed to parse audd response: {e}")))?;

    if audd_response.status.as_deref() == Some("error") {
        return Err(AppError::Audd(format!(
            "audd returned error: {}",
            raw_response
        )));
    }

    let matches = extract_matches(&audd_response);
    let highest_score = matches.iter().map(|m| m.score).max().unwrap_or(0);
    let is_flagged = !matches.is_empty();

    info!(
        match_count = matches.len(),
        highest_score,
        is_flagged,
        "scan complete"
    );

    Ok(Json(ScanResponse {
        matches,
        is_flagged,
        highest_score,
        raw_response,
    }))
}

async fn emit_label(
    State(state): State<AppState>,
    Json(request): Json<EmitLabelRequest>,
) -> Result<Json<EmitLabelResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let signer = state.signer.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    info!(uri = %request.uri, val = %request.val, neg = request.neg, "emitting label");

    // Create and sign the label
    let mut label = Label::new(signer.did(), &request.uri, &request.val);
    if let Some(cid) = request.cid {
        label = label.with_cid(cid);
    }
    if request.neg {
        label = label.negated();
    }
    let label = signer.sign_label(label)?;

    // Store in database
    let seq = db.store_label(&label).await?;
    info!(seq, uri = %request.uri, "label stored");

    // Broadcast to subscribers
    if let Some(tx) = &state.label_tx {
        let _ = tx.send((seq, label.clone()));
    }

    Ok(Json(EmitLabelResponse { seq, label }))
}

async fn query_labels(
    State(state): State<AppState>,
    Query(params): Query<QueryLabelsParams>,
) -> Result<Json<QueryLabelsResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    let uri_patterns: Vec<String> = params
        .uri_patterns
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();
    let sources: Option<Vec<String>> = params
        .sources
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect());
    let limit = params.limit.unwrap_or(50).min(250).max(1);

    let (rows, cursor) = db
        .query_labels(
            &uri_patterns,
            sources.as_deref(),
            params.cursor.as_deref(),
            limit,
        )
        .await?;

    let labels: Vec<Label> = rows.iter().map(|r| r.to_label()).collect();

    Ok(Json(QueryLabelsResponse { cursor, labels }))
}

async fn subscribe_labels(
    State(state): State<AppState>,
    Query(params): Query<SubscribeLabelsParams>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let db = state.db.clone().ok_or(AppError::LabelerNotConfigured)?;
    let label_tx = state.label_tx.clone().ok_or(AppError::LabelerNotConfigured)?;

    Ok(ws.on_upgrade(move |socket| handle_subscribe(socket, db, label_tx, params.cursor)))
}

async fn handle_subscribe(
    mut socket: WebSocket,
    db: Arc<LabelDb>,
    label_tx: broadcast::Sender<(i64, Label)>,
    cursor: Option<i64>,
) {
    // If cursor provided, backfill from that point
    let start_seq = if let Some(c) = cursor {
        // Send historical labels first
        match db.get_labels_since(c, 1000).await {
            Ok(rows) => {
                for row in &rows {
                    let msg = SubscribeLabelsMessage {
                        seq: row.seq,
                        labels: vec![row.to_label()],
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            return;
                        }
                    }
                }
                rows.last().map(|r| r.seq).unwrap_or(c)
            }
            Err(e) => {
                error!(error = %e, "failed to backfill labels");
                return;
            }
        }
    } else {
        // Start from current position
        db.get_latest_seq().await.unwrap_or(0)
    };

    // Subscribe to live updates
    let rx = label_tx.subscribe();
    let mut stream = BroadcastStream::new(rx);

    let mut last_seq = start_seq;

    loop {
        tokio::select! {
            // Receive from broadcast
            Some(result) = stream.next() => {
                match result {
                    Ok((seq, label)) => {
                        if seq > last_seq {
                            let msg = SubscribeLabelsMessage {
                                seq,
                                labels: vec![label],
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if socket.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                            last_seq = seq;
                        }
                    }
                    Err(_) => continue, // Lagged, skip
                }
            }
            // Check for client disconnect
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

#[derive(Serialize)]
struct SubscribeLabelsMessage {
    seq: i64,
    labels: Vec<Label>,
}

fn extract_matches(response: &AuddResponse) -> Vec<AuddMatch> {
    let Some(result) = &response.result else {
        return vec![];
    };

    match result {
        AuddResult::Groups(groups) => groups
            .iter()
            .flat_map(|group| {
                group
                    .songs
                    .as_ref()
                    .map(|songs| {
                        songs
                            .iter()
                            .map(|song| parse_song(song, group.offset.as_ref()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .collect(),
        AuddResult::Single(song) => vec![parse_song(song, None)],
    }
}

fn parse_song(song: &AuddSong, offset: Option<&serde_json::Value>) -> AuddMatch {
    let offset_ms = offset.and_then(|v| match v {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => parse_timecode_to_ms(s),
        _ => None,
    });

    AuddMatch {
        artist: song.artist.clone().unwrap_or_else(|| "Unknown".to_string()),
        title: song.title.clone().unwrap_or_else(|| "Unknown".to_string()),
        album: song.album.clone(),
        score: song.score.unwrap_or(0),
        isrc: song.isrc.clone(),
        timecode: song.timecode.clone(),
        offset_ms,
    }
}

fn parse_timecode_to_ms(timecode: &str) -> Option<i64> {
    let parts: Vec<&str> = timecode.split(':').collect();
    match parts.len() {
        2 => {
            let mins: i64 = parts[0].parse().ok()?;
            let secs: i64 = parts[1].parse().ok()?;
            Some((mins * 60 + secs) * 1000)
        }
        3 => {
            let hours: i64 = parts[0].parse().ok()?;
            let mins: i64 = parts[1].parse().ok()?;
            let secs: i64 = parts[2].parse().ok()?;
            Some((hours * 3600 + mins * 60 + secs) * 1000)
        }
        _ => None,
    }
}

// --- errors ---

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("audd error: {0}")]
    Audd(String),

    #[error("labeler not configured")]
    LabelerNotConfigured,

    #[error("label error: {0}")]
    Label(#[from] labels::LabelError),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!(error = %self, "request failed");
        let (status, error_type) = match &self {
            AppError::Audd(_) => (StatusCode::BAD_GATEWAY, "AuddError"),
            AppError::LabelerNotConfigured => (StatusCode::SERVICE_UNAVAILABLE, "LabelerNotConfigured"),
            AppError::Label(_) => (StatusCode::INTERNAL_SERVER_ERROR, "LabelError"),
            AppError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DatabaseError"),
        };
        let body = serde_json::json!({
            "error": error_type,
            "message": self.to_string()
        });
        (status, Json(body)).into_response()
    }
}
