---
title: "for creators"
description: "upload, manage, and distribute your audio"
---

you make sound! let's get it out there!

:::caution[🚦]
you _don't_ have an account? head to [plyr.fm/login](https://plyr.fm/login) to create one.
:::

on plyr.fm, you can share **music**, **podcasts**, **sound art**, **ASMR**, and anything else that makes noise — no distribution fees, no gatekeepers.

when you upload a track:
- it's stored in [a place you control](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io), tied to your identity
- share your track with anyone, even if they don't have an account
- you can [embed a player](#embeds) on your website or blog
- you can [gate tracks](#supporter-gated-tracks) behind supporter status

your catalog isn't trapped here — other apps can access your tracks without plyr.fm's permission, and you can export everything as a ZIP from the [portal](https://plyr.fm/portal) at any time.

## your first upload

1. **sign in** at [plyr.fm](https://plyr.fm) with your atmosphere account (e.g. `you.bsky.social`)

   ![plyr.fm sign-in page — enter your atmosphere account to get started](/screenshots/login-page.png)

2. **upload** — click the upload button and drop your audio file (MP3, WAV, or M4A)

   ![the upload form — title, audio file, description, album, tags, and artwork](/screenshots/upload-form.png)

3. **add artwork** — attach cover art to your track. see [artwork guidelines](#artwork-guidelines) for format and size recommendations

4. **add metadata** — edit your track in the [portal](https://plyr.fm/portal) to add tags, cover art, and a description

   ![the track editor — title, description, album, tags, artwork, and suggested tags](/screenshots/portal-track-editor.png)

   <span id="auto-tagging"></span>when you add tags, you can opt in to **auto-tag with recommended genres** — plyr.fm runs [ML genre classification](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/backend/genre-classification.md) on the audio using the [effnet-discogs](https://replicate.com/mtg/effnet-discogs) model and suggests tags automatically. you can accept, remove, or add your own. auto-suggested tags typically appear within a few seconds of upload.

5. **see it live** — your track is playable immediately and indexed for discovery
6. **embed it** — copy the embed code to put a player on your website or blog (see [embeds](#embeds) below)

## adult audio and content notices

if a track contains adult or sexual audio, enable **contains adult or sexual
audio** when uploading it. You can change the notice later in the track editor.

the notice is stored with your track in your ATProto repository. On plyr.fm,
noticed tracks are hidden from discovery and cannot be played by anonymous
listeners. Signed-in listeners must explicitly enable sensitive audio in their
settings. You can still see and manage your own noticed tracks.

removing your notice removes only your own assertion. If a plyr.fm moderator
independently labeled the track, that operator label and its default-hide policy
remain until the moderation decision is reversed.

## artwork guidelines

track artwork is displayed as a square across the app — in lists, the player, and on track pages. for best results:

- **use square images** (1:1 aspect ratio) — at least **500 × 500 px** for clarity at all display sizes
- **supported formats**: JPG, PNG, WebP, or GIF
- **max file size**: 20 MB

non-square images are automatically center-cropped to fit a square frame. if your artwork is wider than it is tall, the left and right edges are trimmed; if taller, the top and bottom are trimmed. there's no manual crop tool, so square images give you full control over what's visible.

album and playlist covers accept the same formats except GIF.

## embeds

share your audio anywhere with embed iframes. plyr.fm supports track, playlist, album, and radio embeds.

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

### album embed

```html
<iframe
  src="https://plyr.fm/embed/album/{handle}/{album_slug}"
  width="100%"
  height="352"
  frameborder="0"
  allow="autoplay; encrypted-media"
  loading="lazy"
></iframe>
```

### radio embed

a live widget for [plyr.fm radio](https://plyr.fm/radio) with a tuner dial for flipping stations:

```html
<iframe
  src="https://plyr.fm/embed/radio"
  width="100%"
  height="220"
  frameborder="0"
  allow="autoplay; encrypted-media"
  loading="lazy"
></iframe>
```

add `?station={slug}` (e.g. `?station=fresh`) to pin the initial station — an unknown slug falls back to the default station. iframes shorter than ~184px hide the tuner dial but keep the pinned station.

### autoplay

every embed accepts `?autoplay=1` to start playback as soon as it loads:

```
https://plyr.fm/embed/radio?station=fresh&autoplay=1
```

two caveats:

- the embedding page must grant permission with `allow="autoplay"` on the iframe (all the examples above do).
- browsers may still block audible autoplay until the visitor has interacted with the embedding site. when blocked, the embed stays paused — no error, just the normal click-to-play state.

the full [radio page](https://plyr.fm/radio) also accepts `?autoplay=1`, useful for browser-source overlays (e.g. OBS) where nothing can click play.

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

supporter gating is separate from the experimental permissioned-data path described below.
It has a shared audience, so it remains on plyr.fm's authenticated storage until the
ecosystem has an interoperable audience and revocation model.

we'd also like to support more expressive gating — tiers, time-limited early access, per-track pricing — as the ecosystem matures.

## private tracks

:::caution[experimental]
private tracks appear only when your PDS supports the evolving ATProto permissioned-data
proposal. Most PDSes do not support it yet.
:::

Choosing **private** stores the track record and audio in an artist-owned permissioned
space on your PDS. There is no public record or R2 copy. The track is hidden from feeds,
search, profiles, albums, and playlists, and only you can view or play it through plyr.fm.

The first time you choose private media, plyr.fm may ask you to approve an additional OAuth
permission. Playback is proxied through plyr.fm because browsers do not hold the short-lived
space credential needed to fetch the blob directly.

This is not the same as **unlisted** (anyone who finds an unlisted track can play it) or
**supporters only** (active supporters can play it). Broader permissioned sharing and
third-party catalog interoperability are still being designed against
[ATProto Proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data).

## copyright detection

every upload is automatically scanned for copyrighted audio. if the scan finds a likely match, your track gets a **yellow ⚠ marker** in the [portal](https://plyr.fm/portal) — tap or hover it to see what was matched.

### what a match means

a match is a **flag for review, not a takedown**. your track stays up and playable. the marker is there so you (and plyr.fm) know the audio resembles a known recording — it's a heads-up, not an accusation.

matches can be wrong. common false positives:

- **samples and loops** reused across many songs
- **covers, remixes, and mashups** — legal gray areas, not necessarily infringement
- **similar chord progressions or drum patterns**
- coincidental audio artifacts

that's why a match is flagged rather than auto-enforced — a human decides whether anything actually needs to happen.

### how the scan works

after your upload finishes, plyr.fm scans the audio against [AudD](https://audd.io/)'s recognition database in short segments. the more of your track that consistently matches the *same* recording, the stronger the signal. a match that carries an [ISRC code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) (a unique recording identifier) is strong evidence of a specific recording, not just similar-sounding audio.

if you believe a match is a false positive, or you hold the rights to the matched work, [get in touch](https://plyr.fm) — nothing about the flag is automatic or final.

## sensitive content labels

plyr.fm uses the global AT Protocol labels `sexual` and `porn` for adult audio.
They are content warnings, not takedowns: the track and its ATProto record remain
in place, while plyr.fm hides the track and blocks playback by default. The
creator can always see and play their own track.

enable **contains adult or sexual audio** during upload, or change the content
notice later in the track editor. The notice is stored with your track as a
standard ATProto self-label and immediately participates in plyr.fm's
default-hide policy. It remains separate from any independent moderator label.
See [sensitive content](/sensitive-content/) for the listener behavior.

## your data

![the artist portal — manage your profile, tracks, and albums](/screenshots/portal-dashboard.png)

every track you upload is tied to [your account](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io) — you can inspect your records in a [PDS viewer](https://pdsls.dev), and they travel with you if you move to a different host.

if your host has a size limit that prevents storing the audio file directly (common on shared hosting), plyr.fm stores the audio in its own CDN instead. the metadata always stays with your account either way.

the [portal](https://plyr.fm/portal) offers a **bulk export** — it packages your tracks as a ZIP (using lossless originals when available) that you can download directly.

see the [lexicons overview](/lexicons/overview/) for the full record schema.

## leaving

you can leave plyr.fm at any time. download your tracks as a ZIP from the [portal](https://plyr.fm/portal), then delete your account — this removes all data from plyr.fm's infrastructure. your atproto records stay on your PDS by default, but you can choose to delete those too. for the full technical details, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/offboarding.md).
