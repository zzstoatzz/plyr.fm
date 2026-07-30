# retrospective: staged-upload cleanup deleted published tracks' audio (2025-11 → 2026-07-30)

## summary

A fleet probe of all 943 discovery-eligible tracks found **twenty serving no
audio**, across seven artists, with breakage dating back to 2025-11. Thirteen
were recovered the same day; seven cannot be recovered from anything plyr
controls.

**One mechanism is proven, and it does not account for all twenty.** See
"what we could not determine" below — this is the correction to the first
version of this document, which asserted a single cause for all of them.

The proven bug: a `file_id` is a content hash
(`hash_file_chunked(file)[:16]`), so re-uploading a file you already published
stages the *exact R2 key your live track is served from*. Phase 3 of the upload
pipeline (`_check_duplicate`) rejects the upload, and the orchestrator's failure
cleanup then deletes "its" staged object — the published track's only copy. The
duplicate path is the one failure mode where the staged object is **guaranteed**
to belong to someone else: you only reach it because a track already owns that
key.

Found on 2026-07-30 when `@fpst.uk`'s tracks were noticed broken **while the
operator was streaming live**.

## timeline (UTC)

| time | event |
|---|---|
| 2025-11-12 | earliest affected track (53, `zzstoatzz.io`) |
| 2026-07-18 15:18:42 | boulyprod uploads `b9deb36a0475b377.wav`; track 1180 created |
| 2026-07-18 15:18:44–53 | `R2 stream_file_data` — it plays |
| 2026-07-18 15:26:56 | same file uploaded again → same content hash, same key |
| 2026-07-18 15:26:57.4 | `attempting R2 delete` `refcount=1` |
| 2026-07-18 15:26:57.6 | `R2 file deleted audio/b9deb36a0475b377.wav` — same trace, `run_track_upload` → `_process_upload_background`. Repeats for 1181, 1186, 1187 that afternoon. |
| 2026-07-30 | reported: "the tracks by this guy also seem broken and are showing in radio", during a live stream |
| 2026-07-30 | fix released (#1733, `2026.0730.064616`); PDS fallback released (#1734); 12 objects restored from PDS blobs + edge cache purged; 20 broken → 8 |

## what we could not determine

Logfire retains ~14 days, so `R2 file deleted` spans only exist from 2026-07-17.
Attribution therefore splits three ways:

| tracks | cause | basis |
|---|---|---|
| 1180, 1181, 1186, 1187 (`boulyprod`, 07-18) | staged-cleanup deletion | **proven** — one trace per track: upload → play → re-upload (same content hash) → `attempting R2 delete refcount=1` → `R2 file deleted` |
| 53 (`zzstoatzz.io`, 2025-11) | **not a deletion** — the object was never in `audio-prod` | **proven** — found intact in `audio-dev`, and the ATProto record still names the old `pub-…r2.dev` URL. Predates `audio-prod` (created 2026-04-18). A bucket-migration gap. |
| 1029–1035 (`fpst.uk`), 930–934 (`flo.by`), 831, 1016, 1136 | **unknown** | outside retention. 831 (2026-03-18) also predates `audio-prod` and may be migration; the rest postdate it and are consistent with the deletion bug, but consistency is not evidence. |

A useful negative result: across the full retention window there were 19
`R2 file deleted` events, and only those 4 hit a row that still referenced the
key. The other 15 were genuine orphans. **The bug is real but fires rarely** —
it needs a re-upload of an already-published file — which is why it took eight
months to be noticed and why a fleet probe found so few.

Two things would have made this answerable and are worth having next time: a
longer retention tier for storage-mutation spans specifically, and recording
*why* an object was deleted (call site + the row that authorized it) rather than
just `file_id` and `key`.

## root causes

### 1. content-addressed keys give bytes no owner (the bug)

`R2Storage.delete()` skipped only at `refcount > 1`. That threshold is correct
for *track deletion* — the track being deleted is itself the one reference — and
wrong for *staged cleanup*, where nothing legitimately references a staged
object, so any reference at all means the bytes are someone else's.

One function answered two different questions. The refcount also counted only
`Track.file_id`, never `original_file_id`, and **never any image column at all**.

### 2. the guard's own regression test could not fail

This class of bug had bitten before — `tests/api/test_track_deletion.py` is
titled "regression tests for banana mix incident", where deleting track 57
removed the R2 file track 56 was using. The refcount guard was that fix. Its
test mocked `R2Storage` *whole* and asserted its own stub returned `False`:

```python
mock_storage.delete = AsyncMock(return_value=False)
result = await storage.delete(file_id)
assert result is False
```

No guard, no query, no threshold. The protection everyone believed in was never
exercised.

### 3. no playback fallback (why it was fatal, not degraded)

Twelve of the twenty had intact audio in the artist's own PDS the entire time.
`GET /audio/{file_id}` gated its PDS branch on `audio_storage == "pds"` exactly,
so a `both` track holding a valid `pds_blob_cid` 404'd anyway. **This is root
cause #2 of the 2026-06-30 retrospective, unchanged.**

### 4. no detection — for the second time

The 2026-06-30 retrospective closed with:

> **open**: nothing alerts on a track whose `r2_url` object is missing... Not
> yet built.

It still wasn't. Missing audio surfaces only as a 404 that is indistinguishable
in logs from a permission denial. Both incidents were found by a human noticing.

## resolution

- **#1733** — `discard_staged()`, which skips at `refcount > 0`; every staged
  cleanup site routes through it. `delete()` keeps `> 1` for its own semantics,
  so the two verbs are now distinct and a new call site has to choose.
- **#1734** — PDS fallback as a last resort before 404, for any track with a
  blob. Declared-storage precedence unchanged.
- **#1735** — the refcount counts *every* media column across `Track`, `Album`
  and `Playlist`, in one query. Images were previously unguarded everywhere;
  upload rollback now discards cover art by the same rule as audio.
- `scripts/restore_r2_from_pds.py` and `scripts/audit_media_integrity.py`.
- `test_refcount_prevents_r2_deletion` rewritten to drive the real guard against
  the real query, mocking only the S3 boundary.

## recovery

**13 of 20 recovered. 20 broken → 7.**

Twelve mirrored tracks (`fpst.uk` ×7, `boulyprod` ×4, `woody.fm` ×1) restored
from PDS blobs: blob fetched from the artist's real PDS (resolved from the DB,
never assumed), `sha256(blob)[:16]` verified to equal the `file_id` for all
twelve — byte-identical to what the artist uploaded — written to `audio-prod`.

