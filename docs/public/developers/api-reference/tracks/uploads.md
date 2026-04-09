---
title: uploads
sidebarTitle: uploads
---

# `backend.api.tracks.uploads`


Track upload endpoints and background processing.

## Functions

### `upload_track` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L973)

```python
upload_track(request: Request, title: Annotated[str, Form()], background_tasks: BackgroundTasks, auth_session: AuthSession = Depends(require_artist_profile), album: Annotated[str | None, Form()] = None, album_id: Annotated[str | None, Form(description='explicit album id to attach to (mutually exclusive with album)')] = None, features: Annotated[str | None, Form()] = None, tags: Annotated[str | None, Form(description='JSON array of tag names')] = None, support_gate: Annotated[str | None, Form(description='JSON object for supporter gating, e.g., {"type": "any"}')] = None, description: Annotated[str | None, Form(description='Track description (liner notes, show notes, etc.)')] = None, auto_tag: Annotated[str | None, Form(description='auto-apply recommended genre tags after classification')] = None, file: UploadFile = File(...), image: UploadFile | None = File(None)) -> UploadStartResponse
```


Upload a new track (requires authentication and artist profile).

**Args:**
- `title`: Track title (required).
- `album`: Optional album name/ID to associate with the track.
- `features`: Optional JSON array of ATProto handles, e.g.,
["user1.bsky.social", "user2.bsky.social"].
- `support_gate`: Optional JSON object for supporter gating.
Requires atprotofans to be enabled in settings.
Example\: {"type"\: "any"} - requires any atprotofans support.
- `file`: Audio file to upload (required).
- `image`: Optional image file for track artwork.
- `background_tasks`: FastAPI background-task runner.
- `auth_session`: Authenticated artist session (dependency-injected).

**Returns:**
- A payload containing `upload_id` for monitoring progress via SSE.


### `upload_progress` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L1162)

```python
upload_progress(upload_id: str) -> StreamingResponse
```


SSE endpoint for real-time upload progress.


## Classes

### `UploadStartResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L65)


response when upload is queued for processing.


### `UploadContext` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L74)


all data needed to process an upload in the background.


### `AudioInfo` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L108)


result of audio validation phase.


### `StorageResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L117)


result of audio storage phase.


### `UploadPhaseError` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L128)


raised when an upload phase fails with a user-facing message.


### `TranscodeInfo` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L228)


result of transcoding an audio file.


### `PdsBlobResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py#L239)


result of attempting to upload a blob to user's PDS.

