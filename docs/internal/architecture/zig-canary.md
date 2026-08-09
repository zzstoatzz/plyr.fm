---
title: "Zig API canary"
---

## purpose

The Zig backend is deployed as an independent canary before it is allowed to
share any client traffic with the Python API. Its first job is to make semantic
and resource regressions observable without giving an incomplete service
production authority.

The Fly application is `plyr-api-zig-canary`. Its Fly hostname is the initial
test surface. `canary.plyr.fm` is deliberately deferred until the service has a
working staging index, stable health behavior, and a useful parity slice; DNS
must not make a health-only deployment look like a supported API.

## authority boundary

The initial canary has exactly one process role: REST API. It has no migration,
background-worker, jetstream, Redis, Docket, R2 write, PDS write, or production
database authority. It reads the staging projection through a dedicated
credential and uses the staging `fm.plyr.stg.track` and `fm.plyr.stg.list`
namespaces.

The machine:

- is capped at one shared CPU and 256 MiB;
- accepts at most 128 connections, with Fly soft backpressure at 96;
- scales to zero and has no minimum running-machine cost;
- uses `/ready`, which performs `SELECT 1` through the application pool, for
  deployment health;
- is deployed only by the manual `deploy Zig canary` GitHub workflow. Local
  `fly deploy` is not part of the operating procedure.

## promotion gates

Before adding `canary.plyr.fm`:

1. `/health` and database-backed `/ready` must remain stable across cold starts.
2. The first public-track endpoint must pass fixture-based semantic comparisons
   against the intended v1 contract, including missing, private, malformed,
   corrupt-projection, and unavailable-index behavior.
3. A real staging track lookup must prove that the published image can reach
   Neon with TLS and decode the current projection.
4. Fly-native measurements must record idle RSS, loaded peak memory, CPU time,
   throughput, and p50/p95/p99 latency. The first budget is at most 16 MiB idle
   application RSS and 64 MiB working set under the agreed load scenario.
5. The service must remain well below its 256 MiB machine ceiling with the
   connection pool established; the ceiling is a guardrail, not a target.
6. No route receives user traffic until its authentication, visibility,
   moderation, and content-authority semantics are explicit. A fast wrong
   response is a regression.

After those gates pass, Cloudflare can proxy `canary.plyr.fm` to Fly without
changing `stg.plyr.fm` or `api-stg.plyr.fm`. Traffic experiments should begin
with explicit test clients, then opt-in shadow/comparison tooling. General
percentage routing belongs to a later decision because the v1 API is a new
contract rather than a drop-in implementation of the Python surface.

## initial catalog reconciliation

A fresh `plyr_index` schema is intentionally empty. Before a useful read-only
canary can exist, the separately invoked `MODE=catalog_reconciler` process reads
distinct DIDs from legacy rows that already claim canonical track or album
records. Those rows are discovery hints only. For each DID, the process resolves
the current identity and PDS, fetches the complete repository, verifies its
signature, blocks, MST, record CIDs, and selected lexicons, then atomically
projects the authenticated snapshot. It shares one bounded resolver, transport,
signing-key cache, and PostgreSQL pool across the batch.

The first strict run against the temporary staging migration branch found four
candidate repositories. One projected successfully; three valid repositories
contained malformed historical list records. Record-level quarantine now keeps
repository signature, MST, block, and CID verification strict while atomically
excluding only selected records that fail DAG-CBOR or lexicon decoding. Each
exclusion persists the record URI/CID, exact reason, and authenticated commit
proof; a later valid record or verified deletion clears it.

The repeated historical defect is a list-item strongRef CID encoded as DAG-CBOR
text instead of a CID link. It remains invalid: the verifier does not reinterpret
the text as a verified CID. On the isolated branch, the corrected reconciler
verified all four repositories, projected 19 live tracks and four profiles, and
quarantined seven list records (five invalid strongRefs and two unknown list
types). Product reads then returned all 19 tracks even though none had an exact
legacy `tracks.atproto_record_uri` match. That last result is intentional: the
verified PDS record is authoritative, while a matching legacy row can enrich
delivery, moderation, visibility, and metrics but cannot determine whether the
record exists.
