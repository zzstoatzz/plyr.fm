---
title: moderation
sidebarTitle: moderation
---

# `backend.api.moderation`


content moderation api endpoints.

## Functions

### `create_report` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L66)

```python
create_report(request: Request, body: CreateReportRequest, session: Session = Depends(require_auth)) -> CreateReportResponse
```


submit a content report.

requires authentication. rate limited to 10 reports per hour per user.
the report is forwarded to the moderation service for storage and
admin review.


### `get_sensitive_images` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L135)

```python
get_sensitive_images(request: Request, response: Response) -> SensitiveImagesResponse
```


get all flagged sensitive images.

proxies to the moderation service which is the source of truth
for sensitive image data.

returns both image_ids (for R2-stored images) and full URLs
(for external images like avatars). clients should check both.

cached at edge (5 min) and browser (1 min) to reduce load from
SSR page loads hitting this endpoint on every request.


## Classes

### `SensitiveImagesResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L21)


list of sensitive image identifiers.


### `ReportReason` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L36)


valid reasons for content reports.


### `CreateReportRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L46)


request to create a content report.


### `CreateReportResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/moderation.py#L58)


response after creating a report.

