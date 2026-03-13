---
title: tags
sidebarTitle: tags
---

# `backend.api.tracks.tags`


tag endpoints for track categorization.

## Functions

### `get_tracks_by_tag` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L52)

```python
get_tracks_by_tag(tag_name: str, db: Annotated[AsyncSession, Depends(get_db)], session: AuthSession | None = Depends(get_optional_session)) -> TagTracksResponse
```


get all tracks with a specific tag.

returns tag info and list of tracks tagged with that tag.


### `list_tags` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L126)

```python
list_tags(db: Annotated[AsyncSession, Depends(get_db)], q: Annotated[str | None, Query(description='search query for tag names')] = None, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> list[TagWithCount]
```


list tags with track counts, optionally filtered by query.

returns tags sorted by track count (most used first).
use `q` parameter for prefix search (case-insensitive).


### `get_recommended_tags` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L171)

```python
get_recommended_tags(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=20)] = 5) -> RecommendedTagsResponse
```


recommend tags for a track based on ML genre classification.

uses effnet-discogs via Replicate to classify audio into genre labels.
results are cached in track.extra["genre_predictions"].


## Classes

### `TagWithCount` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L29)


tag with track count for autocomplete.


### `TagDetail` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L36)


tag detail with metadata.


### `TagTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L43)


response for getting tracks by tag.


### `RecommendedTag` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L155)


a recommended tag with confidence score.


### `RecommendedTagsResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/tags.py#L162)


response for tag recommendations based on genre classification.

