---
title: queue
sidebarTitle: queue
---

# `backend.api.queue`


queue api endpoints.

## Functions

### `get_queue` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/queue.py#L31)

```python
get_queue(response: Response, db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> QueueResponse
```


get current queue state with ETag for caching.


### `update_queue` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/queue.py#L67)

```python
update_queue(update: QueueUpdate, session: Session = Depends(require_auth), if_match: Annotated[str | None, Header()] = None) -> QueueResponse
```


update queue state with optimistic locking via If-Match header.

the If-Match header should contain the expected revision number (as ETag).
if there's a conflict (revision mismatch), returns 409.


## Classes

### `QueueResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/queue.py#L16)


queue state response model.


### `QueueUpdate` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/queue.py#L24)


queue state update model.

