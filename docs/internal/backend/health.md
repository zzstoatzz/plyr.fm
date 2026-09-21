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
upload jobs still pending with no phase, last updated April 30–July 18. One
upload completed within the preceding day. The freshness check intentionally
reports those four rows as stalled rather than excluding historical failures
to get a green result. Reconciliation of those rows is a separate operation;
the check never changes their state. Ordinary `/health` and playback remain
independent of that backlog verdict.

The regression suite uses real local Postgres: stale and progressing jobs,
quiet periods, browser transfers, optimization budgets, terminal outcome
counts, connection refusal, and a real table lock that exceeds the probe
deadline. The timeout test also checks recovery after releasing the lock.
