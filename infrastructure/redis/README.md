# plyr-redis

self-hosted Redis on Fly.io. backs docket background tasks, the session cache,
rate-limit counters, and the discovery cache.

three apps, one per environment — `plyr-redis` (prod, used by `relay-api`),
`plyr-redis-stg` (staging, used by `relay-api-staging`), and
`plyr-redis-next` (the Zig successor canary). they are not shared.

`plyr-redis-next` is intentionally narrower: it holds only expiring,
domain-separated anonymous play-deduplication keys. It has no volume or AOF
because losing that cache fails open and must not affect playback availability.

## deployment

```bash
# first time: create app and volume
fly apps create plyr-redis
fly volumes create redis_data --region iad --size 1 -a plyr-redis

# deploy (staging: -c fly.staging.toml; next: -c fly.next.toml)
fly deploy -a plyr-redis
```

## authentication

Redis requires a password. it is read from the `REDIS_PASSWORD` secret and
applied via `--requirepass` in `[processes]`, which is why the command is
wrapped in `sh -c` — Fly exec's the process args rather than running them
through a shell, so an unwrapped `$REDIS_PASSWORD` would be taken literally.

neither app has a public IP (`fly ips list` is empty), so this is defense in
depth against anything that reaches the org's private network — see #1782.

## connecting from other fly apps

the password belongs in the connection string:

```
redis://:<REDIS_PASSWORD>@plyr-redis.internal:6379
```

```bash
fly secrets set DOCKET_URL='redis://:<pw>@plyr-redis.internal:6379' -a relay-api
fly secrets set DOCKET_URL='redis://:<pw>@plyr-redis-stg.internal:6379' -a relay-api-staging
fly secrets set DOCKET_URL='redis://:<pw>@plyr-redis-next.internal:6379' -a plyr-api-zig-canary
```

**the password and the connection string must change together.** Redis rejects
`AUTH` when no password is set, and rejects unauthenticated clients once one is,
so whichever side moves first, the other is broken until it catches up. plan for
a brief window: the session cache degrades gracefully (every Redis call falls
through to Postgres), but in-flight docket tasks can fail.

> verifying with `redis-cli`? use `-a <pw>`, not `-u redis://:<pw>@host` — the
> URL form sends an empty ACL username and fails with `WRONGPASS` even when the
> password is right. the Python client parses the same URL correctly.

## configuration

- **persistence**: AOF (append-only file) enabled for durability
- **memory**: 200MB max with LRU eviction
- **storage**: 1GB volume mounted at /data
- **auth**: `--requirepass` from the `REDIS_PASSWORD` secret

## cost

~$1.94/month (256MB shared-cpu VM) + $0.15/month (1GB volume) = ~$2.09/month

vs. Upstash pay-as-you-go which was costing ~$75/month at 37M commands.
