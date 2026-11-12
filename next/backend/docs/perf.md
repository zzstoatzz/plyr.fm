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

1. **Every request re-plans its query.** pg.zig sends unnamed statements, so
   the large track query is parsed and planned on each request: about 9 ms of
   the 14 ms a discovery page takes end to end, more than it spends executing.
   Named prepared statements per pooled connection would remove that.
2. **Idle connections and Neon suspend.** Composed catalog reads now retry a
   lost connection once (see the November 12 recovery section); the other read
   adapters still need the same bounded recovery contract. Neon suspends a compute after 5
   minutes without active queries, and idle connections do not prevent it,
   so the pool costs nothing while idle. The suspend closes the connections
   it held, though, and the pool does not notice until one is used: with
   every server-side connection terminated locally, the next request got a
   503 and the ones after it succeeded. A Fly machine that outlives a Neon
   suspend therefore fails one request on wake. Retrying once on a broken
   connection can hide it; retrying only `acquire` is insufficient because the
   first failure can arrive while reading rows.
3. **One OS thread per connection** (`server.zig` spawns a thread per
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

## composed read statement cache, November 12

The composed track store now names its nine fixed queries through pg.zig's
existing per-connection statement cache. Reuse avoids repeated Parse/Describe;
Postgres still chooses between custom and generic plans. This is not a promise
that every query stops planning. Names are bounded by the query set and disappear
with the connection. No user values enter statement names.

A local ReleaseSafe comparison used the same Postgres 16 container, 20,000
tracks, one artist, 50-row responses, and identical before/after response SHA-256s.
Each case warmed with 12 serial requests, then measured three seconds at one and
eight concurrent clients. The first complete before/after pair had no errors:

| read | concurrency | p50 before → after | p95 before → after | requests/s before → after |
|---|---:|---:|---:|---:|
| discovery | 1 | 28.3 → 31.6 ms | 39.2 → 51.7 ms | 32.2 → 28.9 |
| discovery | 8 | 46.7 → 40.9 ms | 103.7 → 65.3 ms | 143.6 → 178.3 |
| popular tag | 1 | 299.9 → 108.6 ms | 351.7 → 132.8 ms | 3.2 → 8.8 |
| popular tag | 8 | 385.6 → 145.1 ms | 632.1 → 390.5 ms | 18.7 → 39.1 |
| rare tag | 1 | 122.4 → 109.7 ms | 197.5 → 130.9 ms | 6.7 → 8.9 |
| rare tag | 8 | 142.3 → 150.9 ms | 190.8 → 241.7 ms | 52.5 → 49.1 |
| artist | 1 | 12.6 → 10.3 ms | 24.5 → 15.1 ms | 69.8 → 92.0 |
| artist | 8 | 21.7 → 15.1 ms | 61.1 → 27.6 ms | 294.1 → 477.1 |

These are short synthetic workstation samples, not production percentiles. The
popular-tag and artist improvements warrant the change; unfiltered and rare-tag
results do not establish a general speedup. The unfiltered single-client and
rare-tag concurrent samples regressed. A second cached pass was started, but
unrelated builds on the shared laptop resumed during that pass; the incomplete
alternating campaign is not used as confirmation. Earlier measurements overlapping
compilation, integration tests or fixture creation were discarded. Dense tag
reads remain too expensive and need a separate query-plan investigation.

The integration regression alternates missing and matching legacy tags beyond
Postgres's initial custom-plan executions and verifies exact record identity. It
also checks that the server actually reused the named statement. Existing tests
exercise cursor/artist/account boundaries, projection changes and moderation on
the same connection, so caching must not freeze values or policy decisions.

### reproducing the larger fixture

The existing `composed_track_bench.sql` seeds 100 tracks and predates several
projection migrations. From `next/backend`, use a disposable `zig_bench` only:

```bash
docker compose --profile bench up -d --wait bench-db
psql=(docker compose exec -T bench-db psql -X -v ON_ERROR_STOP=1 -U zig_bench -d zig_bench)
"${psql[@]}" < scripts/composed_track_bench.sql
"${psql[@]}" -c 'ALTER TABLE public.artists ADD COLUMN pds_url text'
for prefix in 0023 0024 0026 0028 0029 0030 0032 0033 0034; do
  for migration in migrations/"$prefix"_*.sql; do
    "${psql[@]}" -1 < "$migration"
  done
done
"${psql[@]}" <<'SQL'
INSERT INTO plyr_index.track_tag_records
SELECT record_uri, record_cid, ARRAY['ambient'], true
FROM plyr_index.track_records;
INSERT INTO plyr_index.track_records
SELECT (jsonb_populate_record(NULL::plyr_index.track_records,
  to_jsonb(t) || jsonb_build_object(
    'record_uri', format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'rkey', format('track-%s', n),
    'title', format('Benchmark Track %s', n),
    'record_created_at', to_char(
      TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ))).*
FROM (SELECT * FROM plyr_index.track_records LIMIT 1) t
CROSS JOIN generate_series(101, 20000) n;
INSERT INTO plyr_index.track_tag_records
SELECT record_uri, record_cid,
  ARRAY[CASE WHEN rkey IN ('track-101', 'track-102')
    THEN 'rare-tag' ELSE 'ambient' END], true
FROM plyr_index.track_records
WHERE record_uri NOT IN (SELECT record_uri FROM plyr_index.track_tag_records);
ANALYZE;
SQL
```

Build each revision with `zig build -Doptimize=ReleaseSafe`, retaining separate
binaries, and wait for fixture creation and other builds to finish. Run
`scripts/bench_http.py --with-index --duration 3 --concurrency 1 --path ...`
with the disposable database URL; repeat at concurrency 8. The paths are
`/v1/tracks?limit=50`, the same with `&tag=ambient` or `&tag=rare-tag`, and
`&artist_did=did:plc:bench`. For the table above, the script's
`benchmark_process` helper was called with each retained binary, pool size 8,
maximum connections 16, and a validation callback that made 12 requests and
compared body hashes before timing. Keep that warmup and compare hashes across
revisions when reproducing the table; the plain CLI command alone includes cold
statement preparation and is a different measurement. Keep the full JSON output,
including errors, sample count, p99 and memory, alongside any reported summary.

## composed read recovery, November 12

Composed catalog reads retry once when their PostgreSQL connection disappears.
The retry wraps the complete adapter operation, including result iteration and
single-row cleanup, before the API serializes or sends a response. It applies to
track detail, discovery and artist catalogs, liked tracks, batch track hydration,
tags and readiness. Other PostgreSQL adapters are unchanged; this does not close
the entire scope of #2319.

`postgres_read.zig` recognizes closed/reset/broken-pipe transports, TLS stream
read/write failures and PostgreSQL connection-loss or shutdown codes
`08003`, `08006`, `57P01`, `57P02`. It marks that connection failed before normal
result cleanup and pool release; pg.zig destroys it and its statement cache, then
opens a replacement. The second complete attempt reacquires a connection and
recreates any prepared statement. A second loss becomes `IndexUnavailable`.
SQL errors, statement cancellation, timeouts, pool exhaustion, allocation errors
and corrupt projections are not retry signals. No write adapter uses this runner.

Each attempt unwinds its result and connection before the next begins. Partial
vectors are freed on error; decoded fields retain the existing request-arena
lifetime and are reclaimed at the end of the HTTP request. At most two bounded
read attempts allocate into that arena. The runner retains no connection, result
or allocation between requests.

Verification commands, from `next/backend`:

```sh
just check
just test-read-http
PLYR_ZIG_TEST_DATABASE_URL=postgresql://zig_test:zig_test@127.0.0.1:5435/zig_test \
  zig build test -Dtest-filter='read retry'
```

The HTTP test creates a unique scratch database and read-only login on the local
test Postgres. It warms each catalog path, terminates that login's sole database
connection, and requires the first subsequent HTTP request to return the identical
200 response through a different backend PID. Denying new logins before terminating
the connection must produce a bounded 503. Its database and role are removed on
exit. The pre-fix binary fails the first terminated-connection case with 503.
The Zig CI workflow runs this HTTP contract against its disposable Postgres.

The focused Zig test terminates a connection after consuming its first row from
a deliberately streaming query. It requires exactly two attempts, different PIDs,
and exactly 1,000 ordered rows without any partial first-attempt rows leaking into
the result. The testing allocator checks allocation cleanup. Separate tests cover
the two-attempt limit and non-retryable errors. A test-name filter is now available
through `-Dtest-filter` so these failure tests can run independently of unrelated
integration tests.

## discovery exclusion cost, November 12

The account-label/hidden-tag change was checked against the existing 20,000-track
fixture above, with no matching hidden tags or account labels. Both binaries were
Debug builds, one local API and one database connection at a time. Each variant
made 12 warmup requests followed by 20 measured sequential requests to
`/v1/tracks?limit=50`; the returned record URI order had to remain identical.
The order was baseline, changed query, baseline again, with other agent builds
held. This is a small local regression check, not a production latency budget.

| query | median | range |
|---|---:|---:|
| before hidden filters | 27.74 ms | 24.76–29.98 ms |
| account and hidden-tag filters | 43.50 ms | 41.38–46.59 ms |
| before, repeated | 27.23 ms | 24.10–29.63 ms |

The extra policy costs about 16 ms in this fixture. An initial correlated
`NOT EXISTS` shape cost 2,361 ms median: `EXPLAIN (ANALYZE, BUFFERS)` showed inflated
estimated subplan costs crossing PostgreSQL's JIT optimization threshold, with
roughly 1.6 seconds of JIT compilation for the page query alone. The shipped shape
uses uncorrelated exclusion sets with non-null keys, retaining PostgreSQL's tag
normalizer and the empty-preference shortcut. Its custom page plan stayed below
the JIT threshold. Negative filters still execute before ordering and `LIMIT`.

Reproduce with the 20,000-row setup above plus migration 0037, retaining separate
Debug binaries before and after the change. Keep tag and account exclusion tables
free of matches, use pool size one, and time individual complete HTTP reads after
the warmup. Repeat the baseline last to expose host-load drift; do not compare
these Debug timings with the ReleaseSafe table above.
