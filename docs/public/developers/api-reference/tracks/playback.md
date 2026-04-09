---
title: playback
sidebarTitle: playback
---

# `backend.api.tracks.playback`


Track detail and playback endpoints.

## Functions

### `get_track_by_uri` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/playback.py#L68)

```python
get_track_by_uri(uri: Annotated[str, Query(description='AT-URI of the track record')], db: Annotated[AsyncSession, Depends(get_db)], session: Session | None = Depends(get_optional_session)) -> TrackResponse
```


Get a track by its ATProto record URI.


### `get_track` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/playback.py#L87)

```python
get_track(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], session: Session | None = Depends(get_optional_session)) -> TrackResponse
```


Get a specific track.


### `increment_play_count` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/playback.py#L106)

```python
increment_play_count(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], session: Session | None = Depends(get_optional_session), body: PlayRequest | None = Body(default=None)) -> PlayCountResponse
```


Increment play count for a track (called after 30 seconds of playback).

If user has teal.fm scrobbling enabled and has the required scopes,
also writes play record to their PDS.

If a ref code is provided, also records a play event for share link tracking.


## Classes

### `PlayRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/playback.py#L34)


optional request body for play endpoint.

