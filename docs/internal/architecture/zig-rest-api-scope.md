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

## measured Python surface

Snapshot from `origin/main` at `dbfcfb2b`:

| measure | count | meaning |
|---|---:|---|
| runtime routes | 184 | FastAPI HTTP and WebSocket route objects |
| method operations | 221 | routes expanded across their accepted methods |
| Subsonic routes | 37 | compatibility aliases and fallback under `/rest` |
| Postgres tables | 27 | content, sessions, jobs, interactions, and operational state mixed together |
| registered Docket tasks | 39 | ingestion, PDS writes, media, ML, moderation, exports, and repair |
| settings sections | 23 | infrastructure and product integrations mediated by the process |
| Python test cases | 1,448 passed, 25 skipped | current local baseline including parametrized cases |

The raw route count overstates the product API because protocol endpoints,
compatibility aliases, repair operations, and internal proxies are mounted on
the same application.

## current capability families

| family | current surface | principal dependencies | `/v1` disposition |
|---|---|---|---|
| identity and sessions | `/auth/*`, `/account/*` | ATProto OAuth/DPoP, encrypted Postgres sessions, Redis session cache | redesign as session and current-user resources; keep OAuth redirects outside normal resource semantics |
| artists | `/artists/*` | PDS profiles, Postgres projection, image storage, follow graph | preserve capability with canonical DID identity and explicit derived fields |
| tracks | 33 `/tracks/*` routes | PDS records/blobs, Postgres, R2, transcoder, Docket, moderation, ML | split catalog reads, publishing commands, interactions, playback, and repair; retire repair verbs from public API |
| albums | `/albums/*` | ATProto list/track records, Postgres, R2 images | model as collection resources; eliminate local-first finalization semantics |
| playlists and liked list | 18 `/lists/*` routes | ATProto list records, Postgres hydration, Redis cache, recommendations | expose `/v1/playlists`; liked tracks are an interaction collection, not a magic list subtype |
| likes and comments | nested track routes | PDS records, local projections, Docket write-behind, Redis tombstones | PDS-first interaction resources; no success based only on local mutation |
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

The 39 Docket tasks fall into seven workloads:

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
Zig REST server. The API needs an asynchronous-command interface whose first
implementation may continue to enqueue the existing Docket tasks.

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
4. Session-aware viewer state and PDS-first interactions.
5. Upload/publication operations and their asynchronous status resources.
6. Exports, moderation reports, queues, and other stateful product workflows.
7. Separate adapters for Subsonic and any retained legacy clients.

The first three steps can progress while Python continues owning background
workers, ingestion, and existing clients. That is the seam that permits a clean
API without requiring every subsystem to be rewritten at once.
