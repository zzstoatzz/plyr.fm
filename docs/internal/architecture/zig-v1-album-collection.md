---
title: "Zig v1 artist album collection"
---

## endpoint

`GET /v1/albums?artist_did={did}` returns verified public album records owned by
one canonical artist DID. The endpoint requires `artist_did`; global album
discovery remains a separate policy decision.

The collection accepts strict `limit` and opaque `cursor` parameters. Its
default limit is 20 and maximum is 100. Unknown, empty, duplicate, malformed,
or out-of-range parameters return `400 invalid_request`. Rows use authenticated
record creation time and AT-URI as descending keyset order. Each `albcur_`
cursor is cryptographically bound to the configured list collection and exact
artist scope, so it cannot be replayed across environments, owners, or resource
kinds.

## one verified substrate

Album collection and detail share `VerifiedListStore`; there is no album-only
legacy adapter. A collection item exists only when all of these are true:

1. an authenticated, non-deleted list record has `listType: album`;
2. the record belongs to the requested DID and configured collection;
3. authoritative account evidence says that owner is available;
4. ordered strong-reference membership was persisted from the same verified
   repository state.

The REST ID is an `alb_` base64url encoding of the canonical list AT-URI. A
local UUID, `(handle, slug)`, or legacy album row cannot create, order, rename,
or admit a v1 album.

## representation and provenance

Each summary exposes:

| group | meaning | source |
|---|---|---|
| `record` | list AT-URI, record CID, collection, and key | verified repository |
| `metadata` | authored name and timestamps | verified repository |
| `owner` | canonical DID and optional transitional profile | verified DID plus explicitly attributed legacy/mixed/derived presentation |
| `metrics` | signed member count, currently available count, and visible play total | verified membership plus derived application metrics |
| `projection` | repository verification, commit CID/revision, and index time | verified repository |

The response deliberately has no slug, description, artwork, local album UUID,
or legacy membership claim. Those values are not authored by the current list
lexicon. If the product retains them, they need a separately designed
presentation resource rather than being smuggled into a verified album.

Members that are private, moderated, unavailable, absent, or stale-CID remain
part of the signed member count but not the available count or visible play
total. This is the same non-leaking availability policy used by album detail.

## adapter boundary

The Postgres adapter knows the current `plyr_index` schema; the application
knows only `VerifiedListStore.CollectionRequest`. Album and playlist collection
therefore share account admission, profile attribution, cursor ordering, record
validation, and metric rules. Replacing Postgres or its table layout does not
change the REST application contract.

## local baseline

Recorded 2026-08-09 with the native ReleaseFast binary and disposable Postgres
fixture, returning one 1,000-byte verified album summary:

| concurrency | responses/s | p50 | p95 | p99 | RSS | errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1,172.9 | 0.788 ms | 1.200 ms | 1.621 ms | 3,872 KiB | 0 |
| 16 | 7,416.8 | 2.096 ms | 3.341 ms | 4.322 ms | 5,056 KiB | 0 |

Run `just zig bench-album-collection` to reproduce it. This covers HTTP,
scope/cursor parsing, pooled SQL, verified record and account admission, signed
membership availability, canonical metrics, provenance, and serialization. It
is a localhost regression baseline, not a Neon capacity claim.

## intentionally open

Artwork, descriptions, human-readable routing aliases, global discovery,
viewer state, and mutations remain separate capabilities. Writes must update
source-authoritative records and are not layered onto the retired local-first
album tables.
