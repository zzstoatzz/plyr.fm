# next

The rewrite of [plyr.fm](https://plyr.fm) that runs beside the legacy app until
it can replace it. SvelteKit serves the new browser client and Expo provides
the iOS and Android app. Both use the same TypeScript core, Zig appview and
playback coordinator. Each client writes the user's `fm.plyr.*` records straight to their PDS and reads
them back through the appview, which follows Tangled's
[Bobbin](https://til.desertthunder.dev/notes/2026/08/01/bobbin/): read-only,
with an index that can be rebuilt from the records. State that is not a record
stays on our own services, after ana's
[evil atproto](https://nekomimi.leaflet.pub/3mqovvmc4jk2i).

**live:** [next.plyr.fm](https://next.plyr.fm), with the API at
api.next.plyr.fm. Production is unchanged by anything here.

## status

Browsing, playback, the queue, Jams, radio, settings, sign-in and the creator
portal's published catalog work on the web client. The queue with its position
and the account's settings are kept in Postgres for any signed-in account. The
native apps build from the same code and have not been accepted on devices.
Publishing parity, full album and playlist management, personalised discovery,
private listening history and moderation preferences are not ported yet.
Nothing in next reads production services at runtime, and nothing may.

At cutover this folder's contents move to the top level. The
[cutover handoff](../docs/research/2026-11-24-next-cutover/README.md) is the
current state of the migration. The older
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

### namespaces

NSIDs follow the domain that owns them. Users' catalog records are `fm.plyr.*`
(`track`, `list`, `like`, `comment`, `actor.profile`, shared with production,
plus `policy` and `release`, which only Next defines so far). Types that only
Next uses (the audio space type, Jams and their join method)
live under `fm.plyr.next.*`, the authority of next.plyr.fm; their lexicons are
in [app/lexicons](app/lexicons). `fm.plyr.stg.*` belongs to the legacy staging
app, so Next never reads or writes it. `fm.plyr.dev.*` is for local runs and
test fixtures only.

At cutover the `fm.plyr.next.*` names stay as they are. Space uris
(`at://{artist}/space/fm.plyr.next.audio/{skey}`) are written into track
records, policies and payment entitlements, so renaming the type would orphan
every closed release. Keep next.plyr.fm resolvable as the lexicon authority.

## develop

```sh
bun install --frozen-lockfile                    # install from next/ with Bun and Node 22+
bun run check:boundaries                         # check workspace imports
(cd core && bun run check && bun run test)       # shared types and model tests
(cd web && bun run dev)                          # Svelte at http://127.0.0.1:5174
(cd app && bun run check && bun run test)        # Expo types and tests
(cd backend && just check)                       # appview and coordinator checks
```

Every merge to main that touches next web runs the Svelte screen checks and,
once they pass, deploys `next.plyr.fm`. To redeploy by hand, or to try the
isolated Pages preview first, dispatch
`gh workflow run check-svelte-next.yml --ref main -f target=preview` (or `target=live`). The live run records the previous deployment ID for rollback
in the `plyr-fm-next` Pages project. The frozen Expo release remains available
via `gh workflow run deploy-web-next.yml --ref next-expo -f target=live`.
Ship a Next backend change before the client change that depends on it.

## docs

Design notes, verification records and handoffs are in
[docs/research](../docs/research), and backend operations are in the backend's
own docs folder.
