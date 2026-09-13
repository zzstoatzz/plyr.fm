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
and the HTTP endpoints above.

## delivery and security

use the track's playback and download capabilities. do not construct a public
bucket URL or assume a playable source authorizes an original download.
restricted managed audio uses private storage; public listening can use a separate
rendition while its original stays protected. album archives check every track.

rights information does not grant playback or download access. downloads off
does not prevent recording playback, and changing policy cannot revoke copies
that were already public. a future move into native Spaces must explicitly
preserve audiences and verify assets; capability detection does not migrate data.

the [live API schema](https://api.plyr.fm/docs) describes the deployed request
and response shapes.
