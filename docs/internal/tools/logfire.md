---
title: "logfire querying guide"
---

## Basic Concepts

Logfire uses Apache DataFusion (PostgreSQL-flavored SQL) to query trace data. All data is stored in the `records` table.

## Environment Filtering

**ALWAYS filter by `deployment_environment`** — it's a top-level column, not in attributes.

| environment | `deployment_environment` value |
|------------|-------------------------------|
| production | `'production'` |
| staging | `'staging'` |
| local dev | `'local'` |

`service_name` is `plyr-api` for all environments — use `deployment_environment` to distinguish environments, not `service_name`.

Every query in this guide includes the environment filter. Omitting it mixes prod/staging/local data.

## Key Fields

top-level columns (use these, not attributes):
- `deployment_environment` - **ALWAYS filter by this**
- `span_name` - name of the span (e.g., "GET /tracks/")
- `message` - human-readable message
- `http_method` - GET, POST, PUT, DELETE, etc.
- `http_response_status_code` - integer status code
- `http_route` - route pattern (e.g., "/tracks/")
- `url_full` - full request URL
- `exception_type` - exception class name
- `exception_message` - exception message text
- `is_exception` - boolean
- `kind` - either 'span' or 'event'
- `trace_id` - unique identifier for a trace (group of related spans)
- `span_id` - unique identifier for this specific span
- `start_timestamp` - when the span started
- `duration` - span duration (in seconds, multiply by 1000 for ms)
- `otel_status_code` - OpenTelemetry status (OK, ERROR, UNSET)
- `otel_status_message` - **error details appear here, not in exception_message**
- `attributes` - JSONB field for span metadata not covered by top-level columns

## Querying for Exceptions

**Find recent exception spans:**
```sql
SELECT
  message,
  start_timestamp,
  otel_status_message,
  exception_type
FROM records
WHERE is_exception = true
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 10
```

**Get exception details with context:**
```sql
SELECT
  message,
  otel_status_message as error_summary,
  exception_type,
  exception_message,
  attributes->>'exception.stacktrace' as stacktrace,
  start_timestamp
FROM records
WHERE is_exception = true
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 5
```

**Find all spans in a trace:**
```sql
SELECT message, kind, start_timestamp, duration
FROM records
WHERE trace_id = '<trace-id-here>'
ORDER BY start_timestamp
```

## HTTP Request Queries

**Recent HTTP requests with status codes:**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  http_response_status_code as status_code,
  http_route,
  otel_status_code
FROM records
WHERE kind = 'span'
  AND http_method = 'GET'
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 20
```

**Find slow or failed HTTP requests:**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  http_response_status_code as status_code,
  otel_status_message
FROM records
WHERE kind = 'span'
  AND http_method IS NOT NULL
  AND (duration > 1.0 OR otel_status_code = 'ERROR')
  AND deployment_environment = 'production'
ORDER BY duration DESC
LIMIT 20
```

**Identify the caller of a request (user identity + client info):**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  attributes->>'user.did' as user_did,
  attributes->>'user.handle' as user_handle,
  attributes->>'http.user_agent' as user_agent,
  attributes->>'client_type' as client_type,
  trace_id
FROM records
WHERE span_name = 'POST /now-playing/'
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 10
```

user identity is attached to the span by auth dependencies — use `attributes->>'user.did'` and `attributes->>'user.handle'`.

**Understanding 307 Redirects:**

When querying for audio streaming requests, you'll see HTTP 307 (Temporary Redirect) responses:

```sql
SELECT
  span_name,
  message,
  http_response_status_code as status_code,
  url_full
FROM records
WHERE span_name = 'GET /audio/{file_id}'
  AND http_response_status_code = 307
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
```

**Why 307 is expected:**
- The `/audio/{file_id}` endpoint redirects to Cloudflare R2 CDN URLs when using R2 storage
- 307 preserves the GET method during redirect (unlike 302)
- This offloads bandwidth to R2's CDN instead of proxying through the app
- See `src/backend/api/audio.py` for implementation

## Database Query Spans

**Find slow database queries:**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  attributes->>'db.statement' as query,
  trace_id
FROM records
WHERE span_name LIKE 'SELECT%'
  AND duration > 0.1
  AND deployment_environment = 'production'
ORDER BY duration DESC
LIMIT 10
```

**Database query patterns:**
```sql
-- group queries by type
SELECT
  CASE
    WHEN span_name LIKE 'SELECT%' THEN 'SELECT'
    WHEN span_name LIKE 'INSERT%' THEN 'INSERT'
    WHEN span_name LIKE 'UPDATE%' THEN 'UPDATE'
    WHEN span_name LIKE 'DELETE%' THEN 'DELETE'
    ELSE 'OTHER'
  END as query_type,
  COUNT(*) as count,
  AVG(duration * 1000) as avg_duration_ms,
  MAX(duration * 1000) as max_duration_ms
FROM records
WHERE (span_name LIKE '%FROM%' OR span_name LIKE '%INTO%')
  AND deployment_environment = 'production'
GROUP BY query_type
ORDER BY count DESC
```

