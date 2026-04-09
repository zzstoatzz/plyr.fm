---
title: "plan: fix album upload ordering"
date: 2026-04-09
---

# plan: fix album upload ordering

## goal

when a user uploads an album via the album upload form, the resulting album should display its tracks in the order the user arranged them in the form. today it doesn't — tracks appear in a non-deterministic order because the underlying atproto list record is built from `Track.created_at`, and `created_at` reflects the race winners of concurrent uploads (introduced by #1238).

## current state

### upload path
- `AlbumUploadForm.svelte:232-295` fires N concurrent `POST /tracks/` calls via `Promise.allSettled`
- each request carries `album: str` (the display name) and the cover art file
- backend `get_or_create_album()` (`tracks/services.py:11`) creates the `Album` row on whichever track commits first; cover art is applied to that first-wins row
- after each track's upload pipeline finishes, `schedule_album_list_sync` (`uploads.py:843`) schedules a docket task that rebuilds the album's atproto list record from DB state
- `sync_album_list` (`_internal/tasks/sync.py:128`) sorts tracks by `Track.created_at` (line 171) and calls `upsert_album_list_record`

### read path
- `albums.py:349-375` fetches the album's atproto list record from the owner's PDS and uses `items[]` as track order
- only when the fetch fails or `list_uri` is None does it fall back to `Track.created_at`

### reorder path (album edit page)
- `+page.svelte:255-291` — user drags → frontend builds `items: [{uri, cid}]` from current order → `PUT /lists/{rkey}/reorder` → backend calls `update_list_record` directly on the PDS
- DB is never written to; the next album read refetches the list record and sees the new order
- `canReorder` is gated on `albumMetadata.list_uri` being set — you can't reorder an album whose list record doesn't exist yet on the PDS

### the problem

the list record is the source of truth for order, but the `sync_album_list` task that builds it is inherently racy under concurrent uploads. each task reads whichever subset of tracks has committed so far, sorts by `created_at`, and upserts the list record. whichever task fires last wins, and `created_at` is effectively random under concurrency.

### what's not the problem

the DB is an index; the atproto list record is the truth. this plan does **not** introduce a parallel ordering column in the DB. fixing this by adding `track_number` to `Track` would fork the truth and require ongoing sync between DB and PDS. the correct fix is to ensure the list record is written with the user-intended order in a single operation, not rebuilt per-track via racing background tasks.

## approach

1. albums become first-class: add `POST /albums/` so the album row exists **before** any track uploads start. tracks reference `album_id` explicitly instead of racing on `get_or_create_album`.
2. reuse the existing `POST /albums/{id}/cover` endpoint for cover art upload (already used from the album edit page).
3. extend `POST /tracks/` with an optional `album_id` form field. when provided: skip `get_or_create_album`, skip cover art, skip per-track `schedule_album_list_sync`. the track still goes through the full upload pipeline (PDS write, CID capture, etc.).
4. surface the PDS strongRef (`atproto_record_uri`, `atproto_record_cid`) in the SSE completion payload so the frontend can collect strongRefs for the finalize call.
5. add `POST /albums/{id}/finalize` that accepts an ordered `track_ids` array, builds strongRefs in that exact order, and writes the atproto list record **once**.
6. update `AlbumUploadForm.svelte` to drive the new flow: create album → upload cover → concurrent track uploads with `album_id` → collect strongRefs on completion → call finalize → redirect.

no schema migration. no new DB column. the frontend owns the authoritative order during upload and hands it to the backend at finalize time.

## not doing

- adding `track_number` or any ordering column to the `Track` model
- touching the existing reorder endpoint (`PUT /lists/{rkey}/reorder`) — it already works correctly as designed
- stripping the legacy `album: str` form field from `POST /tracks/` — the single-track `/upload` page still uses it, and it's fine for single uploads where there's no ordering question
- retry-failed-tracks UX — out of scope; failed tracks in an album upload just surface as error toasts, user can re-upload them via the existing add-to-album flow later
- garbage-collecting empty albums created via the new endpoint that never receive tracks — worth tracking but out of scope
- touching playlists — same list pattern, different UX, different PR
- debouncing per-track `sync_album_list` on the legacy path — still racy there, accepted as a pre-existing issue documented as such in the PR

