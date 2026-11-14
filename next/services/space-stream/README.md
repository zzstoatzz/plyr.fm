# space-stream (plyr fork)

forked from [zzstoatzz.io/space-stream](https://tangled.org/zzstoatzz.io/space-stream) `main` on 2026-11-14, to change what plyr needs here and fold it back upstream later. what differs:

- `SPACE_TYPES` (wrangler var) limits which space types the deployment serves; anything else gets `403 SpaceTypeNotServed`. this deployment serves plyr's audio spaces only.
- the worker is named `plyr-space-stream`.
- oxlint runs without the vendored anti-slop plugin, which did not come across with the fork.


a sync service for atproto [permissioned spaces](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data). it follows a space through the space host's update webhooks and serves its records as a websocket of [Jetstream](https://github.com/bluesky-social/jetstream)-shaped events, the arrangement Bluesky describes in [a Jetstream for spaces](https://atproto.com/blog/space-sync). it holds no user sessions: a consumer lends it a delegation token, and the space's authority decides whether that consumer may read.

young, and built on an alpha protocol. a deployment at `space-stream.n8-3e9.workers.dev` exists for trials only.

## install

requires [bun](https://bun.sh) and a Cloudflare account to deploy to.

```sh
git clone https://tangled.org/zzstoatzz.io/space-stream
cd space-stream && bun install
```

## use

a consumer gets a delegation token for the space from its user's PDS (`com.atproto.space.getDelegationToken`) and connects with it:

```
wss://<host>/subscribe?space=<space uri>&delegation=<token>&cursor=<time_us>&wantedCollections=<nsid>
```

events are Jetstream commit events with a `space` field. the stream stays open while the consumer keeps renewing, by posting a fresh delegation to `/renew` before the time the first message gives. this is a backend stream: it carries every record in the space, and the consuming app decides what each of its users may see.

## develop

```sh
bun run check    # typecheck, lint, and tests in the Workers runtime
bun run try      # trial against real hosts, with test accounts from the environment
bun run deploy   # wrangler deploy
```

## docs

the [docs](https://tangled.org/zzstoatzz.io/space-stream/tree/main/docs) directory holds the protocol the feed speaks and the handoff with open work.
