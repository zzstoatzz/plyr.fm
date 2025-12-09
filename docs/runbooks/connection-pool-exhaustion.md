# connection pool exhaustion

## symptoms

- 500 errors across multiple endpoints
- 30-second request timeouts
- logfire shows: `QueuePool limit of size 10 overflow 5 reached, connection timed out`
- queue listener logs: `queue listener connection lost, attempting reconnect`
- database connection errors mentioning multiple Neon IP addresses timing out

## observed behavior (2025-12-08 incident)

evidence from logfire spans:

| time (UTC) | event | duration |
|------------|-------|----------|
| 06:32:40 | queue service connected | - |
| 06:32:50-06:33:29 | SQLAlchemy connects succeeding | 3-6ms |
| 06:33:36 | queue heartbeat times out | 5s timeout |
| 06:33:36-06:36:04 | ~2.5 min gap with no spans | - |
| 06:36:04 | GET /albums starts | hangs 24 min |
| 06:36:06 | GET /moderation starts | **succeeds in 14ms** |
| 06:36:06 | GET /auth/me starts | hangs 18 min |
| 06:36:31 | multiple requests | **succeed in 3-15ms** |

key observation: **some connections succeed in 3ms while others hang for 20+ minutes simultaneously**. the stuck connections show psycopg retrying across 12 different Neon IP addresses.

## what we know

1. the queue listener heartbeat (`SELECT 1`) times out after 5 seconds
2. psycopg retries connection attempts across multiple IPs when one fails
3. each IP retry has its own timeout, so total time = timeout × number of IPs
4. some connections succeed immediately while others get stuck
5. restarting the fly machines clears the stuck connections

## what we don't know

- why some connections succeed while others fail simultaneously
- whether this is a Neon proxy issue, DNS issue, or application issue
- why psycopg doesn't give up after a reasonable total timeout

## remediation

restart the fly machines to clear stuck connections:

```bash
# list machines
fly machines list -a relay-api

# restart both machines
fly machines restart <machine-id-1> <machine-id-2> -a relay-api
```

## verification

check logfire for healthy spans after restart:

```sql
SELECT
  span_name,
  message,
  start_timestamp,
  duration * 1000 as duration_ms,
  otel_status_code
FROM records
WHERE deployment_environment = 'production'
  AND start_timestamp > NOW() - INTERVAL '5 minutes'
ORDER BY start_timestamp DESC
LIMIT 30
```

you should see:
- `queue service connected to database and listening`
- database queries completing in <50ms
- no ERROR status codes

## incident history

- **2025-11-17**: first occurrence, queue listener hung indefinitely (fixed by adding timeout)
- **2025-12-02**: cold start variant, 10 errors (fixed by increasing pool size)
- **2025-12-08**: 37 errors in one hour, some connections stuck 20+ min while others worked

## future investigation

- consider adding a total connection timeout that caps retries across all IPs
- investigate whether disabling IPv6 reduces retry time
- add monitoring/alerting for queue listener disconnects
- consider circuit breaker pattern to fail fast when connections are failing

## related docs

- [connection pooling config](../backend/database/connection-pooling.md)
- [logfire querying guide](../tools/logfire.md)
