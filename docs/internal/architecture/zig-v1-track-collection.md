---
title: "Zig v1 track collection"
---

## endpoint

`GET /v1/tracks` is the first collection resource. It is an anonymous,
read-only discovery view over public and supporter-gated tracks. It reuses the
complete v1 track representation; list and detail cannot quietly disagree
about identity, provenance, media, access, moderation, or projection state.

The collection accepts three query parameters:

| parameter | contract |
|---|---|
| `limit` | optional integer from 1 through 100; defaults to 50 |
| `cursor` | optional opaque cursor returned by the preceding page |
| `artist_did` | optional canonical artist DID; switches from discovery to that artist's public catalogue |

Unknown, duplicate, empty, malformed, and out-of-range parameters return
`400 invalid_request`. The server does not clamp a caller mistake or interpret
an offset.

The response has one collection shape:

```json
{
  "object": "list",
  "data": [],
  "has_more": false,
  "next_cursor": null
}
```

`next_cursor` is present only when `has_more` is true. The query fetches
`limit + 1` policy-visible rows; the extra row is evidence that another page
exists and is never serialized into the current page.

## stable cursor

Rows are ordered by `(created_at DESC, atproto_record_uri DESC)`. The opaque,
versioned cursor carries both values. The canonical AT URI is the tie-breaker,
so two tracks with the same timestamp cannot overlap pages or disappear. This
deliberately replaces the Python endpoint's timestamp-only cursor.

The cursor is a continuation position, not a snapshot token. A track published
after the first page belongs before that page and will not appear later in the
same traversal. Deletes do not invalidate the cursor. A future immutable
projection can add snapshot semantics without exposing database IDs.

## discovery policy

Policy is applied in PostgreSQL before ordering and `LIMIT`, following the same
rule as PubSearch's retrieval choke point. Filtering a serialized page would
make `has_more` lie and previously caused missing Python results.

The initial anonymous collection includes only rows that:

- use the configured environment-aware track collection;
- are published rather than pending;
- have `public` or `supporters` visibility;
- belong to an available account according to verified-repository or current-PDS evidence;
- are not excluded by a moderation override;
- carry no adult-audio label from either author or operator;
- carry no active copyright label unless an operator explicitly allowed them.

Supporter visibility means discoverable metadata, not permission to stream the
audio. Playback remains a separate authorization resource.

Viewer preferences, tags, hidden-tag defaults, search, and other filters are not
smuggled into this collection. They remain open contract work. In particular,
the appview should not hard-code a default tag preference into the canonical
catalogue query merely because Python currently does so for one client feed.

## artist catalogue policy

`artist_did` is retained because it is an explicit, canonical filter already
used by the current clients. It is validated with `zat` before any index access;
raw and percent-encoded DIDs are accepted, while duplicate or malformed values
return `400`. The cursor and ordering contract is identical to discovery.

An artist catalogue is a content-view context rather than a feed chosen for the
listener. It still requires the configured record collection, a published row,
an active account, and no active copyright or operator exclusion. It differs in
two deliberate ways:

- `unlisted` tracks are included because an artist profile is a direct
  destination rather than discovery;
- adult-audio labels remain visible in the catalogue representation, allowing
  the client to render the label rather than misrepresenting the catalogue.

Private tracks remain excluded without an authenticated owner context. The SQL
predicate includes the artist DID before ordering and `LIMIT`, so pagination
cannot leak another artist or report a false `has_more` value.

## implementation boundary

The application layer owns strict query parsing, percent decoding, DID and
cursor validation, page construction, and error classification. `TrackStore`
owns a bounded public-collection read with an explicit discovery-or-artist
scope and returns the internal timestamp sort key beside each domain track. The
PostgreSQL adapter owns SQL policy and copies every row into the request arena
before advancing the streaming result.

The composed-store integration test proves that verified self-labels control
discovery without erasing adult-labelled tracks from their artist catalogue,
and that current-PDS deactivation removes both detail and collection reads. The
legacy adapter tests still cover equal timestamps across page boundaries and
prove that a filtered, newer row does not displace visible results. Before canary
promotion, the staging query needs `EXPLAIN (ANALYZE, BUFFERS)` and a composite
projection index appropriate for `(created_at, atproto_record_uri)` if the
existing single-column timestamp index is insufficient.

The HTTP benchmark harness accepts `--with-index` to use `DATABASE_URL` from
the environment. It never reads or prints the value. This keeps health-boundary
and database-backed measurements visibly distinct.

## local database baseline

Recorded 2026-08-08 with the ReleaseFast binary, local PostgreSQL 14 fixture,
four visible/filtered test rows, `limit=2`, and persistent HTTP connections:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 3,158.9 | 0.309 ms | 0.356 ms | 0.481 ms | 0 |
| 16 | 9,714.4 | 1.454 ms | 3.247 ms | 4.607 ms | 0 |

This exercises HTTP, routing, strict query parsing, PostgreSQL pool/query/row
decoding, policy filtering, track serialization, and cursor generation. It is
not a staging-data, network-TLS, memory, or Python-parity measurement; those
remain canary gates.

The artist-filtered path was recorded against the expanded fixture with five
returned records and a percent-encoded DID:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 2,770.5 | 0.328 ms | 0.528 ms | 0.906 ms | 0 |
| 16 | 9,318.0 | 1.507 ms | 3.416 ms | 4.934 ms | 0 |

This baseline additionally exercises URL decoding, DID validation, the artist
scope, content-view policy, and the wider response page. It remains a localhost
regression measurement rather than a Neon capacity claim.

## composed-read baseline

`just zig bench-composed-tracks` rebuilds a guarded `relay_test` fixture with
100 authenticated track records, authored profile state, account evidence, and
the transitional policy/delivery rows. Recorded 2026-08-08 on the Apple M5 Pro
host with the ReleaseFast binary and local PostgreSQL:

| resource | concurrency | responses/s | p50 | p95 | p99 | RSS | errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| 50-track collection | 1 | 368.5 | 2.676 ms | 3.006 ms | 3.876 ms | 3,360 KiB | 0 |
| 50-track collection | 16 | 2,113.1 | 6.936 ms | 13.343 ms | 18.356 ms | 12,832 KiB | 0 |
| track detail | 1 | 1,215.4 | 0.800 ms | 1.012 ms | 1.283 ms | 3,328 KiB | 0 |
| track detail | 16 | 5,498.6 | 2.668 ms | 5.198 ms | 6.825 ms | 12,208 KiB | 0 |

RSS is sampled after each five-second request pass. These measurements include
HTTP serialization and the joins across authenticated records, profile,
account evidence, local policy, moderation, metrics, and delivery. They are a
repeatable local regression baseline, not a Neon or Python comparison.

The production-shaped linux/amd64 ReleaseSafe image is 35,281,923 bytes and
contains a 13,025,696-byte executable. Relative to the preceding account-worker
artifact, composed reads added 9,269 image bytes and 11,904 executable bytes.
The cold Docker compile completed in 320.6 seconds; this is a build-cost and
artifact-size guardrail, not a runtime capacity result.
