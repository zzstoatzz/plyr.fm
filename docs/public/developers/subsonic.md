---
title: "use plyr from your Subsonic app"
description: "sign in to plyr.fm from a Subsonic-compatible music app with a developer token"
---

plyr.fm answers the Subsonic API, so a Subsonic-compatible music app can browse
plyr.fm albums, play tracks, and count your listens. The surface is
**experimental**: it covers browsing and playback, and several common Subsonic
features are missing (see [what doesn't work](#what-doesnt-work)).

It was built by pointing Amperfy and Shelv at it and fixing what they needed. Other
Subsonic-compatible clients may work; they haven't been exercised.

## what you need

- a plyr.fm account
- a [developer token](/developers/auth/#developer-tokens), created at
  [plyr.fm/settings#developer](https://plyr.fm/settings#developer). Your
  browser login is not accepted; it has to be a developer token.

A developer token is a full API credential for your account, not a read-only
one. Give it a name you'll recognize (for example, the app's name) so you can
revoke just that one from settings later. Revoking it signs the app out.

## set up the app

Add a new server in your app's settings and enter:

| field | value |
| --- | --- |
| server URL | `https://api.plyr.fm` |
| username | your handle (for example `you.bsky.social`) or your DID |
| password | your developer token |

Apps add `/rest` themselves; enter the server URL without it.

Both Subsonic sign-in styles work: sending the password directly, and the
token-and-salt scheme most apps use by default. With the token-and-salt
scheme the username must be the handle or DID the token belongs to.

Apps that save a server through Navidrome's sign-in (Shelv does this) also
work: plyr.fm answers that sign-in with the same username and developer token.

To check the server without an app, a request with no credentials should come
back as a Subsonic error envelope, not an HTTP error:

```bash
curl 'https://api.plyr.fm/rest/ping.view?f=json&v=1.16.1&c=test'
```

```json
{"subsonic-response":{"status":"failed","version":"1.16.1","type":"plyr.fm",
 "serverVersion":"0.0.0","openSubsonic":true,
 "error":{"code":10,"message":"required parameter is missing: p or u+t+s"}}}
```

## what works

Your library in the app is the plyr.fm catalog, not only your own uploads.

| in the app | Subsonic method |
| --- | --- |
| connection check | `ping`, `getLicense`, `getMusicFolders` (one folder, "plyr.fm") |
| albums: newest, random, most played, A–Z | `getAlbumList`, `getAlbumList2`, `getAlbum` |
| artists | `getArtists`, `getArtist` |
| your playlists | `getPlaylists`, `getPlaylist` |
| shuffle | `getRandomSongs` |
| a single track | `getSong` |
| playback | `stream` |
| downloads | `download` |
| artwork for tracks, albums, and playlists | `getCoverArt` |
| play counts | `scrobble` |

Responses come in XML by default, or JSON with `f=json`. Methods accept `GET`
or `POST`, with or without the `.view` suffix.

- **albums** list only albums that have tracks you can see. "Most played"
  orders albums by their tracks' total plays.
- **tracks that aren't on an album** don't appear under any album or artist.
  You can reach them through shuffle and through playlists.
- **playlists** are the ones you own.
- **scrobbles** add to the track's play count, with repeat plays of the same
  track deduplicated. "Now playing" notifications are accepted but not
  counted. If teal.fm scrobbling is on in your settings and your token was
  granted that permission, the play is also sent to [teal.fm](https://teal.fm).

## which tracks you can play

The app follows the same rules as the website:

- **supporter-only and other gated tracks** appear in listings. They play when
  your account has listening access, for example as a supporter of that
  artist; otherwise the app gets a "not authorized" error for that track.
- **private tracks** appear only if you're the artist or have been given
  access.
- **adult-labeled audio** appears in albums, artists, and playlists, and is
  left out of shuffle. See [moderation](/moderation/).
- **copyright-de-listed tracks** don't appear.
- **downloads** follow each track's download setting and prefer the original
  upload (for example, lossless) when there is one.

## what doesn't work

Methods plyr.fm doesn't implement return a Subsonic error with code `0` and the
message "*method* is not implemented", rather than an HTTP error. Missing today:

- **search**: `search2` and `search3`. Your app's search box won't return
  results from plyr.fm. Use [plyr.fm](https://plyr.fm) or the [HTTP API](/developers/quickstart/)
  to find things.
- **favorites**: starring and unstarring, and starred lists. Your plyr.fm
  likes don't appear in the app.
- **playlist editing**: playlists are read-only from the app.
- **genres**: the genre list is always empty.
- **folder browsing**: `getIndexes` and `getMusicDirectory`.
- **transcoding**: `stream` ignores `format` and `maxBitRate`. The app gets the
  file plyr.fm stores for streaming, at its original bitrate.
- lyrics, play queues, bookmarks, podcasts, internet radio, sharing, and
  user management.

## next steps

- [authentication](/developers/auth/): creating, expiring, and revoking
  developer tokens
- [quickstart](/developers/quickstart/): the HTTP API and Python SDK
- [sensitive content](/sensitive-content/): the adult audio setting
