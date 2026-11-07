# Next rewrite handoff

November 7, 2026. Start from current remote `main`, not an old task worktree.
The runtime checkpoint is #2447–#2451 and #2453; #2454 records live acceptance.
There is no unfinished implementation goal or pending deployment from this cycle.
Old local branches contain duplicate commit histories from squash merges, and some
old worktrees predate later fixes. Do not merge them wholesale into main.

## Read first

- [STATUS.md](../../STATUS.md): current completion and known limits.
- [Rewrite inventory](2026-11-04-rewrite-progress-and-scope.md): remaining product
  journeys, service dependencies and deferred scope.
- [Personal queue acceptance](2026-11-07-personal-queue-verification.md): architecture,
  deployed revisions, actual browser matrix and reproduction commands.
- [Player lessons and cycles](2026-11-04-player-lessons-and-core-cycles.md): legacy
  design/history; dated observations there are not current implementation status.
- [Costs](../../COSTS.md): historical baseline, Jam addition and queue capacity.

## Current architecture and acceptance

Everything new stays in `next/`. Expo/React Native owns the client; Zig serves the
read-only canonical appview. Clients own OAuth and write canonical records to the
PDS. Postgres is the derived catalog/accounting store; it receives no playback tick
writes. Preferences use an owner-only Space. Creator-owned Spaces authorize Jams;
two Zig coordinators share their real-time state through persistent Redis.

Personal queues synchronize one account across clients, while Jams synchronize
multiple accounts separately. Explicit Play transfers the connected personal audio
output. Occurrence keys distinguish repeated tracks. Picks, collection tails and
generated continuation stay separate. IndexedDB/MMKV hold sanitized checkpoints
and durable edit journals; refresh restores paused. Full external OAuth restores
paused listening intent and the original destination. In-document navigation keeps
audio playing. Prepared edit headers must remain identical through transport queuing
and lost-ack retry; #2453 has the regression for that boundary.

The complete live Chrome matrix passed with independent browser processes, real
PDS OAuth, decoded audio, no local asset/coordinator overrides and normal autoplay
policy. It covered concurrency, passive silence/clock rendering, explicit output
handoff, paused refresh, reconnect, delayed-admission Play/Pause, lost acknowledgements,
drag/promotion, OAuth return intent, API503 retry, two-account Jams, radio, continuation
and repeat/advancement. Firefox passed the live core matrix. TypeScript and 77 client
tests, normal Zig/Postgres/Redis tests, the 500-case property campaign and native
bundle exports passed. Native exports do not establish physical-device acceptance.

## Latest performance investigation

The user saw a one-off slow homepage and reported that it looked normal afterward.
On November 7 at 1:21 a.m. Central, Fly logs show the Next API waking after scaling
to zero, with startup connection refusals/retries and roughly a 1–2 second startup
penalty. Subsequent direct keep-alive samples (five per route) measured catalog,
charts, tags and search medians around 120–165 ms from this workstation; a fresh
browser rendered the homepage heading in about one second. These are small samples,
not traffic percentiles or an SLO. One resource snapshot showed about 10 MiB process
RSS, about 43 MiB machine memory and no indication of CPU/memory pressure.

No scaling configuration changed. `next/backend/fly.canary.toml` intentionally has
`min_machines_running = 0`. Next has targeted playback/receipt logs, not a complete
per-request latency histogram. The connected Logfire project exposed legacy
production spans, so those were not used as Next performance measurements.
Keep cold startup, warm queries, browser rendering and audio startup distinct.
See [performance notes](../../next/backend/docs/perf.md) and
[API placement](../../next/backend/docs/api-placement.md).

## Remaining boundaries and next work

- Choose the next core journey from the inventory. Private listening history and
  Teal/Rocksky/scrobbling interoperability remain design/port work; queue persistence
  and public play accounting are implemented, not the next blank slate.
- Publishing, complete album/playlist management, creator portal parity, For You/
  semantic discovery and native lifecycle remain incomplete as itemized there.
- Redis is one persistent primary, not Redis HA. Retained personal state has no idle
  TTL; bounded event history still consumes meaningful memory under the 128 MiB
  `noeviction` limit. Disconnected buffered audio is not a hardware lease.
- Physical native/background playback, broader concurrency and immediate membership
  revocation still require separate acceptance.
- #2319 tracks first-read retry after a dropped/Neon-suspended pooled connection;
  #2320 tracks prepared-statement work. Do not assume keeping a VM warm solves the
  database wake path. #2452 tracks six pre-existing optional ReleaseFast fixture
  failures; normal CI and the deployed ReleaseSafe build passed.
- SDK/MCP, legacy-URL work and cutover rehearsal remain deferred. Avoid a fresh UI
  redesign; preserve the existing product behavior and implement the next viable
  end-to-end journey before broader cleanup.

Normal production was not promoted. Its machine versions/images remained unchanged
and frontend/backend health was good during verification. Merges may deploy Next;
normal production promotion still requires the user's instruction. Use the justfiles
and `uv`, and follow the repository's PR/review workflow.
