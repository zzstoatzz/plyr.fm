---
title: "ATProto labeler service"
---

technical documentation for the moderation service's ATProto labeling capabilities.

## overview

the moderation service (`moderation.plyr.fm`) acts as an ATProto labeler — a service that produces signed labels about content. labels are metadata objects that follow the `com.atproto.label.defs#label` schema and can be queried by any ATProto-compatible app.

key distinction: **labels are signed data objects, not repository records**. they don't live in a user's repo — they're served directly by the labeler via XRPC endpoints.

creator self-labels are the complementary mechanism: they live inside the
creator's repository record as `com.atproto.label.defs#selfLabels`. plyr.fm
preserves the two provenances separately and evaluates their union; the labeler
must not re-emit a creator assertion as though it were an operator decision.

the labeler's data lives in the separate Neon project `plyr-moderation`
(`rough-hall-37695610`), not the `plyr-prd` application database.

## why labels?

from [Bluesky's labeling architecture](https://docs.bsky.app/docs/advanced-guides/moderation):

> "Labels are assertions made about content or accounts. They don't enforce anything on their own — clients decide how to interpret them."

this enables **stackable moderation**: multiple labelers can label the same content, and clients can choose which labelers to trust and how to handle different label values.

for plyr.fm, this means:
- we produce `copyright-violation` labels when admin confirms a match (or Osprey auto-emits)
- we use global ATProto content labels such as `sexual` and `porn` for audio as
  well as images; the media type does not change the label vocabulary
- other ATProto apps can query our labels and apply their own policies
- users/apps can choose to subscribe to our labeler or ignore it
- we can revoke labels by emitting negations (`neg: true`)

## endpoints

the moderation service exposes these label-related endpoints:

### POST /emit-label

creates a signed ATProto label. called by the copyright admin dashboard, a
generic operator request, or a future rules-engine output sink. See the
[sensitive-audio runbook](../runbooks/moderating-sensitive-audio.md) before using
it for an adult-audio action.

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

`MODERATION_AUTH_TOKEN` authorizes this endpoint. The similarly named
`MODERATION_BSKY_PASSWORD` is only an app password for updating the labeler
account's repository declaration and cannot authorize HTTP label emission.

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

### POST /admin/labels

the backend uses this generic endpoint to fetch the current active values for
each subject URI. This is the primary consumer API for discovery and playback
policy.

```json
{
  "uris": ["at://did:plc:abc123/fm.plyr.track/xyz789"]
}
```

```json
{
  "labels": {
    "at://did:plc:abc123/fm.plyr.track/xyz789": ["sexual"]
  }
}
```

`POST /admin/active-labels` remains as a compatibility projection for the
copyright synchronization task and returns only `copyright-violation` subjects.

current state is the latest event for each `(src, uri, val)` tuple. A historical
negation does not permanently suppress a newer positive label, and a newer
negation revokes the positive state without deleting either event.

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
| `sexual` | sexually suggestive or explicit content; global ATProto value | creator PDS record and/or operator labeler |
| `porn` | pornographic content; global ATProto value | creator PDS record and/or operator labeler |

`sexual` and `porn` are deliberately not plyr.fm-specific inventions. They are
global ATProto label values, and ATProto's media labels apply to audio as well as
images and video. A label is an assertion; plyr.fm's separate policy layer maps
both values to the adult-audio preference and keeps anonymous access disabled.

creator removal and labeler negation are intentionally independent. A creator
can remove only their repo assertion; they cannot clear an operator label by
editing the track. Likewise, negating an operator label does not rewrite the
creator's repository.

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

### operator access

run the [agent access preflight](../tools/agent-access.md) before an incident.
Public health and XRPC label queries require no credential. Protected writes
require `MODERATION_AUTH_TOKEN`; the signing key stays inside the Fly service and
must never be copied into an operator environment.

### feature gates

the Rust service has two feature gates (`config.rs`):
- `labeler_enabled()`: requires `MODERATION_DATABASE_URL` + `MODERATION_LABELER_DID` + `MODERATION_LABELER_SIGNING_KEY`
- `claude_enabled()`: requires `ANTHROPIC_API_KEY` + `MODERATION_DATABASE_URL`

if labeler isn't configured, `/emit-label` returns an error and the admin dashboard is unavailable.

## integration with backend

the backend interacts with the labeler in three ways:

1. **generic label cache** (`_internal/clients/moderation.py`): fetches complete active value sets via `POST /admin/labels`. used for discovery and playback policy.

2. **copyright compatibility**: `POST /admin/active-labels` and `/admin/negated-labels` drive the legacy copyright synchronization task.

3. **strict byte authorization**: the audio endpoint requires a current label
   check and returns `503` rather than serving possibly adult audio when the
   labeler cannot be reached.

the backend does **not** call `/emit-label` directly. labels are emitted by an
operator or the copyright dashboard. A first-class generic-label operator UI or
CLI remains a tooling gap.

the cache includes empty label sets. After an urgent label write, invalidate the
label, discovery, album, and radio caches using the runbook or wait for their
TTL; otherwise a newly labeled track can remain in a previously serialized
response temporarily.

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
