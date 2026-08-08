---
title: "Zig v1 track collection"
---

## endpoint

`GET /v1/tracks` is the first collection resource. It is an anonymous,
read-only discovery view over public and supporter-gated tracks. It reuses the
complete v1 track representation; list and detail cannot quietly disagree
about identity, provenance, media, access, moderation, or projection state.

This first slice accepts two query parameters:

| parameter | contract |
|---|---|
| `limit` | optional integer from 1 through 100; defaults to 50 |
| `cursor` | optional opaque cursor returned by the preceding page |

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
- belong to an active artist account;
- are not excluded by a moderation override;
- carry no adult-audio label from either author or operator;
- carry no active copyright label unless an operator explicitly allowed them.

Supporter visibility means discoverable metadata, not permission to stream the
audio. Playback remains a separate authorization resource.

Viewer preferences, artist-scoped catalogues, tags, hidden-tag defaults, search,
and other filters are not smuggled into this anonymous slice. They remain open
contract work. In particular, the appview should not hard-code a default tag
preference into the canonical catalogue query merely because Python currently
does so for one client feed.

## implementation boundary

The application layer owns strict query parsing, cursor validation, page
construction, and error classification. `TrackStore` owns a bounded discovery
read and returns the internal timestamp sort key beside each domain track. The
PostgreSQL adapter owns SQL policy and copies every row into the request arena
before advancing the streaming result.

The integration test covers equal timestamps across page boundaries and proves
that a filtered, newer row does not displace visible results. Before canary
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
