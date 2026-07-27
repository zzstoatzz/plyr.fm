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

- it is omitted from the home feed, search, recommendations, and shared radio
  by default
- **it is still listed on the artist's page, in albums and playlists, in
  someone's likes, and in your queue** — places you navigated to show what is
  there
- **you always see your own adult-labeled tracks**, whatever your settings say

[moderation](/moderation) has the full surface-by-surface table, including how
copyright labels differ.
- **a direct link still plays, for anyone.** The label changes where a track
  appears, not whether it can be reached
- the creator can always see and play their own track

signing in and enabling **sensitive audio** changes what you are *shown*. It has
never been an age check — any account satisfied it, and plyr.fm does not verify
anyone's age — so requiring one to press play cost creators the ability to share
their own work with a signed-out listener and bought nothing in return.

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

track responses include creator provenance in `self_labels`, active plyr.fm
moderation provenance in `operator_labels` on creator-owned track listings, and
the effective union in `labels`.

labels do not gate `/audio/{file_id}`. A client that wants to warn before
playing should read the labels from the track response and decide for itself —
which is the point: the assertion is published, and what to do about it is
yours to choose.

listing endpoints apply plyr.fm's own default (hide unless the viewer opted in
or owns the track). That default is ours, not the network's; other clients
reading the same labels are free to render them differently.
