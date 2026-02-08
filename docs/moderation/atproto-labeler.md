# ATProto labeler service

technical documentation for the moderation service's ATProto labeling capabilities.

## overview

the moderation service (`moderation.plyr.fm`) acts as an ATProto labeler - a service that produces signed labels about content. labels are metadata objects that follow the `com.atproto.label.defs#label` schema and can be queried by any ATProto-compatible app.

key distinction: **labels are signed data objects, not repository records**. they don't live in a user's repo - they're served directly by the labeler via XRPC endpoints.

## why labels?

from [Bluesky's labeling architecture](https://docs.bsky.app/docs/advanced-guides/moderation):

> "Labels are assertions made about content or accounts. They don't enforce anything on their own - clients decide how to interpret them."

this enables **stackable moderation**: multiple labelers can label the same content, and clients can choose which labelers to trust and how to handle different label values.

for plyr.fm, this means:
- we produce `copyright-violation` labels when tracks are flagged
- other ATProto apps can query our labels and apply their own policies
- users/apps can choose to subscribe to our labeler or ignore it
- we can revoke labels by emitting negations (`neg: true`)

## architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     moderation service                           │
│                     (moderation.plyr.fm)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  /scan      │    │ /emit-label │    │ /xrpc/com.atproto.  │  │
│  │  endpoint   │    │  endpoint   │    │ label.queryLabels   │  │
│  └──────┬──────┘    └──────┬──────┘    └──────────┬──────────┘  │
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   AuDD      │    │   sign      │    │   query labels      │  │
│  │   client    │    │   label     │    │   from postgres     │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                            │                                     │
│                            ▼                                     │
│                     ┌─────────────┐                              │
│                     │   labels    │                              │
│                     │   table     │                              │
│                     └─────────────┘                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## endpoints

### POST /scan

scans audio for copyright matches via AuDD.

```bash
curl -X POST https://moderation.plyr.fm/scan \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audio_url": "https://r2.plyr.fm/audio/abc123.mp3"}'
```

response:

```json
{
  "matches": [
    {
      "artist": "Taylor Swift",
      "title": "Love Story",
      "score": 95,
      "isrc": "USRC10701234"
    }
  ],
  "is_flagged": true,
  "highest_score": 95,
  "raw_response": { ... }
}
```

### POST /emit-label

creates a signed ATProto label.

```bash
curl -X POST https://moderation.plyr.fm/emit-label \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
    "val": "copyright-violation",
    "cid": "bafyreiabc123"
  }'
```

the service:
1. creates label with current timestamp
2. signs with labeler's secp256k1 private key (DAG-CBOR encoded)
3. stores in `labels` table with monotonic sequence number

### GET /xrpc/com.atproto.label.queryLabels

standard ATProto XRPC endpoint for querying labels.

```bash
# query by URI pattern
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*"

# query by source (labeler DID)
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?sources=did:plc:plyr-labeler"

# query by cursor (pagination)
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?cursor=123&limit=50"
```

response:

```json
{
  "cursor": "456",
  "labels": [
    {
      "ver": 1,
      "src": "did:plc:plyr-labeler",
      "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
      "cid": "bafyreiabc123",
      "val": "copyright-violation",
      "neg": false,
      "cts": "2025-11-30T12:00:00.000Z",
      "sig": "base64-encoded-secp256k1-signature"
    }
  ]
}
```

## label signing

labels are signed using DAG-CBOR serialization with secp256k1 keys (same as ATProto repo commits).

signing process:
1. construct label object without `sig` field
2. encode as DAG-CBOR (deterministic CBOR)
3. compute SHA-256 hash of encoded bytes
4. sign hash with labeler's secp256k1 private key
5. attach signature as `sig` field

this allows any client to verify labels came from our labeler by checking the signature against our public key (in our DID document).

## label values

current supported values:

| val | meaning | when emitted |
|-----|---------|--------------|
| `copyright-violation` | track flagged for potential copyright infringement | scan returns matches |

future values could include:
- `explicit` - explicit content marker
- `spam` - suspected spam upload
- `dmca-takedown` - formal DMCA notice received

## negation labels

to revoke a label, emit the same label with `neg: true`:

```json
{
  "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
  "val": "copyright-violation",
  "neg": true
}
```

use cases:
- false positive resolved after manual review
- artist provided proof of licensing
- DMCA counter-notice accepted

## database schema

```sql
CREATE TABLE labels (
    id BIGSERIAL PRIMARY KEY,
    seq BIGSERIAL UNIQUE NOT NULL,     -- monotonic for subscribeLabels cursor
    src TEXT NOT NULL,                  -- labeler DID
    uri TEXT NOT NULL,                  -- target AT URI
    cid TEXT,                           -- optional target CID
    val TEXT NOT NULL,                  -- label value
    neg BOOLEAN NOT NULL DEFAULT FALSE, -- negation flag
    cts TIMESTAMPTZ NOT NULL,           -- creation timestamp
    exp TIMESTAMPTZ,                    -- optional expiration
    sig BYTEA NOT NULL,                 -- signature bytes
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_labels_uri ON labels(uri);
CREATE INDEX idx_labels_src ON labels(src);
CREATE INDEX idx_labels_seq ON labels(seq);
CREATE INDEX idx_labels_val ON labels(val);
```

## deployment

the moderation service runs on Fly.io:

```bash
# deploy
cd services/moderation && fly deploy

# check logs
fly logs -a plyr-moderation

# secrets
fly secrets set -a plyr-moderation \
  LABELER_DID=did:plc:xxx \
  LABELER_SIGNING_KEY=hex-private-key \
  DATABASE_URL=postgres://... \
  AUDD_API_KEY=xxx \
  MODERATION_AUTH_TOKEN=xxx
```

## integration with backend

the backend calls the moderation service in two places:

1. **scan on upload** (`_internal/moderation.py:scan_track_for_copyright`)
   - POST to `/scan` with R2 URL
   - store result in `copyright_scans` table

2. **emit label on flag** (`_internal/moderation.py:_store_scan_result`)
   - if `is_flagged` and track has `atproto_record_uri`
   - POST to `/emit-label` with track's AT URI and CID

```python
async def _emit_copyright_label(uri: str, cid: str | None) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"{settings.moderation.labeler_url}/emit-label",
            json={"uri": uri, "val": "copyright-violation", "cid": cid},
            headers={"X-Moderation-Key": settings.moderation.auth_token},
        )
```

## troubleshooting

### label not appearing in queries

1. check moderation service logs for emit errors
2. verify track has `atproto_record_uri` set
3. query labels table directly:
   ```sql
   SELECT * FROM labels WHERE uri LIKE '%track_rkey%';
   ```

### signature verification failing

1. ensure `LABELER_SIGNING_KEY` matches DID document's public key
2. check DAG-CBOR encoding is deterministic
3. verify hash algorithm is SHA-256

### scan returning empty matches

AuDD requires actual audio fingerprints. common issues:
- audio too short (< 3 seconds usable)
- microphone recordings don't match source audio
- very low bitrate or corrupted files

## references

- [ATProto Labeling Spec](https://atproto.com/specs/label)
- [Bluesky Moderation Guide](https://docs.bsky.app/docs/advanced-guides/moderation)
- [DAG-CBOR Spec](https://ipld.io/specs/codecs/dag-cbor/spec/)
- [AuDD API Docs](https://docs.audd.io/)
