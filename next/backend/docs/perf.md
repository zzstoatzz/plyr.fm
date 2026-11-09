# read-path performance

Measured on 2026-11-03 against a local Postgres 16 container with the
`migrations/` schema and a synthetic catalog: 20k tracks, 500 artists with
profiles, 2k accounts, 100k likes skewed toward a few tracks. Query times are
`EXPLAIN ANALYZE` of the exact text the store sends; endpoint times are the
median of ten warm `curl` requests to a ReleaseSafe build. Real data is
smaller today; what matters is how each query grows with the catalog.

## fixed

| endpoint | before | after | change |
|---|---|---|---|
| `/v1/tracks`, first page of 50 | 375 ms query | 50 ms query | page CTE before per-track joins |
| `/v1/tracks`, first page of 50 | 51 ms | 5 ms | stored `record_created_at_us` + index (0028) |
| `/v1/tracks`, cursor page | 56 ms | 8 ms | same |
| `/v1/charts/tracks`, all time | 530 ms query | 67 ms | page CTE, then maintained like counts (0029) |
| `/v1/charts/tracks?period=week` | 266 ms | 43 ms | like counts, window on an index |
| `/v1/records/await`, 10 s wait | 66 queries | 25 | capped backoff |

Every change returned identical rows or bodies. Notes:

- **Year 0 broke every list.** Postgres has no year 0, so
  `'0000-01-01T00:00:00Z'::timestamptz` raises, while the atproto datetime
  profile allows it. Each list cast every row's `record_created_at`, so one
  such track, like or playlist made every list over its table fail, the
  period chart included. 0028's trigger stores NULL for a datetime Postgres
  cannot represent, and the queries skip those rows.
- **Maintained counts are exact under any writer.** Statement-level
  triggers on `like_records` (0030) and a row trigger on
  `account_availability` recount the subjects a statement touched, after
  locking their count rows in key order. 0029 first did this per row under
  transaction-scoped advisory locks, which fill the shared lock table: one
  transaction touching more than about 6,400 distinct subjects failed with
  "out of shared memory", as a 100k-like bulk load did locally. With 0030 that
  load succeeds and matches a recount. A hegel property
  (`-Dfuzz-only=like_counts`, needs `PLYR_ZIG_TEST_DATABASE_URL`) drives
  random like upserts, retargets, multi-row statements, tombstones, owner
  purges, availability changes and truncation through both migrations and
  compares the table with a recount after every step.
- **The count triggers cost writes.** Each statement recounts its distinct
  subjects. Batches of 200 like inserts and deletes over distinct subjects
  ran at about a third of their rate without the triggers (70 vs 223 batches
  in 15 s locally). At next's ingest rate that is nothing; a full reconcile
  pays a few seconds.

## prepared statements and the Neon wake path (2026-11-09)

Hot reads go through `src/internal/index/postgres_read.zig`, which does two
things the pool helpers didn't:

- **Named prepared statements.** Each SQL constant is prepared once per
  pooled connection under a name derived from its text at comptime, so a
  name can never point at different SQL. Measured locally with
  `scripts/read_path_bench.sql` (500 artists, 20k tracks, 100k likes) and
  `scripts/bench_http.py --with-index`, ReleaseSafe, 4 vCPU container, Postgres
  16 on the same host, concurrency 1, 5 s per row; bodies were byte-identical
  before and after:

  | endpoint | before p50 | after p50 |
  |---|---|---|
  | `/v1/tracks?limit=50` | 26.2 ms | 1.6 ms |
  | `/v1/tracks?limit=50&cursor=…` | 27.0 ms | 1.6 ms |
  | `/v1/tracks/{id}` | 3.9 ms | 0.23 ms |
  | `/v1/tracks?limit=50`, concurrency 8 | 52 ms (146 req/s) | 4.5 ms (1,560 req/s) |

  Search stays unprepared (`queryUnprepared`): after five executions
  Postgres may switch a prepared statement to a generic plan, and for the
  trigram search that plan was 10–20% slower than re-planning. Tag-filtered
  discovery and period charts are prepared but were not benchmarked with
  tags or a populated chart window; if a generic plan regresses one of them
  on real data, move it to `queryUnprepared` too.

- **One retry on a dead connection.** A read that fails with a transport
  error or SQLSTATE class `08`, `57P` (what Neon suspend and
  `pg_terminate_backend` send) or `0A000` (a cached plan invalidated by a
  schema change) is retried once. The failed connection is released as
  failed, so the pool replaces it, and the pool is LIFO, so the retry
  normally runs on that replacement. Query errors are never retried, nor
  are failures after the first row has been read. Only statements the
  comptime read-only check accepts can use the module, so writes cannot be
  retried by accident. A postgres test terminates every pooled backend and
  asserts the following reads succeed; hegel properties
  (`-Dfuzz-only=postgres_read`) cover the retry policy and the read-only
  check, with mutants for both in `src/fuzz/mutants.zon`.

Writes (ingest, play receipts, mirror bookkeeping) still use the pool
directly and are not retried.

## ingest and the api

- **No read/write contention measured.** With ~1,000 like writes/s (batched
  inserts and deletes, triggers on) against the same database, track lists,
  the chart and the artist page answered within noise of idle. The
  ingester commits one short transaction per record, and Postgres readers
  never wait on row locks; only DDL and `TRUNCATE` (migration 0027) take
  locks that block reads, and those run at deploy.
- **`/v1/health/ingest`** reports the stream cursor and its age (ingest lag),
  when the catalog was last reconciled, the label sync sequence and age, and
  the mirror backlog (pending and retrying, capped at 10,000), in one query of
  about 20 ms at 20k tracks. The reconciler records its completion in
  `relay_cursors` (`catalog_reconcile`). There is no metrics exporter in the
  backend, so these are not also emitted as metrics.

The eager-pool startup issue was resolved in #2312 by passing
`connect_on_init_count` through pg.zig's `initUri`. The earlier local measurements
were 83, 242 and 846 ms for 1, 4 and 16 connections at 10 ms network latency.
The deployed configuration opens one connection before binding and connects
the remainder in the background.

## open, ranked

1. **One OS thread per connection** (`server.zig` spawns a thread per
   accepted stream, bounded by `MAX_CONNECTIONS`). Fine at current load on a
   256 MB machine; worth revisiting before raising the connection limit.

## scale to zero

The api process group runs only the HTTP server: no timers, loops, or
outbound keepalives of its own (the identity refresher, blob mirror and label
sync run in the ingester group). Fly's proxy starts and stops `app` machines
on inbound traffic (`auto_stop_machines = "stop"`, `min_machines_running =
0`), so nothing in the code keeps them up; an external poller of `/ready` or
`/v1/health/ingest`, or a long `await`, would.

## reproducing

The numbers come from a throwaway `postgres:16-alpine` container, with
`tc qdisc ... netem delay 10ms` for the boot measurements. The migrations
need stub `public.tracks`, `public.artists`, `public.albums`,
`public.user_preferences`, `public.share_links` and
`public.share_link_events` tables (the Python schema they grant on and
backfill from) and the `plyr_zig_canary` and `plyr_zig_worker` roles. Seed
with `generate_series` into `actor_identities`, `account_availability`,
`profile_records`, `track_records` and `like_records`, using real CIDs and
TIDs (the stores refuse anything else), then `ANALYZE`.
`scripts/read_path_bench.sql` is that fixture, for a `plyr_bench` database
built the way CI builds one (Python `init_db.py`, then `scripts/migrate`).
