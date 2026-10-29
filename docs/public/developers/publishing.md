---
title: publishing access
description: defaults, per-work permissions, and protected audio
---

publishing separates listening, original-file downloads, metadata visibility,
and optional rights metadata. see [the creator guide](/artists/#music-access)
for Portal controls.

## upload contract

`POST /tracks/` accepts multipart form data. pass a `publishing` JSON string
to override the complete template:

```json
{
  "access": {
    "listening": "public",
    "downloads": "off",
    "visibility": "public"
  },
  "attach_rights": false
}
```

omit it to use album settings when present, otherwise the artist's Portal defaults.
the resolved settings are saved on the track, along with `policy_origin`
(`portal`, `album`, or `track`). this is a snapshot, not live inheritance.

| field | values |
| --- | --- |
| listening | `public`, `signed_in`, `supporters`, `owner`, `space` |
| downloads | `open`, `ask`, `supporters`, `off` |
| visibility | `public`, `unlisted`, `private` |

the server validates available audiences and host capabilities. `ask` is an
optional support prompt, not payment verification. unlisted metadata remains
visible on profiles and in search. native private Spaces enforce their own
membership boundary; there is no managed-storage fallback after a Space refusal.

<a id="protected-audio-on-staging"></a>

## protected audio

this behavior is live at `https://api.plyr.fm`. existing catalog audio is not
migrated automatically.

for non-private metadata, restricted listening or downloads select protected
audio. a Spaces-capable host stores its primary source in the artist's
app-restricted playback Space. private R2 storage is an optional playback copy.
web-playable Space audio is accepted as uploaded; downloads off does not force
an encoding pass. formats needing browser conversion retain a PDS original while
preparing a playback rendition. resumable transfers currently stage chunks in
private R2 before publishing the PDS source; the optional copy refers to
retained playback storage, not that initial transfer.

`GET /auth/me` distinguishes `permissioned_spaces.supported` (host capability)
from `granted` (the current OAuth permission bundle). a capable host without the
required grant returns `403 permissioned_scope_required`; complete OAuth approval
before retrying. host discovery failures and refused Space writes do not select
managed storage instead.

when the host lacks Spaces, `POST /tracks/` and
`POST /tracks/uploads/{upload_id}/finish` require the optional multipart boolean
`accept_plyr_storage=true` for a protected upload. its default is false; omission
returns `400 plyr_storage_acceptance_required`. obtain explicit acceptance for
each upload before sending it. it cannot bypass a capable host's scope refusal,
and does not apply to native private Space uploads.

HTTP track and revision responses may include `audio_space`, the PDS Space record
URI. treat it as PDS ownership even when `audio_storage` is `r2_private` and
`pds_blob_cid` is null; that public-blob field deliberately carries no protected
CID. public ATProto track records use `audioSpace` to reference the source.
follow plyr.fm's playback/download routes, which enforce the saved policy and
Space app access, rather than constructing public blob URLs.

## editing published works

metadata PATCH requests do not change access. use the owner-authenticated
`POST /tracks/{track_id}/publishing` endpoint with
`{"settings": <publishing template>}`; `settings: null` resolves the current
album/Portal template. poll `GET /tracks/publishing-jobs/{job_id}` for completion.
a queued job is not a completed access change.

`POST /albums/{album_id}/publishing` accepts `settings` and
`replace_overrides` (false by default). it reports selected and preserved track
IDs. private album templates are not supported. jobs report updated and failed
track IDs; a partial failure is not an atomic rollback of all album changes.
refresh the saved state before retrying.

## client migration

the Python SDK's sync and async upload methods accept `PublishingDefaults`.
the CLI accepts `--publishing` JSON. the old `unlisted` upload/update argument
and CLI flags are removed. select unlisted discovery through the publishing
template instead. existing-track access editing remains available through Portal
and the HTTP endpoints above. source support for `accept_plyr_storage` and
`audio_space` is merged in the Python client repository. package releases are
separate: check the installed SDK, CLI, or MCP version and its backend contract,
or use the production HTTP endpoints.

## delivery and security

use the track's playback and download capabilities. do not construct a public
bucket URL or assume a playable source authorizes an original download.
older managed audio uses private storage; its playback rendition can differ from
the original. new protected uploads use the Space source described above. album
archives check every track, including protected PDS sources.

rights information does not grant playback or download access. downloads off
does not prevent recording playback, and changing policy cannot revoke copies
that were already public. a future move into native Spaces must explicitly
preserve audiences and verify assets; capability detection does not migrate data.

the [live API schema](https://api.plyr.fm/docs) describes the deployed request
and response shapes.
