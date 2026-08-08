---
title: "Zig REST API scope and parity map"
---

## decision

The new product API begins at `/v1`. It is a new contract, not the existing
FastAPI surface moved behind a prefix. Parity means accounting for a user or
system capability and making an explicit preserve, redesign, defer, or retire
decision.

Within a major version, additions should be compatible: new resources, new
optional request fields, and new response fields are allowed; changing the
meaning or required shape of an existing resource is not. This follows the
useful part of [OpenAI's REST compatibility policy](https://developers.openai.com/api/reference/overview#backwards-compatibility),
which currently keeps its REST API under `v1` and names additive changes that
do not require a new major version.

## live surface inventory

The inventory is derived from the running FastAPI router, SQLAlchemy metadata,
and Docket registry. Run `just zig inventory` for the summary,
`just zig inventory --routes` for every route, or `just zig inventory --json`
for machine-readable output.

Snapshot from `origin/main` at `87a3ced0`:

| measure | count | meaning |
|---|---:|---|
| runtime routes | 184 | FastAPI HTTP and WebSocket route objects |
| method operations | 221 | routes expanded across their accepted methods |
| Subsonic routes | 37 | compatibility aliases and fallback under `/rest` |
| Postgres tables | 27 | content, sessions, jobs, interactions, and operational state mixed together |
| registered Docket tasks | 40 | ingestion, record writes, media, ML, moderation, exports, and repair |
| settings sections | 23 | infrastructure and product integrations mediated by the process |
| Python test cases | 1,448 passed, 25 skipped | current local baseline including parametrized cases |

The raw route count overstates the product API because protocol endpoints,
compatibility aliases, repair operations, and internal proxies are mounted on
the same application.

### coverage ledger

“Covered” means the Zig route exists and its contract is exercised locally. It
does not mean the corresponding Python response was copied. The new API is
allowed to replace several old operations with one coherent resource, or to
retire an operation entirely, but every old capability still needs an explicit
decision.

| Zig surface | state | capability covered | important gaps |
|---|---|---|---|
| `GET /v1` | covered | API namespace discovery | generated API description/OpenAPI |
| `GET /v1/tracks` | covered | anonymous discovery or artist-scoped public catalogue with strict keyset pagination | viewer context, tag filters, hidden-tag preferences, search and other collection views |
| `GET /v1/tracks/{track_id}` | covered | public, published track detail from the projection | authenticated viewer state, private/gated tracks, playback, list/search views, publication and mutations |
| `GET /v1/artists/{identifier}` | covered | public artist detail by canonical DID or case-insensitive handle alias | verified repository ingestion, collections, follows, profile writes, account state, viewer context |
| `GET /v1/albums?artist_did={did}` | covered | canonical list-record albums for one artist with strict keyset pagination | continuous verified ingestion, global discovery, writes, viewer state |
| `GET /v1/albums/{album_id}` | covered | verified album record and position-complete strong-reference membership with policy-safe hydration | continuous verified ingestion, writes, artwork, private/gated authorization, viewer state |
| `GET /health` | covered | process liveness | none for liveness |
| `GET /ready` | covered | index configuration and a live database probe | readiness for dependencies required by future routes |
| `GET /` | covered | points clients at `/v1` | protocol metadata remains separate |

`OPTIONS` handling, bounded connections, CORS, request IDs, and the common JSON
error envelope are covered cross-cutting behavior, not product capabilities.

The product coverage count is therefore **five read capabilities**: anonymous
track discovery, track detail, artist detail, artist album discovery, and
verified album detail. The
artist resource replaces both Python lookup routes with one DID-or-handle
contract. Semantic parity remains partial because the Zig routes deliberately
exclude viewer-specific and delivery behavior. Of the 221 Python operations,
root discovery and liveness
have covered successor behavior, two track reads have partial coverage, two
artist lookups have one covered successor, one album listing and one album
detail have partial coverage, and the remaining 213 have no implemented Zig
mapping yet.

### legacy surface by resource

This table is the queue of capabilities to account for. Counts are route
objects first and method-level operations second; `/rest` is larger in the
second column because every Subsonic route accepts both `GET` and `POST`.

| resource | routes | operations | Zig v1 status |
|---|---:|---:|---|
| `/rest` | 37 | 74 | not started; separate compatibility adapter |
| `/tracks` | 33 | 33 | discovery/artist collection and track detail partial; all other capabilities open |
| `/lists` | 18 | 18 | not started |
| `/auth` | 15 | 15 | not started |
| `/artists` | 9 | 9 | public DID/handle lookup covered by one v1 resource; all other capabilities open |
| `/albums` | 9 | 9 | canonical collection plus verified ordered detail partial; mutations and other views open |
| `/jams` | 9 | 9 | not started |
| `/copyright` | 8 | 8 | not started |
| `/now-playing` | 4 | 4 | not started |
| `/audio` | 3 | 3 | not started |
| `/radio` | 3 | 3 | not started |
| `/exports` | 3 | 3 | not started |
| `/stats` | 3 | 3 | not started |
| `/account` | 2 | 2 | not started |
| `/activity` | 2 | 2 | not started |
| `/search` | 2 | 2 | not started |
| `/preferences` | 2 | 2 | not started |
| `/queue` | 2 | 2 | not started |
| `/migration` | 2 | 2 | candidate for retirement/internal tooling |
| `/pds-save` | 2 | 2 | candidate for retirement/internal tooling |
| `/moderation` | 2 | 2 | not started |
| `/.well-known` | 2 | 2 | protocol surface; not started |
| `/discover` | 1 | 1 | not started |
| `/for-you` | 1 | 1 | not started |
| `/oembed` | 1 | 1 | protocol surface; not started |
| `/users` | 1 | 1 | not started |
| `/` | 1 | 1 | covered with a new response contract |
| `/health` | 1 | 1 | covered; readiness split into `/ready` |
| `/config` | 1 | 1 | not started |
| `/oauth-client-metadata.json` | 1 | 1 | protocol surface; not started |
| `/robots.txt` | 1 | 1 | protocol surface; not started |
| `/sitemap-data` | 1 | 1 | indexing surface; not started |
| `/logfire-proxy` | 1 | 1 | candidate for retirement |
| `/xrpc` | 1 | 1 | protocol surface; not started |

## current capability families

| family | current surface | principal dependencies | `/v1` disposition |
|---|---|---|---|
| identity and sessions | `/auth/*`, `/account/*` | ATProto OAuth/DPoP, encrypted Postgres sessions, Redis session cache | redesign as session and current-user resources; keep OAuth redirects outside normal resource semantics |
| artists | `/artists/*` | PDS profiles, Postgres projection, image storage, follow graph | public detail started with canonical DID identity, handle aliases, and explicit field provenance |
| tracks | 33 `/tracks/*` routes | PDS records/blobs, Postgres, R2, transcoder, Docket, moderation, ML | discovery/artist collection and detail started; split publishing commands, interactions, playback, and repair; retire repair verbs from public API |
| albums | `/albums/*` | ATProto list/track records, Postgres, R2 images | canonical artist collection and verified membership/detail started; eliminate local-first finalization semantics |
| playlists and liked list | 18 `/lists/*` routes | ATProto list records, Postgres hydration, Redis cache, recommendations | expose `/v1/playlists`; liked tracks are an interaction collection, not a magic list subtype |
| likes and comments | nested track routes | PDS records, local projections, Docket write-behind, Redis tombstones | source-authoritative interaction resources; no success based only on local mutation |
| uploads and revisions | track upload/audio/revision routes | temporary jobs, R2, PDS uploadBlob, transcoder, Docket | redesign as asynchronous `/v1/uploads` and publication operations with idempotency |
| playback | `/audio/*`, track play | R2/PDS/space blob resolution, supporter checks, counters | `/v1/tracks/{id}/playback`; separate authorization and availability from catalog metadata |
| discovery | `/search`, `/for-you`, `/discover`, tags | SQL, Redis, follow graph, Turbopuffer, CLAP/Replicate-derived data | preserve as query resources after catalog reads; recommendations are derived and explainable as such |
| personal playback state | `/queue`, `/now-playing` | Postgres, LISTEN/NOTIFY, Teal PDS records | defer until catalog/auth foundations; decide which state belongs on PDS before designing routes |
| live jams | `/jams` plus WebSocket | Postgres, Redis Streams, in-process fan-out | defer; REST lifecycle and realtime event transport need a separate design |
| exports and PDS save | `/exports`, `/pds-save` | jobs, Docket, R2, PDS writes | exports may become `/v1/exports`; `pds-save` is a migration repair tool and is not a product resource |
| moderation | `/moderation`, copyright routes, content filters | moderation service/labeler, label stream, Redis caches, notification bot, PDS records | reports and viewer policy belong in `/v1`; operator and labeler control remain separate |
| platform metadata | `/`, `/health`, `/config`, OAuth metadata, JWKS, DID document | settings, OAuth keys | health and protocol discovery remain unversioned; expose only safe client configuration |
| public embeds and indexing | `/oembed`, robots, sitemap, mention XRPC | Postgres projection, ATProto profile lookup | keep protocol-specific routes unversioned and outside `/v1` |
| Subsonic | `/rest/*`, `/auth/login` | developer tokens, catalog projection, playback | maintain as an independent compatibility adapter; do not shape `/v1` around it |
| browser telemetry proxy | `/logfire-proxy/*` | Logfire | retire from the public product API or move behind an explicitly internal boundary |

## subsystem dependency map

### Canonical network state

- ATProto OAuth with DPoP, PAR, refresh, account groups, and scope upgrades.
- PDS XRPC reads/writes for profiles, tracks, likes, comments, lists, Teal
  scrobbles/status, and copyright publishing-owner records.
- Environment-aware `fm.plyr.*` / `fm.plyr.dev.*` NSIDs.
- Jetstream and label WebSocket consumers. Jetstream is currently trusted as a
  delivery source even though it does not prove commit signatures or MST diffs.

### Derived and operational persistence

- Neon Postgres currently mixes projections (`tracks`, `artists`, `albums`,
  playlists, likes, comments) with operational state (sessions, OAuth states,
  jobs, pending operations, feature flags, queues, and jams).
- Redis backs Docket, session/moderation/discovery caches, rate limiting,
  ingestion cursors and tombstones, Redis Streams for jams, and deduplication.
- Postgres LISTEN/NOTIFY invalidates server-authoritative queue state.

### Blob and media path

- Public audio, private audio, and image R2 buckets.
- PDS blobs and space-gated blobs.
- The Rust transcoder service for normalization/format conversion.
- Image orientation, thumbnails, content hashes, staged objects, revisions,
  refcount-sensitive deletion, and public/private moves.
- Playback can resolve to R2, a PDS blob, or both; the new API must report
  provenance and availability without presenting the mirror as canonical.

### Background execution

The 40 Docket tasks fall into seven workloads:

1. verified-state projection candidates: track/like/comment/list/profile,
   identity, and account-event ingestion;
2. PDS commands: like/comment writes, album/list sync, Teal scrobbling, and
   account synchronization;
3. media: upload, replacement, optimization, movement, and PDS saving;
4. analysis: copyright, image moderation, embeddings, and genre classification;
5. lifecycle: stuck-upload reaping, exports, and follow-graph warming;
6. label state: operator-label and copyright-resolution synchronization;
7. transparency: publishing moderation decisions.

These are dependencies behind REST operations, not automatically part of the
Zig REST server. The API needs an asynchronous-command interface. Python
pydocket and Zig Docket are not wire-compatible, so a producer and its worker
move as one slice under a separate `plyr-zig` namespace; the Zig API does not
emit Python pickle or share the Python worker stream. The full boundary is in
[`zig-background-work.md`](zig-background-work.md).

### External services

- `plyr-moderation`: audio/image scans, label emission and lookup, reports,
  moderation events, overrides, and cache invalidation.
- `plyr-transcoder`: streaming media transformation.
- CLAP on Modal, Replicate genre classification, and Turbopuffer vectors.
- ATProto identity/PDS services, Constellation, Slingshot, Teal, and
  IndieMusi-compatible records.
- Logfire tracing/logging and the notification Bluesky account.

## `/v1` resource outline

This is a boundary map, not a frozen schema:

| area | initial resources |
|---|---|
| API metadata | `GET /v1` |
| current identity | `GET /v1/me`, session/account-management resources |
| catalog | `/v1/artists`, `/v1/tracks`, `/v1/albums`, `/v1/playlists` |
| interactions | track likes and comments as addressable PDS-backed resources |
| publishing | `/v1/uploads` and explicit publish operations |
| playback | `/v1/tracks/{track_id}/playback` |
| discovery | `/v1/search`, tag resources, recommendations, activity |
| moderation | `/v1/reports` and viewer-facing content-policy results |
| long-running work | `/v1/exports` and operation/job status resources |

Every resource representation should distinguish:

- canonical identity: AT URI, CID/revision, author DID, record timestamps;
- derived index data: aggregates, rankings, hydrated profiles, availability;
- mirror data: verified digest, media variants, and delivery URL;
- viewer state: liked, authorized, hidden, or moderation-filtered.

## surfaces deliberately outside `/v1`

- `/health` and deployment readiness;
- OAuth client metadata, JWKS, DID documents, and OAuth redirect callbacks;
- `/rest/*` Subsonic compatibility;
- oEmbed, robots, sitemap, and protocol-specific XRPC endpoints;
- internal telemetry, repair, moderation-operator, and reconciliation controls;
- WebSocket/SSE transports until their event contracts are designed.

## REST foundation work

Before broad endpoint implementation:

1. define one JSON error envelope, request IDs, and status-code rules;
2. choose opaque path IDs while always returning canonical AT URIs;
3. define cursor pagination and stable ordering once for every collection;
4. define idempotency keys for publish and interaction commands;
5. define authentication separately from authorization and viewer filtering;
6. define an operation resource for asynchronous commands;
7. generate an OpenAPI document from the Zig route/schema definitions;
8. build contract tests around `/v1`, using Python tests to discover cases but
   rewriting expectations where the old API encodes local-first authority.

## likely Zig library boundaries

Extract only when the boundary has a real second consumer or independent test
surface:

- `plyr-atproto`: record schemas/validation, environment-aware NSIDs, AT URI and
  CID utilities, OAuth/DPoP, and PDS client operations, building on `zat`;
- `plyr-media`: content digests, verified PDS blob fetches, R2-compatible object
  operations, media metadata, and mirror provenance;
- `plyr-index`: projection types and Postgres queries with no HTTP concepts;
- `plyr-moderation-client`: typed client for the existing Rust moderation API;
- `plyr-api-types`: request/response/event schemas only if multiple clients or
  services actually consume generated bindings.

HTTP routing, cookies, endpoint authorization, and product composition should
remain in `plyr-backend` rather than becoming generic libraries prematurely.

## implementation order

1. REST conventions and in-memory ports: errors, IDs, cursors, auth context,
   index/media interfaces, and generated OpenAPI shape.
2. Read-only catalog: tracks, artists, albums, playlists, and playback
   availability.
3. Search, tags, activity, and derived recommendation surfaces.
4. Session-aware viewer state and source-authoritative interactions.
5. Upload/publication operations and their asynchronous status resources.
6. Exports, moderation reports, queues, and other stateful product workflows.
7. Separate adapters for Subsonic and any retained legacy clients.

The first three steps can progress while Python continues owning background
workers, ingestion, and existing clients. That is the seam that permits a clean
API without requiring every subsystem to be rewritten at once.
