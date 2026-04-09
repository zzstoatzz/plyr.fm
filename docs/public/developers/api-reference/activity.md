---
title: activity
sidebarTitle: activity
---

# `backend.api.activity`


activity feed — platform-wide chronological event stream.

## Functions

### `get_activity_feed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L256)

```python
get_activity_feed(db: Annotated[AsyncSession, Depends(get_db)], cursor: str | None = Query(None), limit: int = Query(20)) -> ActivityFeedResponse
```


get the platform-wide activity feed.


### `get_activity_histogram` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L352)

```python
get_activity_histogram(db: Annotated[AsyncSession, Depends(get_db)], days: int = Query(7, ge=1, le=30)) -> ActivityHistogramResponse
```


get activity counts per day for the sparkline.


## Classes

### `ActivityActor` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L20)


actor who performed the activity.


**Methods:**

#### `normalize_avatar` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L30)

```python
normalize_avatar(cls, v: str | None) -> str | None
```

### `ActivityTrack` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L34)


track referenced in an activity event.


**Methods:**

#### `normalize_avatar` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L46)

```python
normalize_avatar(cls, v: str | None) -> str | None
```

### `ActivityCollection` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L50)


collection referenced in an activity event.


### `ActivityEvent` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L61)


single activity event.


### `ActivityFeedResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L80)


paginated activity feed.


### `ActivityHistogramBucket` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L88)


single day in the activity histogram.


### `ActivityHistogramResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/activity.py#L95)


activity counts per day over a time window.

