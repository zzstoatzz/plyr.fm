# database connection pooling analysis

analysis of current pooling configuration vs Nebula best practices, following the connection pool outage.

## current state (plyr.fm)

### where connections are created

**primary connection pool** - `src/backend/utilities/database.py:42-51`
```python
engine = create_async_engine(
    settings.database.url,
    echo=settings.app.debug,
    pool_pre_ping=True,      # ✅ verify connections before use
    pool_recycle=3600,       # ❌ hardcoded 1 hour
    pool_use_lifo=True,      # ✅ reuse recent connections
    pool_size=5,             # ❌ hardcoded
    max_overflow=0,          # ❌ hardcoded, no overflow allowed
    **kwargs,
)
```

**queue listener** - `src/backend/_internal/queue.py:67`
```python
# separate asyncpg connection for LISTEN/NOTIFY
timeout = settings.database.queue_connect_timeout  # ✅ 3.0s default (just added)
self.conn = await asyncio.wait_for(asyncpg.connect(db_url), timeout=timeout)
```

### what we're missing

1. **no statement timeout** - queries can run indefinitely
2. **no connection timeout** - pool checkout can hang (except queue listener now)
3. **no pool timeout** - waiting for available connection has no limit
4. **hardcoded pool settings** - can't adjust per environment
5. **no overflow** - immediate failure when 5 connections are busy

## nebula's approach

from `sandbox/nebula/src/prefect_cloud/settings.py:120-156`:

### configurable settings

```python
class NebulaDatabaseSettings(BaseSettings):
    timeout: Optional[float] = Field(
        default=2,
        description="statement timeout in seconds applied to all database interactions"
    )

    connection_timeout: Optional[float] = Field(
        default=3,
        description="connection timeout in seconds applied to all database interactions"
    )

    pool_recycle: Optional[float] = Field(
        default=2 * HOUR,  # 7200 seconds
        description="time after which a connection will be recycled"
    )

    pool_size: Optional[int] = Field(
        default=5,
        description="database connections to keep in pool at a time"
    )

    pool_max_overflow: Optional[int] = Field(
        default=0,
        description="dynamic connections if pool is exhausted"
    )

    pool_pre_ping: bool = Field(
        default=True,
        description="ping database before using connection from pool"
    )
```

### how they apply these settings

from `sandbox/nebula/src/prefect_cloud/utilities/database.py:100-127`:

```python
kwargs: dict[str, Any] = {
    "connect_args": {
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "server_settings": {
            "jit": "off",
            "plan_cache_mode": plan_cache_mode,
        },
    }
}

# apply database timeout (statement timeout)
if timeout := database_settings.timeout:
    kwargs["connect_args"].update(dict(command_timeout=timeout))

# apply connection timeout
if connection_timeout := database_settings.connection_timeout:
    kwargs["connect_args"].update(dict(timeout=connection_timeout))
    kwargs["pool_timeout"] = connection_timeout  # ⭐ also set pool timeout

engine = create_async_engine(
    database_settings.connection_url.get_secret_value(),
    echo=database_settings.echo,
    pool_pre_ping=database_settings.pool_pre_ping,
    pool_use_lifo=True,
    pool_recycle=database_settings.pool_recycle,
    pool_size=database_settings.pool_size,
    max_overflow=database_settings.pool_max_overflow,
    **kwargs,
)
```

## key differences

| setting | plyr.fm (current) | nebula | notes |
|---------|-------------------|--------|-------|
| **pool_size** | 5 (hardcoded) | 5 (configurable) | same default, but nebula can adjust |
| **max_overflow** | 0 (hardcoded) | 0 (configurable) | both strict by default, but nebula flexible |
| **pool_recycle** | 3600s (hardcoded) | 7200s (configurable) | nebula recycles less frequently |
| **pool_pre_ping** | True | True (configurable) | ✅ both enabled |
| **pool_use_lifo** | True | True | ✅ both enabled |
| **statement timeout** | ❌ none | 2s (configurable) | **critical missing** |
| **connection timeout** | ❌ none | 3s (configurable) | **critical missing** |
| **pool timeout** | ❌ none | = connection_timeout | **critical missing** |

