---
title: "PDS mirroring alert repetition"
---

# PDS mirroring alert repetition

Investigated October 17, 2026 (through October 18 00:13:30 UTC).
The initial investigation was read-only. The subsequent authorized fix is recorded below.

## Fix delivered

[PR #2183](https://github.com/zzstoatzz/plyr.fm/pull/2183) merged as `d4411605`
and shipped in [2026.1018.002803](https://github.com/zzstoatzz/plyr.fm/releases/tag/2026.1018.002803).
Production deployment run `39082856895` succeeded; all production machines
reported that revision. Explicit expired/invalid-token responses from the
bodyless probe now reach the existing bounded token-refresh path before the
audio stream opens. Nonce and scope responses retain their prior handling.

Real HTTP regression tests failed on the old code for all three token-error
forms and passed with the fix. The full backend suite passed (1,883 tests,
26 existing skips), as did lint, API-contract checks, container build, and CI.
A controlled local HTTP endpoint inside each deployed staging and production
worker verified rejection before body consumption and successful upload with
fresh credentials. This did not publish tracks or exercise a real user's PDS.

The live alert now uses a 15-minute window at its existing 15-minute frequency,
retains the one-minute watermark and channel assignments, and includes trace
IDs with a shorter description. Replaying the captured evaluations produces
five notifications rather than 17 for the same five events. Its first new
evaluation (00:13:30–00:28:30 UTC) completed without matches, errors, or
deliveries, rather than repeating the 00:04 failure.

At 00:30:12 UTC production freshness was healthy, with no stalled upload or
worker work. Historical tracks and invalid refresh grants were not repaired;
those remain separate user recovery actions. Sections below preserve the
original diagnosis and configuration for reference.

## Confirmed alert behavior

Alert `3660d4c6-064b-40bd-83c0-ad027c5dc0e3`, project `waow/plyr-fm`,
evaluates a one-hour window every 15 minutes, delayed one minute, with
`notify_when=has_matches`. It sends on every matching evaluation, not only on
a new failure. In the 96 evaluations inspected, five distinct failure events
generated 17 deliveries to each configured channel. Four older events each
appeared in four notifications; the newest had appeared once so far.

The query correctly filters production and matches `pds blob upload failed%`
or `pds save failed for track%`. It does not track recovery. An empty window
means no recent matching log, not that affected tracks have been repaired.

Two active webhook channels remain assigned without schedules:

- `dd48f5e3-d524-4586-be6e-371b7a5b887e`: pub-search ingestion alerts (discord)
- `f22200f9-efdb-4e3a-9141-f0fce6b4c578`: phi alert watch (push)

Discord deliveries returned HTTP 200. The phi receiver returned HTTP 200 and
`opened=false` for the recent repeated deliveries. The Discord assignment
explains continued delivery to the channel in the screenshot; the configuration
does not establish why that shared destination was originally chosen.
The alert was created August 9 and last updated August 17.

## Actual failures

All five matching events exhausted four blob-upload attempts with `ReadError`.

| UTC event time | PDS | Outcome evidenced in trace |
| --- | --- | --- |
| October 17 07:12:41 | blacksky.app | Token refresh rejected: refresh token replayed; upload failed. |
| October 17 14:49:52 | blacksky.app | Token refresh rejected: invalid refresh token; ATProto synchronization failed. |
| October 17 21:57:34 | selfhosted.social | Record write refreshed token and succeeded; track 1481. |
| October 17 23:00:12 | selfhosted.social | Record write refreshed token and succeeded; track 1486. |
| October 18 00:04:35 | selfhosted.social | Record write refreshed token and succeeded; track 1489; job completed. |

The selfhosted.social events are three different files, not one hourly retry.
The Blacksky events are two attempts at `Out Of Space.wav` for one account.

Representative [selfhosted.social trace](https://logfire.pydantic.dev/waow/plyr-fm?traceId=01a14c52a7fec530b43f5567f611454f):
nonce priming receives 401 before each streamed attempt; all four attempts
raise ReadError; the code falls back to R2; putRecord then receives 401,
refreshes successfully, and succeeds. The blob is not retried after that refresh.

`_prime_pds_nonce` remembers the nonce but does not act on authentication
failure. `upload_blob` refreshes tokens on a returned 401, whereas its network
exception branch retries without refreshing. An early rejection that closes
a streamed connection can therefore hide the 401 from the refresh branch.
The code documents this transport behavior for nonce rejection already.
Stale/rejected authentication is the leading explanation for these three
failures, not a proven reproduction: the streamed requests' rejection bodies
are unavailable, and a priming 401 alone does not distinguish nonce challenge
from token rejection. Blacksky also has confirmed unrecoverable refresh errors.

Reviewed source history including #2072 and #2073, fetched origin/main
`96c0e8d3`, the open PR list, and the separate October 17 upload-failure
retrospective. No later change in the relevant upload/client files addresses
this gap. No database state or current playback was independently verified.

## Recommended changes

1. For event notifications, use a 15-minute window with the existing
   15-minute evaluation frequency and one-minute delay. Keep `has_matches`
   so genuinely new failures remain visible during an ongoing incident.
   Verify adjacent evaluation boundaries and late-ingestion behavior before
   rollout. Merely switching to `starts_having_matches` suppresses repeats
   but can hide new failures during continuous matching and re-alert after
   gaps; it does not fix underlying uploads.
2. Include trace ID and job/track context in a concise notification. Replace
   the historical PR explanation with actionable failure and recovery details.
3. Choose the intended notification destination explicitly. The current
   Discord route is an active shared webhook, not a stale UI subscription.
4. Reproduce early authentication rejection with a real streaming HTTP
   server: nonce challenge, expired token with successful refresh, invalid
   refresh grant, and interrupted body. Resolve authentication before sending
   the large body, preserving nonce handling and bounded retries. Do not
   blindly refresh on every network error or treat every priming 401 as expiry.
5. Verify a full PDS blob upload after the fix and separately address the
   Blacksky session requiring reauthentication. Record publication and R2
   fallback alone do not establish PDS audio recovery.
