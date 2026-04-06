---
title: search
sidebarTitle: search
---

# `backend.api.search`


search endpoints for relay.

## Functions

### `unified_search` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L98)

```python
unified_search(db: Annotated[AsyncSession, Depends(get_db)], q: str = Query(..., min_length=2, max_length=100, description='search query'), type: str | None = Query(None, description='filter by type: tracks, artists, albums, tags (comma-separated for multiple)'), limit: int = Query(20, ge=1, le=50, description='max results per type')) -> SearchResponse
```


unified search across tracks, artists, albums, and tags.

uses pg_trgm for fuzzy matching with similarity scoring.
results are sorted by relevance within each type.


### `semantic_search` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L362)

```python
semantic_search(db: Annotated[AsyncSession, Depends(get_db)], q: str = Query(..., min_length=3, max_length=200, description='text description of desired audio'), limit: int = Query(10, ge=1, le=50, description='max results')) -> SemanticSearchResponse
```


semantic audio search — describe a mood and get matching tracks.

uses CLAP embeddings to match text descriptions to audio content.
no auth required (matches existing /search/ pattern).
returns 503 if embedding services are disabled.


## Classes

### `TrackSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L22)


track search result.


### `ArtistSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L34)


artist search result.


### `AlbumSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L45)


album search result.


### `TagSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L58)


tag search result.


### `PlaylistSearchResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L68)


playlist search result.


### `SearchResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L90)


unified search response.


### `SemanticTrackResult` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L341)


a track result from semantic audio search.


### `SemanticSearchResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/search.py#L353)


response from semantic search endpoint.

