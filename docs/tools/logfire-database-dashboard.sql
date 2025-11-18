-- Database Performance Dashboard
-- Shows aggregated database query metrics grouped by query pattern

WITH query_classification AS (
    -- Classify queries by type and extract table names from actual SQL
    SELECT
        span_name,
        attributes->>'db.statement' as query_text,
        duration,
        start_timestamp,
        trace_id,
        otel_status_code,
        CASE
            WHEN span_name LIKE 'SELECT%' THEN 'SELECT'
            WHEN span_name LIKE 'INSERT%' THEN 'INSERT'
            WHEN span_name LIKE 'UPDATE%' THEN 'UPDATE'
            WHEN span_name LIKE 'DELETE%' THEN 'DELETE'
            WHEN span_name LIKE 'BEGIN%' THEN 'TRANSACTION'
            WHEN span_name LIKE 'COMMIT%' THEN 'TRANSACTION'
            WHEN span_name LIKE 'ROLLBACK%' THEN 'TRANSACTION'
            ELSE 'OTHER'
        END AS query_type,
        -- Extract primary table from actual SQL query in attributes
        CASE
            -- tracks queries (most common)
            WHEN attributes->>'db.statement' LIKE '%FROM tracks%' AND attributes->>'db.statement' NOT LIKE '%JOIN%' THEN 'tracks'
            WHEN attributes->>'db.statement' LIKE '%FROM tracks JOIN%' THEN 'tracks+joins'
            WHEN attributes->>'db.statement' LIKE '%INTO tracks%' THEN 'tracks'
            WHEN attributes->>'db.statement' LIKE '%UPDATE tracks%' THEN 'tracks'

            -- track_likes queries
            WHEN attributes->>'db.statement' LIKE '%FROM track_likes%' THEN 'track_likes'
            WHEN attributes->>'db.statement' LIKE '%INTO track_likes%' THEN 'track_likes'

            -- user auth/session queries
            WHEN attributes->>'db.statement' LIKE '%FROM user_sessions%' THEN 'user_sessions'
            WHEN attributes->>'db.statement' LIKE '%INTO user_sessions%' THEN 'user_sessions'
            WHEN attributes->>'db.statement' LIKE '%UPDATE user_sessions%' THEN 'user_sessions'

            -- user preferences
            WHEN attributes->>'db.statement' LIKE '%FROM user_preferences%' THEN 'user_preferences'
            WHEN attributes->>'db.statement' LIKE '%INTO user_preferences%' THEN 'user_preferences'
            WHEN attributes->>'db.statement' LIKE '%UPDATE user_preferences%' THEN 'user_preferences'

            -- queue state
            WHEN attributes->>'db.statement' LIKE '%FROM queue_state%' THEN 'queue_state'
            WHEN attributes->>'db.statement' LIKE '%INTO queue_state%' THEN 'queue_state'
            WHEN attributes->>'db.statement' LIKE '%UPDATE queue_state%' THEN 'queue_state'

            -- artists
            WHEN attributes->>'db.statement' LIKE '%FROM artists%' THEN 'artists'
            WHEN attributes->>'db.statement' LIKE '%INTO artists%' THEN 'artists'
            WHEN attributes->>'db.statement' LIKE '%UPDATE artists%' THEN 'artists'

            -- albums
            WHEN attributes->>'db.statement' LIKE '%FROM albums%' THEN 'albums'
            WHEN attributes->>'db.statement' LIKE '%INTO albums%' THEN 'albums'

            ELSE 'other/unknown'
        END AS primary_table
    FROM records
    WHERE
        -- Filter for database operations
        (span_name = 'SELECT neondb'
         OR span_name = 'INSERT neondb'
         OR span_name = 'UPDATE neondb'
         OR span_name = 'DELETE neondb'
         OR span_name = 'BEGIN neondb'
         OR span_name = 'COMMIT neondb'
         OR span_name = 'ROLLBACK neondb')
        -- Exclude very fast queries (connection pool pings, etc.)
        AND duration > 0.001
),
aggregated_metrics AS (
    -- Aggregate by query type and table
    SELECT
        query_type,
        primary_table,
        COUNT(*) AS total_queries,
        ROUND(AVG(duration * 1000)::numeric, 2) AS avg_duration_ms,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration * 1000)::numeric, 2) AS p50_duration_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration * 1000)::numeric, 2) AS p95_duration_ms,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration * 1000)::numeric, 2) AS p99_duration_ms,
        ROUND(MAX(duration * 1000)::numeric, 2) AS max_duration_ms,
        COUNT(*) FILTER (WHERE otel_status_code = 'ERROR') AS error_count,
        ROUND((COUNT(*) FILTER (WHERE otel_status_code = 'ERROR')::numeric / COUNT(*)::numeric * 100), 2) AS error_rate_pct
    FROM query_classification
    GROUP BY query_type, primary_table
)
SELECT
    query_type AS "Query Type",
    primary_table AS "Table",
    total_queries AS "Count",
    avg_duration_ms AS "Avg (ms)",
    p50_duration_ms AS "p50 (ms)",
    p95_duration_ms AS "p95 (ms)",
    p99_duration_ms AS "p99 (ms)",
    max_duration_ms AS "Max (ms)",
    error_count AS "Errors",
    COALESCE(error_rate_pct, 0) AS "Error Rate %"
