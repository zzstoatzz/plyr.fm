---
title: comments
sidebarTitle: comments
---

# `backend.api.tracks.comments`


Track timed comments endpoints.

## Functions

### `get_track_comments` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L66)

```python
get_track_comments(track_id: int, db: Annotated[AsyncSession, Depends(get_db)]) -> CommentsListResponse
```


get all comments for a track, ordered by timestamp.

public endpoint - no auth required.


### `create_comment` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L122)

```python
create_comment(track_id: int, body: CommentCreate, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> CommentResponse
```


create a timed comment on a track.

requires auth. track owner must have allow_comments enabled.
the comment is visible immediately; the ATProto record is created in background.


### `delete_comment` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L212)

```python
delete_comment(comment_id: int, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> DeletedResponse
```


delete a comment. only the author can delete their own comments.

the comment is removed immediately; the ATProto record is deleted in background.


### `update_comment` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L250)

```python
update_comment(comment_id: int, body: CommentUpdate, db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth)) -> CommentResponse
```


update a comment's text. only the author can edit their own comments.

the comment is updated immediately; the ATProto record is updated in background.


## Classes

### `CommentCreate` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L30)


request body for creating a comment.


### `CommentUpdate` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L37)


request body for updating a comment.


### `CommentResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L43)


response model for a single comment.


### `CommentsListResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/comments.py#L57)


response model for list of comments.

