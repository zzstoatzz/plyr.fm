---
title: "upload stall alert"
---

# upload stall alert

Use this when the moderation account reports that upload jobs made no progress
for more than ten minutes. The reaper has already marked those jobs failed; the
alert proves those jobs stopped progressing, not that the whole pipeline is down.

## triage

1. Open the alert's **upload health** link. A 200 means no other upload is
   currently stalled. A 503 means the response's `upload.stalled` count still
   needs investigation. `failed_last_24h` is diagnostic and does not make the
   probe unhealthy by itself.
2. In the alert's Logfire environment, find the `reap_stuck_uploads` span at the
   alert time. Confirm the count and any `skipping R2 cleanup` or storage errors.
   Follow error traces rather than searching only log text.
3. Check recent `POST /tracks/` spans and completed upload jobs. Several fresh
   completions around an isolated reap point to abandoned state; multiple
   current stalls point to a live worker, database, PDS or storage incident.
4. Check the Fly worker and app machines. A healthy app does not prove the
   worker is consuming jobs.
5. Use the full job IDs from the alert to inspect the rows. Preserve the failed
   state and cleanup hints until storage ownership is understood.

## ownership boundaries

- `processing` and pre-worker `pending` jobs use the ten-minute progress budget.
- `pending/transfer` is browser-owned and has a separate 24-hour abandoned
  transfer policy; it should not trigger this alert.
- The reaper calls refcounted `discard_staged` only when a job has cleanup hints.
  A skipped cleanup with no hints is expected for jobs that never reached media
  staging.
- `/health/freshness` is read-only. It reports state but never repairs it.

For the health contract and initial production baseline, see
[`docs/internal/backend/health.md`](../backend/health.md). For the original
worker OOM incident that introduced the reaper, see
[`2026-05-10-worker-oom-loop-streaming.md`](../retrospectives/2026-05-10-worker-oom-loop-streaming.md).
