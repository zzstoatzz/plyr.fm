# Player lessons and core parity cycles

Date: November 4, 2026. Source checkpoint: df6684dce. This narrows the
[rewrite inventory](2026-11-04-rewrite-progress-and-scope.md) into the next work.
Cutover rehearsal, legacy URL compatibility, SDK and MCP are deferred. They are
not prerequisites for these cycles. No runtime changes are claimed here.

## November 6 progress

Cycle 1's backend/client implementation and public browser verification shipped
in #2363/#2364/#2366/#2370; the initial gaps below are historical, not outstanding
tasks. See [the implemented accounting contract](../internal/architecture/next-play-accounting.md)
and [recorded acceptance](2026-11-04-playback-browser-workflow.md). Native lifecycle,
historical-count migration and personal scrobbling were not silently included.

The scoped real-time Jam MVP was brought forward and completed in #2422–#2430.
Its [audit](2026-11-06-jams-live-verification.md) covers actual decoded audio and
coordinator failure; broader Cycle 4 parity, especially one-speaker routing and
native/backgrounding, remains. Queue dragging, shortcuts, navigation and stable
scrubbing shipped, but queue persistence and continuation semantics do not become
complete just because those controls now exist. Cycles 2 and 3 remain uncompleted.

The [current inventory](2026-11-04-rewrite-progress-and-scope.md) is the current
scope/status reference. This document retains the original research and ordered
cycles so the reasoning behind them is not lost.

## What we are preserving

This is an intentional rewrite: preserve the product's accumulated behavior and
learning while replacing its coordination debt. Production is the behavioral
reference, with known defects identified rather than copied. A screen existing
in Next does not establish that its underlying journey is complete.

The [August player research](2026-08-03-player-architecture.md) already studied
MPD, mpv, Media3, AVFoundation, Vidstack, Shaka, hls.js, Feishin and Jellyfin.
Its useful conclusions were one owner for playback commands, per-load lifetime
for listeners and asynchronous work, explicit source identity, and a distinction
between requested playback and observed playback. It did not recommend a large
state-machine framework. We should use this work before choosing abstractions.

### How the behavior evolved

| Evidence | Problem and lasting lesson |
|---|---|
| #472, d7c548ff | Batched reactive state admitted duplicate play requests within milliseconds. Qualification must synchronously enter a pending state before asynchronous submission. |
| #1024, b21fb402; #1026, 18ba8b01 | Old position/duration credited a newly selected track; a nonreactive lock then suppressed real plays. Reset before replacing sources, subscribe before loading, and exercise consecutive tracks and cached media. |
| #1443, 7f1b35ed | Seeking and restoring position inflated plays. Accumulate actual listened time: qualify after min(30 seconds, half the duration). Server dedup protects against refreshing and competing tabs. |
| #1622, 7cb19339; #2106, 4fd78dd0 | Catalog radio bypassed ordinary accounting. A listener joining at minute ten has listened zero seconds; station position is not listening evidence. Live broadcasts are a different case. |
| #1757, 22c09f2a; #1762, cf56758c; #2104, 8d6d4c1f | Old radio listeners, seeks and rejected play promises mutated successor sources. Scope callbacks, positions and errors to a load; stale work must lose authority. |
| #2027–#2028 | Identical audio bytes do not make two authored tracks the same track. Record identity and queue occurrence identity are separate from blob identity. |

The [queue contract](../internal/frontend/queue.md) distinguishes explicit up-next
from a replaceable collection/recommendation tail. Repeated queue entries are
separate occurrences. Changing browsing context must not discard explicit
choices. Its older claim that repeat is unimplemented is superseded by code.

The [multi-tab investigation](../internal/retrospectives/2025-11-04-multi-tab-playback-issue.md)
separates synchronized display/queue state from ownership of audible playback.
A remote state update must not steal the speaker. Its historical unresolved
status is not evidence of a present production defect.

Production's Player.svelte:758–845 also distinguishes the Jam audio output from
silent controllers and preserves autoplay permission when advancing, including
locked Android playback. Those mechanics need actual lifecycle acceptance, not
just a desktop click test.

### Do not carry these defects forward