FROM aggregated_metrics
WHERE total_queries > 0
ORDER BY
    -- Sort by most impactful queries first
    (total_queries * avg_duration_ms) DESC,
    error_count DESC
LIMIT 50;


-- Alternative: Top Slowest Individual Queries
-- Uncomment to see the actual slowest query instances instead of aggregated patterns
/*
SELECT
    ROUND(duration * 1000, 2) AS "Duration (ms)",
    CASE
        WHEN span_name = 'SELECT neondb' THEN 'SELECT'
        WHEN span_name = 'INSERT neondb' THEN 'INSERT'
        WHEN span_name = 'UPDATE neondb' THEN 'UPDATE'
        WHEN span_name = 'DELETE neondb' THEN 'DELETE'
        ELSE 'OTHER'
    END AS "Type",
    LEFT(attributes->>'db.statement', 150) AS "Query Preview",
    start_timestamp AS "Timestamp",
    trace_id AS "Trace ID",
    otel_status_code AS "Status"
FROM records
WHERE
    (span_name = 'SELECT neondb'
     OR span_name = 'INSERT neondb'
     OR span_name = 'UPDATE neondb'
     OR span_name = 'DELETE neondb')
    AND duration > 0.001
ORDER BY duration DESC
LIMIT 25;
*/


-- Alternative: Database Operations Timeline (hourly aggregation)
-- Uncomment to see query volume and performance over time
/*
WITH hourly_metrics AS (
    SELECT
        DATE_TRUNC('hour', start_timestamp) AS hour,
        CASE
            WHEN span_name = 'SELECT neondb' THEN 'SELECT'
            WHEN span_name = 'INSERT neondb' THEN 'INSERT'
            WHEN span_name = 'UPDATE neondb' THEN 'UPDATE'
            WHEN span_name = 'DELETE neondb' THEN 'DELETE'
            ELSE 'OTHER'
        END AS query_type,
        COUNT(*) AS query_count,
        ROUND(AVG(duration * 1000)::numeric, 2) AS avg_duration_ms,
        COUNT(*) FILTER (WHERE otel_status_code = 'ERROR') AS error_count
    FROM records
    WHERE
        (span_name = 'SELECT neondb'
         OR span_name = 'INSERT neondb'
         OR span_name = 'UPDATE neondb'
         OR span_name = 'DELETE neondb')
        AND start_timestamp > NOW() - INTERVAL '24 hours'
    GROUP BY hour, query_type
)
SELECT
    hour AS "Hour",
    query_type AS "Type",
    query_count AS "Count",
    avg_duration_ms AS "Avg Duration (ms)",
    error_count AS "Errors"
FROM hourly_metrics
ORDER BY hour DESC, query_count DESC;
*/


-- Alternative: Connection Pool and Transaction Metrics
-- Uncomment to analyze transaction patterns and connection behavior
/*
WITH transaction_metrics AS (
    SELECT
        DATE_TRUNC('minute', start_timestamp) AS minute,
        COUNT(*) FILTER (WHERE span_name = 'BEGIN neondb') AS begin_count,
        COUNT(*) FILTER (WHERE span_name = 'COMMIT neondb') AS commit_count,
        COUNT(*) FILTER (WHERE span_name = 'ROLLBACK neondb') AS rollback_count,
        ROUND(AVG(duration * 1000) FILTER (WHERE span_name = 'BEGIN neondb')::numeric, 2) AS avg_begin_ms,
        ROUND(AVG(duration * 1000) FILTER (WHERE span_name = 'COMMIT neondb')::numeric, 2) AS avg_commit_ms
    FROM records
    WHERE
        span_name = 'BEGIN neondb'
        OR span_name = 'COMMIT neondb'
        OR span_name = 'ROLLBACK neondb'
    GROUP BY minute
)
SELECT
    minute AS "Minute",
    begin_count AS "Begins",
    commit_count AS "Commits",
    rollback_count AS "Rollbacks",
    avg_begin_ms AS "Avg BEGIN (ms)",
    avg_commit_ms AS "Avg COMMIT (ms)",
    CASE
        WHEN begin_count > 0
        THEN ROUND((rollback_count::numeric / begin_count::numeric * 100), 2)
        ELSE 0
    END AS "Rollback Rate %"
FROM transaction_metrics
WHERE begin_count > 0 OR commit_count > 0 OR rollback_count > 0
ORDER BY minute DESC
LIMIT 60;
*/
