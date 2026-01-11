# database connection pooling

configuration and best practices for managing database connections in production.

## overview

plyr.fm uses SQLAlchemy's connection pooling to manage PostgreSQL connections efficiently. proper pool configuration is critical for:

- preventing connection exhaustion under load
- failing fast when the database is slow or unresponsive
- optimizing resource usage across concurrent requests

## configuration

all settings are configurable via environment variables and defined in `src/backend/config.py`.

### timeouts

```bash
# how long a single SQL query can run before being killed (default: 10s)
DATABASE_STATEMENT_TIMEOUT=10.0

# how long to wait when establishing a new database connection (default: 10s)
# set higher than Neon cold start latency (~5-10s) to allow wake-up
DATABASE_CONNECTION_TIMEOUT=10.0

# how long to wait for an available connection from the pool (default: = connection_timeout)
# this is automatically set to match DATABASE_CONNECTION_TIMEOUT
```

**why these matter:**

- **statement_timeout**: prevents runaway queries from holding connections indefinitely. set based on your slowest expected query.
- **connection_timeout**: fails fast when the database is slow or unreachable. set higher than Neon cold start latency (5-10s) to allow serverless databases to wake up after idle periods.
- **pool_timeout**: fails fast when all connections are busy. without this, requests wait forever when the pool is exhausted.

### connection pool sizing

```bash
# number of persistent connections to maintain (default: 10)
DATABASE_POOL_SIZE=10

# additional connections to create on demand when pool is exhausted (default: 5)
DATABASE_MAX_OVERFLOW=5

# how long before recycling a connection, in seconds (default: 7200 = 2 hours)
DATABASE_POOL_RECYCLE=7200

# verify connection health before using from pool (default: true)
DATABASE_POOL_PRE_PING=true
```

**sizing considerations:**

total max connections = `pool_size` + `max_overflow` = 15 by default

**pool_size:**
- too small: connection contention, requests wait for available connections
- too large: wastes memory and database resources
- default of 10 handles Neon cold start scenarios where multiple requests arrive after idle periods

**max_overflow:**
- provides burst capacity for traffic spikes
- default of 5 allows 15 total connections under peak load
- connections beyond pool_size are closed when returned (not kept idle)

**pool_recycle:**
- prevents stale connections from lingering
- should be less than your database's connection timeout
- 2 hours is a safe default for most PostgreSQL configurations

**pool_pre_ping:**
- adds small overhead (SELECT 1) before each connection use
- prevents using connections that were closed by the database
- recommended for production to avoid connection errors

## Neon serverless considerations

plyr.fm uses Neon PostgreSQL, which can scale to zero after periods of inactivity. this introduces **cold start latency** that affects connection pooling.

### the cold start problem

1. site is idle for several minutes → Neon scales down
2. first request arrives → Neon needs 500ms-10s to wake up
3. if pool_size is too small, all connections hang waiting for Neon
4. new requests can't get connections → 500 errors

### production solution: disable scale-to-zero

