---
title: "for developers"
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

# search tracks
results = client.search("ambient electronic", type="tracks")
for track in results:
    print(f"{track.title} by {track.artist_display_name}")

# get a specific track
track = client.get_track("abc123")
```

the SDK handles pagination, rate limiting, and auth. see [pypi.org/project/plyrfm](https://pypi.org/project/plyrfm/) for full docs.

## MCP server

plyr.fm has a hosted MCP server for AI assistants:

```
https://plyrfm.fastmcp.app/mcp
```

add it to your MCP client config to let LLMs search and play tracks, manage playlists, and interact with the platform.

## developer tokens

generate tokens at [plyr.fm/portal](https://plyr.fm/portal). tokens are scoped to your account and can be revoked at any time.

## ATProto lexicons

all plyr.fm data uses custom ATProto lexicons under the `fm.plyr` namespace. see the [lexicons overview](/lexicons/overview/) for schemas and record types.
