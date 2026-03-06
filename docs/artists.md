---
title: "for artists"
---

plyr.fm gives artists a place to share music where **you own your data**. every track you upload is an [ATProto](https://atproto.com) record stored in your personal data server — portable, verifiable, and yours.

## uploading

1. sign in at [plyr.fm](https://plyr.fm) with your [Atmosphere](https://atproto.com) account (Bluesky, BlackSky, etc.)
2. click **upload** and drop your audio files
3. add a title, tags, and optional cover art
4. your track is live — stored in your PDS and indexed by plyr.fm

supported formats: MP3, WAV, FLAC, AAC, OGG. files are transcoded for streaming automatically.

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

## your data

because tracks are ATProto records, you can:

- **[export](https://plyr.fm/portal)** your entire catalog from your PDS at any time
- **migrate** to a different PDS without losing anything

your music lives in your repo under the `fm.plyr.track` collection. see the [lexicons overview](/lexicons/overview/) for the full schema.
