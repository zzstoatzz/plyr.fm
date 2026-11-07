# Personal queue synchronization verification

November 7, 2026. Tracking issue: #2446. Client PR: #2451.

## Implementation and deployment boundary

Backend #2447–#2450 are merged and deployed to Next. The client is under final
browser acceptance before merge. Browser evidence below currently uses locally
exported client assets on the Next origin, real Next APIs/coordinators, real
public-PDS OAuth and private Spaces. It is not yet live-client acceptance.
Normal production has not been promoted.

The same account shares a personal queue across connected clients; only deliberate
Play claims its connected output. Jams remain separate, many-account rooms.
Private Space admission authorizes an owner-only Redis coordination session; the
queue itself is not a portable PDS record. The catalog appview remains read-only
for canonical user records. No server-owned OAuth session was added.

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
Fully deployed-client acceptance remains pending.

The browser run exposed an Expo status edge: clearing the media source could
retain its previous playing status. Detached status is now normalized, and source
readiness waits for media metadata. Delayed checkpoint reads, account transitions,
passive timeline rendering and reconnecting Play/Pause are fenced independently.

## Evidence and practical limits

Client type checking and 76 behavior tests pass locally. iOS and Android bundle
exports pass; this is not physical native acceptance. Real Postgres endpoint
coverage and two-store Redis races passed. The coordinator browser transport
harness uses two local coordinators with actual public-PDS authorization. CI's
normal Zig suite passes. Six existing authored-record fixture failures under the
optional ReleaseFast suite reproduce on the baseline and are tracked in #2452;
that failing suite is not reported as passing. Deployment uses ReleaseSafe.

Observed local ReleaseFast Redis request-to-event p95 was 0.469 ms for one entry
and 3.837 ms for 200; browser simultaneous-add convergence was observed at 51–68 ms.
These are samples, not service guarantees. See [cost attribution](../../COSTS.md#november-7-personal-queue-cost-addendum).

Disconnected buffered audio is not a distributed hardware lease: it can continue
until the device reconnects or pauses locally. Redis is persistent but single
primary; this establishes coordinator failover, not Redis HA. Revocation remains
admission-bounded. Physical native/background behavior, broad concurrency and
personal history/scrobbling remain separate acceptance work.
