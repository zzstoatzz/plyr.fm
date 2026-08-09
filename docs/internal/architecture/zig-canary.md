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

The canary has exactly one process role: REST API. It has no runtime migration,
background-worker, jetstream, Docket queue, R2 write, PDS write, or production
database authority. It reads a dedicated Neon branch cloned from production
through a `plyr_zig_canary` credential and uses the production `fm.plyr.track`
and `fm.plyr.list` namespaces. The migration grants schema usage and `SELECT`
on every current projection table, establishes the same default for projection
tables created later, and grants no schema creation privilege. The first scoped
write capability grants only canonical play-metric insert/update, the isolated
legacy play-count column mirror, share-link lookup/event insert, and the event
sequence. A dedicated `plyr-redis-next` instance holds only expiring play-dedup
keys; Redis failure counts fail open and cannot deny playback.
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

The API's primary Fly region is `iad`, adjacent to the isolated Neon's
`aws-us-east-1` compute. The initial `sjc` deployment made the placement cost
directly measurable: public `/health` had a 74 ms median, one database-backed
`/ready` probe had a 202 ms median, and a 50-track read had a 338 ms median while
the process averaged only 1.8% of one core. The roughly 128 ms added by a single
`SELECT 1` is network distance, not application work. The optional reconciliation
Machine uses the same region so an explicit repair does not reintroduce that
cross-country path.

Changing `primary_region` does not relocate an existing Fly Machine. The manual
deployment therefore performs a health-gated replacement after publishing and
deploying the immutable image: it clones the exact service Machine into `iad`,
cordons the old region, and runs the complete semantic smoke through Fly routing.
Only a successful smoke destroys the superseded Machine; failure uncordons the
old Machine. Subsequent deployments already have one `iad` Machine and skip the
replacement path.

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
image to `plyr-api-zig-canary`, whose own database credential remains narrowly
scoped to the tested REST capability set.
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

`next.plyr.fm` is reserved for the complete successor application: a frontend
whose data and playback capabilities come from Zig `/v1`. Directly exposing the
isolated Fly API there was useful only as a temporary backend-verification state;
it is not a shippable interpretation of next. The dedicated Pages frontend uses
a fixed-target, least-authority `/api/v1/*` transport so previews are testable and the
future session boundary stays same-site. It passes the Zig status, body,
request-ID, and source-rich JSON through without adapting it to the Python API.
Users and test clients opt into next explicitly; percentage routing is not the
model for a versioned contract and UI that are being replaced together.

On 2026-08-09 temporary Cloudflare A and AAAA records exposed the dedicated Fly
ingress long enough to verify the backend. The frontend checkpoint replaced
those exact records with one proxied CNAME from `next.plyr.fm` to the isolated
`plyr-fm-next.pages.dev` project. Existing production and staging DNS records and
Pages projects were not changed.

## deployed frontend checkpoint

Commit `a922f59fae866b3e2c5c76b3382f3361531c67d4` is deployed to the manual,
direct-upload Pages project `plyr-fm-next`. The project has no Git integration,
so branch pushes do not create automatic Pages builds. Deployments remain
intentional checkpoints through `just frontend deploy-next`. Pages deployment
`26efff6d-6a0d-40f8-9253-9e2dc6fee27f` serves the existing SvelteKit application,
not a second frontend package.

The first client slice is an anonymous verified catalog and player. It consumes
the v1 response shapes natively rather than manufacturing Python-era numeric
track IDs or `file_id` audio routes. Catalog visibility and playback capability
remain separate: clicking play resolves
`GET /v1/tracks/{track_id}/playback`, checks the returned track identity and
availability, and only then attaches the returned delivery URL.

The Pages Function is a fixed-target transport from same-origin `/api/v1/*` to
`plyr-api-zig-canary.fly.dev`. It permits `GET`, `HEAD`, and scoped `POST`,
refuses paths outside `v1`, forwards only the dedicated anonymous play cookie,
and does not rewrite JSON. This makes the Pages preview testable
without adding preview origins to backend CORS and leaves a same-site seam for
future sessions.

The deployed `https://next.plyr.fm` verification proved:

- the page renders 20 verified tracks from Zig;
- a playback response round-trips the selected opaque track ID and attaches its
  delivery URL;
- a canonical DID resolves through the flat artist resource and scopes the
  catalog to nine matching tracks;
- verified keyword search resolves canonical track identity;
- one anonymous sustained play is counted, returns a host-only HttpOnly listener
  cookie, and a second request with that cookie is rejected by Redis as a
  duplicate without incrementing the canonical Postgres metric again;
