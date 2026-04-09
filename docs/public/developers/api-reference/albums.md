---
title: albums
sidebarTitle: albums
---

# `backend.api.albums`


albums api endpoints.

## Functions

### `invalidate_album_cache` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L47)

```python
invalidate_album_cache(handle: str, slug: str) -> None
```


delete cached album response. fails silently.


### `invalidate_album_cache_by_id` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L56)

```python
invalidate_album_cache_by_id(db: AsyncSession, album_id: str) -> None
```


look up album handle+slug and invalidate cache. fails silently.


### `list_albums` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L235)

```python
list_albums(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, list[AlbumListItem]]
```


list all albums with basic metadata.


### `list_artist_albums` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L268)

```python
list_artist_albums(handle: str, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, list[ArtistAlbumListItem]]
```


list albums for a specific artist.


### `get_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L305)

```python
get_album(handle: str, slug: str, db: Annotated[AsyncSession, Depends(get_db)], session: AuthSession | None = Depends(get_optional_session)) -> AlbumResponse
```


get album details with tracks (ordered by ATProto list record or created_at).


### `create_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L451)

```python
create_album(body: AlbumCreatePayload, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> AlbumMetadata
```


create a new empty album shell.

the ATProto list record is not written here — it is deferred to
`POST /albums/{id}/finalize`, which is called after all tracks have
been uploaded so the list can be written once in user-intended order.

idempotent on (artist_did, slug): if an album with the same slug
already exists, the existing row is returned instead of failing.


### `upload_album_cover` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L526)

```python
upload_album_cover(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], image: UploadFile = File(...)) -> dict[str, str | None]
```


upload cover art for an album (requires authentication).


### `finalize_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L576)

```python
finalize_album(album_id: str, body: AlbumFinalizePayload, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> AlbumMetadata
```


write the album's ATProto list record using an explicit track order.

called by the frontend after all per-track uploads have settled. this is
the single place the list record is created/updated for albums built via
`POST /albums/` + `POST /tracks/?album_id=...`. idempotent — calling
again with a different track_ids order rewrites the list record.


### `update_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L681)

```python
update_album(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], title: Annotated[str | None, Query(description='new album title')] = None, description: Annotated[str | None, Query(description='new album description')] = None) -> AlbumMetadata
```


update album metadata (title, description). syncs ATProto records on title change.


### `remove_track_from_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L787)

```python
remove_track_from_album(album_id: str, track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> RemoveTrackFromAlbumResponse
```


remove a track from an album (orphan it, don't delete).

the track remains available as a standalone track.


### `delete_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L825)

```python
delete_album(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], cascade: Annotated[bool, Query(description='if true, also delete all tracks in the album')] = False) -> DeleteAlbumResponse
```


delete album. tracks are orphaned unless cascade=true. removes ATProto list record.


## Classes

### `AlbumMetadata` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L72)


album metadata response.


### `AlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L88)


album detail response with tracks.


### `AlbumListItem` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L95)


minimal album info for listing.


### `RemoveTrackFromAlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L106)


response for removing a track from an album.


### `DeleteAlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L113)


response for deleting an album.


### `ArtistAlbumListItem` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L120)


album info for a specific artist (used on artist pages).


### `AlbumCreatePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L131)

### `AlbumUpdatePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L137)

### `AlbumFinalizePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L143)


request body for POST /albums/{id}/finalize.

track_ids is the authoritative user-intended order for the album's
ATProto list record. every id must belong to this album and have a
completed PDS write (atproto_record_uri + cid set).