## why these settings matter

### statement timeout (`command_timeout`)
- limits how long a single SQL query can run
- prevents runaway queries from holding connections
- nebula uses 2s default - aggressive but appropriate for API workloads
- **without this**: slow queries hold connections indefinitely

### connection timeout (`timeout`)
- limits how long we wait to establish initial connection
- prevents hanging when database is slow/unresponsive
- nebula uses 3s default
- **without this**: connection attempts hang indefinitely (our outage!)

### pool timeout
- limits how long we wait for an available connection from pool
- prevents requests from hanging when pool is exhausted
- nebula sets it equal to connection_timeout
- **without this**: requests wait forever when all 5 connections are busy

### pool_size and max_overflow
- pool_size: persistent connections kept open
- max_overflow: additional connections opened on demand
- total max connections = pool_size + max_overflow
- **tradeoff**:
  - larger pool = more memory/connections, but better concurrency
  - max_overflow > 0 = graceful degradation under load
  - max_overflow = 0 = hard limit, fails fast (current approach)

### pool_recycle
- how long before recycling a connection
- prevents stale connections from lingering
- **too short**: unnecessary connection churn
- **too long**: may hit database timeout and get forcibly closed
- nebula uses 2 hours, we use 1 hour
- both are reasonable, depends on database config

## recommendations

### tier 1: critical (fix immediately)

