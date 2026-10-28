---
title: "audio streaming — the /audio dispatch tree"
---

`backend/src/backend/api/audio.py` serves playback, URL lookup and downloads.
Protected PDS audio described below is deployed to staging on October 28, 2026;
production promotion is pending. Existing catalog sources are unchanged. See
[protected PDS audio](../architecture/protected-pds-audio.md) and its
[validation plan](../plans/2026-10-28-protected-pds-audio.md).

## source and audience

Listening, metadata visibility and original downloads are independent. Storage
fields identify copies; they do not authorize access.

| Source | Metadata | Read authorization | Delivery |
| --- | --- | --- | --- |
| public PDS blob / public R2 | public or unlisted | current listening policy | CDN or public PDS redirect |
| protected PDS playback Space | public or unlisted | current listening policy plus app Space credential | verified private R2 mirror or PDS proxy |
| legacy / explicitly accepted private R2 | public or unlisted | current listening policy | private signed URL or proxy |
| member-private self Space | private | requesting reader's membership credential | PDS proxy |

`protected_audio` identifies the protected source. Its public DTO field is
`audio_space`; `pds_blob_cid` remains reserved for public blobs. `space_uri`
identifies the separate member-private metadata path. A protected PDS source can
have `audio_storage=r2_private` because that value describes its mirror bucket.

## dispatch order

1. Member-private tracks check access through `can_access` and proxy using the
   requesting user's credential. Refusal is 404 to conceal the track's existence.
2. A protected PDS source checks any listening gate. Requests for a distinct
   original also enforce download policy against the selected track ID. Sharing
   a playback hash with an open track does not authorize its protected original.
3. Protected delivery obtains or reuses a valid app credential for the artist's
   playback Space before using R2. A verified, present mirror can serve playback;
   otherwise the backend streams the PDS blob. Originals use the source read.
4. Other gated/private-R2 audio uses the legacy authorized delivery path.
5. Ordinary public audio uses its existing CDN/PDS resolution path.

Signed-in listening rejects anonymous requests with 401. Supporter listening
uses `validate_supporter`; it does not require a particular supporter provider.
Download `off` permits artist recovery, and `supporters` requires the artist or a
verified supporter. Moderation and private-track restrictions still apply.

The playback Space has public read policy, an owner/member write policy and an
allow-list for the deployed OAuth client. App attestation authorizes the app;
listener delegation is unnecessary. Anonymous listeners and accounts on PDSes
without Spaces can play through plyr. The self Space continues to use member
policy and reader delegation; it is not opened for this delivery path.

## mirrors and response behavior

An imported source starts unverified. Before exposing its mirror to processors,
source bytes must match CID, declared size and content hash; storage must return
the expected hash, and a conditional update must confirm the source is unchanged.
A claimed hash alone cannot select another artist's private object. Deterministic
verification refusal produces no processor URL; transient errors have bounded
background retries. Private metadata stays excluded from public hooks.

`Range` and HEAD are preserved on PDS proxy reads. `cors=1` requests bytes through
the backend instead of a credentialed cross-origin redirect. `/url` returns a
backend stream URL for protected PDS and member-private sources, with the same
original authorization. Downloads and exports can read the protected original
without an R2 playback mirror; album archives enforce per-track permissions.

Cached Space credentials are capped at 50 minutes, shortened to JWT expiry minus
30 seconds when present. Private R2 presigns default to 3600 seconds. App-access
revocation is bounded by cached credentials and already issued URLs; it is not
instant. Download restrictions do not prevent saving playback bytes.

## historical public CDN incident

The June 30 dead-`audioUrl` incident (#1616) concerned ordinary public `both`
tracks trusting an indexed CDN URL that named no object. Ingest verifies public
objects rather than adding a public R2 HEAD to every playback request. This
history does not describe protected PDS delivery, which checks its mirror and
can stream the artist's source when the mirror is missing.

See [streaming uploads](streaming-uploads.md) for key/hash semantics and
[audio access reconciliation](../architecture/audio-access-reconciliation.md)
for the historical policy decisions.
