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
database authority. It reads a dedicated Neon branch cloned from production
through a `plyr_zig_canary` credential and uses the production `fm.plyr.track`
and `fm.plyr.list` namespaces. The migration grants schema usage and `SELECT`
on every current projection table, establishes the same default for projection
tables created later, and grants no schema creation or table-write privilege.
The transitional REST adapters additionally receive `SELECT` on the clone's
`tracks`, `artists`, `albums`, and `user_preferences` tables. This is an explicit
compatibility seam for handles, presentation, and local policy—not content
authority—and is confined to the isolated branch.
Online upgrades skip this deployment-only grant where that role is absent, so
local and unrelated environments do not acquire an ambient principal. The Fly
configuration also declares `DATABASE_ROLE=plyr_zig_canary`; startup compares it
to PostgreSQL's effective `current_user` and refuses to serve if the staged
credential has more or different authority than intended.
The canary uses a 16-connection PostgreSQL pool so its 16-worker product-read
benchmark measures application work rather than pool admission.
Its `DATABASE_URL` uses Neon's direct endpoint. `pg.zig` describes and binds an
unnamed extended-protocol statement across separate synchronization cycles;
Neon's transaction pooler may assign those cycles to different backend sessions.
Layering that pooler beneath the application's already bounded pool is therefore
both redundant and incorrect for this client protocol.

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
the exact branch ref before receiving the Fly token; dispatching the
target from an arbitrary branch is a skipped job, not an arbitrary-code path into
deployment authority.

The canary job builds and pushes a commit-addressed image before changing the API
Machine. Its optional `reconcile_catalog` input runs that exact image once as an
unmanaged `--rm` Machine in the canary app. The process receives a dedicated
next-branch writer credential and production NSIDs, writes authenticated
projections, and is destroyed when it exits. The writer can read the two legacy
candidate tables and mutate `plyr_index`; it cannot mutate legacy tables.
Only after successful reconciliation does the workflow deploy the same immutable
image to `plyr-api-zig-canary`, whose own database credential remains read-only.
Routine canary deployments leave reconciliation disabled, avoiding repeated PDS
fetches and projection writes.

After semantic smoke, the same job captures the application process at idle,
drives `/v1/tracks?limit=50` over the public Fly hostname for ten seconds each at
concurrency 1 and 16, and captures it again. The retained commit-addressed JSON
artifact includes application current/peak RSS, cgroup current/peak memory,
application CPU time during the observation window, requests per second, and
p50/p95/p99 latency. The job fails on any Zig request error, process restart,
idle RSS above 16 MiB, or application peak RSS above 64 MiB. It touches only the
isolated next environment; it does not load, SSH into, or configure the existing
staging or production applications. This is deliberately part of the manually
dispatched deployment path, not the PR workflows, so ordinary checkpoints never
generate remote load or repeated infrastructure runs.

## next-environment gates

Before exposing `next.plyr.fm`:

1. `/health` and database-backed `/ready` must remain stable across cold starts.
2. The first public-track endpoint must pass fixture-based semantic comparisons
   against the intended v1 contract, including missing, private, malformed,
   corrupt-projection, and unavailable-index behavior.
3. A real track lookup must prove that the published image can reach
   Neon with TLS and decode the current projection. The deployment smoke gate
   requires a nonempty verified track collection, round-trips a playable track
   through detail and playback, resolves its artist, traverses that artist's
   album collection, and round-trips a verified public playlist through detail;
   empty required projection tables cannot satisfy this gate.
4. Fly-native measurements must record idle RSS, loaded peak memory, CPU time,
   throughput, and p50/p95/p99 latency. The agreed load scenario is the public
   50-track collection for ten seconds at concurrency 1 and 16. The first budget
   is at most 16 MiB idle application RSS and 64 MiB application peak RSS. These
   absolute budgets are enforced without coupling next to either existing
   environment.
5. The service must remain well below its 256 MiB machine ceiling with the
   connection pool established; the ceiling is a guardrail, not a target.
6. No route receives user traffic until its authentication, visibility,
   moderation, and content-authority semantics are explicit. A fast wrong
   response is a regression.

During the backend phase, `next.plyr.fm` routes directly to the isolated Zig API.
A separately configured frontend can later claim that hostname and route its API
calls to the same service without changing any existing environment. Users and
test clients opt into next explicitly; percentage routing is not the model for a
versioned contract and UI that are being replaced together.

On 2026-08-09 Cloudflare A and AAAA records were created for `next.plyr.fm`,
pointing only to the dedicated Fly ingress addresses for
`plyr-api-zig-canary`. Existing production and staging DNS records and Pages
projects were not changed.

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

The first production-shaped run used the isolated Neon branch
`next-zig-backend`, not the production database itself. Of 99 candidate
repositories, 91 verified and produced 978 live tracks and 82 authored profiles.
Three candidates were retryable because their PDS was unavailable, and five were
rejected by the repository-size guard. The strict reconciler therefore exited
nonzero after preserving all verified progress; the next environment can serve
that authenticated subset while the size and retry cases remain explicit work.
