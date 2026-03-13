---
title: "for developers"
description: "build on plyr.fm — API, lexicons, and architecture"
---

open API, open data, open protocol. build a player, a recommendation engine, or something nobody's thought of yet.

plyr.fm exposes a public API, a Python SDK, and an MCP server. all track data is atproto records — portable, verifiable, and queryable by any client.

## using a coding assistant?

paste this into Claude Code, Cursor, or similar to get started:

```
i want to build an integration with plyr.fm. the API docs are at
https://docs.plyr.fm/developers/api-reference/ and the OpenAPI spec is at
https://api.plyr.fm/docs. the Python SDK is `plyrfm` (uv add plyrfm).

public endpoints (no auth): search, list tracks, stream audio, top tracks,
tags, albums, playlists, RSS feeds, oEmbed. authenticated endpoints require
a developer token from plyr.fm/portal.
```

## get started

1. **[quickstart](/developers/quickstart/)** — build a track player in 30 lines
2. **[API reference](/developers/api-reference/)** — endpoints, request/response examples, error codes
3. **[auth](/developers/auth/)** — OAuth flow, developer tokens, scoped requests

## Python SDK

```bash
uv add plyrfm
```

```python
from plyrfm import PlyrClient

client = PlyrClient()

# list tracks
for track in client.list_tracks(limit=5):
    print(f"{track.id}: {track.title} by {track.artist}")

# get a specific track
track = client.get_track(42)
```

authenticated operations (upload, download, manage your tracks) require a [developer token](/developers/auth/):

```python
client = PlyrClient(token="your_token")
my_tracks = client.my_tracks()
client.upload("song.mp3", "My Song")
```

see the [plyr-python-client repo](https://github.com/zzstoatzz/plyr-python-client) for full SDK docs.

## MCP server

the `plyrfm-mcp` package provides an MCP server for AI assistants:

```bash
uv add plyrfm-mcp
```

add to Claude Code:

```bash
claude mcp add plyr-fm -- uvx plyrfm-mcp
```

tools include `search`, `list_tracks`, `top_tracks`, `tracks_by_tag`, and more. see the [repo](https://github.com/zzstoatzz/plyr-python-client) for setup options.

## ATProto lexicons

all plyr.fm data uses custom ATProto lexicons under the `fm.plyr` namespace. see the [lexicons overview](/lexicons/overview/) for schemas and record types.

## contributing

plyr.fm is open source. see the [contributing guide](/contributing/) to get involved.
