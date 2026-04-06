---
title: feeds
sidebarTitle: feeds
---

# `backend.api.feeds`


RSS feed generation for artist, album, and playlist collections.

## Functions

### `artist_feed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/feeds.py#L83)

```python
artist_feed(handle: str, db: Annotated[AsyncSession, Depends(get_db)]) -> Response
```


RSS feed of all public tracks by an artist, newest first.


### `album_feed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/feeds.py#L133)

```python
album_feed(handle: str, slug: str, db: Annotated[AsyncSession, Depends(get_db)]) -> Response
```


RSS feed of tracks in an album.


### `playlist_feed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/feeds.py#L188)

```python
playlist_feed(playlist_id: str, db: Annotated[AsyncSession, Depends(get_db)]) -> Response
```


RSS feed of tracks in a playlist.

