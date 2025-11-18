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

# how long to wait when establishing a new database connection (default: 3s)
DATABASE_CONNECTION_TIMEOUT=3.0

# how long to wait for an available connection from the pool (default: = connection_timeout)
# this is automatically set to match DATABASE_CONNECTION_TIMEOUT
```

**why these matter:**

- **statement_timeout**: prevents runaway queries from holding connections indefinitely. set based on your slowest expected query.
- **connection_timeout**: fails fast when the database is slow or unreachable. prevents hanging indefinitely on connection attempts.
- **pool_timeout**: fails fast when all connections are busy. without this, requests wait forever when the pool is exhausted.

### connection pool sizing

```bash
# number of persistent connections to maintain (default: 5)
DATABASE_POOL_SIZE=5

# additional connections to create on demand when pool is exhausted (default: 0)
DATABASE_MAX_OVERFLOW=0

# how long before recycling a connection, in seconds (default: 7200 = 2 hours)
DATABASE_POOL_RECYCLE=7200

# verify connection health before using from pool (default: true)
DATABASE_POOL_PRE_PING=true
```

**sizing considerations:**

total max connections = `pool_size` + `max_overflow`

**pool_size:**
- too small: connection contention, requests wait for available connections
- too large: wastes memory and database resources
- rule of thumb: start with 5, increase if seeing pool exhaustion

**max_overflow:**
- `0` (default): strict limit, fails fast when pool is full
- `> 0`: creates additional connections on demand, provides burst capacity
- tradeoff: graceful degradation vs predictable resource usage

**pool_recycle:**
- prevents stale connections from lingering
- should be less than your database's connection timeout
- 2 hours is a safe default for most PostgreSQL configurations

**pool_pre_ping:**
- adds small overhead (SELECT 1) before each connection use
- prevents using connections that were closed by the database
- recommended for production to avoid connection errors

## production best practices

### small-scale (current deployment)

for a single-instance deployment with moderate traffic:

```bash
# strict pool, fail fast
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=0

# conservative timeouts
DATABASE_STATEMENT_TIMEOUT=10.0
DATABASE_CONNECTION_TIMEOUT=3.0

# standard recycle
DATABASE_POOL_RECYCLE=7200
```

this configuration:
- keeps resource usage predictable
- fails fast under database issues
- prevents cascading failures

### scaling up

if experiencing pool exhaustion (503 errors, connection timeouts):

**option 1: increase pool size**
```bash
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=0
```
pros: more concurrent capacity, still predictable
cons: more memory/database connections

**option 2: add overflow**
```bash
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=5  # allows 10 total under burst load
```
pros: handles traffic spikes, efficient baseline
cons: less predictable resource usage

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
