---
title: "Zig next environment"
---

## purpose

The Zig backend is deployed independently before it is allowed to replace any
part of the Python-backed production application. Its first job is to make
semantic and resource regressions observable without giving an incomplete
service production authority.

The Fly application is `plyr-api-zig-canary`. Its Fly hostname is the initial
infrastructure test surface. That internal name describes the rollout mechanism,
not the public product. The eventual parallel application is `next.plyr.fm`,
following Grain's successor-deployment pattern: users opt into the new stack
directly while `plyr.fm` continues to run. `next.plyr.fm` is a frontend plus its
Zig API configuration, not an alias that exposes the bare API as a website.

## authority boundary

The initial canary has exactly one process role: REST API. It has no migration,
background-worker, jetstream, Redis, Docket, R2 write, PDS write, or production
database authority. It reads the staging projection through a dedicated
`plyr_zig_canary` credential and uses the staging `fm.plyr.stg.track` and
`fm.plyr.stg.list` namespaces. The migration grants schema usage and `SELECT`
on every current projection table, establishes the same default for projection
tables created later, and grants no schema creation or table-write privilege.
Online upgrades skip this deployment-only grant where that role is absent, so
local and unrelated environments do not acquire an ambient principal. The Fly
configuration also declares `DATABASE_ROLE=plyr_zig_canary`; startup compares it
to PostgreSQL's effective `current_user` and refuses to serve if the staged
credential has more or different authority than intended.

The machine:

- is capped at one shared CPU and 256 MiB;
- accepts at most 128 connections, with Fly soft backpressure at 96;
- scales to zero and has no minimum running-machine cost;
- uses `/ready`, which performs `SELECT 1` through the application pool, for
  deployment health;
- is deployed only by the manual `zig-canary` target in the registered
  `deploy staging` GitHub workflow. Local `fly deploy` is not part of the
  operating procedure.

The canary target deliberately lives in a workflow already registered on the
default branch. GitHub does not expose a newly introduced `workflow_dispatch`
file until that file exists on the default branch, which would make a standalone
canary workflow in this long-lived unmerged PR impossible to launch. Dispatching
the existing workflow with `ref=codex/zig-backend` and `target=zig-canary` loads
this branch's guarded canary job. Push-triggered Python staging deploys retain
their existing job and cannot select the canary path. The canary job also checks
the exact branch ref before receiving the staging Fly token; dispatching the
target from an arbitrary branch is a skipped job, not an arbitrary-code path into
staging authority.

The canary job builds and pushes a commit-addressed image before changing the API
Machine. Its optional `reconcile_catalog` input runs that exact image once as an
unmanaged `--rm` Machine in the existing `relay-api-staging` app. Fly injects the
staging app's already-deployed `DATABASE_URL`; the process receives only explicit
staging NSIDs, writes authenticated projections, and is destroyed when it exits.
Only after successful reconciliation does the workflow deploy the same immutable
image to `plyr-api-zig-canary`, whose own database credential remains read-only.
Routine canary deployments leave reconciliation disabled, avoiding repeated PDS
fetches and projection writes.

After semantic smoke, the same job captures the application process at idle,
drives `/v1/tracks?limit=50` over the public Fly hostname for ten seconds each at
concurrency 1 and 16, and captures it again. The retained commit-addressed JSON
artifact includes application current/peak RSS, cgroup current/peak memory,
application CPU time during the observation window, requests per second, and
p50/p95/p99 latency. It streams the same snapshot helper into the current Python
staging API Machine and drives Python's 50-track route from the same runner at
the same concurrency levels. Mean response bytes are retained for both APIs, and
the summary reports resource, throughput, and latency ratios without pretending
different payload sizes are equivalent work. The job fails on any Zig request
error, process restart, idle RSS above 16 MiB, or application peak RSS above
64 MiB. It also fails unless Python staging uses at least 50 times the Zig
process's idle and peak RSS and Zig serves at least 10 times Python's successful
request rate at both concurrency levels. A Python baseline error remains evidence
but does not lower the Zig gate. This is deliberately part of the manually
dispatched deployment path, not the PR workflows, so ordinary checkpoints never
generate remote load or repeated infrastructure runs.

## next-environment gates

Before exposing `next.plyr.fm`:

1. `/health` and database-backed `/ready` must remain stable across cold starts.
2. The first public-track endpoint must pass fixture-based semantic comparisons
   against the intended v1 contract, including missing, private, malformed,
   corrupt-projection, and unavailable-index behavior.
3. A real staging track lookup must prove that the published image can reach
   Neon with TLS and decode the current projection. The deployment smoke gate
   requires a nonempty verified collection, round-trips its first track through
   detail, resolves its artist, and traverses that artist's album collection;
   empty projection tables cannot satisfy this gate.
4. Fly-native measurements must record idle RSS, loaded peak memory, CPU time,
   throughput, and p50/p95/p99 latency. The agreed load scenario is the public
   50-track collection for ten seconds at concurrency 1 and 16. The first budget
   is at most 16 MiB idle application RSS and 64 MiB application peak RSS. The
   comparative gate requires at least 50x lower idle and peak RSS and at least
   10x greater successful throughput than Python staging at both concurrencies.
5. The service must remain well below its 256 MiB machine ceiling with the
   connection pool established; the ceiling is a guardrail, not a target.
6. No route receives user traffic until its authentication, visibility,
   moderation, and content-authority semantics are explicit. A fast wrong
   response is a regression.

After those gates pass, deploy a separately configured frontend at
`next.plyr.fm` and route its API calls to the Zig service without changing
`plyr.fm`, `stg.plyr.fm`, or `api-stg.plyr.fm`. Prefer a same-origin API path or a
dedicated successor API origin over making `next.plyr.fm` itself return API JSON.
Users and test clients opt into the complete next environment explicitly;
percentage routing is not the model for a versioned contract and UI that are
being replaced together.

The Cloudflare preflight on 2026-08-09 found the `plyr.fm` zone active with no
`next.plyr.fm` DNS record and no Pages project claiming that hostname. Production
(`plyr-fm`) and staging (`plyr-fm-stg`) remain separate Pages projects. The next
namespace is therefore available for a third parallel application; it should
remain empty until the Fly-hostname gates above pass.

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
verified PDS record is authoritative. Canonical-URI application projections
enrich access, verified delivery, operator moderation, and metrics independently.
An absent metrics row is an attributed derived zero rather than a fallback to
the legacy track counter, and none of these application projections determine
whether the authored record exists.
