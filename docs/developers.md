---
title: "for developers"
description: "build on plyr.fm — API, lexicons, and architecture"
---

plyr.fm exposes a public API, a Python SDK, and an MCP server. build players, analytics, recommendation engines, or integrations on top of the open data.

## API

the full OpenAPI spec is at [api.plyr.fm/docs](https://api.plyr.fm/docs). key endpoints:

| endpoint | description |
|----------|-------------|
| `GET /search/` | search tracks, artists, playlists |
| `GET /tracks/{id}` | get track metadata |
| `GET /tracks/{id}/stream` | stream audio |
| `GET /stats` | platform stats |
| `GET /oembed` | oEmbed endpoint |

authenticated endpoints require a developer token from [plyr.fm/portal](https://plyr.fm/portal).

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

authenticated operations (upload, download, manage your tracks) require a token:

```python
client = PlyrClient(token="your_token")
my_tracks = client.my_tracks()
client.upload("song.mp3", "My Song")
```

see the [plyr-python-client repo](https://github.com/zzstoatzz/plyr-python-client) for full docs.

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

## developer tokens

generate tokens at [plyr.fm/portal](https://plyr.fm/portal). tokens are scoped to your account and can be revoked at any time.

## ATProto lexicons

all plyr.fm data uses custom ATProto lexicons under the `fm.plyr` namespace. see the [lexicons overview](/lexicons/overview/) for schemas and record types.

## contributing

plyr.fm is open source. see the [contributing guide](/contributing/) to get involved.
