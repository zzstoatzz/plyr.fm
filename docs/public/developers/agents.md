---
title: "for agents"
description: "choose a plyr.fm interface, discover audio, and verify what happened"
---

start at [plyr.fm/llms.txt](https://plyr.fm/llms.txt), also available on the
[docs domain](https://docs.plyr.fm/llms.txt). This guide is available as
[plain Markdown](https://docs.plyr.fm/agents.md).

plyr.fm offers public audio discovery and authenticated library management.
An integration should be able to find a track, inspect what it found, and hand
back a playable link. Publishing or changing a library is a separate action
that needs the user's authorization.

## choose an interface

| task | interface | starting point |
| --- | --- | --- |
| search and browse from a tool-calling agent | hosted MCP | `https://plyrfm.fastmcp.app/mcp` |
| compose a workflow in Python | SDK | `uv add plyrfm`; `PlyrClient` or `AsyncPlyrClient` |
| use a terminal | CLI | `uvx plyrfm --help` |
| build a client or inspect exact responses | HTTP | `https://api.plyr.fm/openapi.json` |
| listen in a browser | app | `https://plyr.fm/track/{id}` |

The SDK, CLI, and MCP are maintained in
[plyr-python-client](https://github.com/zzstoatzz/plyr-python-client). The MCP
exposes read operations; the SDK, CLI, and HTTP API also support mutations.
Use the live OpenAPI schema for HTTP details and installed CLI help for commands.

## discover the MCP

Connect your MCP client to `https://plyrfm.fastmcp.app/mcp`, or launch
`uvx plyrfm-mcp` as a local stdio server. Public catalog tools need no token.
For account reads, the local server accepts `PLYR_TOKEN`; the hosted server
accepts the `x-plyr-token` header. Create tokens in
[settings → developer](https://plyr.fm/settings#developer).

Discover tools when connecting. The current groups are:

- **find audio:** `search`, `top_tracks`, `list_tags`, `tracks_by_tag`, `list_tracks`
- **inspect a selection:** `get_track`, `get_playlist`, `playlists_by_artist`
- **read your library:** `my_tracks`, `liked_tracks`, `list_playlists`, `list_revisions`
- **explore a playlist:** `playlist_recommendations`

Library reads and playlist recommendations require authentication; revision reads
also require ownership.
A tool's presence does not mean the current caller can read every resource.

## find something, then inspect it

```text
search(query="ambient", type="tracks", limit=5)
→ results with type, id, title, artist, and relevance
get_track(track_id=<chosen result id>)
→ track metadata and an audio URL
```

Search accepts 2–100 characters. `type` uses plural names such as `tracks`,
`artists`, `albums`, `tags`, or `playlists`; each result has a singular `type`
discriminator. The limit is per type, from 1 to 50. `counts` counts returned
results, not every match in the catalog. There is no search offset; narrow the
query, or use the browse endpoints documented in OpenAPI.

Search is lexical/fuzzy matching. Do not treat a title match as evidence of a
track's sound. Mood search is a separate, feature-flagged app capability; the
MCP search tool exposes the lexical search interface.

Read the chosen track's description and tags, and distinguish its identifiers:

- `id` identifies the track in this plyr.fm environment.
- `atproto_record_uri` is its ATProto record address, when available. Resolve a
  known public URI through `GET /tracks/by-uri?uri=...`.
- `file_id` identifies audio storage; it is not a track ID.
- `r2_url` in HTTP and hosted MCP JSON responses is the audio URL. Python SDK
  objects expose it as `audio_url`. The URL may point to a CDN or an authenticated route.

Inspect `visibility`, `gated`, and any labels before offering access. Missing
metadata and null duration are unknown values. The full HTTP response can
contain fields that a released SDK/MCP model does not yet expose.

## listen, share, or download

Return the track page, `https://plyr.fm/track/{id}`, when the user wants to
listen. MCP discovery does not control the web player's queue or start audio
in the user's browser.

For a custom player, use the returned audio URL and handle redirects and access
errors. There is no `/tracks/{id}/stream` endpoint. A metadata lookup succeeding
proves the record was found; an audio request succeeding proves bytes are
reachable; neither proves that playback started on the user's device.

Downloads follow the artist's policy and the dedicated download endpoints.
Streaming availability alone does not establish download permission. See the
[creator guide](/artists/#downloads) for the current behavior.

## make an authorized change

Use the SDK, CLI, or HTTP API for uploads, likes, comments, and playlist edits.
Obtain the user's authorization for the intended change; possessing a token is
not itself authorization. Public writes may also publish to the user's PDS.

After a write, read the resource again: check the track detail after editing it,
or the playlist's ordered tracks after changing its contents. An upload may
finish before background audio optimization, PDS mirroring, or indexing finishes.
If a request times out, inspect state before repeating a create operation so you
do not publish duplicates.

A browser session uses an HttpOnly cookie. Scripts use a developer token in the
Authorization header. Keep credentials out of links, logs, examples, and public
files. A 401 needs valid authentication; a 403 can indicate missing scope,
ownership, or access. Read the error detail before choosing a remedy.

## what is portable, and what is private

Public tracks, likes, comments, and public playlists use ATProto records.
Private playlists remain in plyr.fm's database. Experimental private tracks use
permissioned data on a compatible PDS; supporter-gated tracks use a separate
access check. These are distinct capabilities, not interchangeable labels.

Discovery filtering also differs from access control. Adult-audio labels affect
where tracks are suggested, while a direct link can still play. Private and
supporter-gated audio have access requirements. The
[moderation table](/moderation/#the-full-picture) describes each surface.

## check the whole workflow

A useful read-only integration check is:

1. Fetch `/llms.txt` from the app and follow the OpenAPI link. Check the body and
   content type, not only a successful status code.
2. Search for a known term and inspect the typed results.
3. Fetch one returned track ID and confirm its identity matches the selection.
4. Produce the track page and inspect its audio URL. If testing audio delivery,
   fetch only what the test needs and verify the response is audio.
5. For MCP, rediscover tools and run the same search → detail flow. Verify that
   unauthenticated library reads report the missing authentication clearly.

Do not issue likes, uploads, or play-count writes as a connectivity test.
The [quickstart](/developers/quickstart/) contains executable SDK and HTTP examples.
