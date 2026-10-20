# Temporary account upload pauses

`backend/_internal/upload_policy.py` owns `PAUSED_UPLOAD_DIDS`, a hardcoded set
of stable account DIDs. It initially contains AddLine. Adding or removing a DID
requires a reviewed backend release; handles and linked accounts do not inherit
another account's pause.

The upload page reads `upload_pause_message` from `/tracks/me/upload-summary`, refreshes it when
opened, and replaces both upload forms with the notice, a private message form, and Nate's optional Bluesky link.
The same message accompanies HTTP 403 responses from the single-request upload,
resumable start/part/finish, and audio replacement endpoints. Stale clients and
developer tokens receive the same server-side refusal. The pause itself sends no notification.

Workers reject previously queued uploads and replacements before processing,
using the normal failed-job cleanup. Copyright scans, embeddings, genre
classification and PDS mirroring check the account before starting new work.
Already-published audio may finish deferred conversion so raw sources such as
AIFF become browser-playable. Cached tag suggestions still work; uncached suggestions do
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

## Private feedback

Paused accounts can POST a message (1–2000 characters after trimming) to
`/tracks/me/upload-feedback`, authenticated by their existing plyr session or
developer token. The endpoint derives identity from that session and refuses
accounts outside the pause list. The existing limiter allows three requests per
hour per session (or token); it is not a global or per-DID quota.

Messages are stored in `upload_feedback` before a best-effort operator DM sends
a preview and the row ID. Notification failure does not discard the message.
There is no public read endpoint, PDS record, or moderation report. Read the full
messages from the environment's database:

```sql
SELECT id, did, handle, message, created_at
FROM upload_feedback
ORDER BY created_at DESC;
```

The form asks for an optional way to reply in the message itself. This is a
private intake form, not an in-app conversation inbox. Failed requests retain
the draft; success means the message is saved, not that a DM was delivered.
