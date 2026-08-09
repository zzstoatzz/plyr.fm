# plyr.fm Zig REST backend

This is the source-authoritative `/v1` app-view API. It is intentionally a
separate contract from the Python API: user-owned records remain authoritative,
Postgres is a rebuildable index, and R2 is a delivery mirror rather than a
second source of truth.

## local commands

Run commands from the repository root through the root justfile:

```sh
just zig check
just zig test-http
just zig test-postgres
just zig image
just zig smoke-canary
DATABASE_URL=... TRACK_COLLECTION_NSID=... LIST_COLLECTION_NSID=... PROFILE_COLLECTION_NSID=... just zig reconcile-catalog
INDEX_MODE=disabled TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile just zig run
just zig bench-http --duration 5 --concurrency 16
DATABASE_URL=postgresql://... just zig bench-http --with-index --path '/v1/tracks?limit=50'
DATABASE_URL=postgresql://... TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile just zig repair-repo did:plc:example
DATABASE_URL=postgresql://... TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile just zig reconcile-accounts
just zig bench-snapshot
```

pg.zig uses system OpenSSL by default. On Apple Silicon with Homebrew's keg-only
OpenSSL, forward both paths explicitly when invoking `zig build`:

```console
zig build \
  -Dopenssl_include_path=/opt/homebrew/opt/openssl@3/include \
  -Dopenssl_lib_path=/opt/homebrew/opt/openssl@3/lib
```

The two options are a pair; supplying only one is a configuration error.

`check` includes a black-box HTTP contract smoke test on an ephemeral port.
`test-postgres` starts a Zig-only disposable Postgres 14 container,
waits for it to accept connections, creates minimal projection schemas, and
exercises the real `pg.zig` adapters. It covers atomic ordered-list replacement,
source-authoritative track replacement, replay and durable tombstone semantics,
whole-commit chain gap/conflict handling, and rollback across projection types.
It also covers authenticated complete-repo bootstrap, list and track absence
reconciliation, durable malformed-record quarantine and repair, and repair
replay before applying and reversing the real Alembic projection migrations.
It only destroys objects in the dedicated `zig_test` database on port 5435;
both test paths refuse any other database name. The HTTP benchmarks use a
third `zig_bench` database on port 5434, so neither path can overwrite the
Python suite's `relay_test` schema.

## API configuration

| variable | required | purpose |
|---|---:|---|
| `MODE` | yes | `api`, `ingester`, `repair`, `catalog_reconciler`, or separately supervised `account_reconciler` |
| `TRACK_COLLECTION_NSID` | yes | exact environment-aware track-record NSID |
| `LIST_COLLECTION_NSID` | yes | exact environment-aware list-record NSID used by albums |
| `PROFILE_COLLECTION_NSID` | yes | exact environment-aware authored profile-record NSID |
| `DATABASE_URL` | in normal API mode | PostgreSQL projection; canonical Postgres URLs and the existing SQLAlchemy `psycopg`, `psycopg2`, and `asyncpg` driver-qualified forms are accepted; missing or unknown configuration fails startup |
| `INDEX_MODE` | no | `required` by default; `disabled` is an explicit test/development mode whose readiness is `503` |
| `MAX_CONNECTIONS` | no | hard cap on accepted connection handlers, default `128` |
| `PORT` | no | listener port, default `8001` |
| `CORS_ALLOWED_ORIGINS` | no | comma-separated exact browser origins; empty disables CORS |
| `INGEST_REPAIR_DID` | in repair mode | canonical DID whose complete repository is fetched, verified, and atomically reconciled |
| `ACCOUNT_CHECK_INTERVAL_SECONDS` | no | authoritative current-PDS recheck interval, default 21600 (six hours) |
| `ACCOUNT_CHECK_RETRY_SECONDS` | no | retry interval after transport or non-authoritative status, default 300 |
| `ACCOUNT_CHECK_LEASE_SECONDS` | no | expired-worker claim recovery window, default 120 |
| `ACCOUNT_CHECK_SEED_SECONDS` | no | periodic sweep from authenticated repository heads, default 300 |
| `ACCOUNT_CHECK_IDLE_MILLISECONDS` | no | idle claim-poll interval, default 1000 |

`/health` is process liveness. `/ready` is product readiness and requires a
configured track index. The listener acquires a connection permit before
`accept`, so saturation applies kernel-backlog backpressure instead of creating
unbounded detached threads.

The current product surface is `GET /v1/tracks`,
`GET /v1/tracks/{track_id}`, `GET /v1/artists/{identifier}`, and the collection
and detail forms of `GET /v1/albums`. The track collection accepts a strict
`limit` from 1 to 100 and an opaque `cursor`; it
accepts an optional canonical `artist_did`, applies discovery or artist-view
policy before keyset pagination, and returns the same track representation as
detail. Track reads require an authenticated record and authoritative account
availability, then compose separately attributed authored profile, application
policy, metrics, and unverified R2 delivery fields. One canonical-URI policy
row carries access and operator-moderation claims with independent provenance;
the Python write paths maintain access while labeler reconciliation owns
moderation, and neither can overwrite the other. The migration imports existing
decisions once. A separate canonical-URI metrics rollup owns play counts and
mirrors them back to the Python column only for compatibility. Verified PDS
blob mirrors live in a separate,
record-CID-bound delivery projection. A legacy track row is optional enrichment:
a verified PDS record without one remains readable with a derived-public default
rather than inheriting local publish state. Artist lookup
accepts a canonical DID or a case-insensitive handle alias and exposes the
transitional source of each profile field. The album
collection exposes only canonical list-record albums and keeps local
presentation fields explicitly separate from record identity. Album detail
preserves every verified strong-reference position and hydrates only an exact
public URI/CID match.