1. **add statement timeout**
   - default: 10s (more lenient than nebula's 2s for music streaming)
   - configurable via `DATABASE_STATEMENT_TIMEOUT`
   - apply via `command_timeout` in connect_args

2. **add connection timeout**
   - default: 3s (same as nebula, same as queue listener)
   - configurable via `DATABASE_CONNECTION_TIMEOUT`
   - apply via `timeout` in connect_args

3. **add pool timeout**
   - set equal to connection_timeout
   - prevents requests hanging when pool exhausted
   - apply via `pool_timeout` parameter

### tier 2: important (add soon)

4. **make pool_size configurable**
   - keep default of 5
   - allow override via `DATABASE_POOL_SIZE`
   - enables per-environment tuning

5. **make max_overflow configurable**
   - keep default of 0 (strict)
   - allow override via `DATABASE_MAX_OVERFLOW`
   - enables graceful degradation if needed

6. **make pool_recycle configurable**
   - increase default to 7200s (2 hours, same as nebula)
   - allow override via `DATABASE_POOL_RECYCLE`

### tier 3: nice to have

7. **add pool monitoring**
   - track `engine.pool.checkedout()` (active connections)
   - track `engine.pool.size()` (total pool size)
   - log/alert when pool utilization > 80%
   - nebula does this with prometheus metrics

8. **document pool settings**
   - add section to `backend/CLAUDE.md`
   - explain each setting and when to adjust
   - provide guidance for scaling

## proposed config structure

```python
class DatabaseSettings(RelaySettingsSection):
    """Database configuration."""

    url: str = Field(
        default="postgresql+asyncpg://localhost/plyr",
        validation_alias="DATABASE_URL",
        description="PostgreSQL connection string",
    )

    # timeouts
    statement_timeout: float = Field(
        default=10.0,
        validation_alias="DATABASE_STATEMENT_TIMEOUT",
        description="Timeout in seconds for SQL statement execution (command_timeout)",
    )

    connection_timeout: float = Field(
        default=3.0,
        validation_alias="DATABASE_CONNECTION_TIMEOUT",
        description="Timeout in seconds for establishing database connections",
    )

    queue_connect_timeout: float = Field(
        default=3.0,
        validation_alias="QUEUE_CONNECT_TIMEOUT",
        description="Timeout in seconds for queue listener database connections",
    )

    # pool settings
    pool_size: int = Field(
        default=5,
        validation_alias="DATABASE_POOL_SIZE",
        description="Number of database connections to keep in pool",
    )

    pool_max_overflow: int = Field(
        default=0,
        validation_alias="DATABASE_MAX_OVERFLOW",
        description="Maximum connections to create beyond pool_size when pool is exhausted",
    )

    pool_recycle: int = Field(
        default=7200,  # 2 hours
        validation_alias="DATABASE_POOL_RECYCLE",
        description="Seconds before recycling a connection (prevents stale connections)",
    )

    pool_pre_ping: bool = Field(
        default=True,
        validation_alias="DATABASE_POOL_PRE_PING",
        description="Verify connection health before using from pool",
    )
```

## proposed database.py changes

```python
def get_engine() -> AsyncEngine:
    """retrieve an async sqlalchemy engine."""
    loop = get_running_loop()
    cache_key = (loop, settings.database.url)

    if cache_key not in ENGINES:
        kwargs: dict[str, Any] = {}

        if "asyncpg" in settings.database.url:
            kwargs["connect_args"] = {
                "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
                "statement_cache_size": 0,
                "prepared_statement_cache_size": 0,
            }

            # apply statement timeout
            if settings.database.statement_timeout:
                kwargs["connect_args"]["command_timeout"] = settings.database.statement_timeout

            # apply connection timeout
            if settings.database.connection_timeout:
                kwargs["connect_args"]["timeout"] = settings.database.connection_timeout
                kwargs["pool_timeout"] = settings.database.connection_timeout

        engine = create_async_engine(
            settings.database.url,
            echo=settings.app.debug,
            pool_pre_ping=settings.database.pool_pre_ping,
            pool_recycle=settings.database.pool_recycle,
            pool_use_lifo=True,
            pool_size=settings.database.pool_size,
            max_overflow=settings.database.pool_max_overflow,
            **kwargs,
        )

        # instrument sqlalchemy with logfire if enabled
        if settings.observability.enabled:
            import logfire
            logfire.instrument_sqlalchemy(engine.sync_engine)

        ENGINES[cache_key] = engine

    return ENGINES[cache_key]
```

## production values to consider

for current scale (small number of users, single fly.io instance):

```bash
# keep current strict pool
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=0

# add critical timeouts
DATABASE_STATEMENT_TIMEOUT=10.0  # lenient for music uploads
DATABASE_CONNECTION_TIMEOUT=3.0  # fail fast on db issues

# longer recycle (same as nebula)
DATABASE_POOL_RECYCLE=7200
```

if we need to scale or see pool exhaustion under load:

```bash
# option 1: larger strict pool
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=0

# option 2: smaller pool with overflow
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=5  # allows 10 total under load
```

## relationship to the outage

the 2025-11-17 outage happened because:

1. queue listener's `asyncpg.connect()` had no timeout
2. neon database was slow
3. connection hung indefinitely
4. **all 5 connections in pool stuck waiting**
5. new API requests couldn't acquire connections
6. requests timed out after 30s

adding timeouts prevents this cascade:
- **connection_timeout=3s**: queue listener fails fast, retries
- **pool_timeout=3s**: API requests fail fast (503) instead of hanging
- **statement_timeout=10s**: prevents slow queries from holding connections

## next steps

1. implement tier 1 changes (critical timeouts)
2. test in staging with various timeout scenarios
3. deploy to production with monitoring
4. observe pool utilization for 1 week
5. implement tier 2 changes (configurable pool settings)
6. document in backend/CLAUDE.md

## references

- nebula settings: `sandbox/nebula/src/prefect_cloud/settings.py`
- nebula database utils: `sandbox/nebula/src/prefect_cloud/utilities/database.py`
- our database utils: `src/backend/utilities/database.py`
- our config: `src/backend/config.py`
- sqlalchemy pooling docs: https://docs.sqlalchemy.org/en/20/core/pooling.html
- asyncpg connection docs: https://magicstack.github.io/asyncpg/current/api/index.html#connection
