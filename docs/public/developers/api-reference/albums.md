---
title: albums
sidebarTitle: albums
---

# `backend.api.albums`


albums api endpoints.

## Functions

### `invalidate_album_cache` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L48)

```python
invalidate_album_cache(handle: str, slug: str) -> None
```


delete cached album response. fails silently.


### `invalidate_album_cache_by_id` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L57)

```python
invalidate_album_cache_by_id(db: AsyncSession, album_id: str) -> None
```


look up album handle+slug and invalidate cache. fails silently.


### `list_albums` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L236)

```python
list_albums(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, list[AlbumListItem]]
```


list all albums with basic metadata.

albums with zero tracks are hidden — they're either unfinalized drafts
from the multi-track upload flow or legacy albums awaiting sync. only
albums that have at least one track appear in public listings.


### `list_artist_albums` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L275)

```python
list_artist_albums(handle: str, db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, list[ArtistAlbumListItem]]
```


list albums for a specific artist.


### `get_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L313)

```python
get_album(handle: str, slug: str, db: Annotated[AsyncSession, Depends(get_db)], session: AuthSession | None = Depends(get_optional_session)) -> AlbumResponse
```


get album details with tracks (ordered by ATProto list record or created_at).


### `create_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L459)

```python
create_album(body: AlbumCreatePayload, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> AlbumMetadata
```


create an empty album shell for the multi-track upload flow.

the ATProto list record is NOT written here — it is deferred to
`POST /albums/{id}/finalize`, which runs after tracks have actually
been published so a total upload failure doesn't leave a fake release
behind. for the same reason, the `album_release` CollectionEvent is
also deferred to finalize (first successful call only, deduped).

idempotent on (artist_did, slug): if an album with the same slug
already exists, the existing row is returned instead of failing.
this preserves the "type an existing album name to add tracks to it"
UX — see finalize_album for the append semantics.


### `upload_album_cover` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L529)

```python
upload_album_cover(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], image: UploadFile = File(...)) -> dict[str, str | None]
```


upload cover art for an album (requires authentication).


### `finalize_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L579)

```python
finalize_album(album_id: str, body: AlbumFinalizePayload, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> AlbumMetadata
```


write the album's ATProto list record using an explicit track order.

called by the frontend after per-track uploads have settled. this is
the single place the list record is created/updated for albums built
via `POST /albums/` + `POST /tracks/?album_id=...`.

append semantics: `track_ids` carries only the tracks from the current
upload session. any tracks already on the album that are NOT in
`track_ids` are preserved in the list record at their current positions
(fetched from the existing list record if present, falling back to
created_at order). new tracks are appended at the end in the order
requested. this matches the "type an existing album name to add tracks
to it" UX without truncating prior track history.

also emits an `album_release` CollectionEvent on the first successful
finalize for the album — so total upload failures don't leave a fake
release event in the activity feed.


### `update_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L778)

```python
update_album(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], title: Annotated[str | None, Query(description='new album title')] = None, description: Annotated[str | None, Query(description='new album description')] = None) -> AlbumMetadata
```


update album metadata (title, description). syncs ATProto records on title change.


### `remove_track_from_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L884)

```python
remove_track_from_album(album_id: str, track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)]) -> RemoveTrackFromAlbumResponse
```


remove a track from an album (orphan it, don't delete).

the track remains available as a standalone track.


### `delete_album` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L922)

```python
delete_album(album_id: str, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Annotated[AuthSession, Depends(require_artist_profile)], cascade: Annotated[bool, Query(description='if true, also delete all tracks in the album')] = False) -> DeleteAlbumResponse
```


delete album. tracks are orphaned unless cascade=true. removes ATProto list record.


## Classes

### `AlbumMetadata` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L73)


album metadata response.


### `AlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L89)


album detail response with tracks.


### `AlbumListItem` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L96)


minimal album info for listing.


### `RemoveTrackFromAlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L107)


response for removing a track from an album.


### `DeleteAlbumResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L114)


response for deleting an album.


### `ArtistAlbumListItem` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L121)


album info for a specific artist (used on artist pages).


### `AlbumCreatePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L132)

### `AlbumUpdatePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L138)

### `AlbumFinalizePayload` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/albums.py#L144)


request body for POST /albums/{id}/finalize.

track_ids is the authoritative user-intended order for the album's
ATProto list record. every id must belong to this album and have a
completed PDS write (atproto_record_uri + cid set).

