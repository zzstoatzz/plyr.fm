use std::{
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
};

use anyhow::anyhow;
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Query, Request},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sanitize_filename::sanitize;
use serde::Deserialize;
use tempfile::TempDir;
use tokio::{fs::File, io::AsyncWriteExt, net::TcpListener, process::Command};
use tracing::{error, info, warn};

#[derive(Debug, Deserialize, Default)]
struct TranscodeParams {
    target: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let max_upload_bytes: usize = env::var("TRANSCODER_MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(512 * 1024 * 1024); // 512MB default

    let auth_token = env::var("TRANSCODER_AUTH_TOKEN").ok();

    let app = Router::new()
        .route("/health", get(health))
        .route("/transcode", post(transcode))
        .layer(middleware::from_fn(move |req, next| {
            auth_middleware(req, next, auth_token.clone())
        }))
        .layer(DefaultBodyLimit::max(max_upload_bytes));

    let port: u16 = env::var("TRANSCODER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8082);
    let host = env::var("TRANSCODER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| anyhow!("invalid bind addr: {e}"))?;
    info!(%addr, max_upload_bytes, "transcoder listening");

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn auth_middleware(
    req: Request,
    next: Next,
    auth_token: Option<String>,
) -> Result<Response, StatusCode> {
    // skip auth for health endpoint
    if req.uri().path() == "/health" {
        return Ok(next.run(req).await);
    }

    // if no auth token configured, allow all requests (local dev mode)
    let Some(expected_token) = auth_token else {
        warn!("no TRANSCODER_AUTH_TOKEN set - accepting all requests");
        return Ok(next.run(req).await);
    };

    // check for X-Transcoder-Key header
    let token = req
        .headers()
        .get("X-Transcoder-Key")
        .and_then(|v| v.to_str().ok());

    match token {
        Some(t) if t == expected_token => Ok(next.run(req).await),
        Some(_) => {
            warn!("invalid auth token provided");
            Err(StatusCode::UNAUTHORIZED)
        }
        None => {
            warn!("missing X-Transcoder-Key header");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn transcode(
    Query(params): Query<TranscodeParams>,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    let target_ext = params.target.unwrap_or_else(|| "mp3".to_string());

    let temp_dir =
        tempfile::tempdir().map_err(|e| AppError::Io(format!("failed to create temp dir: {e}")))?;
    let (input_path, original_name) = write_upload_to_disk(&mut multipart, &temp_dir).await?;

    let output_path = temp_dir.path().join(format!("output.{}", target_ext));
    run_ffmpeg(&input_path, &output_path, &target_ext).await?;

    let bytes = tokio::fs::read(&output_path)
        .await
        .map_err(|e| AppError::Io(format!("failed to read output file: {e}")))?;

    let media_type = match target_ext.as_str() {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        other => {
            info!(
                target = other,
                "unknown target format, defaulting to octet-stream"
            );
            "application/octet-stream"
        }
    };

    let download_name = format!("{}.{}", original_name, target_ext);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static(media_type))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{}\"", download_name))
                .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
        )
        .body(Body::from(bytes))
        .map_err(|e| AppError::Http(e.to_string()))?;

    Ok(response)
}

async fn write_upload_to_disk(
    multipart: &mut Multipart,
    temp_dir: &TempDir,
) -> Result<(PathBuf, String), AppError> {
    let mut file_path: Option<PathBuf> = None;
    let mut original_name: Option<String> = None;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid multipart data: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let filename = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload".to_string());
        let sanitized_name = sanitize(&filename);
        let ext = std::path::Path::new(&sanitized_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("bin");
        let path = temp_dir.path().join(format!("input.{}", ext));
        let mut file = File::create(&path)
            .await
            .map_err(|e| AppError::Io(format!("failed to create temp file: {e}")))?;

        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|e| AppError::BadRequest(format!("failed to read upload chunk: {e}")))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Io(format!("failed to write chunk: {e}")))?;
        }
        file.flush()
            .await
            .map_err(|e| AppError::Io(format!("failed to flush file: {e}")))?;

        file_path = Some(path);
        original_name = Some(
            std::path::Path::new(&sanitized_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("track")
                .to_string(),
        );
        break;
    }

    match (file_path, original_name) {
        (Some(path), Some(name)) => Ok((path, name)),
        _ => Err(AppError::BadRequest(
            "multipart form must include a 'file' field".into(),
        )),
    }
}

async fn run_ffmpeg(input: &Path, output: &Path, target_ext: &str) -> Result<(), AppError> {
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y").arg("-i").arg(input);

    match target_ext {
        "mp3" => {
            cmd.args(["-acodec", "libmp3lame", "-b:a", "320k", "-ar", "44100"]);
        }
        "wav" => {
            cmd.args(["-acodec", "pcm_s16le", "-ar", "44100"]);
        }
        "m4a" => {
            cmd.args(["-acodec", "aac", "-b:a", "256k", "-ar", "44100"]);
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported target format: {}",
                other
            )));
        }
    }

    cmd.arg(output);

    let output_res = cmd
        .output()
        .await
        .map_err(|e| AppError::Ffmpeg(format!("failed to spawn ffmpeg: {e}")))?;

    if !output_res.status.success() {
        let stderr = String::from_utf8_lossy(&output_res.stderr).to_string();
        error!(%stderr, "ffmpeg failed");
        return Err(AppError::Ffmpeg(stderr));
    }

    Ok(())
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("http error: {0}")]
    Http(String),
    #[error("ffmpeg error: {0}")]
    Ffmpeg(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::error!(error = %self, "request failed");
        let status = match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Io(_) | AppError::Http(_) | AppError::Ffmpeg(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let body = serde_json::json!({
            "error": self.to_string(),
        });
        (status, Json(body)).into_response()
    }
}
