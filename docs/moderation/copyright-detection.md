# copyright detection

technical documentation for the copyright scanning system.

## how it works

```
upload completes
       │
       ▼
┌──────────────┐     ┌─────────────────┐     ┌─────────────┐
│   backend    │────▶│   moderation    │────▶│  AuDD API   │
│ (background) │     │   service       │     │             │
│              │◀────│   (Rust)        │◀────│             │
└──────────────┘     └─────────────────┘     └─────────────┘
       │                    │
       │                    │ if flagged
       ▼                    ▼
┌──────────────┐     ┌─────────────────┐
│ copyright_   │     │  ATProto label  │
│ scans table  │     │  emission       │
└──────────────┘     └─────────────────┘
```

1. track upload completes, file stored in R2
2. backend calls moderation service `/scan` endpoint with R2 URL
3. moderation service calls AuDD API for music recognition
4. results returned to backend, stored in `copyright_scans` table
5. if flagged, backend calls `/emit-label` to create ATProto label
6. label stored in moderation service's `labels` table

## AuDD API

[AuDD](https://audd.io/) is a music recognition service similar to Shazam. their API scans audio and returns matched songs with confidence scores.

### request

```bash
curl -X POST https://api.audd.io/ \
  -F "api_token=YOUR_TOKEN" \
  -F "url=https://your-r2-bucket.com/audio/abc123.mp3" \
  -F "accurate_offsets=1"
```

### response

```json
{
  "status": "success",
  "result": [
    {
      "offset": 0,
      "songs": [
        {
          "artist": "Artist Name",
          "title": "Song Title",
          "album": "Album Name",
          "score": 85,
          "isrc": "USRC12345678",
          "timecode": "01:30"
        }
      ]
    },
    {
      "offset": 180000,
      "songs": [
        {
          "artist": "Another Artist",
          "title": "Another Song",
          "score": 72
        }
      ]
    }
  ]
}
```

### pricing

- $2 per 1000 requests
- 1 request = 12 seconds of audio
- 5-minute track ≈ 25 requests ≈ $0.05
- first 300 requests free

## database schema

### backend: copyright_scans table

```sql
CREATE TABLE copyright_scans (
    id SERIAL PRIMARY KEY,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,

    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    highest_score INTEGER NOT NULL DEFAULT 0,
    matches JSONB NOT NULL DEFAULT '[]',      -- [{artist, title, score, isrc}]
    raw_response JSONB NOT NULL DEFAULT '{}', -- full API response

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(track_id)
);
```

### moderation service: labels table

```sql
CREATE TABLE labels (
    id BIGSERIAL PRIMARY KEY,
    seq BIGSERIAL UNIQUE NOT NULL,           -- monotonic sequence for subscriptions
    src TEXT NOT NULL,                        -- labeler DID
    uri TEXT NOT NULL,                        -- target AT URI
    cid TEXT,                                 -- optional target CID
    val TEXT NOT NULL,                        -- label value (e.g., "copyright-violation")
    neg BOOLEAN NOT NULL DEFAULT FALSE,       -- negation (for revoking labels)
    cts TIMESTAMPTZ NOT NULL,                 -- creation timestamp
    exp TIMESTAMPTZ,                          -- optional expiration
    sig BYTEA NOT NULL,                       -- secp256k1 signature
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### scan result states

| is_flagged | highest_score | meaning |
|------------|---------------|---------|
| `false` | 0 | no matches found |
| `false` | 0 | scan failed (error in raw_response) |
| `true` | > 0 | matches found, label emitted |

## configuration

### backend environment variables

```bash
# moderation service connection
MODERATION_SERVICE_URL=https://moderation.plyr.fm
MODERATION_AUTH_TOKEN=shared_secret_token
MODERATION_TIMEOUT_SECONDS=300
MODERATION_ENABLED=true

# labeler URL (for emitting labels after scan)
MODERATION_LABELER_URL=https://moderation.plyr.fm
```

### moderation service environment variables

```bash
# AuDD API
AUDD_API_KEY=your_audd_token

# database
DATABASE_URL=postgres://...

# labeler identity
LABELER_DID=did:plc:your-labeler-did
LABELER_SIGNING_KEY=hex-encoded-secp256k1-private-key

# auth
MODERATION_AUTH_TOKEN=shared_secret_token
```

## interpreting results

### confidence scores

AuDD returns a score (0-100) for each match:

| score | meaning |
|-------|---------|
| 90-100 | very high confidence, almost certainly a match |
| 70-89 | high confidence, likely a match |
| 50-69 | moderate confidence, may be similar but not exact |
| < 50 | low confidence, probably not a match |

default threshold is 70. tracks with any match >= 70 are flagged.

### false positives

common causes:
- generic beats/samples used in multiple songs
- covers or remixes (legal gray area)
- similar chord progressions
- audio artifacts matching by coincidence

this is why we flag but don't enforce. human review is needed.

### ISRC codes

[International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) - unique identifier for recordings. when present, this is strong evidence of a specific recording match (not just similar audio).

## admin queries

### list all flagged tracks

```sql
SELECT t.id, t.title, a.handle, cf.confidence_score, cf.matched_tracks
FROM copyright_flags cf
JOIN tracks t ON t.id = cf.track_id
JOIN artists a ON a.did = t.artist_did
WHERE cf.status = 'flagged'
ORDER BY cf.confidence_score DESC;
```

### scan statistics

```sql
SELECT
    status,
    COUNT(*) as count,
    AVG(confidence_score) as avg_score
FROM copyright_flags
GROUP BY status;
```

### tracks pending scan

```sql
SELECT t.id, t.title, t.created_at
FROM tracks t
LEFT JOIN copyright_flags cf ON cf.track_id = t.id
WHERE cf.id IS NULL OR cf.status = 'pending'
ORDER BY t.created_at DESC;
```

## querying labels

labels can be queried via standard ATProto XRPC endpoints:

```bash
# query labels for a specific track
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:artist/fm.plyr.track/*"

# query all labels from our labeler
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?sources=did:plc:plyr-labeler"
```

response:

```json
{
  "labels": [
    {
      "src": "did:plc:plyr-labeler",
      "uri": "at://did:plc:artist/fm.plyr.track/abc123",
      "val": "copyright-violation",
      "cts": "2025-11-30T12:00:00.000Z",
      "sig": "base64-encoded-signature"
    }
  ]
}
```

## future considerations

### batch scanning existing tracks

```python
# scan all tracks that haven't been scanned
async def backfill_scans():
    async with get_session() as session:
        unscanned = await session.execute(
            select(Track)
            .outerjoin(CopyrightScan)
            .where(CopyrightScan.id.is_(None))
        )
        for track in unscanned.scalars():
            await scan_track_for_copyright(track.id, track.r2_url)
```

### label subscriptions

the moderation service exposes `com.atproto.label.subscribeLabels` for real-time label streaming. apps can subscribe to receive new labels as they're created.

### user-facing appeals

eventual flow:
1. artist sees flag on their track
2. artist submits dispute with evidence (license, original work proof)
3. admin reviews dispute
4. if resolved: emit negation label (`neg: true`) to revoke the original

### admin dashboard

considerations for where to build the admin UI:
- **option A**: add to main frontend (plyr.fm/admin) - simpler, reuse existing auth
- **option B**: separate UI on moderation service - isolated, but needs its own auth
- **option C**: use Ozone - Bluesky's open-source moderation tool, already built for ATProto labels

see [overview.md](./overview.md) for architecture discussion.
