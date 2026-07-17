---
title: "sensitive content"
description: "how sensitive artwork and adult-labeled audio work on plyr.fm"
---

plyr.fm hides sensitive content by default. Signed-out visitors cannot opt in;
signed-in listeners can decide separately whether to show sensitive artwork and
adult-labeled audio.

## the controls

open [settings → privacy & display](https://plyr.fm/settings#privacy-display).
The **all sensitive content** switch is the parent control: it turns both
preferences on or off together. Under it, **sensitive artwork** and
**sensitive audio** can be changed individually.

when the artwork and audio preferences differ, the parent switch shows a mixed
state. That means one kind of sensitive content is enabled and the other is not.

preferences are saved to your plyr.fm account. They are off by default and are
not available to signed-out visitors.

## sensitive artwork

artwork that has been flagged as sensitive stays blurred until you enable
**sensitive artwork**. This includes track and album artwork and can include an
external profile image. Link previews do not expose flagged artwork.

## adult-labeled audio

plyr.fm recognizes the global AT Protocol labels `sexual` and `porn`. These are
[standard content-warning values](https://github.com/bluesky-social/atproto/blob/main/packages/api/definitions/labels.json),
not categories invented specifically for plyr.fm, and they can describe audio
as well as images or video.

when a creator self-labels a track or a trusted labeler applies either value:

- it is omitted from discovery, search, recommendations, public collections,
  queues, Subsonic browsing, and shared radio by default
- a direct link can still explain that the track exists, but playback requires
  a signed-in listener who enabled **sensitive audio**
- signed-out audio requests are rejected
- the creator can always see and play their own track

shared radio excludes adult-labeled tracks for everyone, including listeners
who opted in. Radio is a public, synchronized surface where one listener's
preference cannot safely determine what every other listener hears.

## labels are not deletion

a label is an assertion about content. It does not delete the track. A creator
notice lives in the track record; an operator label is a separate signed
assertion and does not rewrite that record. Removing one does not remove the
other. plyr.fm applies the same viewing and playback policy to their union.

if a track is labeled incorrectly, use the report control while viewing it or contact
[plyrdotfm@proton.me](mailto:plyrdotfm@proton.me).

## for developers

track responses include creator provenance in `self_labels` and the effective
union in `labels`. For adult-labeled tracks, the audio URL points at plyr.fm's
protected `/audio/{file_id}` endpoint instead of a public CDN URL. Clients must
not cache or bypass that endpoint.

the endpoint returns:

- `401` for a signed-out request
- `403` for a signed-in listener who has not opted in
- `503` when the content-safety service is unavailable and access cannot be
  checked safely

denied responses include `X-Content-Labels` with the active policy label.
