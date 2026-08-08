---
title: "Zig v1 artist album collection"
---

## endpoint

`GET /v1/albums?artist_did={did}` returns the public albums authored by one
canonical artist DID. The initial endpoint requires `artist_did`; a global
album discovery policy has not been inferred from the legacy all-albums route.

The collection accepts the same strict `limit` and opaque `cursor` conventions
as tracks. Its default limit is 20 and maximum is 100. Unknown, empty,
duplicate, malformed, or out-of-range parameters return `400 invalid_request`.
The artist DID and any percent escapes are validated before index access.

Rows use `(created_at DESC, atproto_record_uri DESC)` keyset ordering. An
`albcur_` cursor is scoped to both the configured list collection and artist
DID; a cursor from another resource, environment, or artist is invalid.

## canonical identity

An album is public in v1 only when it has a complete `fm.plyr.list` record URI
and CID. Its REST ID is an `alb_` base64url encoding of that AT-URI. The local
album UUID never crosses the API boundary, and `(handle, slug)` is not treated
as durable identity.

This deliberately excludes two legacy states:

- a local album without a list-record URI is unfinished migration state, not a
  decentralized album;
- a list record with no publicly viewable indexed member tracks is not exposed
  as a public album card.

The adapter validates URI authority, collection, record key, and DAG-CBOR CID.
Invalid projected identity is a `500 internal_error`, distinct from an
unavailable index.

## representation and provenance

The response separates:

| group | meaning | current provenance |
|---|---|---|
| `record` | canonical list AT-URI, CID, collection, and record key | legacy unverified projection |
| `metadata` | projected list name and timestamps | legacy unverified projection |
| `presentation` | slug, description, and artwork URL | legacy app-local state |
| `artist` | canonical DID plus projected profile fields | derived join |
| `metrics` | visible member count and summed plays | derived from the legacy local membership relationship |

The current `fm.plyr.list` lexicon authors `name`, `listType`, ordered strong
references, and timestamps. It does not author description, slug, or artwork.
Those useful compatibility fields therefore remain visibly local presentation
state rather than being mislabeled as PDS-owned metadata. `image_id` and the
local UUID are omitted entirely.

The collection summary still labels membership `legacy_local`: `album_id` is
not proof that the projected relationship matches the strong-reference order
in the list record. The separate album-detail resource now reads the verified
ordered-membership projection and does not inherit this summary compromise.

## public catalogue policy

Counts include only indexed track records that are published, non-private, and
not actively copyright-blocked or operator-excluded. Adult-audio labels remain
visible because an artist catalogue is a direct content-view context, not a
feed selected for the listener. Deactivated artists and albums from another
environment-aware list collection are excluded in SQL before ordering and
`LIMIT`.

The query borrows the existing Postgres pool. `AlbumStore` exposes no legacy
table concepts, so a verified repository projection can replace the initial
adapter without changing the application or HTTP contract.

## local baseline

Recorded 2026-08-08 with the ReleaseFast binary and disposable Postgres 14
fixture, returning two complete album summaries:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 2,769.6 | 0.351 ms | 0.418 ms | 0.596 ms | 0 |
| 16 | 8,838.9 | 1.620 ms | 3.478 ms | 4.799 ms | 0 |

This exercises routing, percent decoding, DID and cursor validation, pooled SQL
aggregation, public-member policy, strict URI/CID decoding, and serialization.
It is a localhost regression baseline, not a Neon production capacity claim.

## intentionally open

The verified album-detail contract is documented in
[`zig-v1-album-detail.md`](zig-v1-album-detail.md). The remaining ingestion gap
is operational: destination-safe relay/PDS transport and the separately
deployable firehose role must feed the verifier already implemented. Mutations
must write source-authoritative records and are not added on top of the legacy
local-first finalization flow. Global discovery, viewer state, artwork
mirroring, and description authorship remain separate design work.
