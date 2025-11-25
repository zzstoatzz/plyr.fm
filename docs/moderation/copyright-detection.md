# copyright detection

technical documentation for the copyright scanning system.

## how it works

```
upload completes
       │
       ▼
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   backend    │────▶│  AuDD API   │────▶│   database   │
│ (background) │     │             │     │ (copyright_  │
│              │◀────│             │     │    flags)    │
└──────────────┘     └─────────────┘     └──────────────┘
                           │
                           ▼
                    music recognition
                    against licensed
                    database
```

1. track upload completes, file stored in R2
2. background job sends R2 URL to AuDD API
3. AuDD scans file against their music database
4. results stored in `copyright_flags` table
5. admin can query flagged tracks

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

```sql
CREATE TABLE copyright_flags (
    id SERIAL PRIMARY KEY,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,

    -- status: pending | scanning | clear | flagged | error
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    -- AuDD data
    audd_response JSONB,        -- full API response
    matched_tracks JSONB,       -- [{artist, title, score, isrc}]
    confidence_score INTEGER,   -- highest match score (0-100)

    -- timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,

    -- metadata
    scanned_by VARCHAR(50),     -- 'audd', 'manual'
    error_message TEXT,

    UNIQUE(track_id)
);
```

### status meanings

| status | description |
|--------|-------------|
| `pending` | awaiting scan |
| `scanning` | scan in progress |
| `clear` | no matches above threshold |
| `flagged` | matches found above threshold |
| `error` | scan failed |

## configuration

```bash
# required
AUDD_API_TOKEN=your_token_here

# optional (have defaults)
AUDD_API_URL=https://api.audd.io/
AUDD_TIMEOUT_SECONDS=300

# scan behavior
MODERATION_SCORE_THRESHOLD=70   # flag if score >= this
MODERATION_AUTO_SCAN=true       # scan on upload
MODERATION_ENABLED=true         # master switch
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

## future considerations

### batch scanning existing tracks

```python
# scan all tracks that haven't been scanned
async def backfill_scans():
    async with get_session() as session:
        unscanned = await session.execute(
            select(Track)
            .outerjoin(CopyrightFlag)
            .where(CopyrightFlag.id.is_(None))
        )
        for track in unscanned.scalars():
            await scan_track_for_copyright(track.id, track.r2_url)
```

### ATProto labels

future integration could publish copyright status as ATProto labels:

```json
{
  "$type": "com.atproto.label.defs#label",
  "src": "did:plc:plyr-moderation",
  "uri": "at://did:plc:artist/fm.plyr.track/abc123",
  "val": "copyright-flagged",
  "cts": "2025-11-24T12:00:00Z"
}
```

this would allow other apps in the ATProto ecosystem to see and act on our moderation signals.

### user-facing appeals

eventual flow:
1. artist sees flag on their track
2. artist submits dispute with evidence (license, original work proof)
3. admin reviews dispute
4. flag status updated to `resolved` or `confirmed`
