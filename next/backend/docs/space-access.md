# space access

who may read a gated space is answered in one place, `src/internal/space/access.zig`.
`checkUserAccess` and supporter downloads both go through its `Decider`; neither
knows how the answer is reached.

## the model

anything gated (a track, an album's tracks, a playlist) lives in a space,
`at://{artist}/space/{SPACE_TYPE_NSID}/{skey}`. the skey is just a name.

the artist opens a space by writing `fm.plyr.policy` records (lexicon in
`next/app/lexicons/policy.json`, collection `<track namespace>.policy`) in their
own repo. each record names one space and one rule. a space can carry any number
of policies; a reader who passes any one of them may read the whole space.

| rule | passes |
| --- | --- |
| `signedIn` | any signed-in account |
| `members` | the listed DIDs (public list, max 512) |
| `supporter` | anyone with a broker-verified `network.attested.payment` to the artist, any amount |
| `purchase` | a verified payment to the artist at or above `amount` in `currency`, whose `entitlements` include this policy record's uri |

`supporter` and `purchase` take optional `brokers`; absent means the
deployment's `SUPPORT_TRUSTED_BROKERS` (default: Atmosphere Money). payments are
read from the payer's repo and each broker proof is verified, so no single
provider is wired in.

## decision order

1. a space of another type: closed.
2. the space authority (the artist): open, read or write.
3. anyone else writing: closed.
4. otherwise the artist's policies naming this exact space uri decide.
5. a space with no policy records falls back to its legacy skey: `signed-in`
   reads as `signedIn`, `supporters` as `supporter`. anything else stays closed.

unknown rule types and malformed records are ignored (they open nothing).
lookup failures fail closed unless another policy already allowed the reader.

## syncing space records

closed tracks keep their metadata on the public record, so the firehose
ingester indexes them and nothing needs syncing. once metadata itself lives
only in a space (a members-only release, a private playlist), plyr keeps a
copy fed by its space-stream (`next/services/space-stream`), a Cloudflare
worker that does the host work (`authorizeSpaceSync`, `listWriters`,
`listRepoOps` with the commit MAC) and emits each verified op in order with a
`time_us` cursor.

- `src/internal/space/sync.zig` is the seam: `parseEvent` reads one stream
  event, `Projector.handle` applies it as one `Store` transaction that also
  moves the space's cursor, so a replay from the stored cursor rebuilds the
  copy. `writer` removed drops that repo, `space_deleted` drops the space.
  a write the stream sent without its record only advances the cursor.
- the stream reads as plyr's sync account. `SPACE_SYNC_DID` names it, and the
  access core admits it to read (never write) every plyr space.

- `MODE=space_consumer` (`src/internal/space/consumer.zig`) holds one socket
  per plyr space a public track points into, re-listed every minute. it logs
  the sync account in once (`SPACE_SYNC_HANDLE`, `SPACE_SYNC_APP_PASSWORD` on
  `SPACE_SYNC_PDS`), mints a delegation token per connection, and subscribes
  to `SPACE_STREAM_HOST` from the space's stored cursor. it never renews:
  when admission runs out the stream closes with 4401 and the consumer
  reconnects with a fresh token, which also makes the stream pull. a 4404
  close drops the space and stops following it.
- the copy is `plyr_index.space_records` with `plyr_index.space_cursors`
  (`postgres_sync_store.zig`), both rebuildable by replaying from cursor 0.

reads of synced rows still go through the access `Decider`, so a stale copy
hides new records but never shows revoked ones. nothing reads the copy yet:
closed tracks keep their metadata public. it is for release-only metadata
and private playlists.
