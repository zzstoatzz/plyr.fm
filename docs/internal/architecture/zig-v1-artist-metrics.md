---
title: "Zig v1 artist metrics"
---

## endpoint

`GET /v1/artists/{identifier}/metrics` returns public aggregate facts for one
artist catalog. The identifier may be a canonical DID or current handle alias,
but the response always names the resolved DID. It is separate from
`GET /v1/artists/{identifier}` because application metrics are neither artist
identity nor authored profile metadata.

The endpoint returns:

- `200` for a public artist, including zero totals when they have no admitted tracks;
- `400 invalid_request` for an invalid DID or handle;
- `404 not_found` when the public artist does not exist;
- `500 internal_error` for corrupt projected identity or aggregate state;
- `503 service_unavailable` when either required projection is unavailable.

## authority

The aggregate deliberately combines two kinds of fact:

| response field | authority |
|---|---|
| catalog membership | authenticated, non-deleted repository track records |
| duration | authored duration on those verified records; absent duration is zero |
| play count | application-owned canonical-URI metric projection; absent metric is zero |
| top-track identity and title | verified record URI, CID, and authored title |

The endpoint does not read legacy numeric track IDs, legacy creation times, or
the legacy `tracks.play_count` compatibility mirror. Likes and a platform-wide
artist rank are omitted rather than copied from an authority model we do not
want to preserve. The existing frontend compatibility adapter consequently
maps `top_liked` and `rank` to `null`.

## admission and consistency

The Postgres adapter materializes one admitted-record relation and derives both
totals and the top track from that same relation. Admission requires current
account availability and excludes deleted records, private visibility,
operator exclusion, and copyright-violation labels without an explicit
operator allow. Supporter-gated tracks remain part of the artist's catalog and
aggregate, matching the artist-scoped track collection rather than global
anonymous discovery.

The top track is deterministic: descending canonical play count, then record
creation time, then record URI. A missing metric row is zero. Invalid negative
aggregates, a partial top-track row, a top track owned by another DID, malformed
AT URIs, or a non-DAG-CBOR CID are projection corruption rather than acceptable
partial responses.

## boundaries and verification

The application first uses `ArtistStore` to resolve and admit the public artist,
then calls the schema-independent `ArtistMetricStore` with only canonical DID
and configured track collection. The Postgres adapter alone knows the current
projection tables and borrows the existing bounded pool.

Unit tests prove alias canonicalization, artist-first absence semantics, JSON
provenance, exact routing, and strict percent decoding of the identifier path
segment. A guarded Postgres integration test proves that
private and copyright-blocked records cannot inflate totals while public,
supporter-gated, and explicitly allowed records do. The black-box HTTP contract
covers invalid identifiers, unavailable projection behavior, and methods. The
post-deploy canary traversal requires a real artist aggregate whose admitted
catalog contains at least one track.

Run `just zig bench-artist-metrics` to rebuild the dedicated `zig_bench` fixture
and measure the complete HTTP → artist resolution → aggregate path at
concurrency 1 and 16.

## local benchmark

On 2026-08-09, a native `ReleaseFast` build against local Postgres 14 and the
deterministic 100-track fixture produced a 527-byte response with zero errors:

| concurrency | requests/sec | p50 | p95 | p99 | process RSS |
|---:|---:|---:|---:|---:|---:|
| 1 | 1,345.9 | 0.729 ms | 0.835 ms | 1.019 ms | 4,208 KiB |
| 16 | 7,694.3 | 1.924 ms | 3.370 ms | 4.326 ms | 4,832 KiB |

This measures the complete two-query path: verified artist admission followed
by the materialized aggregate. It is a local regression baseline, not a remote
Neon capacity claim. The benchmark first exposed that direct encoded DID path
segments were not decoded by Zig; the REST boundary now performs strict
single-segment percent decoding and rejects malformed escapes, encoded path
separators, backslashes, and NUL bytes.
