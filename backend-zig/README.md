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
INDEX_MODE=disabled TRACK_COLLECTION_NSID=fm.plyr.dev.track just zig run
just zig bench-http --duration 5 --concurrency 16
DATABASE_URL=postgresql://... just zig bench-http --with-index --path '/v1/tracks?limit=50'
```

`check` includes a black-box HTTP contract smoke test on an ephemeral port.
`test-postgres` starts the repository's disposable Postgres 14 test container,
waits for it to accept connections, creates a minimal projection schema, and
exercises the real `pg.zig` adapter. It only destroys tables in the dedicated
`relay_test` database on port 5433; the test refuses any other database name.

## API configuration

| variable | required | purpose |
|---|---:|---|
| `MODE` | yes | must be `api`; set by `just zig run` |
| `TRACK_COLLECTION_NSID` | yes | exact environment-aware track-record NSID |
| `DATABASE_URL` | in normal API mode | PostgreSQL projection; missing configuration fails startup |
| `INDEX_MODE` | no | `required` by default; `disabled` is an explicit test/development mode whose readiness is `503` |
| `MAX_CONNECTIONS` | no | hard cap on accepted connection handlers, default `128` |
| `PORT` | no | listener port, default `8001` |
| `CORS_ALLOWED_ORIGINS` | no | comma-separated exact browser origins; empty disables CORS |

`/health` is process liveness. `/ready` is product readiness and requires a
configured track index. The listener acquires a connection permit before
`accept`, so saturation applies kernel-backlog backpressure instead of creating
unbounded detached threads.

The current product surface is `GET /v1/tracks`,
`GET /v1/tracks/{track_id}`, and `GET /v1/artists/{identifier}`. The track
collection accepts a strict `limit` from 1 to 100 and an opaque `cursor`; it
accepts an optional canonical `artist_did`, applies discovery or artist-view
policy before keyset pagination, and returns the same track representation as
detail. Artist lookup accepts a canonical DID or a case-insensitive handle
alias and exposes the transitional source of each profile field.

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
hostname is the initial verification surface; `canary.plyr.fm` should be added
only after the service passes its resource and semantic-parity gates.
