---
title: "for artists"
description: "upload, manage, and distribute your music on atproto"
---

your music, stored in your data repo, playable by any atproto client. no distribution fees, no gatekeepers.

plyr.fm gives artists a place to share music where **you own your data**. every track you upload is an [atproto](https://atproto.com) record stored in your [PDS](https://atproto.com/guides/self-hosting#pds) — the metadata record and the audio blob itself — portable, verifiable, and yours.

## your first upload

1. **sign in** at [plyr.fm](https://plyr.fm) with your atproto handle (e.g. `you.bsky.social`)
2. **upload** — click the upload button and drop your audio file (MP3, WAV, or M4A)
3. **add metadata** — title, tags, and optional cover art. plyr.fm auto-suggests genre tags from the audio
4. **see it live** — your track is now an atproto record in your PDS, indexed by plyr.fm and playable immediately
5. **embed it** — copy the embed code to put a player on your website or blog (see [embeds](#embeds) below)

the audio and metadata are stored on your PDS. if your PDS can't accept the file (blob size limits), plyr.fm falls back to R2 storage — but the metadata record always lives in your repo.

## embeds

share your music anywhere with embed iframes. plyr.fm supports track, playlist, and album embeds.

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

### what's next

because atproto doesn't yet have permissioned data, gated audio currently lives in plyr.fm-managed storage (public blob). this is the one exception to the "your music, your data" promise — and we want to fix it.

the atproto team is [exploring permissioned data](https://dholms.leaflet.pub/3mfrsbcn2gk2a) through concepts like **buckets** — named containers with access control lists that could let private blobs live on your own PDS. once that ships, gated tracks could move back to artist-controlled storage while still enforcing access rules at the protocol level.

we'd also like to support more expressive gating — tiers, time-limited early access, per-track pricing — as the ecosystem matures.

## your data

because tracks are atproto records, you can:

- **[export](https://plyr.fm/portal)** your entire catalog from your PDS at any time
- **migrate** to a different PDS without losing anything

your music lives in your repo under the `fm.plyr.track` collection. see the [lexicons overview](/lexicons/overview/) for the full schema.

## leaving

you can leave plyr.fm at any time. export your full catalog as a zip from the [portal](https://plyr.fm/portal). deleting your account removes all data from plyr.fm's infrastructure — your atproto records stay on your PDS by default, but you can choose to delete those too. for the full technical details, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs-internal/offboarding.md).
