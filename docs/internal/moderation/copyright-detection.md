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
│ (docket task,│     │   service       │     │ (enterprise, │
│  retried)    │◀────│   (Rust)        │◀────│  accurate    │
└──────────────┘     └─────────────────┘     │  offsets)    │
       │                                     └──────────────┘
       ├──decide what the matches are evidence of
       ├──store in copyright_scans
       └──if someone else's recording is present:
            open a review item + DM the operator
```

1. track upload completes, file stored in R2
2. backend schedules `scan_copyright` (docket, up to 4 attempts)
3. the task calls the moderation service `POST /scan` with the R2 URL
4. the service calls AuDD with `accurate_offsets=1` and returns the matches
5. the backend derives **evidence** from the matches
   (`_internal/copyright_evidence.py`) and drops recordings that are the
   uploader's own
6. the scan is stored; `is_flagged` is true when evidence of someone else's
   recording remains
7. if flagged, the backend opens a `flagged_by_scan` review item and DMs the
   operator with the recordings found and where in the upload they sit

the service fingerprints; the backend decides. Labels are never emitted
automatically — see [overview](overview.md).

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

### pricing

see `COSTS.md` and `scripts/costs/export_costs.py` for the plan constants; one
request is 12 seconds of audio.

## what counts as evidence

AuDD samples the upload every 12 seconds and reports, for each sample, the
reference recordings it resembles and the position inside each one
(`timecode`). It returns no confidence score. A match is cheap: 665 of the
1,092 scans in production on 2026-10-01 carried at least one, and most of
those are original work.

what separates a recording that is present from a coincidence is whether it
**plays through**. When a recording is in the upload, successive samples land
at successive positions in the same reference — the upload offset and the
reference timecode advance together. A coincidental match does not advance: it
is a different song at every sample, or the same reference loop matched at
unrelated positions.

`song_evidence()` counts, per reference recording, the largest set of samples
that stay in step (offset minus timecode within 8 seconds). Measured over
those 665 scans:

| best in-step run | scans |
|---|---|
| 1 sample | 522 |
| 2 | 18 |
| 3 | 7 |
| 4 | 2 |
| 5 | 5 |
| 6 or more | 106 |

the distribution has two humps and almost nothing between them, so the bar is
**4 samples in step** — about 48 seconds of one recording playing through.

one case needs a second rule. A short clip on repeat matches at every sample
but its timecode keeps resetting, so nothing stays in step for long. A
recording matched at 6 or more samples that are at least 80% of all matched
samples is also evidence. Two scans met only this rule on 2026-10-01; it is
tuned on far less data than the in-step rule.

### what the previous rule did

until October 2026 the Rust service flagged when one song was at least N% of
the *matches* (`dominant_match_pct`), or when three songs each matched at
three positions. The denominator was the match count, not the audio, so one
stray match was 1 of 1 = 100%. Of 27 flagged scans, 18 had no recording
playing through at all — several were ten-second test uploads — while 61
tracks that did have one were not flagged.

two other things were wrong at the same time, and are why the numbers above
looked the way they did:

- the deployed threshold was 30%, not the intended 70%. `fly.toml` was
  corrected to `MODERATION_COPYRIGHT_SCORE_THRESHOLD` but the service was not
  redeployed afterwards, so production still carried the old, unread name.
- every flag raised before 2026-06-29 was cleared within five minutes by the
  resolution sync (#1602). Only the 13 listed in the July worklist were
  restored. `scripts/rescore_copyright_scans.py` re-derives `is_flagged` from
  stored matches.

### self-matches

an artist's own distributed catalogue matches itself. `is_self_match()`
compares the reference artist with the uploader's handle and display name
(lowercased, alphanumerics only, substring either way, 4+ characters). It is
applied per recording, so one of the uploader's own tracks inside a mix does
not hide the others.

it misses a stage name that shares nothing with the handle or display name.
Those arrive in the queue and are acknowledged by hand.

### what evidence is not

a recording being present is not a finding. Covers, remixes, DJ mixes, and
public-domain readings all play through a reference. The flag puts a track in
front of a person; [label policy](label-policy.md) covers what happens next.

### failed scans

a scan that errors is retried by docket (4 attempts, 30 seconds to 10
minutes). If the last attempt fails, a row is stored with
`raw_response.status = "scan_failed"` and a `copyright scan failed` error is
logged. Previously a failure was stored as a clear scan on the first error and
never retried.

## database schema

### backend: copyright_scans table (Neon postgres)

```sql
CREATE TABLE copyright_scans (
    id SERIAL PRIMARY KEY,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,

    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    highest_score INTEGER NOT NULL DEFAULT 0,  -- always 0 with accurate_offsets
    matches JSONB NOT NULL DEFAULT '[]',       -- [{artist, title, isrc, ...}]
    raw_response JSONB NOT NULL DEFAULT '{}',  -- full AuDD response + evidence

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(track_id)
);
```

### scan result states

| is_flagged | raw_response contains | meaning |
|------------|----------------------|---------|
| `false` | `evidence: []` | no recording plays through |
| `false` | `evidence: [...]` | the only recordings found are the uploader's own |
| `false` | `status: "scan_failed"` | every attempt failed; the track is unscanned |
| `true` | `evidence: [...]` | someone else's recording is present; review opened |

scans stored before October 2026 have no `evidence` key until rescored.
`highest_score` is always 0 and should be ignored.

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
       cs.raw_response->'evidence'->0->>'artist' as artist,
       cs.raw_response->'evidence'->0->>'title' as recording,
       cs.raw_response->'evidence'->0->>'in_step_segments' as in_step
FROM copyright_scans cs
JOIN tracks t ON t.id = cs.track_id
JOIN artists a ON a.did = t.artist_did
WHERE cs.is_flagged = true
ORDER BY cs.scanned_at DESC;
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
| scan task + retry | `backend/src/backend/_internal/tasks/copyright.py` |
| evidence + self-match | `backend/src/backend/_internal/copyright_evidence.py` |
| result storage, review item, DM | `backend/src/backend/_internal/moderation.py` |
| moderation client (httpx wrapper) | `backend/src/backend/_internal/clients/moderation.py` |
| DM text | `backend/src/backend/_internal/notifications.py` |
| AuDD call | `services/moderation/src/audd.rs` |
| rescore stored scans | `scripts/rescore_copyright_scans.py` |
| tests | `backend/tests/_internal/test_copyright_evidence.py`, `test_copyright_self_match.py`, `backend/tests/test_moderation.py` |

## related documentation

- [overview](overview.md) — architecture and philosophy
- [ATProto labeler](atproto-labeler.md) — label signing, admin dashboard, XRPC endpoints
- [sensitive content](sensitive-content.md) — image moderation
