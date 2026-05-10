# postmortem: production outage 2025-11-17

## summary

complete API outage for 4 minutes (05:04-05:08 UTC). all requests returned 500 errors due to database connection pool exhaustion.

## timeline (UTC)

- **05:04:45** - first connection pool exhaustion event
- **05:06:00** - all API requests failing with 30s timeouts
- **05:08:35** - manual restart via `flyctl apps restart relay-api`
- **05:08:50** - service restored and healthy

**total downtime: ~4 minutes**

## root cause

the queue service uses asyncpg for PostgreSQL LISTEN/NOTIFY cross-instance synchronization. the connection initialization in `_connect()` had **no timeout**:

```python
# BEFORE (problematic code)
self.conn = await asyncpg.connect(db_url)
```

when Neon database was slow or unresponsive, `asyncpg.connect()` hung indefinitely. this exhausted SQLAlchemy's connection pool (configured with `pool_size=5, max_overflow=0`).

with all 5 connections stuck waiting for the queue listener, every incoming API request timed out after 30s trying to acquire a database connection.

## the fix

wrapped the connection call in `asyncio.wait_for()` with a configurable timeout:

```python
# AFTER (hotfix)
timeout = settings.database.queue_connect_timeout  # default 3.0s
self.conn = await asyncio.wait_for(asyncpg.connect(db_url), timeout=timeout)
```

### why 3 seconds?

analyzed logfire production data to establish baseline:
- healthy connections: 2-4ms (typical)
- p99 latency: 549ms
- chosen timeout: 3.0s (5x headroom over p99)

this provides sufficient buffer for transient slowness while failing fast enough to retry via the existing reconnection logic in `_listen_loop()`.

### configuration

added `QUEUE_CONNECT_TIMEOUT` environment variable to DatabaseSettings:
- default: 3.0 seconds
- configurable per environment
- allows runtime adjustment without code changes

## contributing factors

1. **no timeout policy** - asyncpg connection calls assumed fast/reliable database
2. **small connection pool** - 5 connections with no overflow meant rapid exhaustion
3. **cascading failure** - queue listener blocked → pool exhausted → all requests failed
4. **no circuit breaker** - no mechanism to detect/isolate failing queue listener

## impact

- **duration**: 4 minutes
- **scope**: 100% of API traffic (all endpoints)
- **user experience**: complete service unavailability
- **data loss**: none (failure mode was read-only connection exhaustion)

## lessons learned

### what went well
- **observability**: logfire traces immediately showed connection pool exhaustion pattern
- **baseline data**: p99 latency metrics informed timeout selection
- **quick recovery**: manual restart restored service in <1 minute
- **retry logic**: existing reconnection loop in `_listen_loop()` worked once timeout added

### what went wrong
- **missing timeout**: critical network call had no failure boundary
- **no proactive monitoring**: connection pool exhaustion not detected until total failure
- **manual intervention**: required human to restart service

### action items

#### completed
- [x] deployed hotfix with configurable timeout (PR #280)
- [x] added specific TimeoutError handling and logging
- [x] documented timeout selection rationale in code comments

#### planned
- [ ] audit all asyncpg/network calls for missing timeouts
- [ ] add connection pool metrics to logfire dashboards
- [ ] implement connection pool exhaustion alerts
- [ ] consider larger pool size or max_overflow for better degradation
- [ ] evaluate circuit breaker pattern for queue listener
- [ ] document timeout policy in backend/CLAUDE.md

## related issues

- PR #280: queue connection timeout hotfix
- issue #XXX: audit network timeouts (to be created)
- issue #XXX: connection pool monitoring (to be created)

## references

- logfire trace showing outage: [link to trace if available]
- hotfix PR: https://github.com/zzstoatzz/plyr.fm/pull/280
- queue service code: `src/backend/_internal/queue.py`
- database settings: `src/backend/config.py`
