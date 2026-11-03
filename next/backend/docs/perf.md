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
- **Maintained counts are exact under any writer.** 0029's triggers on
  `like_records` and `account_availability` recompute one subject at a time
  under an advisory lock. A hegel property (`FUZZ_ONLY=like_counts`, needs
  `PLYR_ZIG_TEST_DATABASE_URL`) drives random like upserts, retargets,
  tombstones, owner purges, availability changes and truncation through the
  migration itself and compares the table with a recount after every step.
- **The count trigger costs writes.** A like insert or delete runs a recount
  of its subject: about 1 ms per row op locally, so like writes run at about
  a third of their former rate (930 vs 3,000 row ops/s). At next's ingest rate
  that is nothing. A full reconcile pays a few seconds. Statement-level
  triggers with transition tables would recount each subject once per
  statement if that ever matters.

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

## open, ranked

1. **Every request re-plans its query.** pg.zig sends unnamed statements, so
   the large track query is parsed and planned on each request: about 9 ms of
   the 14 ms a discovery page takes end to end, more than it spends executing.
   Named prepared statements per pooled connection would remove that.
2. **pg.zig's `initUri` drops `connect_on_init_count`**, so a pool built from
   a URL always opens every connection before the server listens. Boot is
   linear in pool size: 83, 242 and 846 ms for 1, 4 and 16 connections at
   10 ms of network latency. Main's pool of 4 keeps that small; the one-line
   fix in the pg.zig fork (pass the option through) would make it one
   handshake.
3. **Idle connections and Neon suspend.** Neon suspends a compute after 5
   minutes without active queries, and idle connections do not prevent it,
   so the pool costs nothing while idle. The suspend closes the connections
   it held, though, and the pool does not notice until one is used: with
   every server-side connection terminated locally, the next request got a
   503 and the ones after it succeeded. A Fly machine that outlives a Neon
   suspend therefore fails one request on wake. Retrying once on a broken
   connection (in the pool, or around `acquire` in the stores) would hide it.
4. **One OS thread per connection** (`server.zig` spawns a thread per
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
