---
title: "quickstart"
description: "find a track and inspect its audio with the plyr.fm SDK or HTTP API"
---

find a track, inspect its metadata, and return a link someone can play. These
examples use public reads and need no developer token. For MCP setup and
workflow guidance, see [for agents](/developers/agents/).

## Python SDK

Install [uv](https://docs.astral.sh/uv/) and add the SDK:

```bash
uv add plyrfm
```

The SDK uses namespaces such as `tracks`, `discover`, `tags`, and `playlists`.
With the published `plyrfm` package:

```python
from plyrfm import PlyrClient

with PlyrClient() as client:
    search = client.discover.search("ambient", type="tracks", limit=5)
    for result in search.results:
        if result.type != "track":
            continue
        track = client.tracks.get(result.id)
        print(f"{track.title} by {track.artist}")
        print(f"  listen: https://plyr.fm/track/{track.id}")
        print(f"  audio: {track.audio_url}")
```

This prints links; it does not start playback. For asynchronous applications,
use `AsyncPlyrClient` with `async with` and await its namespace methods.

## HTTP API

The machine-readable schema is at
[api.plyr.fm/openapi.json](https://api.plyr.fm/openapi.json); the
[interactive reference](https://api.plyr.fm/docs) renders that schema.

```bash
# search returns a results array plus counts for the returned results
curl --fail --get 'https://api.plyr.fm/search/' \
  --data-urlencode 'q=ambient' \
  --data-urlencode 'type=tracks' \
  --data-urlencode 'limit=5'

# choose an id from results, then inspect the complete track
curl --fail 'https://api.plyr.fm/tracks/655'
```

`655` is an example track; use an ID from your own search response. The detail
response contains `r2_url`, the audio URL, and `atproto_record_uri`, the
portable record address when available. The Python SDK calls those fields
`audio_url` and `atproto_uri`.

Use the returned audio URL, following redirects and respecting any access
requirements. There is no `/tracks/{id}/stream` endpoint. Inspect `gated` and
`visibility` before offering playback, and use the dedicated download endpoints
when the user wants a download.

## authenticated operations

Create a [developer token](/developers/auth/) in
[settings](https://plyr.fm/settings#developer). The SDK reads `PLYR_TOKEN` from
your environment; HTTP uses `Authorization: Bearer <token>`.

After the user authorizes a particular library change:

```python
from plyrfm import PlyrClient

with PlyrClient() as client:
    client.tracks.like(655)
    liked = client.tracks.liked()
    print(any(track.id == 655 for track in liked))
```

This publishes a like for the example track; substitute the track the user chose.
Library mutations and uploads can publish ATProto records. Read the affected
resource afterward to verify the intended result.

## next steps

- [for agents](/developers/agents/) — MCP setup, result contracts, and verification
- [authentication](/developers/auth/) — token lifetime, scopes, and browser sessions
- [API reference](/developers/api-reference/) — browse endpoints
- [lexicons](/lexicons/overview/) — record schemas and environment namespaces
- [SDK, CLI, and MCP source](https://github.com/zzstoatzz/plyr-python-client)
