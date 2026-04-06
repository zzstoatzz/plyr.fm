---
title: "copyright detection"
---

technical documentation for the copyright scanning system.

## how it works

```
upload completes
       │
       ▼
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│   backend    │────▶│   moderation    │────▶│  AuDD API    │
│ (docket bg   │     │   service       │     │ (enterprise, │
│  task)       │     │   (Rust)        │     │  accurate    │
│              │◀────│                 │◀────│  offsets)    │
└──────────────┘     └─────────────────┘     └──────────────┘
       │
       ├──store in copyright_scans table
       ├──if flagged: DM admin via ATProto notifications
       └──publish to Redis stream (for Osprey, when deployed)
```

1. track upload completes, file stored in R2
2. backend fires docket background task calling `scan_track_for_copyright`
3. backend calls moderation service `POST /scan` with R2 URL
4. moderation service calls AuDD enterprise API with `accurate_offsets=1`
5. moderation service computes `dominant_match_pct` and `is_flagged`
6. results returned to backend, stored in `copyright_scans` table
7. if flagged, backend DMs admin with track details and matches
8. backend publishes event to `moderation:actions` Redis stream (for Osprey)

labels are **not** automatically emitted. that happens manually from the admin dashboard, or will happen via Osprey rules once deployed.

## AuDD API

