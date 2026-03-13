---
title: search
sidebarTitle: search
---

# `backend.api.search`


search endpoints for relay.

## Functions

### `search_atproto_handles` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L114)

```python
search_atproto_handles(q: str = Query(..., min_length=2, description='search query (handle prefix)'), limit: int = Query(10, ge=1, le=25, description='max results')) -> HandleSearchResponse
```


search for ATProto handles by prefix.


### `unified_search` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L124)

```python
unified_search(db: Annotated[AsyncSession, Depends(get_db)], q: str = Query(..., min_length=2, max_length=100, description='search query'), type: str | None = Query(None, description='filter by type: tracks, artists, albums, tags (comma-separated for multiple)'), limit: int = Query(20, ge=1, le=50, description='max results per type')) -> SearchResponse
```


unified search across tracks, artists, albums, and tags.

uses pg_trgm for fuzzy matching with similarity scoring.
results are sorted by relevance within each type.


### `semantic_search` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L388)

```python
semantic_search(db: Annotated[AsyncSession, Depends(get_db)], q: str = Query(..., min_length=3, max_length=200, description='text description of desired audio'), limit: int = Query(10, ge=1, le=50, description='max results')) -> SemanticSearchResponse
```


semantic audio search — describe a mood and get matching tracks.

uses CLAP embeddings to match text descriptions to audio content.
no auth required (matches existing /search/ pattern).
returns 503 if embedding services are disabled.


## Classes

### `TrackSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L23)


track search result.


### `ArtistSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L35)


artist search result.


### `AlbumSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L46)


album search result.


### `TagSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L59)


tag search result.


### `PlaylistSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L69)


playlist search result.


### `HandleSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L82)


ATProto handle search result.


### `HandleSearchResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L91)


response for handle search.


### `SearchResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L106)


unified search response.


### `SemanticTrackResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L367)


a track result from semantic audio search.


### `SemanticSearchResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L379)


response from semantic search endpoint.

