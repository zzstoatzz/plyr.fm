---
title: stats
sidebarTitle: stats
---

# `backend.api.stats`


platform-wide statistics endpoints.

## Functions

### `get_platform_stats` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/stats.py#L28)

```python
get_platform_stats(db: Annotated[AsyncSession, Depends(get_db)]) -> PlatformStats
```


get platform-wide statistics.


### `get_costs` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/stats.py#L55)

```python
get_costs() -> Response
```


proxy costs JSON from R2 to avoid CORS issues.

the costs.json file is generated daily by a GitHub Action and uploaded
to R2. this endpoint proxies it so the frontend can fetch without CORS.


## Classes

### `PlatformStats` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/stats.py#L18)


platform-wide statistics.

