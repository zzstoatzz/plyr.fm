---
title: audio
sidebarTitle: audio
---

# `backend.api.audio`


audio streaming endpoint.

## Functions

### `stream_audio` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/audio.py#L37)

```python
stream_audio(file_id: str, request: Request, session: Session | None = Depends(get_optional_session))
```


stream audio file by redirecting to CDN URL.

for public tracks: redirects to CDN URL.
for gated tracks: validates supporter status and returns presigned URL.

HEAD requests are used for pre-flight auth checks - they return
200/401/402 status without redirecting to avoid CORS issues.

images are served directly via R2 URLs stored in the image_url field,
not through this endpoint.


### `get_audio_url` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/audio.py#L201)

```python
get_audio_url(file_id: str, session: Session | None = Depends(get_optional_session)) -> AudioUrlResponse
```


return direct URL for audio file.

for public tracks: returns CDN URL for offline caching.
for gated tracks: returns presigned URL after supporter validation.

used for offline mode - frontend fetches and caches locally.


## Classes

### `AudioUrlResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/audio.py#L27)


response containing direct R2 URL for offline caching.

