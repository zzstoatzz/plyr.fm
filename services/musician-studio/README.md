# musician studio

The schedule is paused until a complete native-audio revision cycle is verified.
The former code-only review loop is disabled and its queued runs were cancelled.

Moss, Kite, and Reed have persistent identities with named musical inspirations,
specific works, reasons for those choices, and experiments to try. Gemini 3.5
Flash receives the actual WAV and makes musical judgments. Luna implements
Python drafts and requested revisions; it cannot approve a release or decide
what belongs in a playlist. Reading code is not listening.

## before publication

For each ten-second piece, the author listens to the rendered draft and requests
a revision. The revised audio is rendered and heard again by the author and by
another musician. Both reviewers receive the author's stated inspirations; each
also has its own identity and taste. Reviews focus on audible pitch relationships,
timbre, bass, balance, articulation, and development, with uncertainty stated.

The host records the listener, author, model version, positive audio-token count,
audio SHA256, and a digest of the supplied inspirations. Those records live in a
separate table from model-generated composition metadata. Publishing requires a
different rendered revision, self-approval of that exact revision, and peer audio
feedback. Missing, stale, text-only, or incomplete evidence blocks uploading. A
musician declining release keeps the draft unpublished and completes its study.
The peer can disagree without vetoing the author's work.

The artist also hears any selected published peer before deciding whether to
add it to its playlist. Reviews and compositions persist for later iterations.
A token receipt proves audio input processing, not accurate musical judgment.

## operation and cost

`flow.py:community` runs as `plyr.fm-musician-community/continuous` on heavypad's
existing Prefect `home-pool`. One artist takes a turn every six hours at :17 UTC,
rotating across the roster. SQLite state is stored at
`/home/stoat/prefect-analytics/musician-studio`; checkouts do not reset memory,
identities, upload reservations, or spending. A lock and concurrency limit
prevent overlap.

The authorized limits are $0.10/session, $10/day, and $10/month in reservations,
with at most 12 model calls/session and one upload attempt/musician/UTC day.
Failures retain reservations and retries reuse the session. Native audio input,
output, and thinking costs enter the same ledger as Python generation. Budget
exhaustion skips work until a later UTC window. These are estimates, not a hard
provider billing cap; subscriptions, hosting, and monitoring are excluded.

Uploads remain unlisted, tagged `ai`, and self-labeled `ai-generated`. Existing
unlisted search and artist-page behavior is preserved. Prefect artifacts
`plyr-fm-musician-progress` and `plyr-fm-musician-costs` show reviews, links,
failures, and usage. Use direct run links in your own browser.

## validation and limitations

`just check` runs 32 offline tests, including the complete review/revision order,
repeat recovery, native audio payloads, missing audio-token receipts, changed
files/inspirations, and missing peer review. A live call through the new client
returned 250 audio tokens and rejected Moss's draft. The full live revision
cycle is still pending the next UTC budget window.

`audio-validation.json` retains blind controls: Flash-Lite confused pitched tones
with noise; 3.8 Flash hallucinated music in silence and then returned 503s. Short
3.5 temporal answers recognized steady tones and pulses but were truncated by
the response limit. These probes do not establish reliable perception or good
music. Titles also remain formulaic. Known diagnostic usage was added to the
worker ledger: $0.033589, bringing September 7's reserved/charged total to
$0.187489/$0.20. No limits were raised to run another full session.

The original score-entry experiment's seven tracks, three playlists, and local
and worker compositions were deleted. Accounts, avatars, bot labels, credentials,
and historical costs remain. The earlier replacement run
[77c97743](https://prefect-server.waow.tech/runs/flow-run/77c97743-2d28-45e0-8bfe-85198e7b8a83)
proved publishing and curation, not listening. Local identity defaults have not
overwritten the earlier public display names. Bot's influence-choice and
self-authored personality work informed the identity design (commits 3a5f576
and 60f3b55).

## runtime and credentials

`just image` builds the execution container. Python runs without network access,
as non-root with a read-only root filesystem, one CPU, 512 MB RAM, a 30-second
timeout, and a fresh output mount. The host requires ten-second stereo PCM
without silence or clipping. Heavypad uses `DOCKER_CONTEXT=default`.
`uv run python compose.py moss` produces a local, unpublished draft.

The canonical sops store owns all credentials. `provision_tokens.py` derives
only developer tokens and the existing Gemini key into the encrypted worker
consumer, verifies equality in memory, and is idempotent. PDS passwords stay in
the canonical store. `renew_tokens.py --renew-if-needed` renews developer tokens
within seven days of expiry through normal OAuth and syncs the consumer.

[Audio API](https://ai.google.dev/gemini-api/docs/audio) and
[pricing](https://ai.google.dev/gemini-api/docs/pricing), checked September 7:
Gemini 3.5 Flash standard estimates use $1.50/million input tokens and $9/million
output tokens including thinking. Pricing is not an invoice.
