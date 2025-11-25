use std::{env, net::SocketAddr};

use anyhow::anyhow;
use axum::{
    extract::Request,
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tracing::{error, info, warn};

// --- config ---

struct Config {
    host: String,
    port: u16,
    auth_token: Option<String>,
    audd_api_token: String,
    audd_api_url: String,
    score_threshold: i32,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            host: env::var("MODERATION_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("MODERATION_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8083),
            auth_token: env::var("MODERATION_AUTH_TOKEN").ok(),
            audd_api_token: env::var("MODERATION_AUDD_API_TOKEN")
                .map_err(|_| anyhow!("MODERATION_AUDD_API_TOKEN is required"))?,
            audd_api_url: env::var("MODERATION_AUDD_API_URL")
                .unwrap_or_else(|_| "https://api.audd.io/".to_string()),
            score_threshold: env::var("MODERATION_SCORE_THRESHOLD")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(70),
        })
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
    offset: Option<i64>,
    songs: Option<Vec<AuddSong>>,
}

#[derive(Debug, Deserialize)]
struct AuddSong {
    artist: Option<String>,
    title: Option<String>,
    album: Option<String>,
    score: Option<i32>,
    isrc: Option<String>,
    timecode: Option<String>,
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

    let app = Router::new()
        .route("/health", get(health))
        .route("/scan", post(scan))
        .layer(middleware::from_fn(move |req, next| {
            auth_middleware(req, next, auth_token.clone())
        }))
        .with_state(AppState {
            audd_api_token: config.audd_api_token,
            audd_api_url: config.audd_api_url,
            score_threshold: config.score_threshold,
        });

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
    score_threshold: i32,
}

// --- middleware ---

async fn auth_middleware(
    req: Request,
    next: Next,
    auth_token: Option<String>,
) -> Result<Response, StatusCode> {
    if req.uri().path() == "/health" {
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

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn scan(
    axum::extract::State(state): axum::extract::State<AppState>,
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
    let is_flagged = highest_score >= state.score_threshold;

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
                            .map(|song| parse_song(song, group.offset))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .collect(),
        AuddResult::Single(song) => vec![parse_song(song, None)],
    }
}

fn parse_song(song: &AuddSong, offset_ms: Option<i64>) -> AuddMatch {
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

// --- errors ---

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("audd error: {0}")]
    Audd(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!(error = %self, "request failed");
        let status = match self {
            AppError::Audd(_) => StatusCode::BAD_GATEWAY,
        };
        let body = serde_json::json!({ "error": self.to_string() });
        (status, Json(body)).into_response()
    }
}
