---
title: users
sidebarTitle: users
---

# `backend.api.users`


user-related public endpoints.

## Functions

### `get_user_liked_tracks` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/users.py#L38)

```python
get_user_liked_tracks(handle: str, db: Annotated[AsyncSession, Depends(get_db)], session: Session | None = Depends(get_optional_session)) -> UserLikedTracksResponse
```


get tracks liked by a user (public).

likes are stored on the user's PDS as ATProto records, making them
public data. this endpoint returns the indexed likes for any user.


## Classes

### `UserInfo` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/users.py#L20)


basic user info.


### `UserLikedTracksResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/users.py#L29)


response for user's liked tracks.