## phases

### phase 1: backend — first-class album creation

**changes**:
- `backend/src/backend/api/albums.py` — new `POST /albums/` endpoint
  - JSON body `CreateAlbumRequest { title: str, description: str | None = None }`
  - creates `Album` row (no tracks, no cover, no atproto list record)
  - emits `CollectionEvent(event_type="album_release", actor_did=..., album_id=...)` on creation (matches the existing post-track-upload flow at `uploads.py:794`)
  - returns `AlbumMetadata` (same response model as `PATCH /albums/{id}`)
  - uses `slugify(title)` + the existing `uq_albums_artist_slug` unique constraint; on `IntegrityError`, returns the existing album row (same pattern as `get_or_create_album`)
- `backend/src/backend/api/albums.py` — `CreateAlbumRequest` Pydantic model at module top

**success criteria**:
- [ ] `just backend test` passes
- [ ] new test `test_create_album_endpoint` covers: success, duplicate title returns existing, auth required, artist-profile required
- [ ] creating an album via `POST /albums/` then `GET /albums/me` returns it

### phase 2: backend — `album_id` on track upload

**changes**:
- `backend/src/backend/api/tracks/uploads.py`:
  - add `album_id: Annotated[str | None, Form()] = None` to `upload_track` parameters
  - add `album_id: str | None = None` to `UploadContext` dataclass
  - in the background pipeline, when `ctx.album_id` is set:
    - skip `get_or_create_album` entirely
    - look up the album row directly by id; raise `UploadPhaseError` if missing or not owned by the artist
    - skip image processing in `_store_image` (`ctx.image_path` will be None from the frontend anyway, but defense-in-depth: if both are somehow set, ignore the track image)
    - derive `ctx.album` (the display name string, used by `build_track_record` for the ATProto track record) from the fetched album's title
    - still run the full PDS write pipeline
    - set `Track.album_id` directly in the atomic publish update
    - **skip** the `schedule_album_list_sync` call in `_schedule_post_upload` (the frontend will call finalize explicitly)
  - request validation: if both `album` (legacy string) and `album_id` are provided, return 400
- `backend/src/backend/api/tracks/uploads.py:905` — extend the result dict in `_process_upload_background`:
  ```python
  result: dict[str, Any] = {
      "track_id": track.id,
      "atproto_uri": track.atproto_record_uri,
      "atproto_cid": track.atproto_record_cid,
  }
  ```

**success criteria**:
- [ ] existing tests (`just backend test`) still pass
- [ ] new test: `POST /tracks/` with `album_id` for an album not owned by the caller → 403/404 surfaced via SSE failure
- [ ] new test: `POST /tracks/` with both `album` and `album_id` → 400
- [ ] new test: `POST /tracks/` with valid `album_id` succeeds, track row has `album_id` set, no per-track sync task was scheduled (verify via mock)
- [ ] SSE completion event includes `atproto_uri` and `atproto_cid`

### phase 3: backend — album finalize endpoint

**changes**:
- `backend/src/backend/api/albums.py` — new `POST /albums/{album_id}/finalize` endpoint
  - JSON body `FinalizeAlbumRequest { track_ids: list[int] }`
  - verify album exists and belongs to authenticated artist
  - fetch all referenced tracks in a single query; verify:
    - every requested id exists
    - every track has `album_id == album_id`
    - every track has `atproto_record_uri` and `atproto_record_cid`
    - any mismatch → 400 with a specific error naming the offending track ids
  - build `track_refs = [{"uri": t.atproto_record_uri, "cid": t.atproto_record_cid} for t in tracks_in_requested_order]`
  - call `upsert_album_list_record(auth_session, album_id, album.title, track_refs, existing_uri=album.atproto_record_uri, existing_created_at=album.created_at)`
  - persist the returned uri/cid onto the album row
  - invalidate album cache (`invalidate_album_cache`)
  - return `AlbumMetadata`
  - idempotent — safe to call multiple times