**for production workloads, disable scale-to-zero in Neon console.** this is the recommended approach per [Neon's production best practices](https://neon.com/blog/6-best-practices-for-running-neon-in-production).

**current configuration (Jan 2026):**

| project | scale-to-zero | reason |
|---------|---------------|--------|
| plyr-prd | **disabled** | customer-facing, no cold starts |
| plyr-stg | enabled | ok to have cold starts on staging |
| plyr-dev | enabled | ok to have cold starts on dev |

**to verify via Neon MCP:**

```
mcp__neon__list_branch_computes({ "projectId": "cold-butterfly-11920742" })
```

check `suspend_timeout_seconds` on the compute:
- `-1` = scale-to-zero disabled (never suspend)
- `0` = scale-to-zero enabled (uses default 5 min timeout)
- `>0` = custom suspend timeout in seconds

**to change:** Neon Console → Project → Computes → Edit → Scale to zero toggle

### fallback mitigations (if scale-to-zero is enabled)

if you must keep scale-to-zero enabled, these settings help survive cold starts:

**larger connection pool (pool_size=10, max_overflow=5):**
- allows 15 concurrent requests to wait for Neon wake-up
- prevents pool exhaustion during cold start

**appropriate connection timeout (10s):**
- long enough to wait for Neon cold start (~5-10s)
- short enough to fail fast on true database outages

**queue listener heartbeat:**
- background task pings database every 5s via separate asyncpg connection
- detects connection death before user requests fail
- triggers reconnection with exponential backoff
- note: this keeps the queue listener's connection warm, not the SQLAlchemy pool

### incident history

- **2025-11-17**: first pool exhaustion outage - queue listener hung indefinitely on slow database. fix: added 15s timeout to asyncpg.connect() in queue service.
- **2025-12-02**: cold start recurrence - 5 minute idle period caused Neon to scale down. first 5 requests after wake-up hung for 3-5 minutes each, exhausting pool. fix: increased pool_size to 10, max_overflow to 5, connection_timeout to 10s.
- **2026-01-11**: disabled scale-to-zero on plyr-prd to eliminate cold starts entirely. kept enabled on dev/staging where cold starts are acceptable.

## production best practices

### current deployment (Neon serverless)

```bash
# pool sized for cold start scenarios
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=5

# timeout accounts for Neon wake-up latency
DATABASE_STATEMENT_TIMEOUT=10.0
DATABASE_CONNECTION_TIMEOUT=10.0

# standard recycle
DATABASE_POOL_RECYCLE=7200
```

this configuration:
- handles 15 concurrent requests during Neon cold start
- fails fast (10s) on true database issues
- balances resource usage with reliability

### if seeing pool exhaustion

**option 1: increase pool size**
```bash
DATABASE_POOL_SIZE=15
DATABASE_MAX_OVERFLOW=5
```
pros: more concurrent capacity during cold starts
cons: more database connections when warm

**option 2: increase overflow**
```bash
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=10  # allows 20 total under burst
```
pros: higher burst capacity, same baseline
cons: less predictable peak resource usage

### tuning statement timeout

adjust based on your query patterns:

```bash
# strict timeout for API workloads
DATABASE_STATEMENT_TIMEOUT=2.0

# lenient for long-running operations (uploads, processing)
DATABASE_STATEMENT_TIMEOUT=30.0
```

analyze slow query logs to understand p99 query latency, then set timeout with appropriate headroom.

## monitoring

### what to watch

1. **pool utilization**: `engine.pool.checkedout()` / `pool_size`
   - alert if > 80% for sustained periods
   - indicates need to increase pool_size

2. **connection timeouts**: rate of pool timeout errors
   - indicates pool exhaustion
   - consider increasing pool_size or max_overflow

3. **statement timeouts**: rate of query timeout errors
   - indicates slow queries or inappropriate timeout
   - investigate slow queries, consider adjusting timeout

4. **connection errors**: failed connection attempts
   - database availability issues
   - network problems

### observability

the engine is instrumented with logfire when observability is enabled (`LOGFIRE_ENABLED=true`). this provides:

- connection pool metrics
- query execution times
- timeout events
- connection errors

review logfire traces to understand:
- which queries are slow
- when pool exhaustion occurs
- connection patterns under load

## how it works

### connection lifecycle

1. **request arrives** → acquire connection from pool
2. **execute query** → use connection (with statement_timeout)
3. **request complete** → return connection to pool
4. **recycle threshold** → close and replace old connections

### failure modes

**pool exhausted:**
- all `pool_size` + `max_overflow` connections in use
- new requests wait for `pool_timeout` seconds
- timeout → 503 error (fail fast)

**database slow:**
- connection attempt exceeds `connection_timeout`
- timeout → fail fast, can retry

**query too slow:**
- query exceeds `statement_timeout`
- query killed, connection returned to pool
- prevents one slow query from blocking others

**connection died:**
- `pool_pre_ping` detects dead connection
- connection discarded, new one created
- prevents errors from using stale connections

## troubleshooting

### 503 errors (pool exhausted)

**symptoms:**
- `QueuePool limit of size N overflow M reached`
- requests timing out waiting for connections

**diagnosis:**
```python
# check pool status
engine = get_engine()
print(f"checked out: {engine.pool.checkedout()}")
print(f"pool size: {engine.pool.size()}")
```

**solutions:**
1. increase `DATABASE_POOL_SIZE`
2. add `DATABASE_MAX_OVERFLOW` for burst capacity
3. investigate slow queries holding connections
4. check for connection leaks (connections not being returned)

### connection timeouts

**symptoms:**
- `asyncpg.exceptions.ConnectionTimeoutError`
- requests failing to connect to database

**diagnosis:**
- check database availability
- check network latency
- review logfire connection traces

**solutions:**
1. verify database is responsive
2. increase `DATABASE_CONNECTION_TIMEOUT` if network latency is high
3. investigate database performance (CPU, I/O)

### statement timeouts

**symptoms:**
- `asyncpg.exceptions.QueryCanceledError`
- specific queries timing out

**diagnosis:**
- identify slow queries in logs
- check query execution plans
- review database indexes

**solutions:**
1. optimize slow queries
2. add database indexes
3. increase `DATABASE_STATEMENT_TIMEOUT` if queries are legitimately slow
4. consider background processing for long operations

## implementation details

### asyncpg-specific configuration

when using `postgresql+asyncpg://` URLs, additional connection settings are applied:

```python
connect_args = {
    # unique prepared statement names per connection
    "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",

    # disable statement caching (prevents prepared statement conflicts)
    "statement_cache_size": 0,
    "prepared_statement_cache_size": 0,

    # statement timeout
    "command_timeout": DATABASE_STATEMENT_TIMEOUT,

    # connection timeout
    "timeout": DATABASE_CONNECTION_TIMEOUT,
}
```

these settings prevent prepared statement caching issues in asyncpg while maintaining performance.

### LIFO pool strategy

connections are returned in LIFO (last-in, first-out) order:

```python
pool_use_lifo=True
```

benefits:
- recently used connections are more likely to still be valid
- helps shed excess connections after load spikes
- increases likelihood of connection cache hits

## references

- implementation: `src/backend/utilities/database.py`
- settings: `src/backend/config.py`
- sqlalchemy pooling: https://docs.sqlalchemy.org/en/20/core/pooling.html
- asyncpg connections: https://magicstack.github.io/asyncpg/current/api/index.html#connection
