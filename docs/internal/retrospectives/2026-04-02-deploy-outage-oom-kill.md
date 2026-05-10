# postmortem: production outage 2026-04-02

## summary

API outage for ~6 minutes (02:34-02:40 UTC). after a deploy, Fly auto-stopped one machine (low traffic). the remaining machine became unresponsive for unknown reasons — the process was "started" per Fly but produced zero Logfire spans. because Fly has **no HTTP health checks configured**, it never detected the failure and never restarted the machine. when a replacement machine finally started, it was **OOM killed** (1GB memory exhausted in 20 seconds). manual intervention was required to restore service.

## timeline (UTC, 2026-04-02)

| time | event |
|------|-------|
| 02:27:01 | deploy starts — both machines receive new image (`deployment-01KN5SXJ2GYCVWT7EN0NF1G851`) |
| 02:27:13 | machine 2 (`91859e9f`) starts |
| 02:27:29 | both machines complete startup (notification bot, queue service, docket worker, db pool warm) |
| 02:27:33 | normal traffic resumes — requests serving fine (20-130ms) |
| 02:27:56 | slow requests: `GET /discover/network` 2594ms, `GET /tracks/` 1675ms (post-deploy cold paths) |
| 02:32:20 | last successful HTTP request: `GET /tracks/top` (44ms) |
| 02:32:31 | queue listener heartbeat timeout on one machine — asyncpg connection marked dead, reconnection begins |
| 02:32:57 | queue listener reconnection fails (15s timeout), retrying with backoff |
| 02:33:26 | last Logfire span before silence (moderation scan HTTP call) |
| **02:34:33** | **one machine shuts down gracefully** — Fly auto-stop (`auto_stop_machines = 'stop'`). all services report orderly shutdown. |
| 02:34:33 – 02:39:38 | **OUTAGE: remaining machine is "started" but producing zero spans.** no HTTP requests, no background work, nothing in Logfire. Fly has no health checks to detect this. |
| 02:39:38 | manual intervention: `fly machine restart` on machine 2 |
| 02:39:49 | machine 2 crashes during restart (exit_code=-1), auto-restarts at 02:39:53 |
| 02:39:59 | Fly proxy auto-starts machine 1 (incoming traffic detected) |
| 02:40:13 | machine 1 completes startup |
| **02:40:20** | **machine 1 OOM killed** after 20 seconds (exit_code=137, oom_killed=true) |
| 02:40:21 | machine 1 auto-restarts, stays up this time |
| 02:41:01 | both machines serving traffic normally |

**total downtime: ~6 minutes** (02:34:33 – 02:40:43)

## root causes

### 1. no Fly health checks — frozen machine went undetected

fly.toml has **no `[[http_service.checks]]` section**. the remaining machine became unresponsive (zero Logfire output from 02:33 to 02:39) but Fly still considered it "started." with health checks, Fly would have detected the failure within seconds and auto-restarted the machine, preventing the outage entirely.

**what froze the machine is unknown.** the queue listener had reconnection issues (heartbeat timeout at 02:32:31), but the queue listener is decoupled from the HTTP server — it uses `asyncio.create_task()` and catches all exceptions internally. it should not be able to freeze the process. possible causes:
- memory pressure causing the process to become unresponsive (1GB is tight)
- asyncio event loop blocked by something unrelated to the queue listener
- the process died without graceful shutdown (hard crash/OOM that Fly's event log truncated)

### 2. Fly auto-stop reduced to single machine

`auto_stop_machines = 'stop'` with `min_machines_running = 1` means Fly will stop one machine during low-traffic periods. the graceful shutdown at 02:34:33 is consistent with Fly sending SIGTERM to the idle machine. this left a single machine — and when that machine froze, there was no redundancy.

### 3. OOM kill on recovery (1GB machine)

machine 1 was OOM killed (exit_code=137) after only **20 seconds** of operation. startup allocates: db connection pool (10 connections), httpx clients, notification bot auth, queue service, docket worker, background tasks. with 6 minutes of queued requests arriving immediately, 1GB was not enough.

## what already works (corrections from initial analysis)

investigation confirmed that several fixes from prior incidents are **already in place**:

- **database pool**: `pool_size=10`, `max_overflow=5`, `pool_pre_ping=True`, `pool_recycle=1800s` — all implemented
- **connection timeouts**: `connection_timeout=10s`, `statement_timeout=10s`, `pool_timeout=10s` — all set
- **queue listener isolation**: uses `asyncio.create_task()`, catches all exceptions internally with exponential backoff, will not crash the HTTP server

the queue listener is **not** the cause of the process death (contrary to the previous two incidents). something else froze or killed the remaining machine.

## impact

- **duration**: ~6 minutes
- **scope**: 100% API traffic
- **user impact**: complete service unavailability
- **data loss**: none
- **recovery**: manual intervention required

## action items

### immediate

1. **add Fly HTTP health checks** — the single fix that would have prevented this outage. Fly would detect the unresponsive machine and restart it automatically.
   ```toml
   [[http_service.checks]]
     interval = "10s"
     timeout = "5s"
     grace_period = "30s"
     method = "GET"
     path = "/health"
   ```

### if needed

2. **increase VM memory to 2GB** — only if OOM kills recur after health checks are added. the OOM may have been a one-time burst from 6 minutes of queued traffic.
3. **set `min_machines_running = 2`** — only if single-machine failures continue to cause outages despite health checks.

### investigate

4. **what froze machine 2?** — the queue listener is decoupled and shouldn't affect HTTP serving. need to understand what caused zero output for 6 minutes while Fly reported the machine as "started." possible approaches:
   - add memory usage logging to startup / periodic intervals
   - check if the OOM kill event for machine 1 (visible in events) has a counterpart for machine 2 (events truncated to 5)

### longer term

5. **uptime monitoring / alerting** — external check that pages when the API is unresponsive
6. **Neon keepalive** — periodic query to prevent cold starts during idle periods

## related incidents

- [2025-11-17 connection pool outage](./2025-11-17-connection-pool-outage.md) — queue listener timeout, pool exhaustion
- [2025-12-02 connection pool outage recurrence](./2025-12-02-connection-pool-outage-recurrence.md) — Neon cold start, pool exhaustion

## key difference from previous incidents

previous incidents had a clear causal chain: queue listener fails → pool exhausts → requests time out → self-recovery.

this incident: one machine auto-stopped, remaining machine froze for unknown reasons, no health checks to detect it, replacement machine OOM killed. **the root cause of the freeze is still unknown** — the queue listener (blamed in prior incidents) is properly isolated and should not be a factor.

## references

- fly machine events: `fly machine status {id} -a relay-api`
- logfire traces: production spans 02:27-02:43 UTC, 2026-04-02
- fly config: `backend/fly.toml`
- queue service: `backend/src/backend/_internal/queue.py`
- database config: `backend/src/backend/config.py`
- health endpoint: `backend/src/backend/api/meta.py:17`
