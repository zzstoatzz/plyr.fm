# publishing access production release

Nate approved production deployment and smoke on September 12 (local time).
The release includes #2047, #2049, #2053, #2054 and #2048, plus commits already
on main for musician-studio. Use the normal full release because backend code
and migration 311b4f106c90 changed.

## migration and blast radius

Before deployment on September 13 UTC, production was at a81c2d9e4f07:
1,017 public tracks, 42 unlisted, four supporter-gated, and three private.
The private tracks use PDS storage. The migration snapshots download defaults,
preserves gate refusals, moves legacy supporter metadata to public visibility
with a separate gate, and leaves native Space authorization intact.

The migration does not copy or delete audio or migrate anything into Spaces.
Formerly public files cannot be recalled. Downgrade deliberately refuses:
repair forward rather than dropping per-work policies or restoring an old app
that expects the removed preferences column. Neon retention is six hours at
preflight; a database restore would also lose subsequent writes and is not a
routine code rollback.

## client and docs

plyr-python-client#42 removes obsolete unlisted write flags and accepts a complete
publishing override across sync/async SDK and CLI. 59 tests and Python 3.10/3.12
CI pass, including current-backend compatibility. Both plyrfm and plyrfm-mcp
were published as v0.0.1-alpha.25 (PyPI 0.0.1a25). A fresh PyPI install
with prereleases enabled loaded both packages and the SDK successfully read
production publishing policies and listed tracks.

Creator, listener, glossary, upload, metadata-editing, developer publishing and
LLM discovery docs are updated. No compatibility translation is added.

## verification

Staging evidence: 19 real uploads, original-file protection, discovery, all five
radio stations, and Nate's separate-account acceptance. Native positive
supporter/Space-member browser coverage remains limited. The private-upload
OAuth CI failure is not a passing end-to-end check; manual staging coverage
is recorded separately. UI follow-ups have 259 passing frontend tests.

## production result

Release `2026.0913.023332` deployed commit `c4596ace`. Backend, production Pages
and docs deployments passed. Both app machines are healthy at version 471;
worker and Jetstream are running (the second worker is the normal standby).
Migration `311b4f106c90` is applied. All 1,066 tracks remain: 1,021 public
(including the four separately gated works), 42 unlisted and three private.
All four supporter works retain their gate, private R2 storage and downloads off.
All three native-private works retain PDS storage and downloads off.

Anonymous production checks on September 13 UTC:
- health, latest feed, monthly top tracks and station listing returned 200;
- public track 1298 streamed in the browser (readyState 4, playback advanced,
  no media error); stream and download redirects returned real audio bytes;
- tracks 425, 798, 799 and 800 remained publicly described but refused anonymous
  streaming with 401 and downloads with 403;
- native-private track detail 1245, 1246 and 1261 returned 404;
- all five radio station responses excluded those seven gated/private tracks;
  firehose was empty, so it has no positive playback coverage in this smoke;
- the homepage rendered “past month” by default;
- the signed-out player menu displayed the sign-in CTA with return-to-track 1298;
- private track 1245 rendered the standard bufo 404 page.

Logfire from 02:36 UTC through the smoke showed expected 401/403/404 refusals
and no HTTP 5xx. This is a short post-release window, not long-term monitoring.

No production upload or artist-policy mutation was performed. The production
API token had expired, and app-password minting is deliberately unavailable
there. Write-path evidence is the completed staging matrix and local checks;
positive supporter/Space-member production access remains untested.

The integration-test tag suppresses upload DMs and copyright scans **only in
staging**. It does not suppress production notifications. Do not create production
smoke uploads on that assumption or change global alerting. Do not use real
artists' works for mutation probes. Previously public copies remain public;
this release does not relocate historical blobs or revoke distributed copies.
