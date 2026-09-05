---
title: "for listeners"
description: "discover and stream audio on plyr.fm"
---

you like sound. so do we.

<iframe
  src="https://plyr.fm/embed/track/778"
  width="100%"
  height="152"
  frameborder="0"
  allow="autoplay; encrypted-media"
  loading="lazy"
  title="a track on plyr.fm"
></iframe>

plyr.fm is an atproto-based audio app — music, podcasts, ASMR, ringtones, prayer, sound art, whatever gets recorded. you queue tracks, like them, build playlists, comment at specific moments.

:::caution[🚦]
no account? head to [plyr.fm/login](https://plyr.fm/login) to create one. you can also listen without signing in — you just won't be able to like, comment, build playlists, support creators, or save your preferences.
:::

when you find something you like:
- <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> **like it** — [how](#your-first-5-minutes)
- **add it to a playlist** — [how](#your-first-5-minutes)
- **leave a comment** at a specific moment in the track
- **support the creator** via [atprotofans](https://atprotofans.com), [ko-fi](https://ko-fi.com), or a custom link

your likes, comments, and public playlists live in [your personal data server](/glossary/#pds), where compatible apps can read them. private playlists stay in plyr.fm.

even today, other apps (like [aetheros.computer](https://aetheros.computer)) already use plyr.fm records to provide an [alternate user interface to audio stored on plyr.fm](https://bsky.app/profile/plyr.fm/post/3mh23kjcelc2u).

## your first 5 minutes

1. **sign in** — go to [plyr.fm](https://plyr.fm) and enter your atmosphere account (e.g. `you.bsky.social`)

   ![plyr.fm sign-in — enter your atmosphere account to get started](/screenshots/login-page.png)

2. **find a track** — browse the feed to see what's playing

   ![the feed shows top tracks and latest uploads](/screenshots/landing-page.png)

   or hit `Cmd+K` to search for something specific

   ![Cmd+K search overlay](/screenshots/search-overlay.png)

3. **play it** — click any track to start streaming. tap a track inside an album or playlist and the rest of that collection lines up behind it as "next from: \<collection\>"

   ![a track card showing title, artist, tags, and play count](/screenshots/feed-track-card.png)

4. **like it** — click the heart on a track or in the player, then choose "add to liked"
5. **build a playlist** — choose "add to playlist" from that same heart menu, then pick or create a playlist

   playlists can be **public** (published to your atmosphere account, readable by any compatible app) or **private** (stays in plyr.fm). private playlists are visible only to you and stay in plyr.fm’s database.

to track and [visualize your listening history](https://teal-appview-production.up.railway.app/), you can [enable teal.fm scrobbling in your settings](https://plyr.fm/settings).

## sensitive content

sensitive artwork and adult-labeled audio are hidden by default. Signed-in
listeners can turn both on together or manage artwork and audio separately in
[settings](https://plyr.fm/settings#privacy-display). Signed-out visitors cannot
opt in. See [sensitive content](/sensitive-content/) for how labels, direct
links, radio, and playback behave.

## what's here

- **stream audio** — music, podcasts, sound art, whatever creators publish
- **like tracks and build playlists** — choose public or private when creating a playlist
- **timed comments** — leave a reaction at a specific moment in a track
- **jams** — shared listening rooms, in real time with friends
- **downloads** — save a track, or a whole album as a zip, when the artist allows it

your likes, public playlists, and comments are stored on your [PDS](/glossary/#pds), the same place a Bluesky post lives. private playlists and app preferences stay in plyr.fm.

## downloads

most public audio can be downloaded — look for the download icon next to share on track and album pages. files come named (`artist - title.ext`) and prefer the lossless original when one exists; albums arrive as a numbered zip in the artist's track order. the first album download takes a minute to prepare — it's safe to leave, it stays ready once built.

if there's no download icon, the artist has switched downloads off, or the audio is supporter-gated or under a copyright notice.

## the player and queue

the player stays at the bottom while you browse. use its heart to like the current track or add it to a playlist, and its queue button to see what is next. the skip buttons move by 5, 10, or 15 seconds depending on track length.

open the queue to reorder upcoming tracks or shuffle them. enable **keep playing** in [settings](https://plyr.fm/settings) to continue with picks from your For You feed when your queue ends.

## keyboard shortcuts

| key | action |
|-----|--------|
| `space` | play / pause |
| `←` / `→` | seek back / forward 10 seconds |
| `j` | previous track |
| `l` | next track |
| `q` | toggle queue |
| `cmd+k` | search |
| `cmd+,` | open settings |
| `m` | mute / unmute |

## leaving

you can leave anytime (we're sad to see you go 😢). to delete your account and all your data from plyr.fm, go to the [portal](https://plyr.fm/portal) and click "delete account". for full detail on what gets deleted, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/offboarding.md).

## even after you leave

feel free to listen without signing in :) we're not mad at you
