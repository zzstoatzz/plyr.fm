---
title: lists
sidebarTitle: lists
---

# `backend.api.lists`


lists api endpoints for ATProto list records.

## Functions

### `reorder_liked_list` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L125)

```python
reorder_liked_list(body: ReorderRequest, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> ReorderResponse
```


reorder items in the user's liked tracks list.

the items array order becomes the new display order.
only the list owner can reorder their own list.


### `reorder_list` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L164)

```python
reorder_list(rkey: str, body: ReorderRequest, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> ReorderResponse
```


reorder items in a list by rkey. items array order = new display order.


### `create_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L203)

```python
create_playlist(body: CreatePlaylistRequest, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> PlaylistResponse
```


create a new playlist.

creates an ATProto list record with listType="playlist" and caches
metadata in the database for fast indexing.


### `list_playlists` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L257)

```python
list_playlists(session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> list[PlaylistResponse]
```


list all playlists owned by the current user.


### `list_artist_public_playlists` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L287)

```python
list_artist_public_playlists(artist_did: str, db: AsyncSession = Depends(get_db)) -> list[PlaylistResponse]
```


list public playlists for an artist (no auth required).


### `get_playlist_meta` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L318)

```python
get_playlist_meta(playlist_id: str, db: AsyncSession = Depends(get_db)) -> PlaylistResponse
```


get playlist metadata (public, no auth required). used for link previews.


### `get_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L349)

```python
get_playlist(playlist_id: str, db: AsyncSession = Depends(get_db), session: AuthSession | None = Depends(get_optional_session)) -> PlaylistWithTracksResponse
```


get a playlist with full track details (public, auth optional for liked state).

fetches the ATProto list record to get track ordering, then hydrates
track metadata from the database. if authenticated, includes liked state.


### `add_track_to_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L451)

```python
add_track_to_playlist(playlist_id: str, body: AddTrackRequest, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> PlaylistResponse
```


add a track to a playlist.

appends the track to the end of the playlist's ATProto list record
and updates the cached track count.


### `remove_track_from_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L551)

```python
remove_track_from_playlist(playlist_id: str, track_uri: str, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> PlaylistResponse
```


remove a track from a playlist.


### `delete_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L645)

```python
delete_playlist(playlist_id: str, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> DeletedResponse
```


delete a playlist.

deletes both the ATProto list record and the database cache.


### `upload_playlist_cover` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L681)

```python
upload_playlist_cover(playlist_id: str, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db), image: UploadFile = File(...)) -> dict[str, str | None]
```


upload cover art for a playlist (requires authentication).

accepts jpg, jpeg, png, webp images up to 20MB.


### `update_playlist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L742)

```python
update_playlist(playlist_id: str, name: Annotated[str | None, Form()] = None, show_on_profile: Annotated[bool | None, Form()] = None, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db)) -> PlaylistResponse
```


update playlist metadata (name, show_on_profile).

use POST /playlists/{id}/cover to update cover art separately.


### `get_playlist_recommendations_endpoint` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L840)

```python
get_playlist_recommendations_endpoint(playlist_id: str, session: AuthSession = Depends(require_auth), db: AsyncSession = Depends(get_db), limit: int = Query(3, ge=1, le=10, description='max recommendations')) -> PlaylistRecommendationsResponse
```


get track recommendations for a playlist.

uses CLAP embeddings to find tracks similar to what's in the playlist.
requires auth (owner only — recommendations are for editing).
results are cached per playlist CID (auto-invalidates on track changes).


## Classes

### `CreatePlaylistRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L53)


request body for creating a playlist.


### `PlaylistResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L60)


playlist metadata response.


### `PlaylistWithTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L74)


playlist with full track details.


### `AddTrackRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L81)


request body for adding a track to a playlist.


### `ReorderRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L93)


request body for reordering list items.


### `ReorderResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L100)


response from reorder operation.


### `RecommendedTrack` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L107)


a recommended track for a playlist.


### `PlaylistRecommendationsResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/lists.py#L117)


response for playlist recommendations.

