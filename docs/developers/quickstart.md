---
title: "quickstart"
description: "build a track player with the plyr.fm API in 30 lines"
---

this guide walks through building a minimal track player using the plyr.fm API. by the end, you'll have code that searches tracks, streams audio, and posts a like — all through public endpoints and atproto records.

## prerequisites

- Python 3.11+ with [uv](https://docs.astral.sh/uv/)
- a [developer token](/developers/auth/) from [plyr.fm/portal](https://plyr.fm/portal) (for authenticated operations)

## install the SDK

```bash
uv add plyrfm
```

## search and play

```python
from plyrfm import PlyrClient

client = PlyrClient()

# search for tracks
results = client.search("ambient")
for track in results:
    print(f"{track.title} by {track.artist}")
    print(f"  stream: {track.stream_url}")

# get top tracks
for track in client.top_tracks(limit=5):
    print(f"{track.title} — {track.play_count} plays")
```

no authentication needed — search, listing, and streaming are public.

## authenticated operations

generate a developer token at [plyr.fm/portal](https://plyr.fm/portal), then:

```python
authed = PlyrClient(token="your_token")

# like a track
authed.like(track_id=42)

# upload a track
authed.upload("song.mp3", "My Song")

# list your tracks
for track in authed.my_tracks():
    print(track.title)
```

## using the API directly

if you prefer raw HTTP, the OpenAPI spec is at [api.plyr.fm/docs](https://api.plyr.fm/docs):

```bash
# search tracks
curl "https://api.plyr.fm/search/?q=ambient"

# get a track
curl "https://api.plyr.fm/tracks/42"

# stream audio (follows redirect to CDN)
curl -L "https://api.plyr.fm/tracks/42/stream" -o track.mp3

# authenticated: like a track
curl -X POST "https://api.plyr.fm/tracks/42/like" \
  -H "Authorization: Bearer your_token"
```

## using the MCP server

for AI assistants (Claude Code, Cursor, etc.):

```bash
claude mcp add plyr-fm -- uvx plyrfm-mcp
```

then ask your assistant to search tracks, get top tracks, or browse by tag — it has full read access to the platform.

## next steps

- **[API reference](/developers/api-reference/)** — full endpoint documentation with request/response examples
- **[auth guide](/developers/auth/)** — OAuth flow details and token management
- **[lexicons](/lexicons/overview/)** — understand the atproto record schemas behind the data
- **[plyr-python-client](https://github.com/zzstoatzz/plyr-python-client)** — full SDK documentation