- non-v1 proxy paths return 404, keeping infrastructure health and unrelated Fly
  routes outside the frontend transport;
- the rendered page is the existing `plyr.fm - audio streaming app`, contains
  the Zig-backed track catalog, and emits no browser console errors;
- the final DNS set contains one proxied CNAME to `plyr-fm-next.pages.dev`.

Run `just zig smoke-next` to repeat the public product-contract traversal through
the same-origin `/api` transport. Infrastructure readiness remains a separate
direct-Fly gate through `just zig smoke-canary`; next does not broaden its proxy
solely to make the verifier convenient.

## deployed search and play checkpoint

Workflow run
[`31340463635`](https://github.com/zzstoatzz/plyr.fm/actions/runs/31340463635)
deployed immutable Zig image `a922f59fae866b3e2c5c76b3382f3361531c67d4`
on 2026-08-09. The Python staging job and authenticated catalog reconciliation
were skipped. The semantic gate covered verified search plus a real scoped
write: the first sustained play claimed an expiring key in the dedicated
`plyr-redis-next`, incremented canonical metrics in the isolated Neon branch,
and the repeated cookie was returned as a non-counting duplicate. Existing
staging and production applications, databases, Redis instances, Pages projects,
and DNS records were not changed.

The retained commit-addressed artifact records the real 117,990-byte 50-track
response:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 7.4 | 128.625 ms | 182.079 ms | 203.908 ms | 0 |
| 16 | 11.8 | 1,289.594 ms | 1,866.857 ms | 1,886.838 ms | 0 |

Idle application RSS was 9,812 KiB. Loaded RSS was 10,596 KiB and process peak
RSS was 15,412 KiB. The application used 0.51 CPU-seconds across 22.36 seconds,
or 2.3% of one core, and retained the same PID. Both the 16 MiB idle and 64 MiB
peak gates passed with zero HTTP errors.

## deployed playlist checkpoint

Workflow run
[`31332239532`](https://github.com/zzstoatzz/plyr.fm/actions/runs/31332239532)
deployed immutable image `93989ab02b0d01df3736a168c0e8e48d9687ac1a`
on 2026-08-09. The Python staging job and authenticated catalog reconciliation
were both skipped. The expanded semantic gate passed against the Fly hostname,
and the same gate then passed independently through `https://next.plyr.fm`,
including track collection/detail, anonymous playback, artist lookup, album
collection/detail, and verified playlist collection/detail.

The retained commit-addressed artifact records the real 117,990-byte 50-track
response:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 2.8 | 308.237 ms | 469.928 ms | 597.699 ms | 0 |
| 16 | 11.4 | 1,435.326 ms | 1,959.052 ms | 2,043.598 ms | 0 |

Idle application RSS was 9,948 KiB. Loaded RSS was 11,296 KiB and the process
peak was 16,672 KiB, passing the 16 MiB idle and 64 MiB peak budgets without a
PID change. The process used 0.41 CPU-seconds across the 23.4-second observation
window, or 1.8% of one core. These are Fly/Neon path measurements rather than a
local throughput claim; their durable value is the semantic traversal, zero
errors, and bounded process resources for the exact deployed commit.

## iad placement checkpoint

Workflow run
[`31332921142`](https://github.com/zzstoatzz/plyr.fm/actions/runs/31332921142)
deployed immutable image `4026da4ff14c169c60b6d95826846ba989c7bef8`
and performed the first health-gated regional replacement. It cloned the exact
service Machine into `iad`, cordoned the `sjc` Machine, passed the complete
semantic smoke through Fly routing, and only then destroyed the superseded
Machine. The Python staging and repository-reconciliation jobs were skipped.

The retained commit-addressed 117,990-byte track-read evidence is:

| concurrency | responses/s | p50 | p95 | p99 | errors |
|---:|---:|---:|---:|---:|---:|
| 1 | 4.7 | 201.458 ms | 245.785 ms | 347.644 ms | 0 |
| 16 | 11.5 | 1,318.764 ms | 1,838.750 ms | 1,893.560 ms | 0 |

Idle application RSS was 9,748 KiB. Loaded RSS was 10,596 KiB and process peak
RSS was 15,504 KiB. The application used 0.45 CPU-seconds across 24.03 seconds,
or 1.9% of one core. The artifact therefore passes both resource budgets after
the topology correction, while the concurrency-1 median improves by 106.779 ms
over the `sjc` checkpoint.

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
