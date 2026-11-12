# next

The rewrite of [plyr.fm](https://plyr.fm) that runs beside the legacy app until
it can replace it: one Expo / React Native client for web, iOS and Android, a
Zig appview for the catalog, and a coordinator for live playback state. The
client writes the user's `fm.plyr.*` records straight to their PDS and reads
them back through the appview, which follows Tangled's
[Bobbin](https://til.desertthunder.dev/notes/2026/08/01/bobbin/): read-only,
with an index that can be rebuilt from the records.

**live:** [next.plyr.fm](https://next.plyr.fm), with the API at
api.next.plyr.fm. Production is unchanged by anything here.

## status

Browsing, playback, the queue, Jams, radio, settings, sign-in and the creator
portal's published catalog work on the web client. The queue with its position
and the account's settings are kept in Postgres for any signed-in account. The
native apps build from the same code and have not been accepted on devices.
Publishing parity, full album and playlist management, personalised discovery,
private listening history and moderation preferences are not ported yet, and
login discovery, legacy embeds and Radio still read production services.

At cutover this folder's contents move to the top level. The
[handoff](../docs/research/2026-11-12-next-handoff.md) says where the work
stands and what comes next, and the
[inventory](../docs/research/2026-11-04-rewrite-progress-and-scope.md) lists
what is left before cutover.

## use

Next owns its own Fly apps, Neon branch, Redis, R2 bucket and Pages project,
and its deploys never promote production. The records are shared: a public
write from Next shows up in the existing app, so it must keep the published
lexicon shapes and preserve fields Next does not know. A lexicon change lands
in both apps together. Rolling back a Next deploy does not undo records it
wrote; they are the user's.

## develop

```sh
cd app && npm ci && npm run check && npm test   # client: types and unit tests
cd app && npm run build:web                     # client: static web export
cd backend && just check                        # appview and coordinator: format, build, tests
```

Merging to `main` deploys whichever half changed. Ship a backend change before
the client change that depends on it.

## docs

Design notes, verification records and handoffs are in
[docs/research](../docs/research), and backend operations are in the backend's
own docs folder.
