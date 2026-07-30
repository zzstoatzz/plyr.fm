---
title: "jetstream ingest — firehose → database"
---

how records authored on a PDS (by plyr.fm itself or by any other ATProto client)
become rows in plyr's index. the consumer is `backend/src/backend/_internal/
jetstream.py`; the per-record tasks live in `backend/src/backend/_internal/tasks/
ingest.py`.

## the path

1. `JetstreamConsumer` holds a websocket to the jetstream firehose, filtered to
   the `fm.plyr.*` collections and the set of known artist DIDs.
2. for each commit/identity/account event it dispatches a docket task —
   `ingest_track_create` / `_update` / `_delete`, the like/comment/list
   equivalents, and `ingest_identity_update` / `ingest_account_status_change`.
3. each task resolves the event into the DB. create and delete are **idempotent**
   by AT-URI or unique constraint. update cannot be — applying a record twice is
   only safe if the second copy is not *older*, so track updates are ordered by
   commit `rev` (see "re-delivery" below).

the consumer runs in its **own fly process group** (not the docket worker loop) —
it was starving as a worker task. see `runbooks/worker-silence-alert.md` and the
`#identity` notes in `tasks/ingest.py`.

## two ways a track row is born

`ingest_track_create` has two distinct branches, and they behave very
differently:

### A. finalize a pending row (plyr's own uploads)

When a user uploads through plyr, the upload path **reserves** a DB row
(`publish_state="pending"`) and then writes the `fm.plyr.track` record to the
PDS. The firehose echoes that record back; ingest finds the existing row by URI
and just **finalizes** it — sets the record CID, flips `publish_state` to
`"published"`, and fires the post-create hooks. The audio bytes were already
written to R2 by the upload path, and `file_id` is the **content hash**
(`sha256[:16]`).

### B. create from scratch (foreign clients)

When **no** pending row exists, the record came from some other ATProto client
writing `fm.plyr.track` directly to a PDS. Ingest builds the row from the record
alone. Two consequences worth knowing:

- `file_id = record.get("fileId", rkey)` — foreign records rarely carry a
  `fileId`, so the `file_id` is the **record rkey** (a TID), *not* a content
  hash. A non-hash `file_id` is the tell that a track came in this way.
- plyr never wrote any audio to R2 for this track. The bytes are wherever the
  record says — a PDS `audioBlob`, an `audioUrl`, or both.

### storage-mode derivation (branch B)

From the record's `audioBlob` / `audioUrl`, ingest derives `audio_storage`:

| record has | `audio_storage` | `r2_url` | `pds_blob_cid` |
|------------|-----------------|----------|----------------|
| blob + url | `both` | the url | blob ref |
| blob only | `pds` | `None` | blob ref |
| url only | `r2` | the url | `None` |
| neither | (rejected — nothing playable) | | |

`pds_blob_size` is **not** set on this path (only the upload path records it).

## trust: origin is not existence

A record's `audioUrl` is attacker/foreign-controlled, so it passes two gates
before it's persisted:

1. **origin trust** (`tasks/origin_trust.py`) — the URL must be on a trusted
   origin (currently only plyr's own R2 CDN; the BYOS hook for per-artist
   registered origins is stubbed). An untrusted URL is stripped (fall back to
   the blob) or, with no blob, the record is rejected.
2. **existence** (`_audio_object_exists`, added #1616) — origin trust only says
   the URL *names* our CDN, not that the bytes are there. A foreign client can
   mint a well-formed, content-addressed `audio.plyr.fm/audio/<sha256[:16]>.<ext>`
   URL with **no object behind it** (or an interrupted write can leave one). So
   we `HEAD` the object; if it's absent we drop the URL and fall back to the PDS
   blob (the real substrate), or skip the record when there's no blob. This runs
   only in branch B — plyr's own uploads (branch A) never reach it, so there's
   no added cost on the normal path.

This is the fix for the 2026-06-30 dead-audioUrl incident; without it a foreign
record landed as `audio_storage="both"` with an `r2_url` that `404`d forever on
playback. See the retrospective and `backend/audio-streaming.md`.

> `ingest_track_update` strips an untrusted `audioUrl` but (unlike create) never
> rejects the whole update. It **does** run the existence check, as of #1736 —
> the earlier reasoning ("an update can only mutate an already-ingested track")
> was wrong, because an already-ingested track is exactly what a stale URL
> corrupts.

## re-delivery: the firehose does not promise order

The firehose offers no ordering or exactly-once guarantee. A repo can re-emit its
commit history, and jetstream's `time_us` is stamped **on receipt**, so it cannot
distinguish a replay from a fresh write.

`ingest_track_update` therefore orders commits by the repo `rev` on the commit
(a TID: monotonic per repo, lexicographically sortable, and authored by the PDS
so it survives re-delivery). The last applied rev is stored on
`tracks.atproto_record_rev`; an update at or below it is refused and logged as
`ingest: skipping superseded track commit`.

Two properties worth knowing:

- **No baseline means no ordering.** A row whose `atproto_record_rev` is `NULL`
  accepts the next update unconditionally and records its rev. Applying-and-learning
  beats rejecting, which would silently drop legitimate edits from clients.
- **Only the track path is guarded.** `ingest_comment_update` and
  `ingest_list_update` remain last-writer-wins. Track was fixed first because it
  is the one that can strand audio bytes.

This is the fix for the 2026-07-30 replay incident, where a re-emitted repo
history walked one track's `r2_url` back to a 19-minute-old revision and another's
title back by an hour, while both PDS records were correct throughout.

## other guards

- **future-timestamp**: a record whose `createdAt` is beyond `_MAX_CLOCK_SKEW`
  (5 min) is skipped.
- **tombstones**: a deleted URI is tombstoned in Redis for 5 min so a cursor
  rewind can't resurrect a just-deleted record as a ghost. plyr always mints
  fresh TID rkeys, so a legitimate same-URI re-create never happens.
- **unknown artist**: events for a DID with no `Artist` row are skipped.
