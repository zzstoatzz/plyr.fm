//! Audio fingerprinting via fpcalc (Chromaprint) + AcoustID lookup.

use std::collections::HashMap;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tracing::info;

use crate::state::{AppError, AppState};

// --- request/response types (unchanged API contract) ---

#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    pub audio_url: String,
}

#[derive(Debug, Serialize)]
pub struct ScanResponse {
    pub matches: Vec<AuddMatch>,
    pub is_flagged: bool,
    /// Percentage of matched segments belonging to the dominant song (0-100)
    pub dominant_match_pct: i32,
    /// The dominant song if one exists (artist - title)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_match: Option<String>,
    /// Highest AcoustID score (0-100)
    pub highest_score: i32,
    pub raw_response: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
pub struct AuddMatch {
    pub artist: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    pub score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timecode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<i64>,
}

// --- fpcalc types ---

#[derive(Debug, Deserialize)]
struct FpcalcOutput {
    duration: f64,
    fingerprint: String,
}

// --- acoustid types ---

#[derive(Debug, Deserialize)]
struct AcoustidResponse {
    status: String,
    #[serde(default)]
    results: Vec<AcoustidResult>,
    // error responses
    error: Option<AcoustidError>,
}

#[derive(Debug, Deserialize)]
struct AcoustidError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct AcoustidResult {
    score: f64,
    #[serde(default)]
    recordings: Vec<AcoustidRecording>,
}

#[derive(Debug, Deserialize)]
struct AcoustidRecording {
    title: Option<String>,
    #[serde(default)]
    artists: Vec<AcoustidArtist>,
}

#[derive(Debug, Deserialize)]
struct AcoustidArtist {
    name: String,
}

// --- handler ---

/// Scan audio for copyright matches via fpcalc + AcoustID.
pub async fn scan(
    State(state): State<AppState>,
    Json(request): Json<ScanRequest>,
) -> Result<Json<ScanResponse>, AppError> {
    info!(audio_url = %request.audio_url, "scanning audio");

    // 1. download audio to temp file
    let client = reqwest::Client::new();
    let audio_bytes = client
        .get(&request.audio_url)
        .send()
        .await
        .map_err(|e| AppError::Scan(format!("failed to download audio: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::Scan(format!("failed to read audio bytes: {e}")))?;

    let tmp = tempfile::NamedTempFile::new()
        .map_err(|e| AppError::Scan(format!("failed to create temp file: {e}")))?;
    let tmp_path = tmp.path().to_owned();
    {
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| AppError::Scan(format!("failed to write temp file: {e}")))?;
        file.write_all(&audio_bytes)
            .await
            .map_err(|e| AppError::Scan(format!("failed to write audio data: {e}")))?;
    }

    // 2. run fpcalc
    let fpcalc_output = tokio::process::Command::new("fpcalc")
        .arg("--json")
        .arg(&tmp_path)
        .output()
        .await
        .map_err(|e| AppError::Scan(format!("fpcalc execution failed: {e}")))?;

    if !fpcalc_output.status.success() {
        let stderr = String::from_utf8_lossy(&fpcalc_output.stderr);
        return Err(AppError::Scan(format!("fpcalc failed: {stderr}")));
    }

    let fpcalc: FpcalcOutput = serde_json::from_slice(&fpcalc_output.stdout)
        .map_err(|e| AppError::Scan(format!("failed to parse fpcalc output: {e}")))?;

    info!(duration = fpcalc.duration, "fpcalc fingerprint generated");

    // 3. lookup on AcoustID
    let raw_response: serde_json::Value = client
        .post("https://api.acoustid.org/v2/lookup")
        .form(&[
            ("client", state.acoustid_api_key.as_str()),
            ("meta", "recordings"),
            ("duration", &(fpcalc.duration as i64).to_string()),
            ("fingerprint", &fpcalc.fingerprint),
        ])
        .send()
        .await
        .map_err(|e| AppError::Scan(format!("acoustid request failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Scan(format!("failed to parse acoustid response: {e}")))?;

    let acoustid_response: AcoustidResponse = serde_json::from_value(raw_response.clone())
        .map_err(|e| AppError::Scan(format!("failed to deserialize acoustid response: {e}")))?;

    if acoustid_response.status == "error" {
        let msg = acoustid_response
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "unknown error".to_string());
        return Err(AppError::Scan(format!("acoustid returned error: {msg}")));
    }

    // 4. map to response format
    let matches = extract_matches(&acoustid_response);
    let highest_score = matches.iter().map(|m| m.score).max().unwrap_or(0);
    let (dominant_match, dominant_match_pct) = find_dominant_match(&matches);

    let is_flagged = highest_score >= state.copyright_score_threshold;

    info!(
        match_count = matches.len(),
        highest_score,
        dominant_match_pct,
        dominant_match = dominant_match.as_deref().unwrap_or("none"),
        is_flagged,
        "scan complete"
    );

    Ok(Json(ScanResponse {
        matches,
        is_flagged,
        dominant_match_pct,
        dominant_match,
        highest_score,
        raw_response,
    }))
}

// --- helpers ---

fn extract_matches(response: &AcoustidResponse) -> Vec<AuddMatch> {
    response
        .results
        .iter()
        .flat_map(|result| {
            let score = (result.score * 100.0) as i32;
            result.recordings.iter().map(move |recording| {
                let artist = if recording.artists.is_empty() {
                    "Unknown".to_string()
                } else {
                    recording
                        .artists
                        .iter()
                        .map(|a| a.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                AuddMatch {
                    artist,
                    title: recording
                        .title
                        .clone()
                        .unwrap_or_else(|| "Unknown".to_string()),
                    album: None,
                    score,
                    isrc: None,
                    timecode: None,
                    offset_ms: None,
                }
            })
        })
        .collect()
}

/// Find the dominant song in matches (the one that appears most frequently).
/// Returns (dominant_song_name, percentage_of_total_matches).
fn find_dominant_match(matches: &[AuddMatch]) -> (Option<String>, i32) {
    if matches.is_empty() {
        return (None, 0);
    }

    // Count matches per unique song (artist + title)
    let mut song_counts: HashMap<(String, String), usize> = HashMap::new();
    for m in matches {
        let key = (m.artist.to_lowercase(), m.title.to_lowercase());
        *song_counts.entry(key).or_insert(0) += 1;
    }

    // Find the song with the most matches
    let (dominant_key, dominant_count) = song_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .unwrap(); // Safe: matches is non-empty

    let pct = (dominant_count * 100 / matches.len()) as i32;
    let dominant_name = format!("{} - {}", dominant_key.0, dominant_key.1);

    (Some(dominant_name), pct)
}
