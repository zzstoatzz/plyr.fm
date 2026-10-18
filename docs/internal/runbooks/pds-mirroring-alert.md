---
title: "PDS mirroring failures"
---

# PDS mirroring failures

Logfire project `waow/plyr-fm`, alert `3660d4c6-064b-40bd-83c0-ad027c5dc0e3`.

The alert reports production blob-upload and portal-save failures. On October
17, 2026, its window was reduced from one hour to 15 minutes, matching its
15-minute frequency with a one-minute watermark. `has_matches` continues to
notify about new events, but adjacent evaluation windows no longer repeatedly
include the same event. Before this change, five failures generated 17 Discord
notifications in 24 hours. The result now includes the trace ID.

An empty evaluation means no matching events in that window, not recovery of
previously affected tracks. Late-arriving telemetry beyond the watermark may
be missed; inspect delivery and ingestion timestamps if an event is absent.

Routing remains the shared `pub-search ingestion alerts (discord)` webhook
and `phi alert watch (push)`. Change the alert's channel assignments to reroute
it; do not disable the shared webhook and affect unrelated alerts.

## Authentication failures during audio streaming

An invalid token can be rejected before a PDS reads the audio body. The HTTP
client may see a connection read error instead of the rejection response.
Retries with the same token then fail identically. The subsequent small record
write can receive a normal 401 and refresh successfully, leaving a published
track whose audio exists only in plyr's storage.

The bodyless nonce probe now forwards explicit `invalid_token`, `InvalidToken`,
and `ExpiredToken` 401 responses to the existing bounded upload refresh loop
before opening the audio stream. Nonce challenges and endpoint scope failures
are not treated as expired tokens. Irrecoverable refresh grants still require
reauthentication; this change does not repair historical tracks automatically.

Regression tests use a real local HTTP server to verify rejection before body
consumption, a successful request with a fresh token, and preservation of nonce
and scope behavior. Existing upload tests cover bounded repeated token refresh.
