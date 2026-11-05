# Next play accounting

Cycle 1 preserves sustained-listening semantics while separating playback,
delivery, durable metrics and personal listening. This is application-owned
anonymous accounting; canonical PDS writes and OAuth remain in the client.

## Ownership and serving paths

| State | Owner / storage | Read and write pattern |
|---|---|---|
| Current load, listening progress, seek boundary | Player instance, memory | Media observations, no database/network or persistence per progress tick. |
| Qualified pending occurrence | Client outbox; IndexedDB transactions on web, dedicated MMKV store on native | Persist once before submission. At most64 pending reports, expire after24h; retry same UUID. No credentials or DID. |
| Anonymous listener key | Local device/browser storage | Random UUID, independent of sign-in and occurrence identity. Used only for cooldown admission; no authority. Partitioned browser storage scopes it to the embedding context. |
| Durable receipt | Next Postgres plyr_index.play_receipts, UUID primary key | Point lookup for replay; receipt and count committed together. Accepted and suppressed outcomes remain stable even after catalog deletion. |
| Anti-inflation cooldown | Next Postgres plyr_index.play_cooldowns | Hashed anonymous key plus canonical record URI; expires after track duration clamped30s–1h. Indexed bounded cleanup. |
| Serving totals | Next Postgres plyr_index.track_metrics | Increment atomically; existing catalog/artist queries join this aggregate, never scan the journal. |
| Displayed count after receipt | Bounded in-memory per-track external store | Notify only subscribers of that record. Use authoritative totals monotonically; no broad page invalidation/refetch. |

Keep Neon/Postgres for this contract. A new storage engine would not remove the
need for admission, atomic counters and replay safety. The schema has a separate
small purpose for each table; private history and public presence do not belong
in the receipt journal. Server acceptance time is named accepted_at; an offline
report is not evidence of the original historical playback timestamp.

## Qualification and source lifetime

A load starts a fresh occurrence UUID. The threshold is min(30 seconds, half the
finite media duration), falling back to30 seconds until duration is known. The
model compares forward media progress with monotonic elapsed time; paused,
stalled, restored and discontinuous position changes earn no time. Progress
arriving with the final pause/end observation is still accounted for. Sparse
background observations need not be discarded just because they exceed5 seconds.

Explicit seeks suspend accumulation and establish a new baseline after the seek.
Source replacement stops the previous observer before attaching its successor.
Repeat-one creates another occurrence only on an observed backwards wrap near the
end/beginning; an explicit seek does not. Jam seek completions recheck the load
and Jam generation before issuing play/pause. Silent room controllers do not
produce local media progress and therefore cannot qualify.

Solo playback and catalog embeds share the provider. Radio retains its own audio
engine but uses the same accounting model. Station position and synchronization
corrections earn no listening. Consecutive rotations use station start identity.
Current radio sources expose production numeric song IDs: a qualified event
retains that reference in the outbox, resolves to a canonical record before
submission, then persists the canonical identity under the same occurrence UUID.
This one compatibility read is outside both tune-in and progress callbacks,
cached for64 songs, and bounded by a timeout. Slow resolution cannot discard
already-heard time. Replacing the radio source contract can remove the bridge.

## Delivery and transaction boundary

POST /v1/tracks/:id/plays uses occurrence UUID and an optional anonymous listener
UUID query parameter. It is a simple request without a JSON/custom-header CORS
preflight. Explicit listener identity avoids relying on first-party cookies in
native apps and cross-site embeds; callers without it retain cookie fallback.
Neither identifier is an authenticated identity or permission to edit records.
Logs include occurrence, record and outcome, never the listener key/cookie.

The client persists before sending and retries network failures,429 and5xx with
bounded exponential backoff. Resume/online events retry pending work. A lost
response and a restart reuse the same occurrence; successful receipt validation
precedes acknowledgement/removal. Invalid permanent requests do not retry forever.
Denied storage degrades to bounded memory and is logged; restart recovery then
cannot be promised. Blocked/cleared storage also limits refresh suppression.

The database function serializes a particular UUID, returns a prior receipt if
present, checks current policy for new events, atomically admits the cooldown,
increments the aggregate and appends the receipt. Conflicting record reuse is
409. A rollback leaves neither a cooldown claim nor a receipt; there is no Redis
claim left behind to swallow a retry. Expired cooldown cleanup is indexed,
bounded and skips locked rows. The existing read-only-by-default API connection
uses explicit BEGIN READ WRITE, one function query, COMMIT: three database
round trips, with no extra catalog read or Redis hop.

A duplicate receipt returns its original counted flag and total. Counted means
that occurrence earned a play, not that this response incremented again. The
UI uses max(server-loaded total, receipt-observed total), so an old replay cannot
lower a more recent count. A genuinely repeated short track can still be
suppressed inside the anti-inflation window; qualification and admission are
separate policies.

## Storage growth and limits

Receipt identities are deliberately retained indefinitely this cycle; deleting
receipts would make sufficiently old UUID replays count again. The journal
contains no listener key/DID, and is distinct from expiring pseudonymous cooldowns.
Both accepted and suppressed new UUIDs append a row and index entries. Monitor
receipt count/bytes and write rate with the cost checkpoint; do not treat small
current storage as a permanent cost ceiling. Cookie/local-key cooldown is not a
general abusive-request rate limit: malicious clients can mint new keys and
UUIDs. Retention/compaction or ingress admission changes need an explicit replay
contract, not silent pruning in the hot path.

## Design references

[TigerBeetle reliable submission](https://docs.tigerbeetle.com/coding/reliable-transaction-submission/)
informs stable client-generated IDs before sending and retrying unknown outcomes.
[Hydrant's transaction layer](https://hydrant.klbr.net/specs/db-layer/) informs
storage-owned atomic boundaries; its [record storage](https://hydrant.klbr.net/specs/block-gc/)
shows why extra indirection must earn its point read.
[Typeahead](https://tangled.org/zzstoatzz.io/typeahead/blob/main/docs/architecture.md)
informs serving prepared projections instead of enriching every read.
[Stream](https://tangled.org/zat.dev/stream) informs bounded serving work and
durable-data-before-progress discipline; it remains an ingestion hint, not a
substitute for independent PDS verification. These are specific design lessons,
not reasons to add another database to the request path.

See the [player study](../../research/2026-11-04-player-lessons-and-core-cycles.md)
and [browser workflow](../../research/2026-11-04-playback-browser-workflow.md)
for historical intent and reproducible acceptance runs. Bundled WebKit tests
are not physical iPhone/native background acceptance. Platform-originated seeks
lack an explicit discontinuity reason in Expo's status API; clock-consistency
checks reject large jumps while our own controls mark discontinuities explicitly.
Playback-speed policy needs separate design before exposing speed controls.
