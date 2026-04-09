---
title: "album uploads"
---

# album uploads

how multi-track album upload works end-to-end, and why.

## the three-step flow

bulk album uploads go through **three** backend calls, not one:

1. `POST /albums/` — create an empty album shell (title, description). returns `{id, slug}`. no ATProto list record yet; no tracks yet.
2. `POST /albums/{id}/cover` — upload cover art (optional). reuses the pre-existing endpoint from the album edit page.
3. concurrent `POST /tracks/` with the optional `album_id` form field, one per track. each request goes through the full track upload pipeline (PDS blob upload, ATProto track record, R2 storage, transcoder if lossless). per-track toasts surface via SSE.
4. `POST /albums/{id}/finalize` — body `{track_ids: [int]}` in user-intended order. writes the album's ATProto list record **once** with strongRefs in the exact order requested.

single-track uploads do **not** use this flow. they post to `POST /tracks/` with the legacy `album: str` form field and go through `get_or_create_album` + per-track `schedule_album_list_sync`.

## why it's shaped this way

album track order is not stored in the database. it lives in the ATProto list record's `items[]` array on the owner's PDS. the album read path (`backend/src/backend/api/albums.py`) fetches that list record and uses `items[]` as the display order; the album edit page's reorder UI writes directly to the list record via `PUT /lists/{rkey}/reorder` and never touches the DB. **the list record is authoritative for order.**

before this flow existed, the album upload form just fired N concurrent `POST /tracks/` calls with the same `album: str` string. each track's post-upload `schedule_album_list_sync` docket task rebuilt the list record by sorting `Track.album_id == album_id` tracks by `created_at`. under concurrent inserts, `created_at` is effectively random — whichever row the DB commits first wins — so the list record reflected the upload race, not the user's chosen order. this was a regression introduced alongside concurrent album uploads; see #1260 for the fix and #1238 for the regression origin.

the fix does **not** add a DB ordering column. that would fork the source of truth and require ongoing DB↔PDS synchronization. instead, the frontend owns the authoritative order during upload and passes it to the backend at finalize time, which writes the list record once, correctly, in a single operation.

## what happens when

### `POST /albums/` (`backend.api.albums.create_album`)

- creates an `Album` row with `title`, `slug` (derived via `slugify(title)` if not provided), `description`
- emits an `album_release` `CollectionEvent`
- **does not** create any ATProto record — the list record is deferred to `finalize`
- idempotent on `(artist_did, slug)`: if an album with the same slug already exists, returns the existing row (matches `get_or_create_album` semantics)
- returns `AlbumMetadata`; `list_uri` is `null` until finalize runs

### `POST /tracks/` with `album_id` (`backend.api.tracks.uploads.upload_track`)

- mutually exclusive with the legacy `album` form field; passing both → 400
- in `_create_records`:
  - resolves the album row up front, verifies `album.artist_did == ctx.artist_did`
  - sets `ctx.album = album_row.title` so the ATProto track record embeds the correct album title
  - sets `Track.album_id = album_row.id` at row creation (not deferred until post-PDS-success as the legacy path does)
- in `_schedule_post_upload`:
  - **skips** `schedule_album_list_sync` — the frontend will call `finalize` explicitly
  - still invalidates the album cache so the album page reflects the new track when finalize runs
- SSE completion payload adds `atproto_uri` and `atproto_cid` so the frontend can collect strongRefs for the finalize call

### `POST /albums/{id}/finalize` (`backend.api.albums.finalize_album`)

