---
title: activity chart
---

The activity page keeps the chronological feed independent of its chart range.
`ActivityChart.svelte` fetches `/activity/histogram?range=…&series=…`, aborts
superseded requests, and draws each bucket's raw count as a faint bar under a
smoothed line. Pointer hover, a native range
input for touch, and keyboard arrows/Home/End inspect a bucket. The fixed
readout above the plot avoids a tooltip covering the chart on narrow screens.

| Range | Buckets |
| --- | --- |
| day | 24 UTC hours, including the current hour |
| week | 168 UTC hours, including the current hour |
| month | 30 UTC dates, including today |
| year | 365 UTC dates, including today |
| all | calendar months from the earliest retained event through this month |

The line is a centered rolling mean (`lib/activity-smoothing.ts`): 3 hours for
day, 12 hours for week, 3 days for month, 7 days for year; all-time is raw
monthly. It is drawn as a monotone cubic, which never overshoots below zero. The
current bucket is partial: it shows only as its bar and feeds no average, so the
line never dips at "now". The readout shows the raw count with the average.

All-time starts at plyr's launch month (October 2025). Records can carry
creator-set dates from years earlier (six tracks are dated 2021–2023); those
events fall outside the chart.

`series=plays` buckets `track_plays.played_at`. Rows come from counted plays
(`web`, `subsonic`) and from a backfill of plyr-origin teal.fm scrobbles
(`teal`), run by the docket tasks in `_internal/tasks/teal_plays.py` (hourly
scheduler, one keyed task per account, a redis done marker per account), which
cover only listeners
who scrobbled — about a fifth of counted plays. `tracked_since` is the first
non-teal play; the chart draws everything before it dashed and labels it
"scrobbled plays only". Teal rows at or after `tracked_since` are not counted,
since those plays are already recorded directly.

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
