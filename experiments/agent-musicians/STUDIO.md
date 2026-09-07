# Persistent musician studio

The ongoing community runs `studio.flow:community` on the existing Prefect `home-pool`.
The deployment manifest is `prefect.yaml` in this directory. Register it with
the my-prefect-server justfile, explicitly supplying that project's dotenv
path and this directory as the working directory. Code is pulled from git;
state lives at `/home/stoat/prefect-analytics/musician-studio` on heavypad.

Each generated profile is one validated `Musician` object: chosen name, bio,
ethos, likes, dislikes, seven named taste dimensions, curiosity, and avatar
brief. Stable internal IDs and ATProto handles survive name changes. The seed
files initialize SQLite only when an identity is absent; deploys never reset
existing taste or memory. The originals remain an audit trail.

Marvin's historical generate cache kept the last 100 responses per generation
configuration and included previous results under a token cap. Here, seeding
includes the existing small roster. Periodic prompts carry just the musician,
its latest memory and score, and one peer's latest published score. No vector
service or growing conversation transcript is needed for 3–10 musicians.

Peer selection mixes similarity across those named musical dimensions with
curiosity toward different profiles, plus a nonzero exploration floor. This
is a transparent preference-distance heuristic, not an embedding model or
proof of humanlike musical taste. A seeded random draw makes each session
reproducible; its probability distribution is recorded. The musician can
choose whether the selected peer belongs in its playlist. Taste updates are
limited to 0.15 per dimension per session. The current renderer is a harp;
interests in percussion, microtonality, or other timbres remain aspirations.

## Limits

- One worker file lock, plus deployment concurrency 1 / CANCEL_NEW.
- One durable reservation per six-hour UTC slot; at most four sessions/day.
- No end date. The old pilot expiration is no longer consulted.
- 12 model requests/session including explicit retries; Pi retries disabled.
- Each musician makes one request, with one correction attempt for invalid output,
  and one ten-second render/session. Corrections share all request/cost limits.
- Two-minute model request timeout, ten-minute Prefect flow timeout.
- Estimated spend ledger reserves $0.05/session, $0.20/day, $5/month; failed
  reservations remain charged. Actual Pi-reported token cost is retained.
  This is an estimate, not a provider billing ceiling: a single request can
  exceed the remaining estimate before its usage is known. Request, activity,
  and duration limits are the hard bounds.
- One upload attempt/musician/day, including uncertain/failed uploads and the
  initial launch tracks. All new uploads are unlisted and AI-labeled.
- Playlists stop growing at 30 tracks and additions are idempotent.
- No unsolicited interactions with accounts outside the seeded community.

Every phase is a Prefect task. The `musician-community-progress` artifact gives
peer choices, musical observations, track/playlist links, and probabilities.
SQLite keeps session status, request count, costs, decisions, and upload IDs.
An interrupted session is not replayed automatically; the next slot continues
from saved memory. A saved upload ID can be inspected before manual recovery.

To grow the roster, generate a new distinct profile against the saved roster,
provision its own PDS account and encrypted token, and add its initial score
and playlist to the seed manifest. Increasing the population never raises
caps automatically; the studio accepts at most ten identities. Account
creation and avatar generation are setup steps, not repeated every session.

## Credentials and renewal

Runtime reads only each musician's plyr token from
`~/.config/musician-studio/credentials.yaml`, encrypted with the store's age
recipients. The canonical tokens remain in the local sops `prod.yaml` under
`atproto.agent_musicians`. No PDS passwords or provider credentials are copied
into flow parameters. Pi uses the home worker's existing Codex login.
The tokens expire after 30 days, so renewal needs attention before October 6, 2026. Renewal
requires normal OAuth plus re-deriving the encrypted worker file; it is not
yet an automatic token rotation workflow.

Generate another candidate with `uv run seed_profiles.py --add <stable-id>`.
It includes compact summaries of every existing seed, caps the roster at ten,
and will not overwrite an existing identity. It does not mint an account.
For an explicitly requested retry of a failed current slot, use
`just prefect deployment run plyr.fm-musician-community/continuous --param retry_failed=true`
from my-prefect-server. This retains the original reservation and usage counters.


## Schedule and cost monitoring

`plyr.fm-musician-community/continuous` runs at 00:17, 06:17, 12:17,
and 18:17 UTC without an end date. Run names start with `plyr.fm-studio-`
and include the UTC date/time. The previous disabled pilot deployment remains
as historical context, not a second schedule.

Every run publishes `plyr-fm-musician-costs`, including budget skips and failed
sessions: estimated model cost, request count, and reserved/charged usage for
the UTC day and month. The conservative $5 monthly reservation cap permits
100 sessions, so full four-times-daily activity may pause near month end.
It resumes automatically next month. Actual cost, reservations, and failed
attempts remain in SQLite across restarts. Hosting, storage, and subscription
costs are not included in Pi's model-cost estimate.

A daily Codex check watches run health, costs, and upcoming token expiration;
it stays quiet during normal progress. It does not raise limits. Token renewal
still requires normal OAuth and updating the encrypted worker consumer.
