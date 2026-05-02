---
title: "plyrfm"
---

python SDK and CLI for plyr.fm - available on [PyPI](https://pypi.org/project/plyrfm/) and [GitHub](https://github.com/zzstoatzz/plyr-python-client).

## installation

```bash
# run directly
uvx plyrfm --help

# or install as a tool
uv tool install plyrfm

# or as a dependency (SDK + CLI)
uv add plyrfm
```

## authentication

some operations work without auth (listing public tracks, getting a track by ID).

for authenticated operations:

1. go to [plyr.fm/portal](https://plyr.fm/portal) -> "your data" -> "developer tokens"
2. create a token
3. `export PLYR_TOKEN="your_token"`

## CLI

the CLI is namespaced (`plyrfm tracks ...`, `plyrfm playlists ...`, etc.) — run `plyrfm --help` to see the full tree.

```bash
# public (no auth)
plyrfm tracks list                                  # list all tracks
plyrfm tracks get 42                                # get one by ID

# authenticated
plyrfm me                                           # check auth
plyrfm tracks my                                    # list your tracks
plyrfm tracks upload track.mp3 "My Song"            # upload
plyrfm tracks upload track.mp3 "My Song" \
    --album "My Album" \
    --image cover.png \
    --description "liner notes" \
    --tag electronic --tag ambient \
    --unlisted                                      # full metadata
plyrfm tracks download 42 --output song.mp3        # download
plyrfm tracks delete 42 --yes                      # delete (skip confirm)
```

the `--unlisted` flag excludes the track from public discovery feeds (latest, top, for-you) but keeps it accessible by direct URL.

use staging API:
```bash
PLYR_API_URL=https://api-stg.plyr.fm plyrfm list
```

## SDK

the SDK is namespaced to mirror the CLI (`client.tracks`, `client.playlists`, ...).

```python
from plyrfm import PlyrClient, AsyncPlyrClient

# public operations (no auth)
client = PlyrClient()
tracks = client.tracks.list()
track = client.tracks.get(42)

# authenticated operations
client = PlyrClient(token="your_token")  # or set PLYR_TOKEN
my_tracks = client.tracks.my()
result = client.tracks.upload(
    "song.mp3",
    "My Song",
    album="My Album",
    image="cover.png",
    description="liner notes",
    tags={"electronic", "ambient"},
    unlisted=True,
)
client.tracks.delete(result.track_id)
```

async:
```python
async with AsyncPlyrClient(token="your_token") as client:
    tracks = await client.tracks.list()
    await client.tracks.upload("song.mp3", "My Song")
```
