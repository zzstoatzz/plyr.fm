# handoff, 2026-11-13

For whoever picks this up next. It records why the repo exists, what has been shown to work and
how, what has not, and the decisions already made so they are not reopened by accident. Delete
sections as they stop being true.

## why this exists

[noti issue 2](https://tangled.org/zzstoatzz.io/noti/issues/2) asks for noti to push records
from a permissioned space (first producer: albedo writing `tech.waow.ops.finding` records about
Prefect alerts into a space waow.tech owns). As written it fuses two jobs inside noti: following
a space (credentials, webhooks, renewal, gap recovery) and consuming its records.

Bluesky's [a Jetstream for spaces](https://atproto.com/blog/space-sync) (2026-11-06) describes
splitting them: a sync service beside the app re-serves space records as a Jetstream-shaped
stream. Their service is a prototype and was not published as of 2026-11-13 (nothing on the
`permissioned-data` branch; `@bsky/jetstream` on npm predates the post). nate decided to spike
it here first, outside noti, because one syncer serving noti, doodl and lore is the interesting
version.

## decisions already made

- **TypeScript on a Cloudflare Worker, one Durable Object per space.** zeldi was considered and
  set aside: as a syncer it lacks client websockets, per-key cells and open egress, and open
  egress cuts against its grant model. Revisit zeldi as a *consumer* when an app on cellar needs
  space data. A zig port is not planned while the protocol is alpha.
- **The feed holds no user sessions.** A consumer lends a delegation token; the feed redeems it
  with the space authority. The credential that comes back admits the consumer and renews the
  feed's registration in one call. This works because a delegation token is a single-use bearer
  token addressed to the authority that says nothing about which app holds it.
- **The space credential is stored, the session rule stands.** The feed keeps the ten-minute
  credential and its key in the Durable Object so it survives eviction. That is not a user
  session and not long-lived; it expires on its own and is deleted with the space.
- **No timer, no `prevSpaceRev` check.** Renewals pull. See "what has been shown".
- **Tokens in the connect URL, renewal by POST.** An earlier version took an `authorize`
  message on the socket. It was dropped because consumers such as zeldi cells and a Worker's
  cron cannot write to the socket.
- **Alpha means current upstream only.** No compatibility with earlier spaces shapes.
- **Nothing in noti yet.** noti issue 2 stays as it is until this is judged ready.

## what has been shown, and how

Local tests (`bun run check`) run the worker in the Workers runtime against an in-memory host
that issues real space credentials and MACs.

Live trial (`bun run try`), last run 2026-11-13 against the deployed worker, space owner
`bufo.uk` on zds (pds.zat.dev), member on Bluesky's reference alpha PDS
(spaces-alpha.host.bsky.network):

| case | result |
| --- | --- |
| member's delegation in the connect URL | admitted; zds issued a 600 second credential and confirmed the webhook registration |
| record written before anyone connected | replayed |
| owner write on zds | event 300 to 380 ms after the write returned |
| member write on the other PDS | event 730 to 1220 ms after |
| delete | event 560 to 1960 ms after |
| forged token | upgrade refused |
| `POST /renew` with a fresh delegation | 200 with a new expiry |
| reconnect with `cursor` and `wantedCollections` | exactly the later events |
| member removed, then reconnects | upgrade refused |

Those timings are a handful of runs from a laptop, not a measurement.

Soak trials (`bun run soak renew`, `bun run soak lapse`), run 2026-11-13 against the same
deployment and accounts, with `wrangler tail` recording what zds sent the feed:

| case | result |
| --- | --- |
| one stream open 30 minutes, `POST /renew` every 4.8 minutes | 6 renewals, all 200; three credential lifetimes; the socket never closed; no `sync_error`; zds sent no `#registrationExpired` |
| a write every 90 seconds on that stream, alternating owner (zds) and member (reference PDS) | 19 of 19 events arrived, median 716 ms, slowest 2793 ms |
| nobody connected for 784 seconds, six writes and a delete meanwhile | reconnect from the cursor replayed all seven, each writer's in order, nothing extra |
| the registration lapsing during that gap | zds sent `#repoWrite` for the five writes before expiry, one `#registrationExpired` in place of the next, then nothing |
| after that reconnect | live again: owner write 331 ms, member write 623 ms; zds did not ask for a new confirmation |
| update notifications across both trials | 26 writes made while a registration was live, 26 `#repoWrite` received: none missed |
| space deleted under an open stream (twice) | `#spaceDeleted` arrived within a second, the authority confirmed, the stream got `space_deleted` and closed with 4404; a later renewal answered 403 `SpaceDeleted` |

What those runs broke, now fixed:

- **The feed stopped syncing once its consumers went idle.** The credential lived only in
  the Durable Object's memory, and an idle object is evicted within seconds. Before the fix, a
  write 90 seconds after connecting never arrived (2 of 2 writes lost in a four-minute run).
  The first live trial missed it because its writes were seconds apart. The credential and
  its key are now stored until they expire.
- `#registrationExpired` and `#spaceDeleted` were ignored; see `protocol.md` for what each
  does now.

What the runs decided about missed webhooks: none was missed, so there is no evidence that a
timer is needed. But zds's source shows a way to lose them that needs no fault: a refused
token withdraws the registration (item 10 below). The feed therefore pulls on every renewal,
which a consumer must send within ten minutes anyway. It does not compare `prevSpaceRev`,
because every update already pulls `listWriters` from the checkpoint. This was shown locally
only; no webhook was lost live to exercise it.

Things the live runs and zds's source taught that the first fake host had wrong:

- `listRepoOps` is refused (`InvalidSpaceMac`) without an `Accept-Signature` MAC request. The
  fake host now enforces it.
- The stream includes the authority's own `com.atproto.space.policy` record.
- zds answers an account it will not admit with 400 `SpaceNotFound`, not
  `AccountNotAuthorized`, and withdraws the registration that request carried.
- A deleted space answers `SpaceDeleted` before any token is checked. The member's PDS still
  mints a delegation for it.

## not shown

Each of these is open work.

1. **The reference PDS as the authority.** Every live run had zds as the space host and the
   reference PDS only as a member's repo host. What it answers a refused account, whether it
   sends `#registrationExpired`, and whether it answers `SpaceDeleted` without a token are
   unknown. The in-memory host follows zds.
2. **A removed member's open socket** keeps streaming until its admission expires, up to ten
   minutes. That matches the proposal's revocation model (short credential lifetime) but has not
   been observed live.
3. **Spaces that restrict apps.** `attestation` is passed through and untested. The consumer
   would mint a client attestation addressed to the authority and lend it with the delegation.
4. **Public-read spaces.** A delegation is required here even where the authority would not ask
   for one, because the delegation's `iss` is how sockets are tied to renewals.
5. **Full sync.** `listRepoOps` hosts may truncate their log; the proposal says to fall back to
   `getRepo` (a STAR archive, verifiable with `verifyRepoStar` from `@atproto/space`). Not
   implemented. A writer whose log was truncated would be silently incomplete.
6. **Account status.** The proposal requires syncers to honour account takedown and
   deactivation, learned from the public firehose's `#account` events. Not implemented. Never
   consume the firehose from nate's home network; a Worker is fine.
7. **One stream, many spaces.** One socket is one space. The blog post describes one stream
   across every space the service follows. A fan-in layer would need a cursor that orders
   across feeds.
8. **Retention.** The event log grows without bound.
9. **Ordering.** `time_us` is assigned when the feed reads an operation, so order within one
   writer is that writer's log order, and order across writers is the order the feed pulled
   them. Nothing promises a consumer more than that; say so or fix it.
10. **Abuse.** Anyone can make the feed call `authorizeSpaceSync` on an arbitrary DID's PDS by
    sending junk to `/subscribe` or `/renew`. No rate limit yet. Worse, zds withdraws the
    registration a refused request carried, so any account's valid but refused delegation for
    a space silences that space's updates until the next accepted token. Renewal pulls bound
    the damage to one renewal interval; they do not prevent it. The feed also fetches DID
    documents and PDS URLs it is given; Workers' fetch cannot reach private addresses, but
    think this through before another host runs it.
11. **Tokens in URLs.** The delegation is in the query string, so it reaches request logs. It
    is single use and already redeemed by then. Workers observability is on for this worker.

## the consumers this is for

- **noti**: the reason this started. It would connect from a Durable Object (it already holds
  outbound sockets for spacedust) with `wantedCollections=tech.waow.ops.finding`, renew from
  its five-minute cron, and turn commits into inbox rows and pushes. It needs a `space:` OAuth
  scope on the waow.tech session to call `getDelegationToken`; noti's scopes are fixed per
  sign-in mode today, and whether a parameterised `space:` scope can be declared in client
  metadata is unanswered (see zds `docs/permissioned-data.md`, "capability discovery").
  Before changing noti, read its `docs/ops-changelog.md`.
- **doodl**: its sync worker is a private copy of the syncer half (webhook registration, alarm
  renewal, full reconciliation), holding server-side OAuth sessions to borrow from. It was the
  template here and is the obvious second consumer.
- **lore**: uses spaces through a pi extension; no syncer today.

Whether one deployment serves all three, and under what hostname, is nate's call.

## working here

- Deployed at `https://space-stream.n8-3e9.workers.dev` on nate's Cloudflare account. It is a
  trial deployment with no custom domain and no deploy workflow. `bun run deploy` ships; ask
  before pointing anything real at it. A deploy closes every open stream.
- `bun run soak renew` and `bun run soak lapse` take 31 and 14 minutes. Run them in the
  background and read the output file; `SOAK_MINUTES`, `RENEW_MINUTES` and `LAPSE_MINUTES`
  shorten them. `bunx wrangler tail space-stream --format json` alongside shows each update
  the host sends (the feed logs its kind).
- CI runs on `spindle.zzstoatzz.io`, whose bun is 1.3.13. It cannot read the lockfile version
  bun 1.4 writes; keep `bun.lock` at `"lockfileVersion": 1`.
- `bun run try` needs `LORE_OWNER_HANDLE`, `LORE_OWNER_APP_PASSWORD`, `LORE_MEMBER_HANDLE` and
  `LORE_MEMBER_APP_PASSWORD`. On nate's laptop, sourcing `live/env.sh` in the pi-extensions
  checkout sets them from the sops store. They are throwaway test identities; never print the
  passwords. Each run creates one space and deletes it in a `finally`.
- Upstream moves. Before protocol work, read the newest `alpha-migrations/prompt-*.md` on the
  `permissioned-data` branch and bump the `@atproto/*` alpha pins together (the `overrides`
  block exists because the published sibling ranges are broken).
- The anti-slop skill is installed at `.agents/skills/install-anti-slop`, and its plugin is
  vendored under `tools/oxlint/anti-slop`. Read a rule's source there when a finding is unclear.

## suggested order

1. nate decides whether noti consumes this. The model "consumers lending delegations keep the
   feed alive" held for 30 minutes and across a lapse; the feed needs no session of its own.
   What it costs a consumer: renew at least every ten minutes, and accept that nothing is
   synced while no consumer is connected (the backlog arrives on reconnect).
2. Full sync and account status, which are correctness gaps a real consumer would hit.
3. Item 1 if a space hosted on the reference PDS matters, and item 10 before anyone else
   can reach the deployment.
4. Everything else as a consumer needs it.
