//! AuDD audio fingerprinting integration.

use std::collections::{HashMap, HashSet};

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
    /// Distinct songs each matched across multiple segments — a DJ mix of
    /// copyrighted material shows several sustained songs even though no
    /// single one dominates
    pub sustained_song_count: usize,
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
    let sustained_song_count = count_sustained_songs(&matches);

    // Two flagging signals, both using match structure as a confidence proxy
    // (AudD returns no scores). Random false positives are scattered one-off
    // matches of unrelated songs and trip neither:
    // - single-song rip: one song dominates the matched segments
    // - mix/collage: several distinct songs are each sustained across
    //   multiple segments, though none dominates (Twitch/YouTube-style
    //   per-segment detection catches these; the dominant test alone cannot)
    let is_flagged = dominant_match_pct >= state.copyright_score_threshold
        || sustained_song_count >= state.copyright_mix_song_threshold;

    info!(
        match_count = matches.len(),
        dominant_match_pct,
        dominant_match = dominant_match.as_deref().unwrap_or("none"),
        sustained_song_count,
        is_flagged,
        "scan complete"
    );

    Ok(Json(ScanResponse {
        matches,
        is_flagged,
        dominant_match_pct,
        dominant_match,
        sustained_song_count,
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

/// Minimum distinct segments a song must match at to count as sustained.
/// One-off segment matches are the false-positive mode; a song recognized at
/// several positions in the file is a real presence.
const MIN_SEGMENTS_PER_SUSTAINED_SONG: usize = 3;

/// Count distinct songs that are each matched at multiple distinct positions.
fn count_sustained_songs(matches: &[AuddMatch]) -> usize {
    let mut song_segments: HashMap<(String, String), HashSet<String>> = HashMap::new();
    for m in matches {
        let key = (m.artist.to_lowercase(), m.title.to_lowercase());
        let segment = m
            .timecode
            .clone()
            .or_else(|| m.offset_ms.map(|o| o.to_string()));
        if let Some(segment) = segment {
            song_segments.entry(key).or_default().insert(segment);
        }
    }
    song_segments
        .values()
        .filter(|segments| segments.len() >= MIN_SEGMENTS_PER_SUSTAINED_SONG)
        .count()
}

/// Find the dominant song in matches (the one that appears most frequently).
/// Returns (dominant_song_name, percentage_of_total_matches).
///
/// AudD doesn't return confidence scores, so we use match frequency as a proxy:
/// if the same song matches across many segments of the track, it's likely real.
/// Random false positives tend to be scattered across different songs.
pub(crate) fn find_dominant_match(matches: &[AuddMatch]) -> (Option<String>, i32) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn m(artist: &str, title: &str, timecode: &str) -> AuddMatch {
        AuddMatch {
            artist: artist.to_string(),
            title: title.to_string(),
            album: None,
            score: 0,
            isrc: None,
            timecode: Some(timecode.to_string()),
            offset_ms: None,
        }
    }

    #[test]
    fn mix_of_sustained_songs_is_counted() {
        // a DJ mix: four songs, each recognized at three distinct positions,
        // none dominating (25% each) — the regression that shipped unflagged
        let matches: Vec<AuddMatch> = [
            ("Susumu Yokota", "Song A"),
            ("Quelle Chris", "Song B"),
            ("Black Star", "Song C"),
            ("Madlib", "Song D"),
        ]
        .iter()
        .flat_map(|(artist, title)| {
            ["00:10", "01:10", "02:10"]
                .iter()
                .map(|t| m(artist, title, t))
                .collect::<Vec<_>>()
        })
        .collect();

        assert_eq!(count_sustained_songs(&matches), 4);
        let (_, pct) = find_dominant_match(&matches);
        assert!(pct < 30, "no single song should dominate a mix");
    }

    #[test]
    fn single_song_rip_is_not_a_mix() {
        let matches: Vec<AuddMatch> = (0..10)
            .map(|i| m("Artist", "Song", &format!("00:{i:02}")))
            .collect();

        assert_eq!(count_sustained_songs(&matches), 1);
        let (_, pct) = find_dominant_match(&matches);
        assert_eq!(pct, 100);
    }

    #[test]
    fn scattered_one_off_matches_are_not_sustained() {
        // the false-positive mode: unrelated songs each matching once
        let matches: Vec<AuddMatch> = (0..5)
            .map(|i| m(&format!("Artist {i}"), &format!("Song {i}"), "00:30"))
            .collect();

        assert_eq!(count_sustained_songs(&matches), 0);
    }

    #[test]
    fn repeated_matches_at_one_position_are_not_sustained() {
        let matches = vec![
            m("Artist", "Song", "00:30"),
            m("Artist", "Song", "00:30"),
            m("Artist", "Song", "00:30"),
        ];

        assert_eq!(count_sustained_songs(&matches), 0);
    }
}
