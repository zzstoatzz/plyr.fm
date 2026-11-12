# Personal queue synchronization verification

November 7, 2026. Tracking issue: #2446. Client PRs: #2451 and #2453.

## Implementation and deployment boundary

Backend #2447–#2450 and #2451 are deployed to Next. Client #2451 and the
prepared-header fix #2453 are deployed to `https://next.plyr.fm`. The live acceptance run verified frontend
commit `a38d2528946f8a53f38eba87c4aa69a816723137`. Both coordinators run the
immutable backend image from `9a575ddb57140bcc02107bc41c09dc7acdfb6853`.
All implementation PR checks and deployment workflows passed.

The final Chrome run uses deployed assets, real Next APIs/coordinators, real
public-PDS OAuth, private Spaces and normal browser autoplay policy. It does not
intercept frontend assets or substitute a local coordinator. API503 and delayed
admission are deliberate failure injections; media delivery and decoding are real.
Normal production was not promoted: its Fly machine states, versions and image
digests match the pre-cycle snapshot, and frontend/backend health return HTTP200.

The same account shares a personal queue across connected clients; only deliberate
Play claims its connected output. Jams remain separate, many-account rooms.
Private Space admission authorizes an owner-only Redis coordination session; the
queue itself is not a portable PDS record. The catalog appview remains read-only
for canonical user records. No server-owned OAuth session was added.

Since November 11 a personal queue is admitted on the owner's service-auth
identity alone. No Space is created or checked for it, so it no longer depends on
the PDS supporting Spaces; Jams still use Space admission.

The queue's record is the `plyr_playback.queue_records` row for the owner in
PostgreSQL, written within about a second of each change. Redis holds the live
copy with the same 24 hour expiry as a Jam room and is reseeded from the record
when a client connects and Redis has nothing.

## Behavior and failure coverage

- Stable occurrence keys retain duplicate authored records. Explicit picks precede
  replaceable collection/generated tails. Dragging a tail entry promotes it.
- IndexedDB/MMKV checkpoints contain sanitized metadata and position, not playback
  delivery URLs or credentials. Refresh restores paused. In-document navigation
  preserves audio; a full external OAuth navigation restores paused listening intent.
- Structural edits are journaled before send, with immutable command identity and
  prepared concurrency headers. A lost acknowledgement followed by refresh retries
  the same operation rather than creating another pick. Cross-tab journal writes merge.
- Redis atomically serializes cross-instance commands, deduplication and events.
  Output uses both logical client and connection identity; stale connected controls
  cannot claim a newer output. A reconnect does not claim another device's speaker.
- Metadata resolves in batches of at most 100. A 200-reference test requires two
  reads, handles reversed responses and preserves missing-reference order.
- Keep-playing reads bounded ten-track catalog pages, cancels stale work and only
  appends after collection playback reaches its last item. Latest tracks are labeled
  honestly; this is not the unported For You recommendation system.

Real independent-browser checks have exercised decoded audio, silent passive
clients without audio fetching, simultaneous adds, explicit output transfer,
paused refresh, reconnect without rewind, lost acknowledgement/reload, pointer
drag, scrubbing/navigation, external OAuth preservation, a real playback retry
after an injected API 503, and two-account Jam create/invite/join. Leaving a Jam
or tuning radio does not pause another device's personal output or a remaining
Jam participant. Phone Now Playing was inspected at 390 × 844 in light and dark.
Continuation enable/disable, repeat-all, repeat-one and exactly-once advancement
through duplicate records passed in Chrome. Firefox also passed core playback,
passive clock rendering, concurrent edits, output transfer, paused refresh, delayed
admission Play/Pause, lost-acknowledgement recovery, drag and scrubbing/navigation.
The full Chrome matrix also passed against deployed assets, including automatic-tail
drag promotion. The Firefox core matrix also passed against deployed assets, with
no local frontend or coordinator overrides.

The browser run exposed an Expo status edge: clearing the media source could
retain its previous playing status. Detached status is now normalized, and source
readiness waits for media metadata. Delayed checkpoint reads, account transitions,
passive timeline rendering and reconnecting Play/Pause are fenced independently.

The #2453 regression queues a journaled edit behind an in-flight progress sample.
Its acknowledgement used to restamp the waiting edit from revision 1 to 2, while
the journal still retained 1: a refreshed retry would have a different fingerprint.
The regression fails before the fix and passes after it. Personal prepared headers
now remain immutable through transport queuing; semantic rebasing stays on the
coordinator. The existing normal-Jam transport behavior is preserved.

## Reproducing browser acceptance

Run `next/app/scripts/check-personal-queue-browser.cjs` with `QUEUE_TEST_ACCOUNTS`
pointing to purpose-created host/guest PDS credentials and `PLAYWRIGHT_MODULE`
pointing to an installed Playwright module. Set `QUEUE_TEST_EXPECT_PROMOTION=1`
for the complete live Chrome matrix. Omit `QUEUE_ASSET_DIR` and
`QUEUE_LOCAL_COORDINATOR` for live acceptance. Never log the credential file.
`QUEUE_BROWSER=firefox` plus `QUEUE_TEST_CORE_ONLY=1` runs the core matrix.
The harness waits for stable handle geometry before coordinate-based dragging;
retained navigation screens are excluded from visible-control selectors.

## Evidence and practical limits

Client type checking and 77 behavior tests pass locally. iOS and Android bundle
exports pass; this is not physical native acceptance. Real Postgres endpoint
coverage and two-store Redis races passed. The coordinator browser transport
harness uses two local coordinators with actual public-PDS authorization. CI's
normal Zig suite passes. Six existing authored-record fixture failures under the
optional ReleaseFast suite reproduce on the baseline and are tracked in #2452;
that failing suite is not reported as passing. Deployment uses ReleaseSafe.

Observed local ReleaseFast Redis request-to-event p95 was 0.469 ms for one entry
and 3.837 ms for 200; final live Chrome simultaneous-add convergence was observed
at 131 ms (earlier runs ranged from 51 to 116 ms).
These are samples, not service guarantees. See [cost attribution](../../COSTS.md#november-7-personal-queue-cost-addendum).

Disconnected buffered audio is not a distributed hardware lease: it can continue
until the device reconnects or pauses locally. Redis is persistent but single
primary; this establishes coordinator failover, not Redis HA. Revocation remains
admission-bounded. Physical native/background behavior, broad concurrency and
personal history/scrobbling remain separate acceptance work.
