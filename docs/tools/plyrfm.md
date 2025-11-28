# plyrfm

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

```bash
# public (no auth)
plyrfm list                        # list all tracks

# authenticated
plyrfm my-tracks                   # list your tracks
plyrfm upload track.mp3 "My Song"  # upload
plyrfm download 42 -o song.mp3     # download
plyrfm delete 42 -y                # delete
plyrfm me                          # check auth
```

use staging API:
```bash
PLYR_API_URL=https://api-stg.plyr.fm plyrfm list
```

## SDK

```python
from plyrfm import PlyrClient, AsyncPlyrClient

# public operations (no auth)
client = PlyrClient()
tracks = client.list_tracks()
track = client.get_track(42)

# authenticated operations
client = PlyrClient(token="your_token")  # or set PLYR_TOKEN
my_tracks = client.my_tracks()
result = client.upload("song.mp3", "My Song")
client.delete(result.track_id)
```

async:
```python
async with AsyncPlyrClient(token="your_token") as client:
    tracks = await client.list_tracks()
    await client.upload("song.mp3", "My Song")
```
