# Temporary account upload pauses

`backend/_internal/upload_policy.py` owns `PAUSED_UPLOAD_DIDS`, a hardcoded set
of stable account DIDs. It initially contains AddLine. Adding or removing a DID
requires a reviewed backend release; handles and linked accounts do not inherit
another account's pause.

The upload page reads `upload_pause_message` from `/tracks/me/upload-summary`, refreshes it when
opened, and replaces both upload forms with the notice and Nate's Bluesky link.
The same message accompanies HTTP 403 responses from the single-request upload,
resumable start/part/finish, and audio replacement endpoints. Stale clients and
developer tokens receive the same server-side refusal. No notification is sent.

Workers reject previously queued uploads and replacements before processing,
using the normal failed-job cleanup. Copyright scans, embeddings, genre
classification, PDS mirroring and deferred optimization check the account before
starting new work. Cached tag suggestions still work; uncached suggestions do
not start inference for paused artists. Calls already running when an old
process is replaced cannot be recalled.

External track creates are ignored while paused. Updates can still change
metadata and listening access, but cannot replace indexed audio or its duration.
Deletes still work. Existing tracks, playback, account access, metadata editing,
and existing-track management remain available. This is a cost control, not a
copyright decision or a takedown.

Removing a DID allows subsequent uploads and processing. It does not replay
ignored firehose events, restart failed upload jobs, or backfill skipped scans.
Any such recovery needs a deliberate, separately scoped operation.

The notice's wording requires Nate's approval before production promotion.
Staging and production use the same hardcoded set; production changes only on
an approved release.
