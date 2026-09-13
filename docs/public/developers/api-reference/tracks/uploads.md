---
title: uploads
sidebarTitle: uploads
---

## upload a track

`POST /tracks/` requires an authenticated artist and multipart form data with
`title` and `file`. optional fields include album, features, tags, description,
artwork, content notices, and a complete `publishing` JSON override.

omitting publishing uses the saved album/Portal defaults. see
[publishing access](/developers/publishing/) for the schema and migration from
the old unlisted/support-gate write fields.

the response contains an `upload_id`. follow
`GET /tracks/uploads/{upload_id}/progress` for processing progress and the
terminal result; request acceptance is not completed publication.

see the [live API schema](https://api.plyr.fm/docs) and
[implementation](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py)
for all current fields.
