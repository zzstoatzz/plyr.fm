---
title: "alerts: worker silence + crash loop"
---

two alerts that, together, catch the operational failure modes of the
docket worker. both target the 2026-05-10 incident class (worker dead,
fly stopped restarting it, nobody noticed for four days), but from
opposite sides.

see [docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md](../retrospectives/2026-05-10-worker-oom-loop-streaming.md)
for the incident this addresses.

| alert | what it catches |
|---|---|
| **worker silence** | worker is not running tasks while the system is taking new uploads (the 2026-05-10 shape exactly) |
| **worker crash loop** | worker keeps starting and dying — the failure mode that `restart.policy = "always"` makes possible. without this, the unbounded restart hides under "loud" but never pages |

## alert 1: worker silence

### what to alert on

the worker is unhealthy if **both** of these are true in the same window:

1. the HTTP API is alive (so we know the system isn't fully down) — at
   least one successful `POST /tracks/` in the window
2. the worker emitted zero task-execution spans
   (`run_track_upload`, `consume_jetstream`, `sync_copyright_resolutions`,
   `scrobble_to_teal`, `warm_follow_graph`)

condition (1) prevents the alert from firing during a planned full-stack
deploy. condition (2) is the actual silence we care about. when nobody
is uploading at all (e.g. middle of the night), this alert is silent by
design — the crash-loop alert below covers idle-worker failure modes
where there's no upload traffic to compare against.

filtering by `attributes->>'docket.task' IN (...)` instead of `IS NOT
NULL` means we count *task execution* on the worker, not the noisier
`docket.add` spans (which the HTTP `app` process emits when it queues
work, regardless of whether anything is consuming it). "queue is being
added to but nothing is being executed" is the exact shape of the
2026-05-10 failure.

### logfire saved query

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

### what to do when this alert fires

1. check fly machine state: `fly status -a relay-api`. if any worker is
   `stopped` (and not `started`), start it: `fly machine start <id> -a relay-api`
2. confirm the worker is consuming the queue: query the saved silence
   query manually and verify `worker_task_count > 0` in the next window
3. if the worker keeps OOM-killing, the crash-loop alert below should
   also be firing — follow that runbook section instead
4. if the worker is started but no spans are appearing, suspect a stuck
   loop (network hang on PDS, DB connection wedged) — `fly machine
   restart <id>` to bounce it
5. open an issue with the logfire trace so the failure mode gets a
   proper retrospective even if the alert was the only signal

## alert 2: worker crash loop

### why this exists

`restart.policy = "always"` (the change in this PR's `fly.toml`) means
fly restarts the worker forever, with no retry budget. that's the right
default — silent permanent failure was what made 2026-05-10 a four-day
outage. but it makes a new failure mode possible: a "poison pill" task
or systemic bug that crashes the worker every time it tries to start,
keeping the system in a churning loop indefinitely. this alert catches
that, so the bound on retry-forever is *human attention*, not arbitrary
machine giving-up.

### what to alert on

the worker is starting more often than a healthy worker should. a
healthy worker starts once per deploy (rare) — anything more is either
a deploy in progress (transient, alert auto-clears) or a bug.

threshold: more than **5 worker starts in 10 minutes** is unhealthy.
that gives a deploy enough room (typically 1–2 starts per machine across
2 worker machines) without burying a real loop.

### logfire saved query

```sql
SELECT
  COUNT(*) AS worker_start_count,
  -- include the timestamps of recent starts in the alert payload so
  -- the on-call has the data to investigate without writing a new query
  array_agg(start_timestamp ORDER BY start_timestamp DESC) AS recent_starts
FROM records
WHERE deployment_environment = 'production'
  AND start_timestamp > NOW() - INTERVAL '10 minutes'
  AND span_name = 'worker process ready'
```

`worker process ready` is logged by `backend/worker.py` once on each
successful startup, so each row counts exactly one worker-restart event.

alert condition:

```
worker_start_count > 5
```

window: 10 minutes. evaluate every 1 minute.

### what to do when this alert fires

1. check fly machine state: `fly status -a relay-api`. confirm the worker
   machine is alternating between `started` and `stopped` rather than
   sitting steady-state `started`
2. pull the recent crash reasons:
   `fly machine status <worker-id> -a relay-api` and look at the event
   log for `exit_code` / `oom_killed` fields
3. if it's an OOM loop on a poison-pill task: stop the worker manually
   with `fly machine stop <id> -a relay-api` to break the loop, then
   identify which task is killing it (look at the latest spans before
   the crash), and either fix the code or manually drop the task from
   redis
4. if the worker is crashing on startup (failing before `worker process
   ready` even logs once), suspect a deploy regression — check the
   most recent merged PR for backend changes
5. open an issue with the logfire trace and update this runbook with
   anything we learned

## how to wire both alerts up in logfire

for each of the two saved queries above:

1. open [https://logfire.pydantic.dev/zzstoatzz/plyr](https://logfire.pydantic.dev/zzstoatzz/plyr)
2. SQL Explorer → paste the query
3. confirm it returns the expected shape
4. save the query (`alert: worker silence (production)` and
   `alert: worker crash loop (production)`)
5. create a monitor on the saved query with the condition above
6. add a notification target for the monitor

## how to test the alerts without breaking production

these instructions assume the staging fly app `relay-api-staging` has
the same `restart.policy = "always"` config as production (it does, per
`backend/fly.staging.toml`) and that staging emits to the same logfire
project under `deployment_environment = 'staging'`.

**testing the silence alert:**

1. duplicate the silence query, swap `deployment_environment = 'staging'`,
   shorten window to 1 minute
2. stop the staging worker: `fly machine stop <worker-id> -a relay-api-staging`
3. trigger an upload via stg.plyr.fm to bump `upload_attempt_count`
4. confirm the monitor fires within ~1 minute
5. restart the staging worker: `fly machine start <worker-id> -a relay-api-staging`

**testing the crash-loop alert:**

1. duplicate the crash-loop query, swap to staging, shorten window to
   2 minutes and lower threshold to `worker_start_count > 2`
2. on staging, repeatedly bounce the worker:
   `for i in 1 2 3 4; do fly machine restart <id> -a relay-api-staging; sleep 20; done`
3. confirm the monitor fires within ~2 minutes
4. clean up: leave the worker steady-state started
