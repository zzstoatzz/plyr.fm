# retrospective: firehose-ingested tracks with a dead audioUrl served no audio (2026-06-23 → 2026-06-30)

## summary

two tracks by `@natespilman.com` — "Right Back To It" (1153) and "Sympathy is a
Knife" (1154) — loaded their track pages fine but played **nothing**: `0 plays`,
scrubber stuck at `0:00`. The records had been authored by a non-plyr ATProto
client and **ingested from the firehose** on **2026-06-23 20:58 UTC**. Each record
carried a well-formed, content-addressed `audio.plyr.fm/audio/<sha256[:16]>.<ext>`
URL **and** a PDS `audioBlob` — but plyr had never written the R2 object, because
plyr never did the upload. Ingest trusted the `audioUrl` by **origin** (it names
our CDN) without checking the bytes existed, so the rows landed as
`audio_storage="both"` with an `r2_url` that `404`d forever, while the playback
path redirects to `r2_url` for `both` tracks with no fallback to the (perfectly
good) PDS blob.

The R2 object was missing from the very first minute — genre classification
`404`d on both URLs at ingest time (**2026-06-23 22:26 UTC**) — but nothing was
watching that signal. The breakage surfaced **6 days later** when `@iame.li`
reported it on bsky ("404ing… looks okay on the PDS tho") on **2026-06-30**. Both
tracks were recovered the same day (R2 objects restored from the intact PDS
blobs, hash-verified) and the root cause fixed and released to production
(`2026.0630.055544`, PR #1616).

**Blast radius: isolated.** A fleet scan for the create-from-scratch signature
(non-hash `file_id` + an `r2_url`) found **exactly these two tracks** — one
external publish to one artist's PDS. Every other `r2_url` track has a content-
hash `file_id` from plyr's own upload path, which actually writes the object.

## timeline (UTC)

| time | event |
|------|-------|
| 2026-06-23 20:58:28 / 20:58:38 | tracks 1153 / 1154 created from the firehose (`jetstream dispatched track.create` → `ingest: track created`). records carry an `audio.plyr.fm` content-addressed audioUrl + an audioBlob; `file_id` = the record rkey (not a content hash). no R2 write ever happens. |
| 2026-06-23 22:26:46 | deferred genre classification fails: `404 … audio.plyr.fm/audio/7b9a5381d4341813.mp3` and `…/98665f6728c87c86.wav`. **first hard evidence the R2 objects never existed.** unwatched. |
| 2026-06-29 ~22:35 CDT | `@iame.li` reports on bsky that `plyr.fm/track/1153` 404s "but looks okay on the PDS." |
| 2026-06-30 | investigation: backend `/audio/{file_id}` returns `307` → the dead R2 URL (origin `404`, cache MISS — never written). artist's real PDS (`oyster…bsky.network`, resolved from the DB, **not** assumed) serves the blob `200`; `sha256(blob)[:16]` matches the key in `r2_url` for both tracks — byte-identical to what should have been in R2. |
| 2026-06-30 | recovery: restored both R2 objects from the PDS blobs, purged the cached `404` at the edge, stamped the `pds_blob_size` the ingest path had left `NULL`. both tracks serve `206`. |
| 2026-06-30 | fix (PR #1616) merged and released to production (`2026.0630.055544`). |

## root causes

### 1. origin trust is not existence (the bug)

`ingest_track_create`'s create-from-scratch branch
(`backend/src/backend/_internal/tasks/ingest.py`) accepted the record's
`audioUrl` after only an **origin** check (`tasks/origin_trust.py` →
`audio.plyr.fm` is ours). But a foreign client can mint a well-formed,
content-addressed URL on our CDN with **no object behind it** (the rkey-style
`file_id` and `pds_blob_size IS NULL` are the tells that these bypassed plyr's
own `R2.save()` path). Ingest set `audio_storage="both"` + `r2_url=<dead url>`
without verifying the bytes existed — even though a usable `audioBlob` was in the
same record.

### 2. no playback fallback (why it was a hard failure, not a degraded one)

`GET /audio/{file_id}` (`backend/src/backend/api/audio.py`) redirects `both`
tracks to `r2_url` unconditionally, with no fallback to the PDS blob when R2 is
missing. So a dead `r2_url` is a hard `404` on playback instead of self-healing
to the blob that was sitting right there. See `backend/audio-streaming.md`.

### 3. silent detection gap

The R2 objects `404`d at ingest time (genre classification, 2026-06-23 22:26),
but that failure isn't alerted on, so the only signal that ever escalated was a
user report 6 days later.

## resolution

PR #1616 added an existence check to the create-from-scratch branch: after the
origin check, `HEAD` the R2 object the `audioUrl` points at
(`_audio_object_exists`). If it's absent, drop the URL and fall back to the PDS
blob (`audio_storage="pds"`), or skip the record when there's no blob. The check
runs **only** for foreign records — plyr's own uploads finalize a pending row and
never reach it — so there's no added cost on the normal path. Regression tests in
`backend/tests/test_jetstream.py`.

The two affected tracks were recovered out-of-band (the source audio was safe in
the artist's PDS the whole time; only plyr's R2 cache copy was missing).

## prevention / follow-ups

- **shipped**: the ingest existence check (#1616); this retrospective;
  `architecture/jetstream-ingest.md` and `backend/audio-streaming.md`, which
  document the create-from-scratch path and the "R2 wins, no fallback" playback
  precedence that made this confusing.
- **fixed the diagnosis trap**: `_internal/CLAUDE.md` no longer claims `file_id`
  is always `sha256[:16]` — a non-hash `file_id` now correctly signals a
  firehose-originated track.
- **open**: nothing alerts on a track whose `r2_url` object is missing (root
  cause #3). A periodic audit of `both` rows with `pds_blob_size IS NULL`, or an
  alert on post-ingest `404`s from genre classification, would have caught this
  in minutes instead of days. Not yet built.
