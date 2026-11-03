# read-path performance

Measured on 2026-11-03 against a local Postgres 16 container with the
`migrations/` schema and a synthetic catalog: 20k tracks, 500 artists with
profiles, 2k accounts, 100k likes skewed toward a few tracks. Times are
`EXPLAIN ANALYZE` of the exact query text the store sends, warm cache, three
runs each. Real data is smaller today; what matters is how each query grows
with the catalog.

## fixed

| query | before | after | rows |
|---|---|---|---|
| discovery list, first page of 50 | 375 ms, 641k buffer hits | 50 ms, 102k | identical |
| track chart, top 20 | 530 ms | 248 ms | identical |

Both queries joined every visible track to its delivery origin, metrics,
profile, and a per-track like-count subquery (20k subquery runs), then kept
one page. They now filter, sort and limit on the cheap columns in a
materialized `page` CTE and join the per-track data for that page only. The
artist list and both cursor variants share the same builder, and the
composed-store Postgres test now walks a cursor page in both scopes.

## open, ranked

1. **Track lists sort on an expression no index can serve.** Every list
   orders by `record_created_at::timestamptz`, a cast from text that is
   `STABLE` (it depends on the session time zone), so it cannot be indexed,
   and `ix_track_records_owner_created` sorts the raw text, which is not time
   order once offsets differ. Each page still sorts every visible track: the
   remaining 50 ms above, linear in the catalog. Fix: project
   `record_created_at_us BIGINT` at write time (the ingester already validates
   the datetime and zat.Datetime.parse yields microseconds) and index `(collection, record_created_at_us DESC, record_uri DESC) WHERE NOT deleted`
   plus the per-owner equivalent; then the page CTE is an index range scan.
   Needs a migration and a backfill, so it is not in this change.
2. **The chart aggregates every like on every request.** `ranked_likes` is a
   `COUNT(DISTINCT owner_did)` over the whole like table joined to account
   availability: about 180 of the remaining 248 ms, linear in likes. The
   chart changes slowly; a like-count table maintained by the like projector
   (or a materialized view refreshed by the ingester) would make it an index
   scan. The same count is also computed per track in every list and detail
   response, now only for the rows returned.
3. **`/v1/records/await` polls Postgres every 150 ms for up to 10 s**: up to
   66 queries for one request while a client waits for its own write to be
   indexed. A `LISTEN`/`NOTIFY` from the projector, or a backoff, would cut
   that to one or a few.
4. **Each api machine opens its whole pool at boot.** pg.zig's pool connects
   all `DATABASE_POOL_SIZE` connections at init (16 on the canary) before
   the machine serves, so every scale-from-zero start pays 16 TLS handshakes
   to Neon. `connect_on_init_count` can open a few and let the reconnector
   fill the rest. Whether 16 idle connections also keep the Neon compute
   from suspending between requests is not verified here; check Neon's
   compute activity for the next branch before changing it for cost.
5. **One OS thread per connection** (`server.zig` spawns a thread per
   accepted stream, bounded by `MAX_CONNECTIONS`). Fine at current load on a
   256 MB machine; worth revisiting before raising the connection limit.

## scale to zero

The api process group runs only the HTTP server: no timers, loops, or
outbound keepalives of its own (the identity refresher and blob mirror run
in the ingester group). Fly's proxy starts and stops `app` machines on
inbound traffic (`auto_stop_machines = "stop"`, `min_machines_running = 0`),
so nothing in the code keeps them up; an external poller of `/ready` or a
long `await` would.

## reproducing

The numbers come from a throwaway `postgres:16-alpine` container. The
migrations need stub `public.tracks`, `public.artists`, `public.albums`,
`public.user_preferences`, `public.share_links` and
`public.share_link_events` tables (the Python schema they grant on and
backfill from) and the `plyr_zig_canary` and `plyr_zig_worker` roles. Seed
with `generate_series` into `actor_identities`, `account_availability`,
`profile_records`, `track_records` and `like_records`, `ANALYZE`, then
`PREPARE` the store's query text and `EXPLAIN (ANALYZE, BUFFERS)` it.