Track 53 restored by copying from `audio-dev`, where it had been all along.

Then the cached 404s were purged. **Restoring the object is not enough**: the
"Cache R2 media assets" rule pins a 1-year edge TTL, and after the writes only 2
of 12 served — the rest were edges still replaying the negative response.

Not recoverable by us: 930–934 (`flo.by`), 831 (`jdhitsolutions.com`), 1136
(`bismark.blacksky.app`). For these, no object exists in any of our seven
buckets (searched by `audio/<file_id>` prefix, so any extension), and the
ATProto record carries only an `audioUrl` — **no `audioBlob`**, since these
predate PDS mirroring. Note the distinction: `pds_blob_cid IS NULL` in our DB
only means *we* recorded no blob; the records were checked directly to confirm.

The accurate statement is "we cannot recover these from anything we control,"
not "the audio is gone" — the artists almost certainly still hold their source
files, so the remedy is asking them to re-upload.

Separately: track 930's ATProto record returns `RecordNotFound` on
`eurosky.social` while our row survives. Unrelated to this incident and not yet
investigated.

## prevention / follow-ups

- **shipped**: the three PRs above, this retrospective, and an integrity script
  that answers "does the object each row points at exist".
- **open**: `audit_media_integrity.py` is not scheduled — it needs to run on a
  cron and page, or this becomes a third incident found by a listener.
- **open**: `move_audio()` (the gating toggle) still copy-then-deletes with no
  refcount guard; `prune_revisions` never consults other tracks' `TrackRevision`
  rows; `audio_optimize`'s abort paths still call `delete()` where they mean
  `discard_staged()`.
- **open**: dedup is scoped per-artist (`uploads.py`), so two artists uploading
  identical bytes legitimately share one object. Serving already assumes that;
  deletion should be audited against it everywhere.
- **open**: `audit_media_integrity.py` only checks the bucket a row's key
  implies. Track 53 proves that is too narrow — a legacy object can be sitting
  in `audio-dev`. It should search every bucket before reporting a row missing,
  and there may be other pre-2026-04-18 tracks in the same state that a
  discovery-scoped probe wouldn't surface.
- **open**: instrument *why* an object is deleted (call site, authorizing row),
  and retain storage-mutation spans longer than 14 days. Without both, 15 of
  these 20 tracks are permanently unattributable.
- **note**: the seven unrecoverable tracks belong to three artists who have not
  been told.
