---
title: "ATProto labeler service"
---

technical documentation for the moderation service's ATProto labeling capabilities.

## overview

the moderation service (`moderation.plyr.fm`) acts as an ATProto labeler — a service that produces signed labels about content. labels are metadata objects that follow the `com.atproto.label.defs#label` schema and can be queried by any ATProto-compatible app.

key distinction: **labels are signed data objects, not repository records**. they don't live in a user's repo — they're served directly by the labeler via XRPC endpoints.

## why labels?

from [Bluesky's labeling architecture](https://docs.bsky.app/docs/advanced-guides/moderation):

> "Labels are assertions made about content or accounts. They don't enforce anything on their own — clients decide how to interpret them."

this enables **stackable moderation**: multiple labelers can label the same content, and clients can choose which labelers to trust and how to handle different label values.

for plyr.fm, this means:
- we produce `copyright-violation` labels when admin confirms a match (or Osprey auto-emits)
- other ATProto apps can query our labels and apply their own policies
- users/apps can choose to subscribe to our labeler or ignore it
- we can revoke labels by emitting negations (`neg: true`)

## endpoints

the moderation service exposes these label-related endpoints:

### POST /emit-label

creates a signed ATProto label. called by the admin dashboard (manual) or Osprey output sink (automatic).

```bash
curl -X POST https://moderation.plyr.fm/emit-label \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
    "val": "copyright-violation",
    "neg": false,
    "context": {
      "track_id": 123,
      "artist_handle": "someone.bsky.social",
      "artist_did": "did:plc:abc123",
      "dominant_match_pct": 85,
      "match_count": 12,
      "dominant_match": "Artist - Song Title"
    }
  }'
```

the service:
1. creates label with current timestamp and labeler DID as `src`
2. encodes as DAG-CBOR (without `sig`)
3. signs SHA-256 hash with labeler's secp256k1 private key
4. stores in `labels` table with monotonic sequence number
5. stores context in `label_contexts` for admin dashboard display
6. broadcasts to WebSocket subscribers via `subscribeLabels`

response:

```json
{
  "seq": 12345,
  "label": {
    "src": "did:plc:plyr-labeler",
    "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
    "val": "copyright-violation",
    "cts": "2026-03-18T12:00:00.000Z",
    "sig": "base64-encoded-secp256k1-signature"
  }
}
```

### GET /xrpc/com.atproto.label.queryLabels

standard ATProto XRPC endpoint for querying labels.

```bash
# query by URI pattern
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?uriPatterns=at://did:plc:*"

# query by source (labeler DID)
curl "https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels?sources=did:plc:plyr-labeler"
```

### GET /xrpc/com.atproto.label.subscribeLabels

WebSocket endpoint for real-time label streaming. apps can subscribe to receive new labels as they're created (monotonic sequence cursor).

### POST /admin/active-labels

backend uses this to check which track URIs have active (non-negated) `copyright-violation` labels. powers the label cache in `backend/_internal/clients/moderation.py`.

```bash
curl -X POST https://moderation.plyr.fm/admin/active-labels \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uris": ["at://did:plc:abc123/fm.plyr.track/xyz789"]}'
```

## admin dashboard

the admin dashboard is an htmx UI served directly by the Rust moderation service at `/admin`. it's auth-protected via `X-Moderation-Key`.

### what it shows

- list of flagged tracks with status (pending/resolved)
- track title (linked to plyr.fm), artist handle (linked to profile)
- environment badge (stg/dev for non-production URIs)
- top 3 copyright matches per flag
- match count badge

### what it does

- **resolve false positives**: emits a negation label (`neg: true`) with a reason (false_positive, legitimate_use, etc.)
- **batch review**: create review batches for bulk processing
- htmx live updates via `flagsUpdated` event

### where the admin UI decision landed

the original overview discussed three options. we went with **option B** — the admin UI lives on the moderation service itself. this keeps moderation self-contained: scanning, labeling, and review all happen in one service.

## label values

| val | meaning | emitted by |
|-----|---------|------------|
| `copyright-violation` | confirmed copyright match | admin dashboard (now), Osprey high-confidence rule (future) |
| `copyright-review` | needs manual review | Osprey moderate-confidence rule (future) |

### negation labels

to revoke a label, emit the same label with `neg: true`:

```json
{
  "uri": "at://did:plc:abc123/fm.plyr.track/xyz789",
  "val": "copyright-violation",
  "neg": true
}
```

use cases:
- false positive resolved after admin review
- artist provided proof of licensing
- DMCA counter-notice accepted

## label signing

labels are signed using DAG-CBOR serialization with secp256k1 keys (same as ATProto repo commits).

signing process:
1. construct label object without `sig` field
2. encode as DAG-CBOR (deterministic CBOR)
3. compute SHA-256 hash of encoded bytes
4. sign hash with labeler's secp256k1 private key
5. attach 64-byte signature as `sig` field

this allows any client to verify labels came from our labeler by checking the signature against our public key (in our DID document).

## database schema (moderation service postgres)

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
```

## deployment

the moderation service runs on Fly.io as `plyr-moderation`:

```bash
fly logs -a plyr-moderation

# required secrets
fly secrets list -a plyr-moderation
# MODERATION_AUTH_TOKEN, MODERATION_AUDD_API_TOKEN, MODERATION_DATABASE_URL,
# MODERATION_LABELER_DID, MODERATION_LABELER_SIGNING_KEY, ANTHROPIC_API_KEY
```

deployment happens via CI on merge to main (no local `fly deploy`).

### feature gates

the Rust service has two feature gates (`config.rs`):
- `labeler_enabled()`: requires `MODERATION_DATABASE_URL` + `MODERATION_LABELER_DID` + `MODERATION_LABELER_SIGNING_KEY`
- `claude_enabled()`: requires `ANTHROPIC_API_KEY` + `MODERATION_DATABASE_URL`

if labeler isn't configured, `/emit-label` returns an error and the admin dashboard is unavailable.

## integration with backend

the backend interacts with the labeler in two ways:

1. **label cache** (`_internal/clients/moderation.py`): periodically checks which URIs have active labels via `POST /admin/active-labels`. used to determine track visibility.

2. **label invalidation**: when admin resolves a flag (negation label), the backend's cache is invalidated so the track becomes visible again.

the backend does **not** call `/emit-label` directly. labels are emitted by:
- admin via the htmx dashboard (manual)
- Osprey output sink calling `/emit-label` (future, automatic)

## troubleshooting

### label not appearing in queries

1. check moderation service logs: `fly logs -a plyr-moderation`
2. verify labeler is enabled: `GET /health` returns `labeler_enabled: true`
3. query labels table directly via the database

### signature verification failing

1. ensure `MODERATION_LABELER_SIGNING_KEY` matches DID document's public key
2. check DAG-CBOR encoding is deterministic
3. verify hash algorithm is SHA-256

## references

- [ATProto Labeling Spec](https://atproto.com/specs/label)
- [Bluesky Moderation Guide](https://docs.bsky.app/docs/advanced-guides/moderation)
- [DAG-CBOR Spec](https://ipld.io/specs/codecs/dag-cbor/spec/)
- [AuDD API Docs](https://docs.audd.io/)
