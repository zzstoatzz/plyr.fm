---
title: "alert: worker silence"
---

an alert that fires when the docket worker process group has not produced
any task-completion span in a window where it should have. catches the
2026-05-10 failure mode (worker dead, fly stopped restarting it, nobody
noticed for four days) within minutes instead of days.

see [docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md](../retrospectives/2026-05-10-worker-oom-loop-streaming.md)
for the incident this addresses.

## what to alert on

the worker is unhealthy if **both** of these are true in the same window:

1. the HTTP API is alive (so we know the system isn't fully down) — at
   least one successful `POST /tracks/` in the window
2. the worker emitted zero spans for any of the recurring tasks it owns
   (`run_track_upload`, `consume_jetstream`, `sync_copyright_resolutions`,
   `scrobble_to_teal`, `warm_follow_graph`)

condition (1) prevents the alert from firing during a planned full-stack
deploy. condition (2) is the actual silence we care about.

## logfire saved query

run this against `production` on a 5-minute window. the alert fires when
`worker_task_count = 0` AND `upload_attempt_count > 0`.

```sql
WITH window_bounds AS (
  SELECT
    NOW() - INTERVAL '5 minutes' AS window_start,
    NOW() AS window_end
)
SELECT
  -- spans emitted by the worker process. if this is zero while the
  -- HTTP API is taking new uploads, the worker is dead or wedged.
  COUNT(*) FILTER (
    WHERE attributes->>'docket.task' IN (
      'run_track_upload',
      'consume_jetstream',
      'sync_copyright_resolutions',
      'scrobble_to_teal',
      'warm_follow_graph'
    )
  ) AS worker_task_count,

  -- successful POST /tracks/ requests as a liveness signal for the
  -- HTTP path, so we don't page during a full-stack deploy window.
  COUNT(*) FILTER (
    WHERE span_name = 'POST /tracks/'
      AND http_response_status_code = 200
  ) AS upload_attempt_count
FROM records, window_bounds
WHERE deployment_environment = 'production'
  AND start_timestamp >= window_bounds.window_start
  AND start_timestamp <  window_bounds.window_end
```

alert condition (in logfire's monitor configuration):

```
worker_task_count = 0 AND upload_attempt_count > 0
```

window: 5 minutes. evaluate every 1 minute. notification: page (slack
or pagerduty depending on what we route alerts through).

## how to wire it up in logfire

1. open [https://logfire.pydantic.dev/zzstoatzz/plyr](https://logfire.pydantic.dev/zzstoatzz/plyr)
2. SQL Explorer → paste the query above
3. confirm it returns one row with two integer columns
4. save the query as `alert: worker silence (production)`
5. create a monitor on the saved query with the condition above
6. add a notification target for the monitor

## how to test the alert without breaking production

1. open [https://logfire.pydantic.dev/zzstoatzz/plyr](https://logfire.pydantic.dev/zzstoatzz/plyr)
2. modify the query to filter on `deployment_environment = 'staging'` and
   shorten the window to 1 minute
3. on staging, stop the worker machine: `fly machine stop <worker-id> -a relay-api-staging`
4. trigger an upload via stg.plyr.fm to bump `upload_attempt_count`
5. confirm the monitor fires within ~1 minute
6. restart the staging worker: `fly machine start <worker-id> -a relay-api-staging`

## what to do when this alert fires

1. check fly machine state: `fly status -a relay-api`. if any worker is
   `stopped` (and not `started`), start it: `fly machine start <id> -a relay-api`
2. confirm the worker is consuming the queue: query the saved alert
   query manually and verify `worker_task_count > 0` in the next window
3. if the worker keeps OOM-killing, investigate memory usage — the
   2026-05-10 fix removed the in-memory audio buffers that were the
   common OOM cause, but new code paths could regress this
4. if the worker is started but no spans are appearing, suspect a stuck
   loop (network hang on PDS, DB connection wedged) — `fly machine
   restart <id>` to bounce it
5. open an issue with the logfire trace so the failure mode gets a
   proper retrospective even if the alert was the only signal

## why this query and not just "any worker span"

filtering by `attributes->>'docket.task' IN (...)` instead of `IS NOT NULL`
means we count *task-completion* spans specifically, not the noisier
`docket.add` spans (which are emitted by the HTTP `app` process when it
queues work, not by the worker process executing it). a queue with new
tasks being added but no tasks being executed is exactly the failure
shape we care about; counting `docket.add` would mask it.

the listed task names cover both the on-demand work (`run_track_upload`,
`scrobble_to_teal`, etc.) and the recurring schedule (`consume_jetstream`,
`sync_copyright_resolutions`, `warm_follow_graph`) so the alert fires even
during quiet periods when nobody is uploading — the recurring tasks tick
every few minutes regardless and the worker emits a span on each tick.
