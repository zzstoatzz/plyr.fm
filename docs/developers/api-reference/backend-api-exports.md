---
title: exports
sidebarTitle: exports
---

# `backend.api.exports`


media export API endpoints.

## Functions

### `export_media` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/exports.py#L34)

```python
export_media(session: Annotated[Session, Depends(require_auth)], db: Annotated[AsyncSession, Depends(get_db)]) -> ExportStartResponse
```


start export of all tracks for authenticated user.

returns an export_id for tracking progress via SSE.


### `export_progress` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/exports.py#L67)

```python
export_progress(export_id: str) -> StreamingResponse
```


SSE endpoint for real-time export progress.


### `download_export` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/exports.py#L117)

```python
download_export(export_id: str, session: Annotated[Session, Depends(require_auth)]) -> RedirectResponse
```


download the completed export zip file.


## Classes

### `ExportStartResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/exports.py#L24)


response when export is queued for processing.

