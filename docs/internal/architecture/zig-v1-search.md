---
title: "Zig v1 catalog search"
---

## endpoint

`GET /v1/search` is a read-only index over authenticated track, authored-profile,
album-list, and playlist-list projections. Search discovers references to
canonical records; it does not create a second metadata authority.

The strict query contract is:

| parameter | contract |
|---|---|
| `q` | required, trimmed UTF-8 containing 2–100 Unicode code points and at most 400 bytes |
| `types` | optional unique comma-separated set of `track`, `artist`, `album`, and `playlist` |
| `limit` | optional global result limit from 1 through 50; defaults to 20 |

Unknown, duplicate, empty, malformed, and out-of-range values return
`400 invalid_request`. The limit applies after all requested types are ranked
together. Counts describe the returned page, not an expensive estimate of the
entire result population.

Each result retains its opaque API identifier, canonical record URI/CID,
owner DID and current handle alias, field-level provenance, projection
verification, and the field and class that matched. The API exposes
`exact`, `prefix`, `substring`, or `fuzzy`; it deliberately does not expose a
floating `score` or `relevance`. Numeric database scores are unstable
implementation details and would turn a replaceable index into a public
ranking contract.

## authority and policy

Tracks and lists are admitted only from non-deleted records authenticated by
the repository projection and an affirmatively available account. Artist hits
also require the authenticated `self` profile record; the transitional
`artists` row supplies handle and display aliases but cannot admit an artist.
Every returned record therefore has `projection.verification = verified_repo`.

Public search applies discovery policy before ranking. Private and unlisted
tracks, operator exclusions, active copyright blocks, deleted records,
adult-audio labels, deactivated legacy aliases, and unavailable repositories cannot become
candidates. Album and playlist results come from the common verified list
projection, never the Python album or playlist tables. A result may still
attribute current aliases, presentation images, and application metrics to
their non-authored sources rather than laundering them into record metadata.

## ranking and storage boundary

Exact handle equality is the strongest match. Other exact matches follow, then
prefix, literal substring, and PostgreSQL trigram similarity. Similarity breaks
ties within a class; normalized title, type, and canonical URI provide a stable
final order. Percent, underscore, and backslash in a user query are escaped
before `ILIKE`, so query text cannot become a wildcard pattern.

The application depends on `SearchStore`, not PostgreSQL tables. The current
adapter treats Postgres as a rebuildable candidate and ranking engine over the
verified projections. Partial GIN trigram indexes accelerate authored track
titles and list names; the existing artist handle/display indexes accelerate
the transitional aliases. This layout can later move into a dedicated Zig
index library without changing the HTTP or application boundary.

Tags are omitted because their present local rows have no settled authored or
application-owned authority model. Semantic search is also omitted: CLAP and
vector retrieval are derived services and need an explicit provenance and
availability contract rather than being folded into keyword search.

## existing frontend

The existing SvelteKit search modal uses this endpoint on `next.plyr.fm`; there
is no successor frontend. Its compatibility adapter validates identities,
counts, provenance, metrics, and requested-type scope before translating a hit
into the existing view model. It currently requests tracks, artists, and albums
because those destination pages already use `/v1`. Playlist results remain in
the API but are withheld from this client until the existing playlist page is
connected to the Zig playlist detail endpoint. Semantic mode stays disabled in
the Zig generation.

## verification and local baseline

The disposable-Postgres integration test proves exact-handle priority,
cross-type ordering, type filtering, opaque identity, literal wildcard
handling, private-track exclusion, and whole-account removal. The black-box
HTTP test covers strict errors and unavailable-index behavior. The deployment
smoke test searches for a real listed track and requires the same ID, record
identity, verified provenance, and absence of public numeric scores.

`just zig bench-search` recreates a guarded 20,000-track PostgreSQL 14 fixture,
builds the native ReleaseFast binary, and searches one exact authored title.
Recorded 2026-08-09 on the Apple M5 Pro host:

| concurrency | responses/s | p50 | p95 | p99 | RSS | errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26.6 | 37.162 ms | 39.857 ms | 40.878 ms | 3,792 KiB | 0 |
| 16 | 354.4 | 42.835 ms | 55.317 ms | 70.677 ms | 4,688 KiB | 0 |

`EXPLAIN (ANALYZE, BUFFERS)` on the track candidate predicate uses a
`BitmapOr` over two scans of the partial trigram index and completes candidate
selection in 2.945 ms on that fixture. The end-to-end measurement includes HTTP,
strict parsing, all policy joins, ranking, decoding, provenance serialization,
and a fresh local process. It is a regression baseline, not a Neon or Python
comparison; deployed resource and semantic gates remain required.