Production player.svelte.ts:292–349 has the intended threshold but marks the
request counted before receiving success, ignores HTTP failures and does not
retry. Its delta-at-most-five-seconds heuristic can credit small seeks and lose
sparse background progress. Repeat-one restarts without resetting accounting
(Player.svelte:797–805). Preserve the intent while replacing those mechanisms.

The old server's optional Teal worker writes records using server-owned OAuth.
A timestamp-derived record key is stable only if retries reuse the same played
at timestamp; generating a fresh timestamp each invocation defeats that property
(backend/_internal/tasks/sync.py:43–125 and atproto/records/fm_teal/play.py:66–123).
Next must keep canonical personal writes in the client.

## Cycle 1: trustworthy play accounting

Deliver a qualified audible playback occurrence all the way to a durable receipt
and visible count. Do not make historical count migration or external scrobbling
a prerequisite. Anonymous aggregate metrics, private listening history, external
scrobbles and public now-playing are separate facts with different consent and
failure boundaries.

Initial gaps at the November 4 checkpoint (addressed by the Cycle 1 implementation):

- next/app/src/api.ts:154–180 and playback.tsx do not submit plays.
- next/backend/src/internal/application/record_play.zig:67–88 claims Redis before
  the Postgres increment. A failed database write leaves a dedup claim; retry can
  return duplicate without recording anything. Redis failure admits increments,
  so uncertain retries can overcount.
- metrics/postgres_play_metric_store.zig:75–77,156–175 discards attribution and
  stores only the aggregate. There is no durable occurrence/event journal for
  Next activity charts or atomic receipt recovery.
- RadioPlayer.tsx:27 owns a separate Expo player. Its synchronization seeks
  (:89–104), and Jam correction seeks in playback.tsx:175–183, are not listening.
  Catalog embeds use PlaybackProvider. Reuse the accounting model across these
  sources without forcing an engine merger as a prerequisite.

Recommended small PR sequence, with each independently verified:

1. Specify occurrence identity, duration/unknown-duration behavior, qualification,
   repeat/anti-refresh policy, privacy and response-loss retry semantics. Build a
   replayable accounting model around actual media observations and explicit
   discontinuities. Use record URI plus a distinct occurrence/load identity;
   reset before source changes and reject stale observations.
2. Make accepted event/receipt and aggregate increment transactional. Prefer a
   bounded durable idempotency mechanism over a Redis claim as the source of
   correctness; keep rate limiting/anti-inflation separate. Exercise concurrent
   duplicates, database rollback and response loss with real Postgres. Define
   receipt retention and its expiry behavior before adding a retry queue.
3. Integrate solo, catalog embeds, catalog Radio and audible Jam playback. Keep
   pending, accepted and retryable states distinct; retry with the same identity.
   Bound retries and storage; failures must not stall audio. Reconcile displayed
   counts from receipts/read models without optimistic double increments.
4. Run the real-browser/media acceptance matrix below against isolated metrics,
   then deploy and verify Next. Trace one occurrence through client qualification,
   submission, server transaction and receipt using non-sensitive identifiers.

Decisions to settle inside the first PR: production's dedup duration window is
30 seconds–1 hour, and can suppress a genuine short-track repeat. Specify that
tradeoff rather than claiming one count per occurrence and dedup by track/time
simultaneously. Next currently uses an anonymous cookie, not authenticated DID
attribution (api/tracks.zig:listenerIdentity). Verify cookie delivery in native
and third-party iframes; do not add appview OAuth custody to identify a listener.
Client-reported listening is not proof against a malicious client. Define abuse
controls separately from retry correctness. Choose an explicit unknown-duration
policy rather than silently counting starts or never counting them.

