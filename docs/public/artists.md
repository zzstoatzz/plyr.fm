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
- its record is tied to your atmosphere identity; audio storage depends on your access choices and host
- choose who can listen and download, including public listening without an account
- you can [embed a player](#embeds) on your website or blog
- you can [gate tracks](#supporter-gated-tracks) behind supporter status

public records can be read by other compatible apps. protected audio remains subject to its access rules; private Spaces require their host's authorization. you can export your catalog from [Portal → manage](https://plyr.fm/portal/manage).

## your first upload

1. **sign in** at [plyr.fm](https://plyr.fm) with your atmosphere account (e.g. `you.bsky.social`)

   ![plyr.fm sign-in page — enter your atmosphere account to get started](/screenshots/login-page.png)

2. **upload** — click **upload** in the header (or **upload track** in the [portal](https://plyr.fm/portal)), give the track a title, and choose your audio file: MP3, WAV, M4A, FLAC, or AIFF (`.aif` works too), up to 1.5 GB (1536 MB) per file. as soon as you pick it, the form shows what it knows about the file — format, size, length, a waveform for shorter tracks, and a play button to check it's the right one — without sending anything. nothing leaves your browser until you press **upload track**, so picking the wrong file costs nothing.

   releasing several tracks together? switch the toggle at the top from **track** to **album**, give the album a title and cover art, and use **choose files** to add every track at once.

   ![the upload form — title, audio file, description, album, tags, and artwork](/screenshots/upload-form.png)

3. **add details** — the same form takes an optional description (liner notes, credits), an album, featured artists, tags, and artwork. see [artwork guidelines](#artwork-guidelines) for format and size recommendations

   <span id="auto-tagging"></span>under tags you can tick **auto-tag with recommended genres** — plyr.fm runs [ML genre classification](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/backend/genre-classification.md) on the audio using the [effnet-discogs](https://replicate.com/mtg/effnet-discogs) model and adds the recommended genres as tags once classification finishes. whether or not you tick it, the track editor shows **suggested** tags you can add with a tap, and you can remove any tag you don't want.

   <span id="ai-generated-audio"></span>if a track is AI-generated, tag it `ai`. listeners hide `ai`, `ai-slop`, and `suno` tags by default, so these tracks stay out of the latest feed and for you unless a listener chooses to see them, and radio airs them only on the [slop](https://plyr.fm/radio/slop) station. they still appear on your artist page and in search.

4. **choose who can listen** — the form shows a one-line summary of your [music access](#music-access) defaults. open **change for this track** to set this track differently. if the track contains sexually explicit audio, tick the [content notice](#adult-audio-and-content-notices)

5. **publish it** — confirm you have the right to distribute the audio, then press **upload track**. a progress notice follows the file through processing and ends with a **view track** link. MP3, WAV, M4A, and FLAC play right away; a public AIFF publishes immediately with your original kept, while a smaller streaming copy is prepared in the background — until it lands, browsers that can't play the original show the track as *still processing — playable shortly*. tracks with restricted listening or downloads publish once their protected playback copy is ready

6. **edit it later** — find the track in the [portal](https://plyr.fm/portal) and choose **edit track** to change its details, artwork, access, or content notice. under **audio & version history** you can replace the audio or restore an earlier version

   ![the track editor — title, description, album, tags, artwork, and suggested tags](/screenshots/portal-track-editor.png)

7. **embed it** — put a player on your website or blog using the snippets in [embeds](#embeds) below

once you've shared more than 24 hours of audio, the upload page may show a card asking you to sponsor plyr.fm, with what your copyright scans have cost so far. it's optional, never blocks uploading, and **dismiss for 30 days** hides it.

## music access

set your defaults in [Portal → manage](https://plyr.fm/portal/manage#music-access)
under **music access**, then **save profile**. new accounts start with anyone
able to listen and download. existing artists' saved download choices are
preserved.

uploads show a short summary and use your defaults. open **change for this
track** (or **change for this album**) to set a specific work differently. album
uploads share settings across their tracks; individual tracks can override them.
when editing an album, applying settings preserves track exceptions unless you
explicitly choose to replace them.

Portal defaults affect **future uploads**. changing them does not rewrite your
existing catalog. use the track or album controls to change published works.

listening, downloads, discovery, and rights information are separate:

- **listening** controls who can play the track. unticking **anyone can
  listen** reveals the audience choices: only me, signed-in listeners, verified
  supporters, and — when your PDS supports it — my Space members.
- **downloads** controls who can obtain the original file. unticking **anyone
  can download** lets you choose only me or verified supporters. public
  listening with downloads off lets people hear your work without offering the
  master.
- **show in feeds** (under **more options**) controls public discovery. an
  unlisted track can still appear on your artist page, in albums, playlists,
  and search; unlisted is not private.
- **attach rights information** adds the rights metadata you set up in Portal.
  adding or removing it does not change listening or download permissions.
  this option only appears on accounts where the rights feature is enabled.

restricted listening with open downloads still allows people to download the
original. choose both settings deliberately. **ask for support before
downloading** (under **more options**) is optional; it does not enforce a
payment or subscription.

### protected audio

restricted originals and listening use plyr.fm-managed protected storage when
native Spaces are not being used. public listening uses a separate playback
rendition when the original must remain protected.

downloads off does not prevent recording or saving playback. restricting an
existing track also cannot recall files that were already public or downloaded.
a compatible PDS becoming available does not automatically migrate your audio
into Spaces.

## adult audio and content notices

if a track contains adult or sexual audio, tick **contains sexually explicit
audio** under **content notice** when uploading it. You can change the notice
later under **content notice** in the track editor.

the notice is stored with your track in your ATProto repository. On plyr.fm,
noticed tracks are hidden from discovery feeds, search, and radio unless a
signed-in listener has enabled sensitive audio in their settings. **Your own
artist page still lists them, and a direct link still follows your listening permissions** — the
notice changes where your track surfaces, not whether someone you send it to
can hear it, and not how your catalogue looks to someone who came to find you.
You always see your own noticed tracks, whatever your own settings say. See
[moderation](/moderation) for exactly which surfaces are affected.

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

share your audio anywhere with embed iframes. plyr.fm supports track, playlist, album, artist, and radio embeds. there's no copy-embed button yet — paste a snippet below and fill in the id from the page's address: `plyr.fm/track/{track_id}`, `plyr.fm/playlist/{playlist_id}`, or `plyr.fm/u/{handle}/album/{album_slug}`.

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

### artist embed

your latest tracks, with your avatar and a link back to your profile:

```html
<iframe
  src="https://plyr.fm/embed/u/{handle}"
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

paste a plyr.fm track, playlist, or album link into any oEmbed-compatible platform and it will render a player automatically. private tracks never resolve through oEmbed.

## supporter-gated tracks

:::caution[experimental]
this feature is early and has limitations — see below.
:::

plyr.fm lets artists gate tracks behind supporter status, verified through attested.network payment attestations and [ATProtoFans](https://atprotofans.com). when a listener tries to play a gated track, plyr.fm checks whether they support the artist — if they do, they get access; if not, the track is locked.

today this is a **binary check**: a listener either supports you or they don't. there are no tiers, amounts, or expiration windows. listening and download permissions each use the audience you selected.

### how it works

1. in [Portal → manage](https://plyr.fm/portal/manage), set your **support link** to **atprotofans** (choose **set up** first if you don't have an ATProtoFans profile yet), so listeners have a way to support you
2. choose **verified supporters** under **who can listen?** (and, if you like, **who can download?**) for the track, or in your Portal music access defaults
3. when a listener hits play, plyr.fm checks their support status — an attested.network payment attestation first, then ATProtoFans. results are cached for up to five minutes, so a brand-new supporter may need to wait that long
4. supporters get access; everyone else sees a lock

### how gated audio is stored

gated audio lives in a **private bucket** on plyr.fm's infrastructure — not publicly accessible. when a supporter plays a gated track, plyr.fm validates their support status and generates a time-limited presigned URL. downloads follow their separate policy; choosing open downloads makes the original available even when listening is restricted.

supporter gating is separate from the experimental permissioned-data path described below.
It has a shared audience, so it remains on plyr.fm's authenticated storage until the
ecosystem has an interoperable audience and revocation model.

we'd also like to support more expressive gating — tiers, time-limited early access, per-track pricing — as the ecosystem matures.

## private tracks

:::caution[experimental]
private tracks appear only when your PDS supports the evolving ATProto permissioned-data
proposal. Most PDSes do not support it yet.
:::

Choosing **my Space members** under **who can listen?** stores the track record and audio
in an artist-owned permissioned space on your PDS. There is no public record or R2 copy. The
track is hidden from feeds, search, profiles, albums, and playlists. You and the people you
add under **private tracks** in [Portal → manage](https://plyr.fm/portal/manage) can view and
play it through plyr.fm; listed people need an account on a PDS that supports permissioned
data and must have signed in to plyr.fm.

Private audio is stored exactly as uploaded, so it must be web-playable — MP3, WAV, M4A, or
FLAC. convert an AIFF before choosing this audience. private tracks are not copyright-scanned
or auto-tagged, have no listener downloads yet, and can't be part of an album upload.

The first time you choose private media, the upload button reads **approve private media**
and plyr.fm asks you to approve an additional OAuth permission; your draft is kept and the
upload continues once you approve. Playback is proxied through plyr.fm because browsers do
not hold the short-lived space credential needed to fetch the blob directly.

This is not the same as **unlisted** (metadata remains discoverable and listening follows its own policy) or
**supporters only** (active supporters can play it). Broader permissioned sharing and
third-party catalog interoperability are still being designed against
[ATProto Proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data).

## copyright detection

every upload (except private Space tracks) is automatically scanned for copyrighted audio, and replacing a track's audio scans it again. if the scan finds a likely match, your track gets a **yellow ⚠ marker** in the [portal](https://plyr.fm/portal) — tap or hover it to see what was matched.

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

if you believe a match is a false positive, or you hold the rights to the matched work, [get in touch](mailto:help@plyr.fm) — nothing about the flag is automatic or final.

## sensitive content labels

plyr.fm uses the global AT Protocol labels `sexual` and `porn` for adult audio.
They are content warnings, not takedowns: the track and its ATProto record remain
in place. plyr.fm hides the track from discovery by default, while artist pages,
collections, and direct links still follow the work’s visibility and listening permissions. Shared radio and
jams exclude adult-labeled audio. The creator can always manage it in the portal.

tick **contains sexually explicit audio** during upload, or change the content
notice later in the track editor. The notice is stored with your track as a
standard ATProto self-label and immediately participates in plyr.fm's
default-hide policy. It remains separate from any independent moderator label.
See [sensitive content](/sensitive-content/) for the listener behavior.

## downloads

listeners can download a track when its saved download policy permits it.
album ZIPs require permission for every included track; they do not bypass a
track's restrictions. files are named after you and your titles, preferring the
lossless original when available.

downloads can be open to anyone, limited to you (only me) or verified supporters,
or open with an optional **ask for support before downloading** prompt. rights
metadata does not itself forbid downloads. native private Space tracks currently
support playback, not a separate listener download.


## your data

![the artist portal — manage your profile, tracks, and albums](/screenshots/portal-dashboard.png)

every track you upload is tied to [your account](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io) — you can inspect your records in a [PDS viewer](https://pdsls.dev), and they travel with you if you move to a different host.

public audio may be stored as a PDS blob or on plyr.fm when the host cannot accept it. protected managed audio stays in private plyr.fm storage. native private works use their PDS Space. moving your account does not by itself move these managed audio files into a Space.

[Portal → manage](https://plyr.fm/portal/manage) offers a bulk export under **your data → export tracks** — it packages your tracks as a ZIP (using lossless originals when available) that you can download directly.

FLAC uploads stream as uploaded. for AIFF uploads, plyr.fm keeps the original alongside the MP3 streaming copy. either way, listeners whose browsers can play the lossless file get it and see a lossless marker on the track.

see the [lexicons overview](/lexicons/overview/) for the full record schema.

## leaving

you can leave plyr.fm at any time. download your tracks as a ZIP from [Portal → manage](https://plyr.fm/portal/manage), then choose **delete account** under **your data** — this removes all data from plyr.fm's infrastructure. your atproto records stay on your PDS by default, but you can choose to delete those too. for the full technical details, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/offboarding.md).
