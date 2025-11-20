---
description: Investigate Logfire spans and traces to answer questions about application behavior
argument-hint: [your question about what happened]
---

First read the Logfire documentation: @docs/tools/logfire.md

Investigate: $ARGUMENTS

Query the `records` table using SQL patterns from the docs. Key points:
- Search by `message` for logfire.info() events, `span_name` for spans
- Use `trace_id` to follow a full user action flow
- Check `otel_status_message` for errors (not exception.message)
- Filter by `start_timestamp` for time ranges
- Extract metadata from `attributes` JSONB field
