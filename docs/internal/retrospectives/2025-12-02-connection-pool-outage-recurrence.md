# postmortem: production outage 2025-12-02

## summary

API outage for ~5 minutes (01:55-02:00 UTC). all requests returned 500 errors due to database connection pool exhaustion. this is a **recurrence** of the [2025-11-17 incident](./2025-11-17-connection-pool-outage.md) with a different trigger mechanism.

## timeline (UTC)

- **01:49:57** - last successful request before incident
- **01:50:00 - 01:54:51** - **5 minute gap with no traffic** (site idle)
- **01:54:51** - queue listener heartbeat times out (`SELECT 1` doesn't respond in 5s)
- **01:54:51** - heartbeat marks asyncpg connection as dead, closes it
- **01:55:19** - queue listener begins reconnection attempts with exponential backoff
- **01:55:34** - first reconnection attempt times out after 15s
- **01:55:56** - first user request arrives: `GET /tracks/114`
- **01:55:56** - **connection hangs for 333 seconds (5.5 minutes!)** attempting to connect
- **01:56:41** - second request arrives, also hangs (198s)
- **01:57:40** - three more requests arrive, all hang (213s each)
- **01:57:43** - **pool exhausted**: new requests get `QueuePool limit of size 5 overflow 0 reached`
- **01:57:43 - 01:59:09** - all API endpoints return 500 with 30s connection timeout
- **02:00:04** - queue listener finally reconnects successfully
- **02:00:09** - SQLAlchemy connections recover, normal operation resumes

**total downtime: ~5 minutes**

## root cause

**Neon serverless cold start after idle period.**

the 5-minute gap with no traffic caused Neon to scale down. when requests resumed:

1. the queue listener's heartbeat (`SELECT 1`) timed out because Neon was cold
2. heartbeat correctly marked the connection as dead and closed it
3. the queue listener's reconnection attempts timed out (15s each)
4. **critically**: the SQLAlchemy pool connections also went stale during the idle period
5. when user requests arrived, they tried to use stale pooled connections
6. these connections hung waiting for Neon to wake up
7. **5 connections hung = pool exhausted = all new requests fail**

### why did connections hang instead of failing fast?

the SQLAlchemy pool has `pool_pre_ping=True`, which should detect dead connections. however:
- pre-ping runs a `SELECT 1` on checkout
- if Neon is cold, the `SELECT 1` itself hangs instead of failing
- the connection doesn't appear "dead" to SQLAlchemy - it's waiting, not closed
- result: 5 requests each hold a connection, waiting 3-5+ minutes for Neon to respond

### the smoking gun from logfire

```
GET /tracks/114 at 01:55:56 → duration: 333,882ms (5.5 minutes!)
  └─ connect span → duration: 333,866ms (connection acquisition hung)
GET /tracks/92 at 01:56:41 → duration: 198,542ms (3.3 minutes!)
GET /tracks/ at 01:57:40 → duration: 213,495ms (3.5 minutes!)
GET /preferences/ at 01:57:40 → duration: 213,355ms
GET /stats at 01:57:40 → duration: 134,223ms
```

these 5 requests consumed all 5 pool connections. every subsequent request waited 30s then got:
```
TimeoutError: QueuePool limit of size 5 overflow 0 reached, connection timed out, timeout 30.00
```

## why the nov 17 fix wasn't enough

the [nov 17 hotfix](./2025-11-17-connection-pool-outage.md) added a 15s timeout to `asyncpg.connect()` for the queue listener. this fix **is working** - we can see the queue listener timing out and retrying correctly.

but the fix only addressed the **queue listener's asyncpg connection**. it did not address:

1. **SQLAlchemy pool connections** - these are separate and have no wake-up timeout
2. **Neon cold start latency** - can exceed 10+ seconds, causing `pool_pre_ping` to hang
3. **pool sizing** - 5 connections with 0 overflow means any 5 slow requests = total outage

## contributing factors

1. **Neon serverless cold starts** - idle period caused database to scale down
2. **small connection pool** - `pool_size=5, max_overflow=0` provides no buffer
3. **no connection timeout** - SQLAlchemy connections wait indefinitely for Neon
4. **pool_pre_ping doesn't help cold starts** - ping hangs same as query would
5. **cascading failure** - 5 slow connections = pool exhausted = 100% failure rate

## impact

- **duration**: ~5 minutes
- **scope**: 100% of API traffic (all endpoints)
- **user experience**: complete service unavailability
- **data loss**: none

## lessons learned

### what went well

- **observability**: logfire clearly showed the connection hang pattern with exact durations
- **queue listener fix working**: the nov 17 timeout fix is working - queue reconnected successfully
- **self-recovery**: service recovered automatically once Neon woke up (no manual restart needed)

### what went wrong

- **incomplete fix**: nov 17 only fixed queue listener, not SQLAlchemy pool
- **Neon cold start not accounted for**: didn't consider idle period → cold start scenario
- **pool too small**: 5 connections with no overflow is fragile

## recommended fixes

### immediate (must do)

1. **add `connection_timeout` to SQLAlchemy connections** (config already exists but may not be set)
   - set `DATABASE_CONNECTION_TIMEOUT=10` in production
   - this adds `timeout` to asyncpg connect_args

2. **increase pool size and add overflow**
   - `DATABASE_POOL_SIZE=10` (from 5)
   - `DATABASE_MAX_OVERFLOW=5` (from 0)
   - allows 15 concurrent connections, better degradation

### short-term

3. **reduce `pool_timeout`** - currently 30s, consider 10s to fail faster

4. **add Neon keepalive** - periodic query to prevent cold starts during low traffic
   - could use existing healthcheck endpoint
   - or dedicated cron/scheduled task

### long-term

5. **circuit breaker pattern** - detect pool exhaustion, fail fast with 503
6. **connection pool metrics** - alert when pool utilization exceeds threshold
7. **Neon provisioned compute** - eliminate cold starts entirely (cost tradeoff)

## related incidents

- [2025-11-17 connection pool outage](./2025-11-17-connection-pool-outage.md) - same failure mode, different trigger

## references

- logfire traces showing incident: production spans 01:54-02:01 UTC
- queue service code: `src/backend/_internal/queue.py`
- database config: `src/backend/config.py`
- database utilities: `src/backend/utilities/database.py`
