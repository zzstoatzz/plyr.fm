---
title: "retro: the upload memory wedge (2026-08-14)"
---

# retro: an album batch wedged the app VM

**impact**: ~2 minutes of failed/hung requests for all production users
(02:00–02:02 UTC), plus a redundancy loss lasting ~20 minutes. one artist's
album batch lost 7 of 8 uploads to "upload timed out (stopped at 100%)".
no data loss; the completed upload survived.

## timeline (UTC, 2026-08-14)

- **02:00:21** — an artist begins batch-uploading an album of WAVs
  (`POST /tracks/` × 8; the first completes in 23s).
- **02:02:04** — the primary app machine emits its last log line
  mid-`POST /tracks/`. no logs of any kind after this.
- **02:02:19** — fly health check fails: *context deadline exceeded while
  awaiting headers*. the process is alive but nothing is schedulable —
  SSH exec also hangs. no OOM-kill event is recorded.
- **02:02:39** — fly-proxy autostarts the stopped second app machine.
- **02:03** — traffic recovers (93-request burst as clients retry).
- **~02:05** — user reports "is prod broke?"; investigation begins.
- **~02:20** — wedged machine manually restarted (`fly machine restart`),
  passes health immediately. redundancy restored.

## what the telemetry showed (and didn't)

- **zero 5xx anywhere**: requests that failed never reached the app, so
  Logfire recorded nothing for them. every span that exists is a 200.
- the giveaway was *shape*, not errors: traffic collapsed to 1 request at
  02:02 and burst to 93 at 02:03, and `fly status` showed one machine
  critical and the other freshly autostarted.
- the in-flight `POST /tracks/` that wedged the machine produced **no span
  at all** — spans export on completion. the artist's client-side error
  list was the best record of what was attempted.

## root cause

`aioboto3`'s `upload_fileobj` runs a reader task that assembles full
`multipart_chunksize` parts and eagerly queues them ahead of the uploader
tasks: `asyncio.Queue(maxsize=Config.max_io_queue_size)`. boto3's
`TransferConfig` defaults are `max_io_queue=100`, `multipart_chunksize=8MB`,
`max_concurrency=10`. disk reads always outrun network uploads, so on any
sufficiently large file the queue fills toward its maximum: **up to ~800MB
of part buffers per upload**, independent of uploader concurrency.

the app VM has 1GB of memory and idles with ~330MB available. one large WAV
could hold most of itself in memory; a batch (3 concurrent uploads per
artist) was guaranteed starvation. memory pressure presented as page-cache
thrash — process alive, nothing schedulable, no clean OOM kill — which is
why logs, health checks, and SSH all went silent together.

compounding: three whole-file sync scans (`hash_file_chunked`,
`extract_duration`, `is_alac`) ran on the event loop, so under pressure the
loop also could not answer `/health`.

**what held**: #1389's end-to-end streaming (spool → tempfile → chunked
hash → streaming upload). there was no whole-file-buffering regression; the
memory was hiding in a transfer-library default nothing in our code named.

## the fix

- **#1831** capped uploader concurrency (`max_concurrency=2`) and moved the
  sync scans to worker threads. **it was insufficient** — it left the
  io_queue at 100 and so barely reduced the bound. careful re-review
  (prompted by "review your fix carefully; what are the cases?") found the
  queue by reading the installed aioboto3 source.
- **#1832** added `max_io_queue=2`: per-upload memory is now
  ~(2 queued + 2 in flight) × 8MB ≈ **32MB**, ~96MB across the per-artist
  gate. it also moved the private-branch hash off the loop (the one scan
  #1831 missed).
- verified by the staging integration suite, including the 150MB longform
  WAV upload (the incident shape), then released to production
  (`2026.0814.024347`) with a clean window: 449 requests, zero 5xx.

## lessons

1. **a transfer library's memory profile lives in its defaults, not your
   code.** we audited our own path for whole-file reads (none) while the
   library buffered 100 parts by design. when handing bytes to a library,
   read what its config defaults *bound*, not what its API implies.
2. **the first fix looked right and wasn't.** capping `max_concurrency`
   pattern-matched the "concurrent buffers" theory and passed every test —
   because mocked tests validate nothing about a kwarg's runtime effect.
   the insufficiency was only findable by reading the vendored source.
3. **absence of 5xx is not absence of outage.** requests that die before
   the app leave no trace in app telemetry. the durable signals were fly's
   machine states and the traffic *shape*.
4. **memory starvation ≠ OOM kill.** page-cache thrash silences a machine
   without any terminating event. "process alive, everything silent" is its
   signature.

## still open

- **machine-level health alerting**: fly's health check knew at 02:02:19;
  a human found out from a user report. the backlog item "fly worker tcp
  health check (running-but-stuck symptom detector)" is this incident's
  app-group twin.
- **VM sizing**: 1GB idling at ~330MB available is thin even post-fix.
  operator/cost call.
- **disk exposure**: at `max_upload_size_mb=1536`, each upload transiently
  costs up to 2× file size in /tmp (starlette spool + our tempfile) on a
  7.8GB rootfs; 3 worst-case concurrent uploads could exhaust disk.
- the artist's 7 failed uploads: the client retry path works (their
  completed track proves the pipeline); they simply need to retry now that
  the fix is live.
