# protocol

What the feed speaks, to consumers on one side and to space hosts on the other. Upstream
references: [proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data)
and the `com.atproto.space.*` lexicons on the `permissioned-data` branch of
[bluesky-social/atproto](https://github.com/bluesky-social/atproto/tree/permissioned-data).

## consumers

### subscribe

```
GET /subscribe?space=<uri>&delegation=<token>[&attestation=<token>][&cursor=<time_us>][&wantedCollections=<nsid>]…
Upgrade: websocket
```

- `space`: `at://<authority did>/space/<space type nsid>/<key>`.
- `delegation`: a delegation token for that space, from `com.atproto.space.getDelegationToken`
  on the consumer's user's PDS. It is single use and lives about 60 seconds.
- `attestation`: a client attestation, for spaces that restrict which apps may read. Passed
  through to the authority; untested.
- `cursor`: replay events with a larger `time_us`, then go live. Omitted or `0` replays the whole
  log.
- `wantedCollections`: repeatable. Exact NSIDs, or a prefix ending `.*`. None means everything.

The feed redeems the tokens with the space authority (`authorizeSpaceSync`) before upgrading.

| answer | meaning |
| --- | --- |
| `101` | admitted; the first message is `{"kind":"authorized","expires_at":"…"}` |
| `400 InvalidRequest` | a malformed space, or no delegation |
| `403 <error>` | the authority refused; `<error>` is its own code. zds answers `SpaceNotFound` for an account it will not admit, `InvalidDelegationToken` for a bad token, and `SpaceDeleted` for a deleted space |
| `502 <error>` | the authority failed to answer |

A websocket client sees a refusal only as a failed upgrade.

### events

```json
{"did":"did:plc:…","time_us":1794650000000000,"kind":"commit","space":"at://…","commit":{"rev":"…","operation":"create","collection":"…","rkey":"…","cid":"…","record":{}}}
{"did":"did:plc:…","time_us":1794650000000001,"kind":"writer","space":"at://…","writer":{"status":"removed"}}
{"did":"did:plc:…","time_us":1794650000000002,"kind":"space_deleted","space":"at://…"}
{"kind":"sync_error","message":"…"}
```

- `commit` is Jetstream's commit event plus `space`. `operation` is `create`, `update` or
  `delete`; a delete carries no `cid` or `record`. `record` is also absent when the repo host
  omitted the value because the record changed again before the feed read it.
- `writer` says an account was removed from the space's writer set. Its earlier records should
  be hidden.
- `space_deleted` is the last event of a space the authority confirmed was deleted; `did` is the
  authority. The socket is then closed with code `4404`, and the feed keeps nothing about the
  space: a later subscribe is refused with `SpaceDeleted`, and cursors from before mean nothing.
- `time_us` is the feed's own sequence, strictly increasing per space. It is the cursor. It is
  not the time of the write.
- `sync_error` is sent once after `authorized` when the catch-up before replay failed. The replay
  that follows is whatever the log already held.
- The space's own records are in the stream too: the authority's `com.atproto.space.policy`
  record arrives like any other commit.

### renew

```
POST /renew
{"space":"<uri>","delegationToken":"<token>","clientAttestation":"<token>"}
```

Answers `{"expires_at":"…"}`, or `403`/`502` as for subscribe. A renewal extends every open
socket that was admitted by a delegation from the same account (the token's `iss`), and no
others. A socket whose admission runs out is closed with code `4401`.

Admission lasts as long as the space credential the authority issued, ten minutes on current
hosts. Renew before `expires_at`.

Every renewal also pulls the space from the feed's checkpoint, so an update the host never
announced reaches open streams at the next renewal at the latest. Renewing more often than the
credential requires narrows that bound; there is no other timer.

## space hosts

The feed is a syncer in the proposal's terms. Every admission and renewal calls
`authorizeSpaceSync` with `notify: {endpoint, token}`, where `endpoint` is the origin consumers
reach the feed at and `token` is one random secret per space, stable across calls. So the
registration is renewed exactly as often as consumers lend tokens, and lapses when they stop.

The credential that comes back, with its key, is stored in the feed's Durable Object until it
expires. A feed whose consumers are idle is evicted from memory within seconds, and the update
that wakes it needs the credential to pull with.

zds withdraws the registration a refused request carried. A refused token from anyone, sent to
`/subscribe` or `/renew` for a space, therefore stops that space's updates until the next
accepted token registers again. The pull on every renewal is what covers that window.

The host calls, with no auth beyond that token in the body:

- `POST /xrpc/com.atproto.space.confirmRegistration {space, token, challenge}` → `{challenge}`,
  or `401 InvalidToken`.
- `POST /xrpc/com.atproto.space.notifySpaceUpdate {space, token, update}` → `{}`, or
  `401 InvalidToken`, or `400 InvalidRequest` for an update of a kind the lexicon does not define.
  - `#repoWrite` and `#repoRemoved` queue a sync, which runs at once.
  - `#registrationExpired` queues one too. By then the feed's credential has expired with the
    registration and it has no token to renew with, so the sync runs when the next consumer
    lends one. Both subscribe and renew pull.
  - `#spaceDeleted` is a claim. The feed asks the authority, which answers `SpaceDeleted` to
    any `authorizeSpaceSync` call before it looks at tokens. On that answer the feed sends
    consumers `space_deleted`, closes them and deletes the space's log, checkpoint, credential
    and notify token. Any other answer leaves everything as it was. A subscribe or renewal
    that gets `SpaceDeleted` does the same.

`prevSpaceRev` on an update is not compared with the checkpoint: every update pulls
`listWriters` from the checkpoint, which recovers a gap whether or not it is noticed.

A sync reads `listWriters` from the stored space revision, then `listRepoOps` for each writer
from the repo revision already applied. Each `listRepoOps` request carries an `Accept-Signature`
MAC request against the writer's `#atproto_kem` key, and the page's commit is verified before
any operation is emitted. Real repo hosts refuse the request without it.