| Acceptance scenario | Required evidence |
|---|---|
| Normal, short, unknown-duration audio | Exact qualification boundary and documented unknown-duration behavior; fetching or clicking alone earns nothing. |
| Seek, pause, buffer, restored position | No credit for jumps, paused/stalled intervals or restoration; real resumed progress qualifies. |
| Rapid A→B→A, cached readiness, stale errors | Each observation belongs to the correct load/occurrence; no successor mutation. |
| Repeated entry, repeat-one, natural advance | Distinct occurrences; documented repeat admission; one end advances once. |
| Offline, HTTP failure, lost response, concurrent duplicate | Same submission identity; committed event counted once; rolled-back event remains recoverable. |
| Radio late join and station boundary | Only locally heard time counts, correction seeks earn nothing, live broadcast excluded from catalog credit. Resolve station song identity to canonical record without restoring legacy-URL work. |
| Jam catch-up and silent controller | Sync position earns nothing; only the device actually rendering audio qualifies. |
| Embed and native/web lifecycle | Test actual iframe cookie behavior, WebKit media, background/resume and native progress delivery. A Chromium test does not establish physical iPhone behavior. |
| Read models | New counts reach track/artist/chart totals; no Python table or production metric writes. |

## Subsequent cycles

These are ordered outcomes, not deadlines or commitments to one large PR each.
Reassess the next cycle against evidence after finishing the current one.

| Cycle | Scope | Exit evidence |
|---|---|---|
| 2. Personal listening | Decide private history ownership and Teal/Rocksky interoperability, opt-in scope, stable write identity and retention. Reuse Cycle 1 qualification without coupling public metrics to successful scrobbling. | Anonymous listening works; opt-out writes no personal record; account switch cannot misattribute; PDS retry/index lag cannot duplicate a scrobble. Public presence remains a separate opt-in concern. |
| 3. Player and queue continuity | Restore queue and position intentionally; explicit versus generated queue; continuation, repeat, unavailable items, output ownership and platform controls. | Reload neither autoplays unexpectedly nor credits restored time; explicit queue survives context changes; source switching produces no overlap; background/interruption and media controls tested on the relevant platform. |
| 4. Complete Jam rooms | Integrate command/recovery work into the running room: shared queue, transitions, controls, host fencing, membership/revocation, reconnect and output choice. Ownership transfer remains later. | Two independent accounts/browsers, late join, concurrent controls, host restart, stale commands, revoked membership and bounded drift; each output counts its own listening only. |
| 5. Library and collections | Playlist artwork/reordering/add-from-editor; album create/member management/artwork; reliable metadata edits and owner catalog pagination. | Real PDS writes, second-client conflicts, saved-versus-indexed feedback and recovery; preserve unknown fields and user ordering. |
| 6. Creator publishing | Resumable and batch/album upload, size/format contract, replacements/revisions, permissions/downloads, owner management. Next currently publishes one public file up to 100MB (pds.ts:263–284). | Interrupted publication recovers; original bytes retained; no accidental audience expansion; reusable transcoder has an explicit publication contract. |
| 7. Discovery and remaining listening surfaces | Hidden tags and preferences, tag browse, chart periods, For You/CLAP and pagination, remaining embed behavior and Radio live/presence as individually scoped journeys. | Filters agree across feed/search/continuation/radio; charts use real accounting; service failures and actual embed sizes tested. |

Preserved sign-in intent, draft retention, account switching, direct PDS writes
and the distinction between saved and indexed belong in every affected journey.
Do not leave them as a late global cleanup. Canonical production records are
shared, even though Next infrastructure and metrics are separate.

The moderation service should be reused where its contracts fit; a Zig appview
does not require rewriting that service. Full moderation product parity can be a
later cycle. Existing label/access enforcement, protected-media integrity and
permission boundaries remain constraints on each newly ported journey. Reuse
reduces implementation work; it does not establish compatibility without tests.

## Running cost checkpoint

See the dated [Next cost note](../../COSTS.md#next-backend-checkpoint-november-4-2026).
The API scales to zero, but the ingester, Redis and database compute currently
keep a baseline cost. Do not describe the whole backend as scaling to zero.

## References

Paths above are relative to frontend/src/lib/, next/app/src/ or
next/backend/src/ as indicated. Line numbers describe the checkpoint and drift.
The primary production qualification and backend flow are player.svelte.ts:292–349
and backend/src/backend/api/tracks/playback.py:175–259. This is a source/history
study plus read-only cost inspection; the acceptance table is work to execute,
not a claim that those tests have already passed.
