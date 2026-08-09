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
| `DATABASE_URL` | in normal API mode | PostgreSQL projection; missing configuration fails startup |
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
availability, then compose separately attributed authored profile, local
access policy, operator moderation/metric, and unverified R2 delivery fields.
Access policy is keyed by canonical record URI and dual-written by the Python
upload, edit, and pending-record reconciliation paths; the migration imports
existing decisions once. Verified PDS blob mirrors live in a separate,
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

The `deploy Zig canary` GitHub workflow is manual-only. Local development may
build and run the image, but deployment goes through that workflow. The Fly
hostname is the initial verification surface. The workflow runs
`scripts/canary_smoke.py` after deployment and fails unless readiness, API
discovery, track collection/detail, artist lookup, and album collection/detail
all prove their expected anonymous semantics and request-ID contract. Run the
same check with `just zig smoke-canary`. `canary.plyr.fm` should be added
only after the service passes its resource and semantic-parity gates.

Before the first useful canary deployment, `just zig reconcile-catalog` seeds a
new projection from current authenticated repositories. Existing canonical-looking
track and album rows supply candidate DIDs only; none of their metadata, CIDs, PDS
locations, or account state is trusted. The one-shot role verifies each complete
repository through the same signature/MST/CID path as continuous ingestion and
fails if no repository verifies or any candidate repository is retryable or
rejected. An authenticated repository can still succeed when individual selected
records are malformed: those records are atomically quarantined with their CID,
reason, and commit proof while valid siblings project normally. It is
separate from the read-only API role and requires projection-write authority.
