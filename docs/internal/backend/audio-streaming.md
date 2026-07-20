---
title: "audio streaming — the /audio dispatch tree"
---

how `GET /audio/{file_id}` decides what bytes to serve, and from where. the
endpoint lives in `backend/src/backend/api/audio.py`.

the load-bearing thing to internalize: **dispatch is driven by `Track.visibility`
and `Track.support_gate`, not by `audio_storage`.** `audio_storage` (`r2` / `pds`
/ `both`) only answers the secondary question "where do the bytes physically
live" *within* a branch. getting this backwards is what made the 2026-06-30 dead-
audioUrl incident confusing (see the retrospective).

## the four track types

`Track.visibility` is the single source of truth (one mutually-exclusive value;
see the column comment in `backend/src/backend/models/track.py`). copyright gating
is orthogonal — it rides on `public`/`unlisted` via `support_gate`.

| type | `visibility` | `support_gate` | who can play | where audio lives |
|------|-------------|----------------|--------------|-------------------|
| public | `public` | `None` | anyone | R2 / CDN (or PDS blob if pds-only) |
| unlisted | `unlisted` | `None` | anyone with the link | R2 / CDN |
| copyright-gated | `public`/`unlisted` | `{"type":"copyright"}` | any **authenticated** listener | R2 (copyright tracks never get a PDS blob) |
| supporter-gated | `supporters` | `{"type":"any"}` | artist or validated atprotofans supporter | R2 **private** bucket (presigned) — or PDS blob if pds-stored |
| private | `private` | `None` | owner only (app-layer policy) | artist's **permissioned space on their PDS**, never R2 |

## dispatch order in `stream_audio`

```
is_private (visibility == "private") ?  → _handle_private_audio
support_gate is not None ?              → _handle_gated_audio
otherwise (public/unlisted, ungated)   → public path
```

### private → `_handle_private_audio`

audio + record live in the artist's ATProto permissioned space on their PDS,
never R2. the browser has no space credential, so we cannot redirect — we
**proxy** the bytes through the owner's credential (`open_space_blob` →
`getDelegationToken` → `getSpaceCredential` → ranged `getBlob`). access is
owner-only at two layers: plyr rejects non-owners, and the required
`com.atproto.simplespace` management layer uses an explicit `member-list`
policy for this MVP. The core permissioned-data protocol does not enumerate
readers; `simplespace` sits above that core and may maintain members. A
non-owner or anonymous request gets a `404`, identical to a missing file, so
private tracks don't leak their existence. `Range` is passed through so
seek/`206` survives the proxy.

> experimental: the `com.atproto.space.*` surface is implemented only by ZDS
> (`pds.zat.dev`); inert on prod PDSes. see
> `architecture/permissioned-private-media.md`.

### gated → `_handle_gated_audio`

both copyright- and supporter-gated tracks flow through here, but
`_check_gate_access` applies **different** checks by `support_gate["type"]`:

- `"copyright"` (indiemusi paradigm) — any authenticated listener is allowed;
  anonymous → `401`.
- `"any"` (supporters) — the artist always passes; otherwise the listener must
  be a validated atprotofans supporter, else `402` with `X-Support-Required`.

after the access check, the bytes come from the PDS blob (`audio_storage=="pds"`)
or a presigned URL into the R2 **private** bucket. `HEAD` requests return
`200`/`401`/`402` **without** redirecting (used as a pre-flight auth check —
avoids CORS issues with cross-origin redirects).

### public/unlisted ungated → the common path

1. if serving the **original lossless** file (the request `file_id` matches
   `original_file_id`), resolve and redirect to it.
2. else if `r2_url` is set (`audio_storage` `r2` or `both`) → `307` redirect to
   it (the CDN). **this is where R2 "wins" over the PDS blob for `both` tracks —
   there is no automatic fallback to the blob if the R2 object is missing.**
3. else if pds-only (`audio_storage=="pds"`, `pds_blob_cid`, no `r2_url`) →
   redirect to the PDS `getBlob` URL.
4. else resolve via `storage.get_url`; `404` if nothing resolves.

The `307` (not `302`) preserves the GET method through the redirect and offloads
bandwidth to R2's CDN instead of proxying through the app.

## why R2 can "win" but be empty

For a `both` track, step 2 trusts `r2_url` unconditionally — it does not verify
the object exists. If the row carries an `r2_url` for an object that was never
written (the dead-audioUrl ingest bug, #1616), playback `307`s to a CDN `404`
and the track "serves nothing" even though a usable PDS blob is present. The fix
keeps the row honest **at ingest** (verify the object exists before trusting the
URL) rather than adding an R2 `HEAD` to every playback request — see
`architecture/jetstream-ingest.md` and the 2026-06-30 retrospective.

## related

- `GET /audio/{file_id}/url` mirrors this dispatch but returns the URL as JSON
  (used by offline mode); private tracks return this backend's own stream URL,
  since the bytes need the space credential the client doesn't hold.
- the R2 key scheme and `file_id` semantics: `backend/streaming-uploads.md`.
- `Track.visibility` model: column comment in `models/track.py`.