[AuDD](https://audd.io/) is an audio recognition service. we use their enterprise API with `accurate_offsets=1` mode.

### request

```bash
curl -X POST https://enterprise.audd.io/ \
  -F "api_token=YOUR_TOKEN" \
  -F "url=https://r2.plyr.fm/audio/abc123.mp3" \
  -F "accurate_offsets=1"
```

### response format

with `accurate_offsets=1`, AuDD scans the audio in segments and returns groups of matches per offset:

```json
{
  "status": "success",
  "result": [
    {
      "offset": 0,
      "songs": [
        {"artist": "Artist Name", "title": "Song Title", "album": "Album", "isrc": "USRC12345678"}
      ]
    },
    {
      "offset": 180000,
      "songs": [
        {"artist": "Artist Name", "title": "Song Title", "isrc": "USRC12345678"}
      ]
    },
    {
      "offset": 360000,
      "songs": [
        {"artist": "Different Artist", "title": "Other Song"}
      ]
    }
  ]
}
```

**`accurate_offsets=1` does NOT return per-match confidence scores.** the `score` field is absent or unreliable. `highest_score` in our scan response is always 0.

### what we compute from the response

the Rust service (`audd.rs`) extracts:

- **matches**: all individual song matches across segments
- **dominant_match_pct**: what % of segments match the same song (by artist + title)
- **dominant_match**: the song that appears most frequently ("Artist - Title")
- **match_count**: total number of segment matches

example: if 3 out of 4 segments match "Taylor Swift - Love Story", `dominant_match_pct = 75`.

### pricing

- enterprise API, $2 per 1000 requests
- 1 request = 12 seconds of audio
- 5-minute track ~ 25 requests ~ $0.05

## interpreting results

### dominant match percentage

this is the only meaningful threshold signal. it answers: "what fraction of the audio consistently matches the same song?"

| dominant_match_pct | interpretation |
|-------------------|----------------|
| 85-100% | very high confidence — most of the audio is the same song |
| 50-84% | moderate confidence — significant overlap, but not conclusive |
| 30-49% | low confidence — some matches, could be samples or similar progressions |
| < 30% | noise — scattered matches across different songs, likely false positive |

### is_flagged

`is_flagged = dominant_match_pct >= MODERATION_COPYRIGHT_SCORE_THRESHOLD`

the threshold is configured via env var on the Rust service. default: 30%.

**known issue (march 2026)**: `fly.toml` sets `MODERATION_SCORE_THRESHOLD=70` but the Rust code reads `MODERATION_COPYRIGHT_SCORE_THRESHOLD`. since the actual env var is never set, the threshold falls through to the default of 30%. the effective threshold has been 30% since deployment.

### false positives

common causes:
- generic beats/samples reused across many songs
- covers or remixes (legal gray area)
- similar chord progressions or drum patterns
- audio artifacts matching by coincidence

this is why we flag but don't auto-enforce. human review in the admin dashboard is needed.

### ISRC codes

[International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) — unique identifier for recordings. when present in a match, this is strong evidence of a specific recording match (not just similar audio).

## database schema

### backend: copyright_scans table (Neon postgres)

```sql
CREATE TABLE copyright_scans (
    id SERIAL PRIMARY KEY,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,

    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    highest_score INTEGER NOT NULL DEFAULT 0,  -- always 0 with accurate_offsets
    matches JSONB NOT NULL DEFAULT '[]',       -- [{artist, title, isrc, ...}]
    raw_response JSONB NOT NULL DEFAULT '{}',  -- full AuDD response + dominant_match_pct

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(track_id)
);
```

### scan result states

| is_flagged | raw_response contains | meaning |
|------------|----------------------|---------|
| `false` | `dominant_match_pct: 0` | no matches found |
| `false` | `error: "..."` | scan failed, stored as clear |
| `true` | `dominant_match_pct: >= threshold` | matches found, admin notified via DM |

note: `highest_score` is always 0 and should be ignored. the meaningful data is in `raw_response.dominant_match_pct`.

## configuration

### backend environment variables

```bash
MODERATION_SERVICE_URL=https://moderation.plyr.fm
MODERATION_AUTH_TOKEN=shared_secret_token
MODERATION_TIMEOUT_SECONDS=300
MODERATION_ENABLED=true
```

### moderation service environment variables

```bash
# AuDD API
MODERATION_AUDD_API_TOKEN=your_audd_token
MODERATION_AUDD_API_URL=https://enterprise.audd.io/  # default

# flagging threshold (% of segments matching same song)
MODERATION_COPYRIGHT_SCORE_THRESHOLD=30  # default; fly.toml sets wrong var name

# auth
MODERATION_AUTH_TOKEN=shared_secret_token

# image moderation
ANTHROPIC_API_KEY=your_key  # for Claude image scanning
MODERATION_CLAUDE_MODEL=claude-sonnet-4-5-20250929  # default
```

## admin queries (Neon)

### list all flagged tracks

```sql
SELECT t.id, t.title, a.handle,
       cs.raw_response->>'dominant_match_pct' as dominant_pct,
       cs.raw_response->>'dominant_match' as dominant_song,
       jsonb_array_length(cs.matches) as match_count
FROM copyright_scans cs
JOIN tracks t ON t.id = cs.track_id
JOIN artists a ON a.did = t.artist_did
WHERE cs.is_flagged = true
ORDER BY (cs.raw_response->>'dominant_match_pct')::int DESC;
```

### scan statistics

```sql
SELECT
    is_flagged,
    COUNT(*) as count
FROM copyright_scans
GROUP BY is_flagged;
```

### tracks pending scan

```sql
SELECT t.id, t.title, t.created_at
FROM tracks t
LEFT JOIN copyright_scans cs ON cs.track_id = t.id
WHERE cs.id IS NULL
ORDER BY t.created_at DESC;
```

## code locations

| what | where |
|------|-------|
| scan trigger + result storage | `backend/src/backend/_internal/moderation.py` |
| moderation client (httpx wrapper) | `backend/src/backend/_internal/clients/moderation.py` |
| DM notification on flag | `backend/src/backend/_internal/notifications.py` |
| Redis stream publish | `backend/src/backend/_internal/moderation.py:_publish_moderation_event` |
| AuDD scanning + dominant match calc | `services/moderation/src/audd.rs` |
| is_flagged threshold check | `services/moderation/src/audd.rs:123` |
| config with env var names | `services/moderation/src/config.rs` |
| tests | `backend/tests/moderation/` (6 files) |

## related documentation

- [overview](overview.md) — architecture and philosophy
- [ATProto labeler](atproto-labeler.md) — label signing, admin dashboard, XRPC endpoints
- [sensitive content](sensitive-content.md) — image moderation
