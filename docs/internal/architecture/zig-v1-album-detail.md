---
title: "Zig v1 verified album detail"
---

## endpoint

`GET /v1/albums/{album_id}` returns one verified album-list record and its
complete ordered strong-reference membership. The opaque `alb_` identifier is
the reversible base64url encoding of the canonical list-record AT-URI; a local
album UUID or mutable `(handle, slug)` pair is never resource identity.

The endpoint returns:

- `200` for a live verified album projection;
- `400 invalid_request` for a malformed opaque identifier;
- `404 not_found` for an absent album or an ID from another configured list
  collection;
- `503 service_unavailable` when the index is disabled or unreachable;
- `500 internal_error` when persisted verified state violates an invariant.

The collection name comes from `LIST_COLLECTION_NSID`; it is not hardcoded.

## authority and availability

The list record is authoritative for membership and order. Every authored
strong reference appears at its exact zero-based position as:

```json
{
  "position": 1,
  "subject": {"uri": "at://...", "cid": "bafy..."},
  "availability": "unavailable",
  "track": null
}
```

`unavailable` deliberately does not reveal whether the referenced track is
missing, private, unpublished, moderated, deactivated, or present under a
different CID. This preserves authored album structure without turning direct
album reads into an index-state or access-policy oracle. A full `track` is
attached only when the public projection has the exact referenced AT-URI and
record CID and passes the direct-content-view policy.

The adapter never appends legacy `tracks.album_id` rows, compacts unavailable
positions, repairs gaps, or invents fallback ordering. A non-contiguous
projection is corruption and fails the whole response.

## representation

| group | meaning | authority |
|---|---|---|
| `record` | list AT-URI, record CID, collection, and record key | verified repository record |
| `metadata` | list name and authored timestamps | verified repository record |
| `members[].subject` | ordered track URI/CID strong reference | verified repository record |
| `members[].track` | optional public track hydration | rebuildable app-view projection |
| `metrics` | member count, available count, and visible-track play sum | derived per response from membership and canonical metrics rollups |
| `projection` | verified commit CID/revision and ingest time | verified ingestion evidence |

Local description, slug, artwork, UUID, and `album_id` are absent. Those fields
can become separately attributed presentation resources later; their absence
is preferable to representing local compatibility state as PDS-authored data.

## one-query adapter

The PostgreSQL adapter performs one ordered query over
`plyr_index.list_records`, `plyr_index.list_members`, and the same composed
track/artist projection used by standalone track reads. Albums and playlists
share this verified-list adapter; list kind and opaque resource identity are
application inputs rather than separate SQL implementations. It validates:

1. list URI authority, environment collection, record key, and DAG-CBOR CID;
2. verified commit DAG-CBOR CID, TID revision, and non-negative ingest time;
3. contiguous non-negative member positions;
4. every member's track URI authority/collection/key and DAG-CBOR CID;
5. exact URI/CID equality before hydrating a public track;
6. overflow-safe metric aggregation.

The application depends only on `VerifiedListStore`; legacy table names and SQL
policy remain inside this replaceable adapter. Track decoding and public-view
admission are exported once by `PostgresComposedTrackStore`, so a track cannot
silently be visible standalone but unavailable in an album, or vice versa.

## local baseline

Recorded 2026-08-09 on an Apple M5 Pro with Zig 0.16.0, ReleaseFast, and the
guarded disposable Postgres 14 `zig_bench` fixture. The response contains 20
ordered members and 20 complete hydrated track resources:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 341.9 | 2.797 ms | 4.129 ms | 5.690 ms | 0 |
| 16 | 1,905.9 | 6.521 ms | 12.116 ms | 21.020 ms | 0 |

The 44,229-byte response used the shared composed-track representation. The Zig
process held 3,440 KiB RSS at concurrency one and 6,320 KiB at concurrency 16.

Run `just zig bench-album-detail` to recreate the fixture and both measurements.
The command refuses destructive setup outside the database named `zig_bench`.
This is a local regression baseline, not a Neon or Fly capacity claim. It
supersedes the faster simplified album-only adapter baseline, which did not run
the canonical composed-track admission and decoding path.

## intentionally open

The endpoint can read projections produced by the verified commit and complete
repository snapshot stores. Destination-safe repair and the separately
deployable continuous relay consumer are wired but not deployed. Album writes,
artwork, viewer state, private/gated authorization, and
presentation-field authorship remain separate capability work rather than
being grafted onto this read.
