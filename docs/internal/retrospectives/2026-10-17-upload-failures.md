---
title: "October upload failures and stalled worker"
---

# October upload failures and stalled worker

Investigated October 17, 2026, using production Logfire (`waow/plyr-fm`),
read-only Neon queries (`plyr-prd`, `cold-butterfly-11920742`), deployed Fly
configuration, public health/config endpoints, and issue #2168. All times below
are UTC. This is an investigation record, not a declaration that the defects
have been fixed.

## Impact

Uploads failed for multiple people through several distinct mechanisms. The
review window is October 3 06:00 through October 17 05:25:28, based on job
creation time and the job's state when queried.

| Outcome | Jobs | Distinct accounts within category |
| --- | ---: | ---: |
| Completed | 110 | 15 |
| Duplicate rejected | 33 | 1 |
| Transcoder failure | 7 | 1 |
| ATProto publication/authentication failure | 3 | 2 |
| Queued until reaped after worker recovery | 3 | 1 |
| Transfer session expired | 1 | 1 |

There were 157 recorded jobs: 110 completed and 47 marked failed. Four distinct
accounts had the 14 non-duplicate failures; accounts overlap between categories.
These are attempts, not unique files or people permanently unable to publish.
The seven transcoder failures repeatedly involved the same filename and byte
size. Duplicate rejection means an existing track was found, not that audio was
lost. The expired transfer does not establish whether the user abandoned it or
was driven away by an error. Requests that never created a job are outside this
denominator. Do not report 47/157 as an infrastructure failure rate.

At 05:25:28 and 05:26:54 on October 17, `/health/freshness` reported zero active
or stalled uploads, 30 completions and 27 failures in its rolling 24-hour
completion window. That window differs from the creation-time census above.
A new production upload created at 05:23:57 completed at 05:24:06, after the
worker restart. This establishes subsequent job completion, not that every
format, size or affected user's retry now works. No synthetic upload or audio
playback test was performed during this investigation.

## Large FLAC uploads exceeded a downstream limit

Seven attempts on October 12–13 reached the transcoder and failed with
`httpx.ReadError`. Each source was 1,132,800,985 bytes (1,080.323 MiB). The
production API advertises a 1,536 MiB limit at `/config`; the deployed
`plyr-transcoder` configuration sets `TRANSCODER_MAX_UPLOAD_BYTES=1073741824`
(1,024 MiB). The repository's Rust service applies that limit to the multipart
request body, which also contains framing overhead.

The API therefore accepts files that exceed its downstream service's configured
capacity. This mismatch is confirmed and is the leading explanation for this
failure cluster. The exact mechanism turning rejection into a connection read
error is not established: historical transcoder-side logs and a reproduction
are still needed. Do not label this an OOM, timeout, or proven ffmpeg defect.
Current stopped transcoder machines are consistent with their configured
scale-to-zero behavior; that state alone is not an outage.

The failed attempts took approximately 11–16 minutes from job creation to
failure. The actual transcoder request lasted roughly 58 seconds in each case;
much of the wait preceded it. A 332.925 MiB FLAC succeeded for the same account
earlier on October 12. Retrying the larger file seven times did not help.

The backend's generic exception handler stores `unexpected error: {e}`. A
`ReadError` with an empty string becomes `transcoding failed: unexpected error: `
in the job, stripping the useful exception type from the user's explanation.

Representative trace:
[October 12 first large-file failure](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a130c9cd8099dff4865cf58a8c2f6a).
Job: `799664c7-ae38-4dc7-9754-561fa60e882a`; created 15:37:35,
transcode began 15:48:16, failure recorded 15:49:15.

## The worker stopped making progress while remaining alive

