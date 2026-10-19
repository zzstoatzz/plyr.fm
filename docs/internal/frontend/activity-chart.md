---
title: activity chart
---

The activity page keeps the chronological feed independent of its chart range.
`ActivityChart.svelte` fetches `/activity/histogram?range=…`, aborts superseded
requests, and renders a zero-based line chart. Pointer hover, a native range
input for touch, and keyboard arrows/Home/End inspect a bucket. The fixed
readout above the plot avoids a tooltip covering the chart on narrow screens.

| Range | Buckets |
| --- | --- |
| day | 24 UTC hours, including the current hour |
| week | 168 UTC hours, including the current hour |
| month | 30 UTC dates, including today |
| year | 365 UTC dates, including today |
| all | calendar months from the earliest retained event through this month |

The current bucket is partial. Counts come from retained likes, uploads,
comments, completed artist profiles, and public collection events, matching the
activity feed's event categories. These are not plays or an immutable audit log;
deleting or unliking can change historical counts. Empty buckets are zero-filled.
All-time is monthly so its response grows with months rather than events.

The legacy `days=1..30` parameter remains supported and defaults to seven daily
buckets when `range` is absent. Named ranges take precedence. Day buckets retain
`YYYY-MM-DD`; hour/month buckets use explicit UTC ISO timestamps. Responses now
include `interval` (`hour`, `day`, or `month`). UTC truncation is explicit and
independent of the database session's time zone.

Endpoint tests exercise PostgreSQL boundaries, zero fill, legacy behavior,
all-time history, and private collection exclusion. Mounted component tests cover
inspection, empty/error recovery, and stale responses after range changes.
