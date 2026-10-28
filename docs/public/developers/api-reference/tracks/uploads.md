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

## protected audio storage on staging

The following behavior is deployed to staging and awaits production promotion.

For public listening with downloads restricted (`off` or `supporters`),
an artist whose PDS supports Spaces stores the source audio in their PDS. The
public track record contains `audioSpace` and `downloadPolicy`; the protected
blob references remain inside the Space. plyr may keep a private streaming mirror.
Listeners can play through plyr without a Spaces account or a delegated grant.

Check `/auth/me` → `permissioned_spaces.supported` for the artist's PDS capability.
If the PDS does not support Spaces, protected uploads require the multipart field
`accept_plyr_storage=true`. This acknowledges that plyr storage holds the audio;
the PDS contains its public metadata. This field is unnecessary for a supported
PDS and does not bypass missing grants or a failed PDS capability check.

| response | meaning |
| --- | --- |
| `400`, `plyr_storage_acceptance_required` | protected upload on a PDS without Spaces needs explicit storage acceptance |
| `403`, `permissioned_scope_required` | approve the expanded owner Space permissions through scope upgrade or a fresh sign-in, then retry with the new session |
| `503`, `could not check PDS storage support` | PDS capability check failed; retry when the PDS is reachable |

The same field and validation apply to
`POST /tracks/uploads/{upload_id}/finish`. Resumable upload parts land in temporary
R2 storage before the worker publishes the owned source to the PDS. Transfer
storage is separate from the completed track's source location, so an R2 failure
can still interrupt multipart transfer. Once published, a missing private mirror
can be served from the protected PDS source. A failed protected PDS write fails
publication rather than silently changing the accepted storage arrangement.

see the [live API schema](https://api.plyr.fm/docs) and
[implementation](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/tracks/uploads.py)
for all current fields.