`MODE=repair` is not part of the API service. It resolves the DID's PDS,
rejects unsafe or mixed DNS destinations, pins a checked address for TLS,
verifies the complete signed repository, reconciles `plyr_index`, and exits.
It never runs migrations; use a write-capable projection role distinct from
the read-only canary credential.

`MODE=account_reconciler` is also independent of the API and firehose roles.
It leases due DIDs from Postgres, resolves each DID's current PDS, and persists
only authoritative account evidence. Relay account frames merely make an
existing authenticated repository due sooner. A periodic sweep is the
correctness backstop, and transport/infrastructure failures schedule retries
without hiding content. Multiple reconcilers coordinate with `SKIP LOCKED` and
expired leases; an untrusted PDS never blocks signed firehose progress.

Do not source or copy the root `.env` into a worktree. Point a command at the
existing environment through the normal settings mechanism, and never print
secret values while checking configuration.

## canary deployment

`fly.canary.toml` defines an API-only Fly service named
`plyr-api-zig-canary`. It uses one 256 MiB shared-CPU machine, scales to zero,
and has no worker, jetstream, migration, Redis, R2, or production traffic
responsibilities. `DATABASE_URL` is its only secret and must point at the
staging projection.

The registered `deploy staging` GitHub workflow exposes an explicit manual
`zig-canary` target. Local development may build and run the image, but deployment
goes through that target. Keeping it in a workflow already present on the default
branch lets this long-lived PR deploy its own ref before merge; a newly added
standalone workflow cannot be dispatched until it reaches the default branch.
The job builds and publishes one commit-addressed image before deployment. On the
first run, its explicit `reconcile_catalog` input launches that image as an
unmanaged `--rm` Machine in `relay-api-staging`: it inherits staging's existing
database secret, authenticates current repositories, writes only the projection,
and is destroyed on exit. The canary app never receives that writer credential.
Later deployments leave reconciliation disabled unless source state needs a
deliberate refresh. The Fly hostname is the initial infrastructure verification
surface. The job runs
`scripts/canary_smoke.py` after deployment and fails unless readiness, API
discovery, track collection/detail, artist lookup, and album collection/detail
all prove their expected anonymous semantics and request-ID contract. The gate
requires a real verified staging track, round-trips its collection representation
through detail, and resolves its artist; an empty projection cannot pass. Run the
same check with `just zig smoke-canary`.

The same manual job then measures—not estimates—the deployed process. A tiny
read-only helper in the image locates the actual Zig executable through `/proc`
and records its current/peak RSS and CPU ticks alongside cgroup current/peak
memory. The runner benchmarks the real 50-track product read for ten seconds at
concurrency 1 and 16, retaining request rate and p50/p95/p99 latency. A combined,
commit-addressed artifact and workflow summary are produced even when a gate
fails. The job then streams the same snapshot helper into the live Python staging
API Machine and drives its current 50-track route from the same runner at the
same concurrency levels. Both benchmark records include mean response bytes, so
throughput and latency ratios cannot quietly conceal materially different
payload sizes. Deployment fails above 16 MiB idle application RSS, above 64 MiB
peak application RSS, after a Zig process restart, or on any Zig load-test HTTP
error; baseline errors are retained rather than making the successor inherit a
legacy failure. The deployed comparison is also a gate: Python staging must use
at least 50x the Zig process's idle and peak RSS, and Zig must serve at least 10x
its successful request rate at both measured concurrency levels. This
instrumentation exists only in the explicitly dispatched
canary job; ordinary PR checks do not run remote load or deployment measurements.
Run the same HTTP load driver against an already deployed target with
`just zig bench-canary -- ...`.

The iteration loop is native by default. `just zig check` uses the host Zig
toolchain and `just zig image-check` builds and starts a host-architecture Linux
container, proves `/health`, and exercises the same `/proc` snapshot helper used
on Fly. It never requests amd64 emulation on an arm64 development machine. When
an amd64 image sanity check is useful before deployment, manually dispatch
`validate docker build` with `target=zig-canary`; that registered workflow runs
one cached Zig image job on a native Linux/amd64 runner. Superseded PR checks are
cancelled. Cross-architecture assurance belongs on the matching runner, while
the deployment workflow remains the authoritative Fly image build.

`next.plyr.fm` is the eventual public parallel deployment of the successor
application, not an alias for the bare API and not a percentage canary. It gets
its own frontend configuration pointed at the Zig `/v1` surface and can evolve
beside `plyr.fm` until it is capable of replacing it. The internal Fly hostname
comes first; the `next` application is exposed only after the backend passes its
resource and semantic gates.

Before the first useful canary deployment, select the workflow's
`reconcile_catalog` input to seed the new projection from current authenticated
repositories. Existing canonical-looking track and album rows supply candidate
DIDs only; none of their metadata, CIDs, PDS locations, or account state is
trusted. The one-shot role verifies each complete repository through the same
signature/MST/CID path as continuous ingestion and fails if no repository verifies
or any candidate repository is retryable or rejected. An authenticated repository
can still succeed when individual selected records are malformed: those records
are atomically quarantined with their CID, reason, and commit proof while valid
siblings project normally. Local `just zig reconcile-catalog` remains a development
command; staging reconciliation uses the disposable Fly Machine so its writer
credential never leaves the staging app.
