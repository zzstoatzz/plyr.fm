-- Client Traffic Dashboard
-- Shows traffic breakdown by client type (SDK, MCP, browser)
-- Uses client_type and client_version attributes added via request_attributes_mapper

-- Main Dashboard: Traffic by Client Type
-- Shows request counts, latency, and error rates grouped by client source
-- Groups by client_type only (version shown in separate query for SDK/MCP)
WITH client_requests AS (
    SELECT
        attributes->>'client_type' AS client_type,
        span_name,
        duration,
        start_timestamp,
        otel_status_code,
        (attributes->>'http.status_code')::int AS status_code
    FROM records
    WHERE
        kind = 'span'
        AND attributes->>'client_type' IS NOT NULL
        AND (span_name LIKE 'GET %' OR span_name LIKE 'POST %' OR span_name LIKE 'DELETE %' OR span_name LIKE 'PATCH %')
)
SELECT
    client_type AS "Client Type",
    COUNT(*) AS "Requests",
    ROUND(AVG(duration * 1000)::numeric, 2) AS "Avg (ms)",
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration * 1000)::numeric, 2) AS "p95 (ms)",
    COUNT(*) FILTER (WHERE status_code >= 400) AS "Errors",
    ROUND((COUNT(*) FILTER (WHERE status_code >= 400)::numeric / NULLIF(COUNT(*), 0) * 100), 2) AS "Error %"
FROM client_requests
GROUP BY client_type
ORDER BY COUNT(*) DESC;


-- Alternative: Traffic Over Time by Client Type
-- Uncomment to see hourly breakdown of traffic sources
/*
SELECT
    DATE_TRUNC('hour', start_timestamp) AS "Hour",
    attributes->>'client_type' AS "Client Type",
    COUNT(*) AS "Requests",
    ROUND(AVG(duration * 1000)::numeric, 2) AS "Avg (ms)"
FROM records
WHERE
    kind = 'span'
    AND attributes->>'client_type' IS NOT NULL
    AND (span_name LIKE 'GET %' OR span_name LIKE 'POST %' OR span_name LIKE 'DELETE %')
GROUP BY DATE_TRUNC('hour', start_timestamp), attributes->>'client_type'
ORDER BY "Hour" DESC, "Requests" DESC
LIMIT 100;
*/


-- Alternative: Top Endpoints by Client Type
-- Uncomment to see which endpoints each client type uses most
/*
SELECT
    attributes->>'client_type' AS "Client Type",
    span_name AS "Endpoint",
    COUNT(*) AS "Requests",
    ROUND(AVG(duration * 1000)::numeric, 2) AS "Avg (ms)"
FROM records
WHERE
    kind = 'span'
    AND attributes->>'client_type' IS NOT NULL
    AND (span_name LIKE 'GET %' OR span_name LIKE 'POST %' OR span_name LIKE 'DELETE %')
GROUP BY attributes->>'client_type', span_name
ORDER BY attributes->>'client_type', COUNT(*) DESC
LIMIT 50;
*/


-- Alternative: SDK/MCP Version Distribution
-- Uncomment to see version adoption for programmatic clients
/*
SELECT
    attributes->>'client_type' AS "Client Type",
    attributes->>'client_version' AS "Version",
    COUNT(*) AS "Requests",
    MIN(start_timestamp) AS "First Seen",
    MAX(start_timestamp) AS "Last Seen"
FROM records
WHERE
    kind = 'span'
    AND attributes->>'client_type' IN ('sdk', 'mcp')
    AND attributes->>'client_version' IS NOT NULL
GROUP BY attributes->>'client_type', attributes->>'client_version'
ORDER BY attributes->>'client_type', COUNT(*) DESC;
*/


-- Alternative: Recent SDK/MCP Requests (Debug View)
-- Uncomment to see individual requests from programmatic clients
/*
SELECT
    start_timestamp AS "Time",
    attributes->>'client_type' AS "Client",
    attributes->>'client_version' AS "Version",
    span_name AS "Endpoint",
    ROUND(duration * 1000, 2) AS "Duration (ms)",
    (attributes->>'http.status_code')::int AS "Status"
FROM records
WHERE
    kind = 'span'
    AND attributes->>'client_type' IN ('sdk', 'mcp')
ORDER BY start_timestamp DESC
LIMIT 25;
*/
