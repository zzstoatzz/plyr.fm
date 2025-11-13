# Logfire Querying Guide

## Basic Concepts

Logfire uses PostgreSQL-flavored SQL to query trace data. All data is stored in the `records` table.

## Key Fields

- `is_exception` - boolean field to filter spans that contain exceptions
- `kind` - either 'span' or 'event'
- `trace_id` - unique identifier for a trace (group of related spans)
- `span_id` - unique identifier for this specific span
- `span_name` - name of the span (e.g., "GET /tracks/")
- `message` - human-readable message
- `attributes` - JSONB field containing span metadata, exception details, etc.
- `start_timestamp` - when the span started
- `duration` - span duration (in seconds, multiply by 1000 for ms)
- `otel_status_code` - OpenTelemetry status (OK, ERROR, UNSET)
- `otel_status_message` - **IMPORTANT: Error messages appear here, not in exception.message**

## Querying for Exceptions

**Find recent exception spans:**
```sql
SELECT
  message,
  start_timestamp,
  otel_status_message,
  attributes->>'exception.type' as exc_type
FROM records
WHERE is_exception = true
ORDER BY start_timestamp DESC
LIMIT 10
```

**Get exception details with context:**
```sql
SELECT
  message,
  otel_status_message as error_summary,
  attributes->>'exception.type' as exc_type,
  attributes->>'exception.message' as exc_msg,
  attributes->>'exception.stacktrace' as stacktrace,
  start_timestamp
FROM records
WHERE is_exception = true
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
  (attributes->>'http.status_code')::int as status_code,
  attributes->>'http.route' as route,
  otel_status_code
FROM records
WHERE kind = 'span' AND span_name LIKE 'GET%'
ORDER BY start_timestamp DESC
LIMIT 20
```

**Find slow or failed HTTP requests:**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  (attributes->>'http.status_code')::int as status_code,
  otel_status_message
FROM records
WHERE kind = 'span'
  AND span_name LIKE 'GET%'
  AND (duration > 1.0 OR otel_status_code = 'ERROR')
ORDER BY duration DESC
LIMIT 20
```

**Understanding 307 Redirects:**

When querying for audio streaming requests, you'll see HTTP 307 (Temporary Redirect) responses:

```sql
SELECT
  span_name,
  message,
  (attributes->>'http.status_code')::int as status_code,
  attributes->>'http.url' as url
FROM records
WHERE span_name = 'GET /audio/{file_id}'
  AND (attributes->>'http.status_code')::int = 307
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
WHERE span_name LIKE '%FROM%' OR span_name LIKE '%INTO%'
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
WHERE message LIKE '%R2%' OR message LIKE '%upload%'
ORDER BY start_timestamp DESC
LIMIT 10
```

**Get full trace for a background task:**
```sql
-- First, find the trace_id for your background task
SELECT trace_id, message, start_timestamp
FROM records
WHERE span_name = 'process upload background'
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
ORDER BY start_timestamp DESC
LIMIT 5;
```

**Find spans within a time range:**
```sql
SELECT
  span_name,
  message,
  start_timestamp,
  duration * 1000 as duration_ms
FROM records
WHERE start_timestamp > '2025-11-11T04:56:50Z'
  AND start_timestamp < '2025-11-11T04:57:10Z'
  AND (span_name LIKE '%R2%' OR message LIKE '%save%')
ORDER BY start_timestamp ASC;
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
SELECT * FROM records WHERE message LIKE '%preparing%';
```

**Aggregate errors by type:**
```sql
SELECT
  attributes->>'exception.type' as error_type,
  COUNT(*) as occurrences,
  MAX(start_timestamp) as last_seen,
  COUNT(DISTINCT trace_id) as unique_traces
FROM records
WHERE is_exception = true
  AND start_timestamp > NOW() - INTERVAL '24 hours'
GROUP BY error_type
ORDER BY occurrences DESC
```

**Find errors by endpoint:**
```sql
SELECT
  attributes->>'http.route' as endpoint,
  COUNT(*) as error_count,
  COUNT(DISTINCT attributes->>'exception.type') as unique_error_types
FROM records
WHERE otel_status_code = 'ERROR'
  AND attributes->>'http.route' IS NOT NULL
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

## Resources

- [Logfire SQL Explorer Documentation](https://logfire.pydantic.dev/docs/guides/web-ui/explore/)
- [Logfire Concepts](https://logfire.pydantic.dev/docs/concepts/)
- Logfire UI: https://logfire.pydantic.dev/zzstoatzz/plyr (project name configured in logfire.configure)
