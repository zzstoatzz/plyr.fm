---
title: "Zig v1 track resource"
---

## endpoint

`GET /v1/tracks/{track_id}` is the first complete Zig REST slice. It composes one
public, published track from independently attributed Postgres projections. Authentication
and private-track authorization are deliberately not implicit: private records
remain `404` until the v1 viewer and space-authorization contract exists.

The endpoint returns:

- `200` for an indexed public track;
- `400 invalid_request` when the identifier is malformed;
- `404 not_found` for a missing track, a private track, or a valid record from a
  different configured collection;
- `503 service_unavailable` when the derived index is unavailable.

Projection corruption is not reported as temporary unavailability. Invalid
row types, malformed persisted JSON, authority mismatches, and invalid content
CIDs return `500 internal_error` and emit an invariant log. The `TrackStore`
port uses an explicit error set so new adapters must make this distinction.

Every response carries `x-request-id`; errors also include it in the stable JSON
error envelope. Credentialed CORS reflects only exact origins listed in
`CORS_ALLOWED_ORIGINS`.

## identity

The path ID has the form `trk_<base64url-no-padding>`. Its decoded payload is a
full canonical track-record AT-URI with a DID authority, collection, and record
key. This encoding is:

- deterministic and collision-free;
- reversible without a plyr.fm database;
- safe as one URL path segment;
- independent of the Python `tracks.id` sequence;
- opaque to clients, which must not construct or parse it as application logic.

The endpoint validates the decoded collection against `TRACK_COLLECTION_NSID`.
This prevents a dev, staging, production, or non-track record ID from crossing
the API boundary while keeping environment-specific NSIDs out of source code.

## representation boundary

The response separates facts by ownership:

| object | ownership |
|---|---|
| `record` | canonical AT-URI identity plus the indexed CID and repository revision |
| `metadata` | projection of record-authored track metadata |
| `artist.did` | canonical portable artist identity |
| `artist.profile` | mutable profile projection resolved for presentation |
| `media.artifacts` | content-addressed media claims, including who declared them and what has been verified |
| `media.origins` | retrieval locations and optional service-owned availability attestations |
| `access` | app-view visibility, discovery, gate, and permissioned-space projection |
| `moderation` | author self-labels, operator labels, and overrides with provenance kept separate |
| `metrics` | explicitly derived app-view aggregates |
| `sources` | field-family provenance for every claim composed into the response |
| `projection` | appview freshness and verification state, never record-authored data |

The adapter's authority map is explicit:

| claim | current source |
|---|---|
| record identity, CID/revision, metadata, blob declaration, authored URL, self-labels | authenticated repository projection |
| account availability | verified repository activity or a current-PDS check |
| authored avatar and bio | independently authenticated profile record |
| handle and display name | transitional legacy artist projection |
| publication and visibility | canonical-URI application access policy |
| operator moderation | canonical-URI labeler projection with independent provenance |
| plays | canonical-URI application metrics rollup |
| R2 URL verified against a record blob | dedicated delivery-origin projection |
| other R2 URL | transitional legacy projection, without a verification claim |

Legacy implementation fields do not appear: local integer ID, `file_id`,
`original_file_id`, `audio_storage`, and bare `r2_url`. A verified record's PDS
blob reference normally becomes an artifact with `verification: declared`.

The Python PDS mirror verifies fetched bytes against that raw-blob CID before
writing R2 and now persists the relationship in
`plyr_index.track_delivery_origins`. Evidence is bound to both record URI and
record CID, so a later record revision cannot inherit a stale delivery claim.
Zig then marks the artifact `verified`, exposes an origin whose `artifact_cid`
points to it, and attributes that origin to `verified_delivery`. This is direct
content evidence, not a signed service attestation, so `attestation` remains
null. Any other legacy R2 URL stays an unverified `legacy_projection` fallback.

`projection.indexed_at` and `projection.verification: verified_repo` now come
from the authenticated record projection. This label covers only the canonical
record path; it cannot launder local policy or delivery into authored truth
because the response also carries field-level `sources`.

## adapter invariants

The PostgreSQL adapter:

1. queries by canonical AT-URI, never local integer ID;
2. requires the URI authority to equal the joined artist DID;
3. excludes private and pending publications;
4. emits UTC RFC 3339 timestamps;
5. copies all row data into a request arena before releasing the pooled result;
6. parses label JSON into typed string arrays rather than passing raw JSON
   through the API;
7. exposes the storage implementation only through a small `TrackStore` port.
8. releases or poisons the pooled connection even when draining a result fails;
   cleanup errors are never silently swallowed.

The integration test brings up the existing disposable Postgres container and
exercises the real SQL decoder. Unit tests cover ID round trips, collection
isolation, JSON shape, routing, error envelopes, and exact-origin CORS.

## known next boundary

The REST read now requires an authenticated record and authoritative account
availability. A matching legacy row can enrich the response but is not required,
so a valid PDS-only track is readable with derived public defaults. Verified R2
mirrors no longer depend on the legacy row for their evidence. The remaining
legacy row is optional presentation/delivery enrichment rather than record
admission, moderation, ordering, or metric authority. The next boundary is to
replace those final compatibility fields while preserving the response contract.
