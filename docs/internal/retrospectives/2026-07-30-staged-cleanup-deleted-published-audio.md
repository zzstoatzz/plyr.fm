# retrospective: staged-upload cleanup deleted published tracks' audio (2025-11 → 2026-07-30)

## summary

Twenty tracks across seven artists served no audio. The R2 objects had existed
and been played — every affected track has `play_count >= 1`, and track 53 had
59 plays and a like — and were then **deleted by plyr itself**.

A `file_id` is a content hash (`hash_file_chunked(file)[:16]`). So re-uploading a
file you already published stages the *exact R2 key your live track is served
from*. Phase 3 of the upload pipeline (`_check_duplicate`) rejects the upload,
and the orchestrator's failure cleanup then deletes "its" staged object — which
is the published track's only copy.

The duplicate path is the one failure mode where the staged object is
**guaranteed** to belong to someone else: you only reach it because a track
already owns that key.

Found on 2026-07-30 when `@fpst.uk`'s tracks were noticed broken **while the
operator was streaming live**. Twelve tracks were recovered the same day from
the artists' PDS blobs (hash-verified byte-identical); eight had no PDS copy and
are unrecoverable.

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

All 12 mirrored tracks restored: blob fetched from the artist's real PDS
(resolved from the DB, never assumed), `sha256(blob)[:16]` verified to equal the
`file_id` for all 12, written to `audio-prod`, then the cached 404s purged —
**restoring the object is not enough**, since the "Cache R2 media assets" rule
pins a 1-year edge TTL and some edges kept serving the negative response.

Unrecoverable (no PDS copy, `audio_storage="r2"`): 930–934 (`flo.by`), 1136
(`bismark.blacksky.app`), 831 (`jdhitsolutions.com`), 53 (`zzstoatzz.io`).

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
- **note**: the eight unrecoverable tracks belong to four artists who have not
  been told.
