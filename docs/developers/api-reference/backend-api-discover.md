---
title: discover
sidebarTitle: discover
---

# `backend.api.discover`


discovery endpoints — social graph powered artist discovery.

## Functions

### `get_network_artists` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/discover.py#L37)

```python
get_network_artists(db: Annotated[AsyncSession, Depends(get_db)], auth_session: Session = Depends(require_auth)) -> list[NetworkArtistResponse]
```


discover artists on plyr.fm that you follow on bluesky.


## Classes

### `NetworkArtistResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/discover.py#L21)


artist from your bluesky follow graph who has music on plyr.fm.


**Methods:**

#### `normalize_avatar` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/discover.py#L32)

```python
normalize_avatar(cls, v: str | None) -> str | None
```
