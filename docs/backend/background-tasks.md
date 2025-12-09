# background tasks

plyr.fm uses [pydocket](https://github.com/PrefectHQ/pydocket) for durable background task execution, backed by Redis.

## overview

background tasks handle operations that shouldn't block the request/response cycle:
- **copyright scanning** - analyzes uploaded tracks for potential copyright matches
- (future) upload processing, notifications, etc.

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

Redis instances are provisioned via Upstash (managed Redis):

| environment | instance | region |
|-------------|----------|--------|
| production | `plyr-redis-prd` | us-east-1 (near fly.io) |
| staging | `plyr-redis-stg` | us-east-1 |

set `DOCKET_URL` in fly.io secrets:
```bash
flyctl secrets set DOCKET_URL=rediss://default:xxx@xxx.upstash.io:6379 -a relay-api
flyctl secrets set DOCKET_URL=rediss://default:xxx@xxx.upstash.io:6379 -a relay-api-staging
```

note: use `rediss://` (with double 's') for TLS connections to Upstash.

## usage

### scheduling a task

```python
from backend._internal.background_tasks import schedule_copyright_scan

# automatically uses docket if enabled, else asyncio.create_task
await schedule_copyright_scan(track_id, audio_url)
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

**Upstash pricing** (pay-per-request):
- free tier: 10k commands/day
- pro: $0.2 per 100k commands + $0.25/GB storage

for plyr.fm's volume (~100 uploads/day), this stays well within free tier or costs $0-5/mo.

**tips to avoid surprise bills**:
- use **regional** (not global) replication
- set **max data limit** (256MB is plenty for a task queue)
- monitor usage in Upstash dashboard

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
