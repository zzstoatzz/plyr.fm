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

## Encoding waits

The October 28 heartbeat fix is deployed to staging in #2233; production
promotion is pending.

The transcoder finishes encoding before sending response headers. The client
heartbeats the job every five seconds for the entire HTTP request, including
uploading input, waiting for headers, and reading output. The heartbeat stops
when the request completes, times out, or is cancelled; HTTP timeouts still
bound a stalled service. A heartbeat failure is logged and retried on the next
tick.

On October 28, renderg.host retried five uploads after R2 errors. Four distinct
tracks published; Creative Space Podcast did not. Two retry jobs were reaped
in `transcode` while their ffmpeg processes were still alive. The prior client
only heartbeated while receiving output, leaving the encoding wait uncovered.
This fix prevents that premature failure; it does not restore failed jobs or
explain the unusually slow encodes.

## R2 promotion waits

The maximum-size staging smoke separately reproduced a `CopyObject` read
timeout after all 154 transfer parts had arrived. #2237, deployed to staging,
uses bounded multipart copy for objects over 64 MiB, verifies destination size
and completion ETag, and heartbeats while the copy is active. Check the
`R2 promote_staged` spans separately from transcoder waits. Neither a completed
browser transfer nor a live heartbeat proves publication completed.

For Spaces-backed protected audio, PDS source ownership precedes the optional
copy. For explicitly accepted R2-only storage, promotion failure still fails
publication. Production promotion of these fixes remains pending.

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
