---
title: "Zig v1 track resource"
---

## endpoint

`GET /v1/tracks/{track_id}` is the first complete Zig REST slice. It reads one
public, published track from the rebuildable Postgres projection. Authentication
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
| `projection` | appview freshness and verification state, never record-authored data |

Legacy implementation fields do not appear: local integer ID, `file_id`,
`original_file_id`, `audio_storage`, and `r2_url`. A PDS blob reference becomes
an artifact with `verification: declared`. The old R2 URL becomes an origin, but
both its `artifact_cid` and `attestation` are null: the legacy row did not persist
either proof, so v1 does not infer them from co-located columns.

The Python mirror now verifies PDS bytes against their blob CID before writing
R2, but the legacy track row does not persist that verification as an explicit
fact. V1 therefore does not claim a delivery is verified merely because
`r2_url` and `pds_blob_cid` coexist. A future projection should store the
verified CID/digest relationship. Once a new projection persists the proof, it
can mark the artifact verified and bind an origin to that artifact without
changing the ownership model.

The legacy table also lacks an ingest timestamp and proof that the row came
through verified repository ingestion. Its `projection.indexed_at` is therefore
null and its `projection.verification` is `legacy_unverified`. New indexes must
persist both facts rather than reconstructing them from track creation time.

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

This read proves the REST/index seam; it does not prove the index is fresh or
that its record was ingested through a verified repository path. Verified CAR,
commit, MST, and blob ingestion remains a prerequisite of a trustworthy
production projection and is intentionally a separate subsystem from this REST
server.
