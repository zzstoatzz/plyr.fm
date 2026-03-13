---
title: listing
sidebarTitle: listing
---

# `backend.api.tracks.listing`


Read-only track listing endpoints.

## Functions

### `list_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L69)

```python
list_tracks(db: Annotated[AsyncSession, Depends(get_db)], artist_did: str | None = None, filter_hidden_tags: bool | None = None, cursor: str | None = None, limit: int | None = None, session: AuthSession | None = Depends(get_optional_session)) -> TracksListResponse
```


List tracks with cursor-based pagination.

**Args:**
- `artist_did`: Filter to tracks by this artist only.
- `filter_hidden_tags`: Whether to exclude tracks with user's hidden tags.
- None (default)\: auto-decide based on context (filter on discovery feed,
  don't filter on artist pages)
- True\: always filter hidden tags
- False\: never filter hidden tags
- `cursor`: ISO timestamp cursor from previous response's next_cursor.
Pass this to get the next page of results.
- `limit`: Maximum number of tracks to return (default from settings, max 100).


### `list_top_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L322)

```python
list_top_tracks(db: Annotated[AsyncSession, Depends(get_db)], limit: int = 10, session: AuthSession | None = Depends(get_optional_session)) -> list[TrackResponse]
```


get top tracks by like count (most liked first, at least one like).


### `list_my_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L403)

```python
list_my_tracks(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth), limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0)) -> MyTracksResponse
```


List tracks uploaded by authenticated user.


### `list_broken_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L461)

```python
list_broken_tracks(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> BrokenTracksResponse
```


Return tracks owned by the user that have missing ATProto records.

These are tracks with a null `atproto_record_uri`, meaning they need
recovery. Such tracks cannot be liked and may require migration or
recreation.


### `get_my_file_sizes` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L507)

```python
get_my_file_sizes(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> FileSizesResponse
```


Get file sizes for the authenticated user's tracks via R2 HEAD requests.


## Classes

### `TracksListResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L52)


Response for paginated track listing.


### `MyTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L60)


Response for listing authenticated user's tracks.


### `BrokenTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L453)


Response for broken tracks endpoint.


### `FileSizesResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/listing.py#L502)
