# musician studio

The six-hour schedule is active after a complete native-audio revision cycle.
The former code-only review loop is disabled.

Moss, Kite, and Reed have persistent identities with named musical inspirations,
specific works, reasons for those choices, and experiments to try. Gemini 3.5
Flash receives the actual WAV and makes musical judgments. Luna implements
Python drafts and requested revisions; it cannot approve a release or decide
what belongs in a playlist. Reading code is not listening.

## composition

Before writing audio code, Luna saves a plan for the tempo and meter, pitch
relationships, motif, instrument roles, and development of the ten-second phrase.
That plan and prior audio feedback accompany implementation and later studies.
New-piece prompts omit old synthesis code to avoid carrying the same implementation
forward; revision prompts retain the current draft.
Listeners do not receive the plan or code, so they cannot merely repeat the
composer's intended notes. They still receive the author's inspirations.
Planning and implementation use low reasoning effort. The audio reviewer checks
whether the musical relationships are audible; prose alone earns no approval.

The optional `studio_instruments` module supplies pitched plucks, bass and pads,
percussion, beat-to-second conversion, mixing and WAV output. It is mounted
read-only in the existing isolated Python container. Artists can alter the
sounds or synthesize their own; the helpers prescribe no score or genre.

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

An explicit `evaluation=true` run performs planning, composition and audio
reviews without publishing or editing playlists. It has one separate reservation
per six-hour window, charged against the same daily/monthly limits. Normal runs
do not enable it.

Uploads remain unlisted, tagged `ai`, and self-labeled `ai-generated`. Existing
unlisted search and artist-page behavior is preserved. Prefect artifacts
`plyr-fm-musician-progress` and `plyr-fm-musician-costs` show reviews, links,
failures, and usage. Use direct run links in your own browser.

## validation and limitations

`just check` runs offline tests, including the complete review/revision order,
repeat recovery, native audio payloads, missing audio-token receipts, changed
files/inspirations, and missing peer review. A live call through the new client
returned 250 audio tokens and rejected Moss's draft. The full live cycle then completed in run
[ee1b967d](https://prefect-server.waow.tech/runs/flow-run/ee1b967d-7424-4864-8f0f-5441b876c635):
Moss heard its draft and a different ten-second revision, Reed heard that same
revision, and Moss heard a published peer. Four native audio reviews recorded
250 audio tokens each. Moss declined release, so no track was uploaded. Six
model calls cost an estimated $0.037656.

`audio-validation.json` retains blind controls: Flash-Lite confused pitched tones
with noise; 3.8 Flash hallucinated music in silence and then returned 503s. Short
3.5 temporal answers recognized steady tones and pulses but were truncated by
the response limit. These probes do not establish reliable perception or good
music. Titles also remain formulaic. Known diagnostic usage was added to the
worker ledger: $0.033589, bringing September 7's reserved/charged total to
$0.187489/$0.20 at the earlier pause. Nate subsequently authorized the higher
limits above, and live verification continued.

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

The September 8 planning evaluation completed in run
[856e3252](https://prefect-server.waow.tech/runs/flow-run/856e3252-7b2f-4710-9d61-21256c647005)
for an estimated $0.040811 across seven model calls, without publishing. Reed
chose custom synthesis. Reviews repeated exact notes supplied in the plan, so
listeners no longer receive it. New-piece prompts now omit old synthesis code
and recommend the provided instruments first. Those prompt corrections are
covered by tests but were not part of that live evaluation. The sample does
not establish better musical quality or accurate pitch recognition.

## listener calibration

An explicit run with `evaluation=true` and `calibration=true` classifies six
unnamed, shuffled ten-second controls through the same native audio client:
silence, regular noise pulses, sequential notes, and stacked notes. The source
and expected answers stay on the host. Results retain wrong answers, confidence,
audio hashes and positive provider audio-token receipts in
`plyr-fm-listener-calibration` and the worker state directory.

Calibration shares the one evaluation reservation per six-hour window, uses six model
calls on a complete first attempt, and cannot publish. Explicit recovery remains
subject to the same twelve-call session cap. It measures basic factual perception,
not taste, pitch transcription, or quality of musical criticism. It does not run
automatically before each composition or change the normal publication gate.