[Issue #2168](https://github.com/zzstoatzz/plyr.fm/issues/2168) records the prior
operator intervention. Its Redis and backlog observations are evidence from
that incident report, not measurements repeated in this investigation.

| Time | Evidence |
| --- | --- |
| October 16 22:04:50 | Reaper task's queued time reported during diagnosis in #2168. |
| October 16 22:15:20 | Redis restart reported in #2168. |
| October 16 22:19:56 | Worker Redis DNS/connection/timeout errors reported in #2168. |
| October 17 02:55:05 | First of three affected upload jobs created. |
| October 17 03:01:10 | Second affected job created. |
| October 17 03:07:15 | Third affected job created. |
| October 17 about 04:37 | Over 400 tasks backed up despite a roughly one-second-old worker heartbeat, per #2168. |
| October 17 04:37–04:38 | Operator restarted worker `6e8204deb36148`, per #2168 and current Fly restart time. |
| October 17 04:38:08 | Logfire and database independently confirm the reaper failed all three queued uploads. |
| October 17 04:39 | Fleet sweep passed, per #2168. A subsequent queued `sleep(0)` canary also completed. |
| October 17 05:24:06 | A newly created upload job completed. |

The three jobs waited approximately 103, 97 and 91 minutes. Their eventual
message said the task did not complete in ten minutes. Recovery drained the
worker queue but did not recover those uploads. The Redis incident is correlated
with the stall; its causal mechanism remains unproven. In particular, the
reaper's queued timestamp precedes the reported Redis restart, so that timestamp
must not be used to assert a precise Redis-caused outage onset.

The reaper and its notification run on the same Docket worker as uploads.
When that worker cannot consume work, neither the ten-minute cleanup nor its
notification can run. Process state, restart-on-exit policy and heartbeats did
not detect this failure mode. The external freshness endpoint did expose it,
but the existing response loop still required manual diagnosis and restart.

[Reaper trace](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a148272826b96536cda8e5641a07ba).
Affected jobs: `ae0df8a4-80ac-406c-9219-ffa96012e545`,
`b4ecf6bf-6b53-48fa-b94a-53d6a5928153`,
`7e254ddc-985e-4c80-8476-d7ecc2c8c221`.

## Other failures and misleading signals

- October 7: two publication failures for one account, first a refresh rejected
  as scope reduction, then an expired session. The first error compares an
  include scope with expanded grants; semantic equivalence has not been proved.
  Do not weaken scope validation based only on that message.
- October 13: another account's publication failed during token refresh with
  no useful error text. These three failures are independent of the worker stall.
- Multipart PUT spans recorded 24 `ClientDisconnect` exceptions and 14
  `NoSuchUpload` exceptions. These are request counts, not failed-job counts.
  All seven October 13 sessions associated with the 14 `NoSuchUpload` errors
  ultimately completed. A representative error was emitted after that session
  had already completed: the evidence is consistent with overlapping or delayed
  requests, but does not yet establish the precise race.
- Eleven `ConcurrencyBlocked` spans on October 13 describe the per-artist
  concurrency limit. They must not be counted as eleven lost uploads.

OAuth evidence:
[scope refresh failure](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a116e4c5bbbb914a4095651c394ba5),
[expired session](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a116e5693132ff18383b23a628ffbd),
[October 13 refresh failure](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a1335083229c48d91b10dba0b65698).
Multipart evidence:
[completed session with a late error](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a1378929eeb602e425e40c57b2af2a).

## Why this remained painful

The system accepted a file outside a downstream limit, made the user pay the
transfer cost repeatedly, and provided an error without a useful cause. The
worker recovery mechanism depended on the failing worker. Health becomes green
once stalled jobs are marked failed; it does not attest to user recovery.

Logfire currently lists three alerts: PDS blob mirroring failures, Jetstream
writes without echoes, and silent Jetstream consumption. None is a general
upload outcome or worker forward-progress alert. External Prefect checks did
detect the stall, according to #2168; the gap was turning those findings into
timely, scoped recovery. Public configuration also reports browser observability
disabled, so server telemetry cannot reconstruct the entire browser experience.

## Corrective actions and acceptance evidence

Production remediation remains open. The staging validation below covers the
size contract and consumer-failure recovery; the other follow-ups still need
owners and delivery dates. Green freshness alone does not close the incident.

| Priority | Action | Required evidence |
| --- | --- | --- |
| P0 | Align upload admission with actual transcoder capacity, including multipart overhead; decide whether to support the advertised maximum or reject unsupported sizes before transfer. | Real FLAC boundary tests through admission, transfer and conversion; deploy configuration verified against the advertised limit. |
| P0 | Implement independent worker progress detection and the scoped recovery loop in #2168. | Real Redis interruption/recovery tests where heartbeats continue but consumption stalls; idle queues do not alarm; reaper progress is checked independently. |
| P1 | Preserve exception class and actionable context in persisted upload failures; make retry guidance depend on failure category. | A real connection interruption produces a useful persisted error, without secrets or raw internal responses shown to users. |
| P1 | Alert on terminal upload failures and repeated failures per account, separating duplicates and expired transfers. | A controlled failed upload produces one actionable incident; successful retries resolve the user-impact state. |
| P1 | Reproduce OAuth refresh failures using actual issuer scope expansion and session expiry behavior. | Valid expanded grants survive refresh; genuinely reduced privileges still fail securely; reauthentication guidance reaches the user. |
| P1 | Reproduce delayed multipart requests around completion and make terminal-session behavior explicit. | Overlapping requests do not turn an already completed upload into an apparent failure or silently restart it. |
| P1 | Validate recovery with a fresh full upload and playable result, including a large FLAC case. | Persisted job completion, published record, and playable audio all agree. |

No users were contacted, jobs retried, production configuration changed, or
services restarted during this investigation. User follow-up should acknowledge
that failed jobs were not restored and avoid recommending another identical
large-file retry before the size mismatch is addressed.

## Reproduction of the census

Run read-only against `plyr-prd`; group accounts separately when deduplicating
impact across categories. This query uses a fixed creation window but observes
current row state, so a later rerun is not an immutable historical snapshot.

```sql
SELECT
  CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN error LIKE 'duplicate upload:%' THEN 'duplicate'
    ELSE phase
  END AS category,
  count(*) AS jobs,
  count(DISTINCT owner_did) AS accounts
FROM jobs
WHERE type = 'upload'
  AND created_at >= '2026-10-03T06:00:00Z'
  AND created_at < '2026-10-17T05:25:28Z'
GROUP BY 1
ORDER BY 1;
```

Logfire queries used explicit windows and `deployment_environment='production'`.
Exception counts were reconciled with terminal job rows rather than added to
them. Relevant source files were compared with fetched `origin/main`
(`1a41ce74`); the transcoder client, upload-session handler and reaper were
unchanged from this checkout. GitHub, Fly and Neon reads succeeded. A Cloudflare
management connector was unavailable; R2 internals were not independently
audited. The original reporter's full list of people and dates was not supplied,
so this bounded census may not cover every reported failure.

## Local reproduction and remediation in progress

The boundary harness sends real padded FLAC files over HTTP and decodes the
returned MP3 with ffprobe. Before the change, the production-configured 1 GiB
request limit rejected the incident's exact byte size with HTTP 400. With a
shared 1.5 GiB file contract and separate multipart overhead allowance, that
size and the exact 1.5 GiB boundary pass; one byte over receives HTTP 413.
This confirms the capacity defect, without claiming the local 400 reproduces
production's exact connection-close behavior.

A real Redis traffic interruption also reproduced a consumer that exits with
`redis.exceptions.TimeoutError` while its separate heartbeat keeps running.
The pinned Docket version's cleanup can fail before setting its worker-done
signal, so its context manager can hang as well. The application now supervises
consumer lifetime and bounds worker cleanup; fatal consumer failure reaches
the process supervisor. Tests interrupt worker Redis traffic, verify a nonzero
process exit, start a replacement, and verify queued and fresh work complete.
The independent API freshness probe checks due scheduled and unread stream
work, including maintenance, without consulting heartbeat freshness.

The exact historical failure remains inferred from a matching reproduction
rather than a recovered worker stack.

## Staging validation — October 17, 2026

[PR #2170](https://github.com/zzstoatzz/plyr.fm/pull/2170) implemented the shared
capacity contract, supervised worker lifecycle, independent queue freshness,
and coordinated service deployment. The initial staging rollout stopped before
changing the backend because Fly resolved the Dockerfile path relative to its
config directory. [PR #2171](https://github.com/zzstoatzz/plyr.fm/pull/2171)
corrected both environment configs.

The [staging deployment](https://github.com/zzstoatzz/plyr.fm/actions/runs/39008260286)
succeeded at commit `1ecf8c2b`. The separate staging transcoder reported
`max_file_bytes=1610612736` and rejected unauthenticated conversion with HTTP 401.
The Linux deployment image also passed all 15 format conversions and the
incident-size, exact-limit, and limit-plus-one boundary cases.

The [live integration suite](https://github.com/zzstoatzz/plyr.fm/actions/runs/39008447197)
passed all 23 selected tests; four tests outside its selection were deselected.
The full-size regression transferred 1,610,612,736 bytes in 154 parts, converted
protected FLAC to MP3, verified completed publication and decoded playback, and
deleted its test track. Job `cd17f4d9-5d52-4008-8a45-bb4932912b05` started at
06:08:01 UTC and completed at 06:22:08 UTC without an error. This validates
capacity, not acceptable latency: the approximately fourteen-minute operation
still warrants a separate performance follow-up.

At 06:26:03 UTC, staging freshness reported no active or stalled uploads, no
overdue scheduled or unread queue work, and no upload failures in the preceding
24 hours. Backend CI passed 1,878 tests with 26 credential-dependent skips;
the separately configured live private-media test passed as well.

Production deployment and post-release upload/playback verification remain
pending Nate's explicit release approval. These staging results do not establish
production recovery or restore any previously failed user upload.
