---
title: shares
sidebarTitle: shares
---

# `backend.api.tracks.shares`


share link tracking endpoints for listen receipts.

## Functions

### `generate_unique_share_code` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L60)

```python
generate_unique_share_code(db: AsyncSession, max_attempts: int = 5) -> str
```


generate a unique 8-character share code, retrying on collision.

uses secrets.token_urlsafe(6) which yields 8 chars with 48 bits of entropy.
at current scale, collision probability is negligible (<0.2% at 1M codes).


### `create_share_link` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L75)

```python
create_share_link(track_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> ShareLinkResponse
```


create a trackable share link for a track.

generates a unique code that can be appended as ?ref={code} to track URLs.
each call creates a new share link (one per share action).


### `record_share_click` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L109)

```python
record_share_click(track_id: int, code: str, db: Annotated[AsyncSession, Depends(get_db)], session: AuthSession | None = Depends(get_optional_session)) -> OkResponse
```


record a click event when someone visits a track via a share link.

called by frontend when page loads with ?ref= parameter.
skips recording if the visitor is the share link creator (self-click).


### `list_my_shares` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L146)

```python
list_my_shares(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)) -> ShareListResponse
```


list share links created by the authenticated user with aggregated stats.

returns paginated list of share links with click/play counts and listener breakdown.


## Classes

### `ShareLinkResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L21)


response for creating a share link.


### `UserStats` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L28)


stats for a user who interacted with a share link.


### `ShareLinkStats` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L38)


stats for a single share link.


### `ShareListResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/shares.py#L52)


paginated list of share links with stats.

