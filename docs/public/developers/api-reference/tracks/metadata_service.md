---
title: metadata_service
sidebarTitle: metadata_service
---

# `backend.api.tracks.metadata_service`


Helpers for track metadata updates.

## Functions

### `resolve_feature_handles` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/metadata_service.py#L23)

```python
resolve_feature_handles(features_json: str) -> list[dict[str, Any]]
```


Parse and resolve feature handles from JSON.


### `apply_album_update` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/metadata_service.py#L78)

```python
apply_album_update(db: AsyncSession, track: Track, album_value: str | None) -> bool
```


Apply album updates to the track, returning whether a change occurred.


### `upload_track_image` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/metadata_service.py#L120)

```python
upload_track_image(image: UploadFile) -> tuple[str, str | None, str | None]
```


Persist a track image and return (image_id, public_url, thumbnail_url).

