---
title: mutations
sidebarTitle: mutations
---

# `backend.api.tracks.mutations`


Track mutation endpoints (delete/update/restore).

## Functions

### `delete_track` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L53)

```python
delete_track(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> MessageResponse
```


Delete a track (only by owner).


### `update_track_metadata` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L151)

```python
update_track_metadata(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth), title: Annotated[str | None, Form()] = None, album: Annotated[str | None, Form()] = None, features: Annotated[str | None, Form()] = None, tags: Annotated[str | None, Form(description='JSON array of tag names')] = None, description: Annotated[str | None, Form(description='Track description (liner notes, show notes), or empty string to remove')] = None, support_gate: Annotated[str | None, Form(description="JSON object for supporter gating, or 'null' to remove")] = None, image: UploadFile | None = File(None), remove_image: Annotated[str | None, Form(description="Set to 'true' to remove artwork")] = None) -> TrackResponse
```


Update track metadata (only by owner).


### `restore_track_record` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L492)

```python
restore_track_record(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> RestoreRecordResponse
```


Restore ATProto record for a track with a missing record.

Handles two cases:
1. If the track has a record in the old namespace, respond with 409
   (`migration_needed`).
2. If no record exists, recreate one using a TID derived from
   `track.created_at` and return the updated track data on success.


### `migrate_track_to_pds` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L612)

```python
migrate_track_to_pds(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> MigrateToPdsResponse
```


migrate an existing track's audio to the user's PDS.

this uploads the audio blob to the user's PDS and updates the ATProto record
to reference it. the R2 copy is kept for CDN streaming performance.

requires:
- active OAuth session (user must be logged in)
- track must belong to the authenticated user
- track must not already have a PDS blob

note: this may fail if the audio file is too large for the PDS blob limit.


## Classes

### `RestoreRecordResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L416)


Response for restore record endpoint.


### `MigrateToPdsResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/mutations.py#L602)


response for PDS migration endpoint.

