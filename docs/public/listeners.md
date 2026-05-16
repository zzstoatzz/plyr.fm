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

your records live on [your own data repo](https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io) — take them with you to any other atproto audio app whenever you want, no migration step.

even today, other apps (like [aetheros.computer](https://aetheros.computer)) already use plyr.fm records to provide an [alternate user interface to audio stored on plyr.fm](https://bsky.app/profile/plyr.fm/post/3mh23kjcelc2u).

## your first 5 minutes

1. **sign in** — go to [plyr.fm](https://plyr.fm) and enter your atmosphere account (e.g. `you.bsky.social`)

   ![plyr.fm sign-in — enter your atmosphere account to get started](/screenshots/login-page.png)

2. **find a track** — browse the feed to see what's playing

   ![the feed shows top tracks and latest uploads](/screenshots/landing-page.png)

   or hit `Cmd+K` to search for something specific

   ![Cmd+K search overlay](/screenshots/search-overlay.png)

3. **play it** — click any track to start streaming

   ![a track card showing title, artist, tags, and play count](/screenshots/feed-track-card.png)

4. **like it** — click the three-dot menu on any track and hit "add to liked"
5. **build a playlist** — click "add to playlist" from the same menu, name your collection

   ![track actions menu — like, add to playlist, queue, share](/screenshots/track-actions-menu.png)

   playlists can be **public** (published to your atmosphere account, readable by any compatible app) or **private** (stays in plyr.fm). private playlists live in plyr.fm's database for now because the part of the AT Protocol that supports shared-but-permissioned data ([permissioned spaces](https://github.com/bluesky-social/atproto/compare/permissioned-data)) is still being designed upstream — once it ships, private and selectively-shared playlists will move to your atmosphere account too.

to track and [visualize your listening history](https://teal-appview-production.up.railway.app/), you can [enable teal.fm scrobbling in your settings](https://plyr.fm/settings).

## what's here

- **stream audio** — music, podcasts, sound art, whatever creators publish
- **like, comment, and build playlists** — public (visible to other atproto apps) or private
- **timed comments** — leave a reaction at a specific moment in a track
- **jams** — shared listening rooms, in real time with friends

your records — likes, playlists, comments — are stored on your [PDS](/glossary/#pds), the same place a Bluesky post lives. they belong to your atmosphere account, not to plyr.fm.

## keyboard shortcuts

| key | action |
|-----|--------|
| `space` | play / pause |
| `j` | previous track |
| `l` | next track |
| `q` | toggle queue |
| `cmd+k` | search |
| `m` | mute / unmute |

## leaving

you can leave anytime (we're sad to see you go 😢). to delete your account and all your data from plyr.fm, go to the [portal](https://plyr.fm/portal) and click "delete account". for full detail on what gets deleted, see the [offboarding documentation](https://github.com/zzstoatzz/plyr.fm/blob/main/docs/internal/offboarding.md).

## even after you leave

feel free to listen without signing in :) we're not mad at you
