# background tasks

plyr.fm uses [pydocket](https://github.com/PrefectHQ/pydocket) for durable background task execution, backed by Redis.

## overview

background tasks handle operations that shouldn't block the request/response cycle:
- **copyright scanning** - analyzes uploaded tracks for potential copyright matches
- **media export** - downloads all tracks, zips them, and uploads to R2
- **ATProto sync** - syncs records to user's PDS on login
- **teal scrobbling** - scrobbles plays to user's PDS
- **album list sync** - updates ATProto list records when album metadata changes
- **PDS like/unlike** - syncs like records to user's PDS asynchronously
- **PDS comment create/update/delete** - syncs comment records to user's PDS asynchronously
- **genre classification** - classifies tracks via Replicate effnet-discogs, stores predictions in `track.extra`
- **move track audio** - moves files between public/private R2 buckets when support_gate is toggled
- **sync copyright resolutions** (perpetual) - syncs copyright label resolutions from ATProto labeler every 5 minutes

## architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   FastAPI   │────▶│    Redis    │◀────│   Worker    │
│   (add task)│     │  (queue)    │     │  (process)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

- **docket** schedules tasks to Redis
- **worker** runs in-process alongside FastAPI, processing tasks from the queue
- tasks are durable - if the worker crashes, tasks are retried on restart

## configuration

### environment variables

```bash
# redis URL (required to enable docket)
DOCKET_URL=redis://localhost:6379

# optional settings (have sensible defaults)
DOCKET_NAME=plyr              # queue namespace
DOCKET_WORKER_CONCURRENCY=10  # concurrent task limit
```

### ⚠️ worker settings - do not modify

the worker is initialized in `backend/_internal/background.py` with pydocket's defaults. **do not change these settings without extensive testing:**

| setting | default | why it matters |
|---------|---------|----------------|
| `heartbeat_interval` | 2s | changing this broke all task execution (2025-12-30 incident) |
| `minimum_check_interval` | 1s | affects how quickly tasks are picked up |
| `scheduling_resolution` | 1s | affects scheduled task precision |

**2025-12-30 incident**: setting `heartbeat_interval=30s` caused all scheduled tasks (likes, comments, exports) to silently fail while perpetual tasks continued running. root cause unclear - correlation was definitive but mechanism wasn't found in pydocket source. reverted in PR #669.

if you need to tune worker settings:
1. test extensively in staging with real task volume
2. verify ALL task types execute (not just perpetual tasks)
3. check logfire for task execution spans

when `DOCKET_URL` is not set, docket is disabled and tasks fall back to `asyncio.create_task()` (fire-and-forget).

### local development

```bash
# start redis + backend + frontend
just dev

# or manually:
docker compose up -d  # starts redis on localhost:6379
DOCKET_URL=redis://localhost:6379 just backend run
```

### production/staging

Redis instances are self-hosted on Fly.io (redis:7-alpine):

| environment | fly app | region |
|-------------|---------|--------|
| production | `plyr-redis` | iad |
| staging | `plyr-redis-stg` | iad |

set `DOCKET_URL` in fly.io secrets:
```bash
flyctl secrets set DOCKET_URL=redis://plyr-redis.internal:6379 -a relay-api
flyctl secrets set DOCKET_URL=redis://plyr-redis-stg.internal:6379 -a relay-api-staging
```

note: uses Fly internal networking (`.internal` domain), no TLS needed within private network.

## usage

### scheduling a task

```python
from backend._internal.background_tasks import schedule_copyright_scan, schedule_export

# automatically uses docket if enabled, else asyncio.create_task
await schedule_copyright_scan(track_id, audio_url)
await schedule_export(export_id, artist_did)
```

### adding new tasks

1. define the task function in `backend/_internal/background_tasks.py`:
```python
async def my_new_task(arg1: str, arg2: int) -> None:
    """task functions must be async and JSON-serializable args only."""
    # do work here
    pass
```

2. register it in `backend/_internal/background.py`:
```python
def _register_tasks(docket: Docket) -> None:
    from backend._internal.background_tasks import my_new_task, scan_copyright

    docket.register(scan_copyright)
    docket.register(my_new_task)  # add here
```

3. create a scheduler helper if needed:
```python
async def schedule_my_task(arg1: str, arg2: int) -> None:
    """schedule with docket if enabled, else asyncio."""
    if is_docket_enabled():
        try:
            docket = get_docket()
            await docket.add(my_new_task)(arg1, arg2)
            return
        except Exception:
            pass  # fall through to asyncio

    asyncio.create_task(my_new_task(arg1, arg2))
```

## costs

**self-hosted Redis on Fly.io** (fixed monthly):
- ~$2/month per instance (256MB shared-cpu VM)
- ~$4/month total for prod + staging

this replaced Upstash pay-per-command pricing which was costing ~$75/month at scale (37M commands/month).

## fallback behavior

when docket is disabled (`DOCKET_URL` not set):
- `schedule_copyright_scan()` uses `asyncio.create_task()` instead
- tasks are fire-and-forget (no retries, no durability)
- suitable for local dev without Redis

## monitoring

background task execution is traced in Logfire:
- span: `scheduled copyright scan via docket`
- span: `docket scheduling failed, falling back to asyncio`

query recent background task activity:
```sql
SELECT start_timestamp, message, span_name, duration
FROM records
WHERE span_name LIKE '%copyright%'
  AND start_timestamp > NOW() - INTERVAL '1 hour'
ORDER BY start_timestamp DESC
```
