---
title: now_playing
sidebarTitle: now_playing
---

# `backend.api.now_playing`


now playing API endpoints for external scrobbler integrations.

exposes real-time playback state for services like teal.fm/Piper.

note: POST/DELETE are rate-limited server-side as a safety net.
the frontend also throttles client-side (10-second intervals).
GET endpoints for Piper are exempt since they're read-only.


## Functions

### `update_now_playing` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L69)

```python
update_now_playing(request: Request, update: NowPlayingUpdate, session: Session = Depends(require_auth)) -> StatusResponse
```


update now playing state (authenticated).

called by frontend to report current playback state.
state expires after 5 minutes of no updates.


### `clear_now_playing` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L100)

```python
clear_now_playing(request: Request, session: Session = Depends(require_auth)) -> StatusResponse
```


clear now playing state (authenticated).

called when user explicitly stops playback.


### `get_now_playing_by_handle` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L114)

```python
get_now_playing_by_handle(handle: str, response: Response, db: Annotated[AsyncSession, Depends(get_db)]) -> NowPlayingResponse
```


get now playing state by handle (public).

this is the endpoint Piper will poll to fetch current playback state.
returns 204 No Content if nothing is playing.

response format matches what Piper expects from music sources:
- track_name: track title
- artist_name: artist display name
- album_name: album name (optional)
- duration_ms: total duration in milliseconds
- progress_ms: current playback position in milliseconds
- is_playing: whether actively playing
- track_url: link to track on plyr.fm
- service_base_url: "plyr.fm" for Piper to identify the source


### `get_now_playing_by_did` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L166)

```python
get_now_playing_by_did(did: str, response: Response) -> NowPlayingResponse
```


get now playing state by DID (public).

alternative to by-handle for clients that already have the DID.
returns 204 No Content if nothing is playing.


## Classes

### `NowPlayingUpdate` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L26)


request to update now playing state.


### `NowPlayingResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/now_playing.py#L40)


now playing state response.

designed to be compatible with teal.fm/Piper expectations.
matches the fields Piper expects from music sources like Spotify.

