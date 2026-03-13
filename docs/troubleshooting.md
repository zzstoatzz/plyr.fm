---
title: "troubleshooting"
description: "common issues and solutions for plyr.fm"
---

## authentication

### OAuth login fails or loops

**symptom**: clicking "log in" redirects to your PDS but returns an error, or you end up back at the login page.

**solutions**:
- check that your system clock is accurate — OAuth tokens are time-sensitive, and clock skew causes signature validation failures
- try a different PDS if your current one is unreachable (plyr.fm supports any ATProto PDS)
- clear your browser cookies for `plyr.fm` and try again
- if you see `scope_upgrade_required`, plyr.fm needs additional permissions — you'll be prompted to re-authorize

### session expired

**symptom**: you're suddenly logged out or see "not authenticated" errors.

**cause**: sessions last 14 days with auto-refresh. if the underlying OAuth token refresh fails (e.g. your PDS revokes the grant), the session becomes invalid.

**solution**: log in again. your data (likes, playlists, tracks) is stored on your PDS — nothing is lost.

### developer token stopped working

**symptom**: API calls with your token return 401.

**cause**: developer tokens rely on OAuth credentials that refresh automatically. if the refresh fails, the token becomes invalid.

**solution**: generate a new token at [plyr.fm/portal](https://plyr.fm/portal). you can revoke the old one from the same page.

## uploads

### upload fails or hangs

**solutions**:
- check file size — uploads are limited (see `GET /config` for current limits)
- supported formats: **MP3**, **WAV**, **M4A**. other formats will be rejected
- ensure you have a stable connection — large files (especially WAV) upload via streaming and can fail on intermittent connections
- check the upload progress indicator in the portal for status

### track appears without audio

**symptom**: track metadata shows up but clicking play does nothing or errors.

**cause**: the audio blob may have failed to upload to your PDS (blob size limits vary by PDS provider). plyr.fm falls back to R2 storage, but if both fail, the track has no playable audio.

**solution**: try re-uploading. if your PDS has strict blob limits, the audio will be stored on plyr.fm's CDN instead.

### tags not appearing

**symptom**: you added tags to a track but they don't show up in search or tag filters.

**cause**: genre classification runs as a background task after upload. auto-suggested tags appear once processing completes (usually within a few seconds).

**solution**: wait a moment and refresh. you can also manually edit tags from the track editor in the portal.

## playback

### audio won't play on iOS (PWA)

**symptom**: first play after backgrounding the app hangs or doesn't produce sound.

**known issue**: iOS PWA audio may hang on first play after the app has been in the background. this is an iOS-specific limitation with web audio in standalone mode.

**workaround**: tap play again, or close and reopen the app.

### audio continues after closing in-app browser

**symptom**: audio and lock screen controls persist after dismissing the in-app browser on iOS (e.g. opening a plyr.fm link from Bluesky).

**known issue**: this is an upstream iOS/Safari behavior — the audio context isn't properly cleaned up when `SFSafariViewController` is dismissed. [tracked on GitHub](https://github.com/zzstoatzz/plyr.fm/issues/779).

**workaround**: force-close the parent app (e.g. Bluesky) to stop playback.

### supporter-gated track locked

**symptom**: a track shows a lock icon and won't play.

**cause**: the artist has gated this track behind supporter status via [ATProtoFans](https://atprotofans.com). plyr.fm checks your support relationship on play.

**solution**: support the artist on ATProtoFans to unlock their gated tracks. any active support relationship grants access to all their gated content.

## embeds

### embed not rendering

**symptom**: pasting a plyr.fm link into a website or social media doesn't show an embedded player.

**solutions**:
- use the iframe embed code from the track/playlist/album page (click "embed")
- for automatic rendering, the platform must support [oEmbed](https://oembed.com/). plyr.fm's oEmbed endpoint is at `https://api.plyr.fm/oembed?url=YOUR_LINK`
- check that the embed URL format is correct: `https://plyr.fm/embed/track/{id}`, `https://plyr.fm/embed/playlist/{id}`, or `https://plyr.fm/embed/album/{handle}/{slug}`

### embed shows wrong dimensions

**solution**: adjust the `width` and `height` attributes on the iframe. the embed player is responsive and adapts to container size. recommended heights: 152px for tracks, 352px for collections.

## PDS sync

### records not appearing on plyr.fm

**symptom**: you created a track record directly on your PDS (e.g. via another ATProto client) but it doesn't show up on plyr.fm.

**cause**: plyr.fm indexes records via [Jetstream](https://docs.bsky.app/blog/jetstream) (real-time ATProto firehose). records should appear within a few seconds. if they don't:
- verify the record uses the correct lexicon (`fm.plyr.track`) and is well-formed (see [lexicons overview](/lexicons/overview/))
- check that the record has either an `audioUrl` or `audioBlob` — records without audio are rejected during ingest
- `audioUrl` must point to a trusted origin (plyr.fm's CDN) — arbitrary URLs are rejected for security

### data migration between PDS providers

migrating your PDS (e.g. from bsky.social to a self-hosted instance) preserves your ATProto records. plyr.fm will re-index your records from your new PDS the next time you log in.

## general

### something else broken?

- check [STATUS.md](https://github.com/zzstoatzz/plyr.fm/blob/main/STATUS.md) for known issues and active work
- open an issue on [GitHub](https://github.com/zzstoatzz/plyr.fm/issues)
- email [plyrdotfm@proton.me](mailto:plyrdotfm@proton.me)