- body: `{"track_ids": [int, ...]}` — the user-intended order
- validates:
  - album exists and belongs to the authenticated artist
  - every requested `track_id` exists (400 with the missing ids otherwise)
  - every track's `album_id` matches the target album (400 with the wrong-album ids otherwise)
  - every track has both `atproto_record_uri` and `atproto_record_cid` set (400 with the pending ids otherwise — this guards against finalize firing before a track's PDS write has committed)
- builds `track_refs: list[{uri, cid}]` in the exact order requested
- calls `upsert_album_list_record(auth_session, album_id, album.title, track_refs, existing_uri=album.atproto_record_uri, existing_created_at=album.created_at)` — idempotent, handles both first-create and updates
- persists the returned `uri` and `cid` onto the `Album` row
- invalidates the album cache
- returns `AlbumMetadata`

finalize is safe to call multiple times — calling it again with a different `track_ids` order just rewrites the list record. this is effectively the same operation as the album-edit-page reorder endpoint (`PUT /lists/{rkey}/reorder`) but addressed by album id instead of list rkey.

## frontend wiring

`frontend/src/lib/components/AlbumUploadForm.svelte` drives the flow:

```
handleUploadAlbum:
  POST /albums/ → {id, slug}
  if coverArtFile:
    POST /albums/{id}/cover (failure is non-fatal, warning toast only)

  indexedResults: Array<UploadResult | null> = tracks.map(() => null)

  Promise.allSettled(
    tracks.map((track, i) =>
      uploader.upload(
        file, title, '',              // empty album string
        features, null,               // no per-track cover
        tags, supportGated, autoTag,
        description,
        (result) => { indexedResults[i] = result },
        { onSuccess, onError },
        track.title,
        albumId                       // new albumId parameter
      )
    )
  )

  orderedTrackIds = indexedResults
    .filter((r): r is UploadResult => r !== null)
    .map(r => r.trackId)

  if (albumId && orderedTrackIds.length > 0)
    POST /albums/{id}/finalize { track_ids: orderedTrackIds }
```

key invariants:
- `indexedResults[i]` holds the result for the track at form position `i` — **not** the completion order. this is how `Promise.allSettled` preserves the user's chosen order across the concurrent race.
- a failed track leaves `indexedResults[i] === null` and is simply omitted from `orderedTrackIds`. successful tracks stay in their relative original positions.
- cover art is uploaded **once** to the album row, not per-track. the old racy flow sent the cover with every track request.
- per-track toasts and concurrent throughput (from #1238) are unchanged — this only replaces the post-upload ordering mechanism.

## partial failure

if some tracks fail during upload:
- successful tracks have the correct `album_id` on their DB row and are included in the finalize call at their original form position
- failed tracks surface as error toasts; `indexedResults[i]` stays `null`
- finalize writes a list record containing only the successful tracks in their relative original order
- gaps in the user's intended sequence are fine — the list record just has the tracks that landed

if **all** tracks fail: the album row still exists (empty). the frontend shows an error toast. GC of empty albums is not implemented — followup work.

if the `POST /albums/` call itself fails: the flow bails with an error toast before any track uploads start.

if the `POST /albums/{id}/cover` call fails: the flow proceeds without the cover; a warning toast points the user to the album edit page to add it later.

if `POST /albums/{id}/finalize` fails (e.g. PDS unreachable): the per-track DB rows are correct, but the list record isn't written. a warning toast tells the user to reorder from the album edit page. a future "resync album" button could re-trigger finalize without requiring a manual reorder.

## legacy single-track upload path (still supported)

`POST /tracks/` with the `album: str` form field (and no `album_id`) takes the original path:

- `get_or_create_album(artist, album_title, image_id, image_url)` creates or finds the album
- cover art is applied to the album on first-create
- `schedule_album_list_sync` is called via docket after the track's PDS write
- `sync_album_list` orders tracks by `Track.created_at` and upserts the list record

this path is still used by:
- the single-track `/upload` page
- any API client posting a single track with `album: str`

the racy ordering problem still exists here in principle, but it's not exercised — the single-track form can't produce concurrent inserts into the same album by construction. if a user uploads multiple singles with the same album name in quick succession via the API, they'd land in `created_at` order (usually what you'd want, but not guaranteed under heavy concurrency).

## references

- PR: #1260 — fix: preserve user-chosen order on album upload
- regression origin: #1238 — concurrent album uploads with per-track toasts
- plan doc: `docs/internal/plans/2026-04-09-album-upload-ordering.md`
- code:
  - `backend/src/backend/api/albums.py` — `create_album`, `finalize_album`, `AlbumFinalizePayload`
  - `backend/src/backend/api/tracks/uploads.py` — `album_id` form field, `UploadContext.album_id`, conditional skip of per-track sync
  - `backend/src/backend/_internal/atproto/records/fm_plyr/list.py` — `upsert_album_list_record`
  - `backend/src/backend/_internal/tasks/sync.py` — `sync_album_list` (legacy path only)
  - `frontend/src/lib/uploader.svelte.ts` — `UploadResult`, `albumId` parameter
  - `frontend/src/lib/components/AlbumUploadForm.svelte` — `handleUploadAlbum`
- tests:
  - `backend/tests/api/test_albums.py` — `test_create_album_endpoint`, `test_finalize_album_writes_list_in_requested_order`, `test_finalize_album_rejects_foreign_tracks`, `test_finalize_album_rejects_tracks_missing_pds_record`
