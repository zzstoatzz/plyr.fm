//! AuDD audio fingerprinting integration.

use std::collections::HashMap;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::state::{AppError, AppState};

// --- request/response types ---

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
    /// Legacy field - always 0 since AudD doesn't return scores
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

// --- audd api types ---

#[derive(Debug, Deserialize)]
pub struct AuddResponse {
    pub status: Option<String>,
    pub result: Option<AuddResult>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AuddResult {
    Groups(Vec<AuddGroup>),
    Single(AuddSong),
}

#[derive(Debug, Deserialize)]
pub struct AuddGroup {
    pub offset: Option<serde_json::Value>,
    pub songs: Option<Vec<AuddSong>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AuddSong {
    pub artist: Option<String>,
    pub title: Option<String>,
    pub album: Option<String>,
    pub score: Option<i32>,
    pub isrc: Option<String>,
    pub timecode: Option<String>,
    pub release_date: Option<String>,
    pub label: Option<String>,
    pub song_link: Option<String>,
}

// --- handler ---

/// Scan audio for copyright matches via AuDD.
pub async fn scan(
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
    let (dominant_match, dominant_match_pct) = find_dominant_match(&matches);

    // Flag if any single song dominates the matches (>= threshold % of segments)
    // This filters out false positives where random segments match different songs
    let is_flagged = dominant_match_pct >= state.copyright_score_threshold;

    info!(
        match_count = matches.len(),
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
        highest_score: 0, // AudD doesn't return scores
        raw_response,
    }))
}

// --- helpers ---

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

/// Find the dominant song in matches (the one that appears most frequently).
/// Returns (dominant_song_name, percentage_of_total_matches).
///
/// AudD doesn't return confidence scores, so we use match frequency as a proxy:
/// if the same song matches across many segments of the track, it's likely real.
/// Random false positives tend to be scattered across different songs.
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