## Background Task and Storage Queries

**Search by message content:**
```sql
SELECT
  span_name,
  message,
  start_timestamp,
  attributes
FROM records
WHERE (message LIKE '%R2%' OR message LIKE '%upload%')
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 10
```

**Get full trace for a background task:**
```sql
-- First, find the trace_id for your background task
SELECT trace_id, message, start_timestamp
FROM records
WHERE span_name = 'process upload background'
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 1;

-- Then get all spans in that trace
SELECT
  span_name,
  message,
  start_timestamp,
  duration * 1000 as duration_ms
FROM records
WHERE trace_id = '<trace-id-from-above>'
ORDER BY start_timestamp ASC;
```

**Extract nested attributes from JSONB:**
```sql
-- Get bucket and key from R2 upload logs
SELECT
  message,
  attributes->>'bucket' as bucket,
  attributes->>'key' as key,
  attributes->>'file_id' as file_id,
  start_timestamp
FROM records
WHERE message = 'uploading to R2'
  AND deployment_environment = 'production'
ORDER BY start_timestamp DESC
LIMIT 5;
```

**Common mistake: Not all log levels create spans**

When using `logfire.info()`, these create log events, not spans. To find them:
- Search by `message` field, not `span_name`
- Use LIKE with wildcards: `message LIKE '%preparing%'`
- Filter by `kind = 'event'` if you only want logs (not spans)

Example:
```sql
-- WRONG: This won't find logfire.info() calls
SELECT * FROM records WHERE span_name = 'preparing to save audio file';

-- RIGHT: Search by message instead
SELECT * FROM records
WHERE message LIKE '%preparing%'
  AND deployment_environment = 'production';
```

**Aggregate errors by type:**
```sql
SELECT
  exception_type as error_type,
  COUNT(*) as occurrences,
  MAX(start_timestamp) as last_seen,
  COUNT(DISTINCT trace_id) as unique_traces
FROM records
WHERE is_exception = true
  AND start_timestamp > NOW() - INTERVAL '24 hours'
  AND deployment_environment = 'production'
GROUP BY error_type
ORDER BY occurrences DESC
```

**Find errors by endpoint:**
```sql
SELECT
  http_route as endpoint,
  COUNT(*) as error_count,
  COUNT(DISTINCT exception_type) as unique_error_types
FROM records
WHERE otel_status_code = 'ERROR'
  AND http_route IS NOT NULL
  AND deployment_environment = 'production'
GROUP BY endpoint
ORDER BY error_count DESC
```

## Known Issues

### `/tracks/` 500 Error on First Load

**Trace ID:** `019a46fe0b20c24432f5a7536d8561a6`
**Timestamp:** 2025-11-02T23:54:05.472754Z
**Status:** 500

**Symptoms:**
- First request to `GET /tracks/` fails with 500 error
- Subsequent requests succeed with 200 status
- Database connection and SELECT query both execute successfully in the trace

**Root Cause:**
SSL connection pooling issue with Neon database. The error appears in `otel_status_message`:
```
consuming input failed: SSL connection has been closed unexpectedly
```

**Analysis:**
- This is a Neon PostgreSQL connection pool issue where SSL connections are being dropped
- First request attempts to use a stale/closed SSL connection from the pool
- Subsequent requests work because the pool recovers and establishes a fresh connection
- The error is captured in `otel_status_code: "ERROR"` and `otel_status_message` fields

**Potential Fixes:**
1. Configure SQLAlchemy connection pool settings for Neon:
   - Set `pool_pre_ping=True` to verify connections before use
   - Adjust `pool_recycle` to match Neon's connection timeout
2. Review Neon-specific SSL connection settings
3. Add retry logic for initial database connections
4. Consider connection pool size tuning

## Pre-built Dashboards

### Database Performance Dashboard

comprehensive database query analysis showing:
- query performance by type and table
- latency percentiles (p50, p95, p99)
- error rates and counts
- query volume and impact

see `logfire-database-dashboard.sql` for the full query with alternative views for:
- slowest individual queries
- hourly query volume timeline
- transaction and connection pool metrics

## Resources

- [Logfire SQL Explorer Documentation](https://logfire.pydantic.dev/docs/guides/web-ui/explore/)
- [Logfire Concepts](https://logfire.pydantic.dev/docs/concepts/)
- Logfire UI: https://logfire.pydantic.dev/zzstoatzz/plyr (project name configured in logfire.configure)
