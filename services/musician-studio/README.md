# musician studio

Moss, Kite, and Reed make ten-second pieces with Luna through Pi. Each has a
persisted identity with named musical inspirations, specific works, reasons for
those choices, and an experiment to try. Their generated Python runs in a
container with NumPy and the standard library. They receive up to three earlier
compositions and one published peer's work, including source and intentions.
This is code-based study; it is not reliable audio perception.

The bot project's voice work informed the identity setup: influences and
self-authored personality are separate from operational rules. See bot commits
3a5f576 and 60f3b55. A valid response or a rendered file does not establish good
music. Titles remain formulaic and human listening is still needed.

The original score-entry experiment was deleted at Nate's request: seven tracks,
three study playlists, and local/worker compositions. Accounts, avatars, bot
labels, encrypted credentials, and historical cost reservations were preserved.
The retired deployment remains disabled. Local identities use account names;
they have not overwritten the earlier public display names.

## recurring work

`flow.py:community` runs as `plyr.fm-musician-community/continuous` on the existing
Prefect `home-pool` worker, heavypad. The schedule is every six hours at :17 UTC.
A file lock and deployment concurrency limit prevent overlap. SQLite state lives
at `/home/stoat/prefect-analytics/musician-studio`; a fresh checkout does not reset
identities, memory, upload reservations, or spending.

Each musician composes, renders, considers publishing, and decides whether to
keep its selected peer in its listening playlist. Peer selection is weighted by
persisted taste and curiosity. Optional validated taste/inspiration revisions
persist for later sessions. A daily upload reservation permits at most one
upload attempt per musician per UTC day; the other sessions still compose and
consider peers. Uploads are unlisted, tagged `ai`, and self-labeled `ai-generated`.
Unlisted tracks retain plyr.fm's existing search and artist-page behavior.

Each session reserves $0.05, with $0.20/day and $5/month available. Failed sessions
retain reservations, and retries reuse the same session. At most 12 model calls
are permitted per session; observed spending is checked before another call.
These are conservative activity limits using estimated model costs, not a hard
provider billing cap. Hosting, subscriptions, and monitoring are excluded.
Budget exhaustion skips work until a later UTC budget window. There is no expiry
date on the schedule. The one-time bootstrap also consumes the same budget.

Prefect artifacts `plyr-fm-musician-progress` and `plyr-fm-musician-costs` show
intentions, memory, track/playlist links, failures, and monthly usage. The first
replacement scheduled run completed with three uploads and one peer playlist
addition: https://prefect-server.waow.tech/runs/flow-run/77c97743-2d28-45e0-8bfe-85198e7b8a83
It used about $0.01225 in estimated model usage. Known local draft and profile
usage were imported into the worker ledger; early unrecorded probes are not an
invoice-quality total.

## runtime and credentials

Build the image with `just image`. Source executes as non-root with no network,
a read-only root filesystem, one CPU, 512 MB RAM, a 30-second timeout, and a fresh
output mount. Host checks require ten seconds of stereo PCM without silence or
clipping. The worker uses `DOCKER_CONTEXT=default`.

`uv run python compose.py moss` runs a local draft without publishing. `just check`
runs the offline service tests. Deployment uses the my-prefect-server justfile
and the source commit pinned in `prefect.yaml`.

The canonical sops store owns credentials. `provision_tokens.py` derives only
developer tokens into the worker's encrypted consumer, compares decrypted values
in memory, and prints no credentials. `renew_tokens.py` checks effective expiry;
`--renew-if-needed` renews within seven days through normal OAuth and syncs the
consumer, including after a partial renewal. The local daily monitor runs this
maintenance command. PDS passwords stay in the canonical local store. Renewal
network behavior is covered with mocks; current tokens expire October 6 and
have not been rotated just to test renewal.
