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

**Find all exception spans:**
```sql
SELECT message, start_timestamp, attributes
FROM records
WHERE is_exception = true
ORDER BY start_timestamp DESC
LIMIT 10
```

**Get exception details from attributes:**
```sql
SELECT
  message,
  attributes->>'exception.type' as exc_type,
  attributes->>'exception.message' as exc_msg,
  attributes->>'exception.stacktrace' as stacktrace
FROM records
WHERE is_exception = true
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
  attributes->>'http.route' as route
FROM records
WHERE kind = 'span' AND span_name LIKE 'GET%'
ORDER BY start_timestamp DESC
```

## Database Query Spans

**Find slow database queries:**
```sql
SELECT
  span_name,
  start_timestamp,
  duration * 1000 as duration_ms,
  attributes->>'db.statement' as query
FROM records
WHERE span_name LIKE 'SELECT%'
  AND duration > 0.1
ORDER BY duration DESC
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
- Logfire UI: https://logfire-us.pydantic.dev/zzstoatzz/relay
