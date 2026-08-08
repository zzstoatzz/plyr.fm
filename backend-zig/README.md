# plyr.fm Zig REST backend

This is the PDS-first `/v1` app-view API. It is intentionally a separate
contract from the Python API; Postgres is a derived index and R2 is a delivery
mirror, not content authority.

## local commands

Run commands from the repository root through the root justfile:

```sh
just zig check
just zig test-http
just zig test-postgres
INDEX_MODE=disabled TRACK_COLLECTION_NSID=fm.plyr.dev.track just zig run
just zig bench-http --duration 5 --concurrency 16
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

Do not source or copy the root `.env` into a worktree. Point a command at the
existing environment through the normal settings mechanism, and never print
secret values while checking configuration.
