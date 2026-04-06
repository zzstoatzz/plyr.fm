---
title: likes
sidebarTitle: likes
---

# `backend.api.tracks.likes`


Track like/unlike endpoints.

## Functions

### `list_liked_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L52)

```python
list_liked_tracks(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> LikedTracksResponse
```


List tracks liked by authenticated user (queried from local index).


### `like_track` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L92)

```python
like_track(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> LikedResponse
```


Like a track - stores in database immediately, creates ATProto record in background.

The like is visible immediately in the UI. The ATProto record is created
asynchronously via a background task, keeping the API response fast.


### `unlike_track` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L147)

```python
unlike_track(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> LikedResponse
```


Unlike a track - removes from database immediately, deletes ATProto record in background.

The unlike is reflected immediately in the UI. The ATProto record deletion
happens asynchronously via a background task.


### `get_track_likes` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L185)

```python
get_track_likes(track_id: int, db: Annotated[AsyncSession, Depends(get_db)]) -> TrackLikersResponse
```


Public endpoint returning users who liked a track.

Returns a list of user display info (handle, display name, avatar, liked_at
timestamp). This endpoint is public—no authentication required to see who
liked a track.


## Classes

### `LikedTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L28)


response for listing liked tracks.


### `LikerInfo` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L34)


user who liked a track.


### `TrackLikersResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/likes.py#L44)


response for getting users who liked a track.

