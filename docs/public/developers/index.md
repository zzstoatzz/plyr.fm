---
title: "for developers"
description: "build on plyr.fm — API, lexicons, and architecture"
---

open API, open data, open protocol. build a player, a recommendation engine, or something nobody's thought of yet.

plyr.fm exposes a public API, a Python SDK, and an MCP server. public track data is
portable ATProto records, verifiable and queryable by any client. Experimental private
tracks instead use credential-gated permissioned records and are not part of the public
repository or API surface.

## using a coding assistant?

Start with [for agents](/developers/agents/) or [llms.txt](https://plyr.fm/llms.txt)
for interface selection, result contracts, and a search → track-detail workflow.

paste this into Claude Code, Cursor, or similar to get started:

```
i want to build an integration with plyr.fm. the API docs are at
https://docs.plyr.fm/developers/api-reference/ and the OpenAPI spec is at
https://api.plyr.fm/openapi.json. the Python SDK is `plyrfm` (uv add plyrfm).

public endpoints (no auth): search, list tracks, stream audio, top tracks,
tags, albums, playlists, RSS feeds, oEmbed. authenticated endpoints require
a developer token from plyr.fm/settings#developer.
```

## get started

1. **[quickstart](/developers/quickstart/)** — find a track and inspect its audio
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
for track in client.tracks.list(limit=5):
    print(f"{track.id}: {track.title} by {track.artist}")

# get a specific track
track = client.tracks.get(42)
```

account operations (upload and manage your tracks) require a [developer token](/developers/auth/):

```python
client = PlyrClient(token="your_token")
my_tracks = client.tracks.my()
client.tracks.upload("song.mp3", "My Song")
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

The hosted endpoint is `https://plyrfm.fastmcp.app/mcp`. The MCP is read-only: it
searches and inspects tracks, libraries, and playlists. Use the SDK, CLI, or HTTP
API for authorized changes. See [for agents](/developers/agents/) for the tool
groups, authentication, and verification workflow.

## ATProto lexicons

all plyr.fm data uses custom ATProto lexicons under the `fm.plyr` namespace. see the [lexicons overview](/lexicons/overview/) for schemas and record types.

## contributing

plyr.fm is open source. see the [contributing guide](/contributing/) to get involved.
