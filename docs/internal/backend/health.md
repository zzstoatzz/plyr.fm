---
title: "health checks"
---

`GET /health` is process liveness, used by Fly for routing. It stays independent
of job backlog and external dependencies.

`GET /health/freshness` is a read-only fleet check. It queries the existing jobs
table with a three-second deadline and returns HTTP 503 when the database is
unavailable or upload/optimization work has stopped progressing. Responses use
`Cache-Control: no-store` and expose aggregate counts and ages only.

## what the verdict means

- Upload jobs in `pending` or `processing` must update within ten minutes,
  matching the existing upload reaper's progress budget. `updated_at`, rather
  than creation time, lets a long upload remain healthy while making progress.
- Pending `transfer` sessions are counted separately: they are waiting on the
  browser, and an abandoned tab is not evidence that the worker has failed.
- Optimization jobs have the configured transcoder optimization timeout plus
  ten minutes of headroom (70 minutes by default). The deferred encode has a
  deliberately longer budget than a foreground upload.
- Completed and failed jobs within the last 24 hours are diagnostic counts.
  A failure may be invalid input or an upstream PDS refusal, so these counts
  alone do not change the HTTP verdict. A quiet pipeline is healthy.

There are no writes, repairs, uploads, PDS calls, or storage calls in this probe.
It does not prove media playability, detect a task lost before a job was created,
or verify Jetstream ingestion. Playback still needs a public-track byte probe;
end-to-end publishing remains covered by the staging integration suite.

## initial baseline

On September 21, 2026 (UTC), a read-only query against `plyr-prd` found four
upload jobs still pending with no phase, last updated April 30–July 18. Twenty
uploads completed in the preceding seven days and the latest track was published
September 20, so the rows were historical orphaned jobs rather than evidence of
a current pipeline outage. The freshness check intentionally reports them as
stalled rather than excluding historical failures to get a green result.

The upload reaper reconciles both stalled `processing` jobs and stalled
pre-worker `pending` jobs. Pending `transfer` sessions remain excluded because
their separate 24-hour reaper owns browser-abandoned multipart uploads. The
freshness check itself never changes state. Ordinary `/health` and playback
remain independent of the backlog verdict.

The regression suite uses real local Postgres: stale and progressing jobs,
quiet periods, browser transfers, optimization budgets, terminal outcome
counts, connection refusal, and a real table lock that exceeds the probe
deadline. The timeout test also checks recovery after releasing the lock.


## Worker forward progress

`checks.worker` reads Redis independently of the consumer and its reaper.
It reports overdue scheduled work and whether the stream contains unread work,
with the oldest waiting age. A wait longer than 120 seconds makes freshness
return 503, including when maintenance is blocked before any upload arrives.
Empty queues and tasks scheduled in the future remain healthy. Active work
alone does not imply a stall; existing upload/optimization progress checks
cover those jobs. Redis probe failures return sanitized `unavailable` state.

The read is bounded and does not deserialize task arguments, create consumers,
acknowledge work, or mutate job state. It uses the pinned Docket queue schema.
A degraded backlog may also mean saturation; it is not by itself permission to
restart a machine. Consumer exceptions now propagate out of the worker process
and use Fly's existing restart policy, while independent freshness monitoring
covers failures where the consumer remains alive. After recovery, verify that
waiting work drains and a fresh task and upload complete.