**success criteria**:
- [ ] `just backend test` passes
- [ ] new test: finalize with valid ordered track_ids → list record written in that order, album has `atproto_record_uri` set
- [ ] new test: finalize with track_id not belonging to album → 400
- [ ] new test: finalize with track missing `atproto_record_uri` → 400 (race where upload didn't complete PDS write)
- [ ] new test: finalize twice with different orders → second call updates the list record to the new order
- [ ] new test: auth required, artist-profile required, not-owner → 403

### phase 4: frontend — uploader result plumbing

**changes**:
- `frontend/src/lib/uploader.svelte.ts`:
  - extend `UploadProgressCallback.onSuccess` signature to accept an optional result object: `onSuccess?: (result: { trackId: number; atprotoUri: string | null; atprotoCid: string | null }) => void` — keep backward compat by making it optional and passing undefined-safe values
  - actually — the current `onSuccess` callback is the XHR-upload-completed callback (line 148), fires as soon as the POST responds with `upload_id`. we need a **separate** signal for the SSE `completed` event (line 184), which is where the full result arrives. rename the SSE-completion hook from the current `onSuccess` function-arg (line 75) to something clearer, or add a new `onComplete` callback. the current `onSuccess` function-arg at line 75 is what the album form uses to get notified of completion.
  - **concrete change**: extend the `onSuccess?: () => void` function-arg at line 75 to `onSuccess?: (result?: { trackId: number; atprotoUri: string | null; atprotoCid: string | null }) => void` and pass the result object at line 203 when invoking it. the XHR-load `callbacks.onSuccess` at line 149 is unchanged (it only wants `upload_id`). existing callsites that ignore the arg keep working.
  - read `update.atproto_uri` and `update.atproto_cid` from the SSE completion payload; pass them to `onSuccess`
- `frontend/src/routes/upload/+page.svelte` — no change needed (doesn't use the result)
- `frontend/src/routes/record/+page.svelte` — no change needed

**success criteria**:
- [ ] `just frontend check` — 0 errors, 0 warnings
- [ ] record page, single-track upload, album upload: all still complete without regressions

### phase 5: frontend — album form uses the new flow

**changes**:
- `frontend/src/lib/components/AlbumUploadForm.svelte`:
  - replace `handleUploadAlbum` (lines 232-295):
    1. `POST /albums/` with `{ title, description }` → capture `{ id, slug }`; if this fails, bail early with a single error toast ("failed to create album")
    2. if `coverArtFile`, `POST /albums/{id}/cover` with the image; failure is a warning toast but does not block (same forgiveness as the current flow, where cover art is applied on first-track-commits)
    3. build a map `track index → upload result` to preserve the user-intended order across `Promise.allSettled`
    4. for each track at index `i`, call `uploader.upload(...)` but pass:
       - `album: ''` (empty — new flow uses album_id)
       - `coverArtFile: null` (no per-track cover)
       - a new form field `album_id` — requires a small extension to `uploader.upload` to accept `albumId?: string` and append `album_id` to the FormData when set
       - `onSuccess: (result) => { indexedResults[i] = result; tracks[i] = { ...tracks[i], status: 'completed' } }`
    5. `Promise.allSettled` on the per-track promise wrappers (existing timeout/retry machinery kept)
    6. after all settle, collect `orderedTrackIds = indexedResults.filter(r => r?.trackId).map(r => r!.trackId)` — preserves form-index order
    7. if `orderedTrackIds.length > 0`, `POST /albums/{id}/finalize` with `{ track_ids: orderedTrackIds }`; on failure surface a warning toast ("tracks uploaded but failed to save order — reorder from the album page")
    8. final summary toast (same phrasing as today), redirect to `/u/{handle}/album/{slug}` if any track succeeded
- `frontend/src/lib/uploader.svelte.ts` — extend `upload` signature to accept `albumId?: string` as a new named parameter; append to FormData as `album_id` when present. existing callsites unchanged.

**success criteria**:
- [ ] `just frontend check` — 0 errors, 0 warnings
- [ ] manual test: upload a 5-track album via the form, verify tracks appear in chosen order on the album page
- [ ] manual test: upload, drag one track to a new position in the form before submitting, verify the displayed order matches
- [ ] manual test: partial failure (force-fail one track via oversized file or invalid format) — remaining tracks land in correct relative order, failed track shows error toast
- [ ] manual test: album upload with no cover art still succeeds
- [ ] per-track toasts still fire with track titles and succeed/fail messages (no regression from #1238)
- [ ] single-track `/upload` page still works (untouched code path)
- [ ] `/record` page still works (untouched code path)

### phase 6: regression tests

**changes**:
- `backend/tests/api/test_albums.py` (or wherever album tests live) — add integration test that exercises the full new flow: create album → upload N tracks with `album_id` in scrambled relative `created_at` order → finalize with explicit order → fetch album → assert the returned track order matches the finalize order, not the `created_at` order
- `frontend` — if there are existing album-upload integration tests, update them for the new flow; otherwise leave manual test plan above

**success criteria**:
- [ ] backend integration test asserts finalize-order-beats-created_at-order
- [ ] `just backend test` all green
- [ ] `just frontend check` clean

## testing

### core scenarios
- **happy path**: 5-track album in form order A B C D E → uploaded album displays A B C D E
- **scrambled creation order**: intentionally make track C commit first (e.g. smallest file) → displayed order still A B C D E
- **partial failure**: track C fails during upload → displayed order is A B D E
- **cover art**: uploaded once via `/cover` endpoint; appears on the album row
- **idempotent finalize**: call finalize twice with different orders; the second call wins
- **reorder-after-upload**: upload album → go to album edit → drag tracks → save; existing reorder flow still works unchanged (sanity regression)

### edge cases
- all tracks fail → no finalize call, album row still exists (empty); user sees errors; garbage collection of empty albums is out of scope
- album creation succeeds but cover upload fails → warning toast, upload proceeds
- finalize is called but one of the tracks hasn't yet finished its PDS write (race) → 400, frontend retries finalize once on 400-missing-uri, then surfaces a warning toast if still failing
- user navigates away mid-upload → existing upload singleton behavior unchanged; toasts persist, SSE keeps firing, finalize won't be called because the form component unmounts — acceptable edge, the existing resync-from-album-edit button is future work but the user can just reorder manually
- legacy `album: str` upload from single-track `/upload` page — unchanged behavior

## open risks / followups

- **finalize retry on race**: if a track's SSE `completed` event arrives but the track row's `atproto_record_uri` hasn't been committed yet (unlikely — `_create_records` commits before the completion signal), finalize would 400. the spec says SSE completed is fired after the atomic publish update, so this shouldn't happen in practice, but worth a single-retry with 500ms backoff in the frontend finalize call.
- **empty album GC**: creating an album then closing the tab leaves an empty album row. not a regression (today's flow also leaves the album if the first track fails after `get_or_create_album` runs), but worth tracking as a followup issue.
- **legacy path still racy**: the single-track `/upload` form with an `album: str` value that collides with an existing album still hits `schedule_album_list_sync`. not regressed by this PR but worth documenting.

## rollout

- single PR, single merge, no feature flag
- the change is a pure fix: the old album upload path is broken (tracks unordered), the new path works. no user is relying on the broken ordering.
- backend is backward compatible: legacy `album: str` path is untouched. old clients (none in the wild — this is a web app) would continue to work.
