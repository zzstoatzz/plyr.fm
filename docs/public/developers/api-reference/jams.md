---
title: jams
sidebarTitle: jams
---

# `backend.api.jams`


jam api endpoints for shared listening rooms.

## Functions

### `create_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L84)

```python
create_jam(body: CreateJamRequest, session: Session = Depends(require_auth)) -> JamResponse
```


create a new jam.


### `get_active_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L101)

```python
get_active_jam(session: Session = Depends(require_auth)) -> JamResponse | None
```


get the user's current active jam.


### `get_jam_preview` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L112)

```python
get_jam_preview(code: str) -> JamPreviewResponse
```


public preview info for a jam (no auth required).


### `get_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L147)

```python
get_jam(code: str, session: Session = Depends(require_auth)) -> JamResponse
```


get jam details by code.


### `join_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L159)

```python
join_jam(code: str, session: Session = Depends(require_auth)) -> JamResponse
```


join a jam.


### `leave_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L171)

```python
leave_jam(code: str, session: Session = Depends(require_auth)) -> dict[str, bool]
```


leave a jam.


### `end_jam` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L186)

```python
end_jam(code: str, session: Session = Depends(require_auth)) -> dict[str, bool]
```


end a jam (host only).


### `jam_command` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L201)

```python
jam_command(code: str, body: CommandRequest, session: Session = Depends(require_auth)) -> dict[str, Any]
```


send a playback command to the jam.


### `jam_websocket` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L264)

```python
jam_websocket(ws: WebSocket, code: str, session_id: Annotated[str | None, Cookie()] = None) -> None
```


WebSocket endpoint for real-time jam sync.


## Classes

### `CreateJamRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L38)

### `CommandRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L46)

### `JamResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L55)

### `JamPreviewResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/jams.py#L70)
