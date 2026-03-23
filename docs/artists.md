---
title: "for creators"
description: "upload, manage, and distribute your audio"
---

you make sound! let's get it out there!

:::caution[🚦]
you _don't_ have a handle? head to [plyr.fm/login](https://plyr.fm/login) to create an account.
:::

on plyr.fm, you can share **music**, **podcasts**, **sound art**, **ASMR**, and anything else that makes noise — no distribution fees, no gatekeepers.

when you upload a track:
- it's stored in [a place you control](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io), tied to your identity
- share your track with anyone, even if they don't have a handle
- you can [embed a player](#embeds) on your website or blog
- you can [gate tracks](#supporter-gated-tracks) behind supporter status

your catalog isn't trapped here — other apps can access your tracks without plyr.fm's permission, and you can export everything as a ZIP from the [portal](https://plyr.fm/portal) at any time.

## your first upload

1. **sign in** at [plyr.fm](https://plyr.fm) with your handle (e.g. `you.bsky.social`)

   ![plyr.fm sign-in page — enter your handle to get started](/screenshots/login-page.png)

2. **upload** — click the upload button and drop your audio file (MP3, WAV, or M4A)

   ![the upload form — title, audio file, description, album, tags, and artwork](/screenshots/upload-form.png)

3. **add artwork** — attach cover art to your track. see [artwork guidelines](#artwork-guidelines) for format and size recommendations

4. **add metadata** — edit your track in the [portal](https://plyr.fm/portal) to add tags, cover art, and a description

   ![the track editor — title, description, album, tags, artwork, and suggested tags](/screenshots/portal-track-editor.png)

   <span id="auto-tagging"></span>when you add tags, you can opt in to **auto-tag with recommended genres** — plyr.fm runs [ML genre classification](https://github.com/zzstoatzz/plyr.fm/blob/main/docs-internal/backend/genre-classification.md) on the audio using the [effnet-discogs](https://replicate.com/mtg/effnet-discogs) model and suggests tags automatically. you can accept, remove, or add your own. auto-suggested tags typically appear within a few seconds of upload.

5. **see it live** — your track is playable immediately and indexed for discovery
6. **embed it** — copy the embed code to put a player on your website or blog (see [embeds](#embeds) below)

## artwork guidelines

track artwork is displayed as a square across the app — in lists, the player, and on track pages. for best results:

- **use square images** (1:1 aspect ratio) — at least **500 × 500 px** for clarity at all display sizes
- **supported formats**: JPG, PNG, WebP, or GIF
- **max file size**: 20 MB

non-square images are automatically center-cropped to fit a square frame. if your artwork is wider than it is tall, the left and right edges are trimmed; if taller, the top and bottom are trimmed. there's no manual crop tool, so square images give you full control over what's visible.

album and playlist covers accept the same formats except GIF.

## embeds

share your audio anywhere with embed iframes. plyr.fm supports track, playlist, and album embeds.

### track embed

```html
<iframe
  src="https://plyr.fm/embed/track/{track_id}"
  width="100%"
  height="152"
  frameborder="0"
  allow="autoplay; encrypted-media"
  loading="lazy"
></iframe>
```

### playlist embed

```html
<iframe
  src="https://plyr.fm/embed/playlist/{playlist_id}"
  width="100%"
  height="352"
  frameborder="0"
  allow="autoplay; encrypted-media"
  loading="lazy"
></iframe>
```

### oEmbed

plyr.fm supports [oEmbed](https://oembed.com/) for automatic embed discovery:

```
https://api.plyr.fm/oembed?url=https://plyr.fm/track/{track_id}
```

paste a plyr.fm track link into any oEmbed-compatible platform and it will render a player automatically.

## supporter-gated tracks

:::caution[experimental]
this feature is early and has limitations — see below.
:::

plyr.fm integrates with [ATProtoFans](https://atprotofans.com) to let artists gate tracks behind supporter status. when a listener tries to play a gated track, plyr.fm checks whether they support the artist — if they do, they get access; if not, the track is locked.

today this is a **binary check**: a listener either supports you or they don't. there are no tiers, amounts, or expiration windows — any active support relationship grants access to all your gated tracks.

### how it works

1. upload a track and toggle **supporter-gated** in the track editor
2. when a listener hits play, plyr.fm checks their support status via ATProtoFans
3. supporters get access; everyone else sees a lock

### how gated audio is stored

gated audio lives in a **private bucket** on plyr.fm's infrastructure — not publicly accessible. when a supporter plays a gated track, plyr.fm validates their support status and generates a time-limited presigned URL. the audio is never exposed without authentication.

this is the one exception to the "your audio, your data" promise: because atproto doesn't yet have permissioned data, there's no way to store private blobs on your PDS with access control. the atproto team is [exploring permissioned data](https://dholms.leaflet.pub/3mfrsbcn2gk2a) through concepts like **buckets** — named containers with access control lists that could let private blobs live on your own PDS. once that ships, gated tracks could move back to artist-controlled storage while still enforcing access rules at the protocol level.

we'd also like to support more expressive gating — tiers, time-limited early access, per-track pricing — as the ecosystem matures.

## your data

![the artist portal — manage your profile, tracks, and albums](/screenshots/portal-dashboard.png)

every track you upload is tied to [your account](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io) — you can inspect your records in a [PDS viewer](https://pdsls.dev), and they travel with you if you move to a different host.

if your host has a size limit that prevents storing the audio file directly (common on shared hosting), plyr.fm stores the audio in its own CDN instead. the metadata always stays with your account either way.

the [portal](https://plyr.fm/portal) offers a **bulk export** — it packages your tracks as a ZIP (using lossless originals when available) that you can download directly.

see the [lexicons overview](/lexicons/overview/) for the full record schema.

## leaving

you can leave plyr.fm at any time. download your tracks as a ZIP from the [portal](https://plyr.fm/portal), then delete your account — this removes all data from plyr.fm's infrastructure. your atproto records stay on your PDS by default, but you can choose to delete those too. for the full technical details, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs-internal/offboarding.md).
