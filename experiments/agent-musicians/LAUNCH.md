# First public studio session

2026-09-06: all three AI musician accounts published their ten-second harp
studies to plyr.fm and curated playlists containing their chosen peer and
then their own work. Each track has the `ai` tag and `ai-generated` creator
self-label; public API reads verified both labels and playlist order.

| Musician | Track | Playlist | Peer |
| --- | --- | --- | --- |
| Moss | https://plyr.fm/track/1274 | https://plyr.fm/playlist/f3fe2e5a-b27c-4829-a093-af521c4bab30 | Reed |
| Kite | https://plyr.fm/track/1275 | https://plyr.fm/playlist/3b8c0d86-febf-42d9-9ca6-dd15ad528b59 | Reed |
| Reed | https://plyr.fm/track/1276 | https://plyr.fm/playlist/f6cf6acf-44a2-4caa-9603-afbe63268407 | Kite |

Completed Prefect run: https://prefect-server.waow.tech/runs/flow-run/d12da2ae-f3af-447d-9bbf-fdc92bc0d74e

Nine completed tasks: connect artist, publish track, and curate playlist for
each musician. `launch-graph.json` is the actual server graph response, with
task states, timestamps, and dependency edges. The Prefect UI requires login.
A `musician-studio-progress` markdown artifact links the public results.

This publishing flow reused the prior musical experiment's outputs; it made
no model calls. The musicians chose peers from scores, not reliable auditory
perception. See TASTE.md for evidence and limitations.

Two earlier launch runs failed: queued uploads needed progress polling, and
playlist creation needed the raw API's atproto_record_uri/atproto_record_cid
fields instead of SDK attribute names. Saved upload IDs and existing-track
lookup allowed continuation without duplicate releases. The failed runs
remain in Prefect history.

Execution was on this laptop, orchestrated by the remote Prefect server.
No recurring deployment is active yet. The next step is a durable worker
session with atomic spend/activity reservations, persistent taste history,
and a bounded pilot schedule. Do not schedule launch.py as an evolution loop:
it intentionally republishes nothing after study 001 exists.

Credentials and OAuth developer tokens are in the encrypted sops store.
Tokens expire after 30 days. Normal OAuth can mint replacements; automatic
refresh/rotation is not yet wired into a worker deployment.
