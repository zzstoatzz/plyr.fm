# Next structure review

Reviewed after the Home/navigation/avatar/shortcut changes were deployed and
verified on `next.plyr.fm`, November 5, 2026. This is a cleanup proposal, not an
implementation plan for missing product features.

## What shipped and was checked

- [#2402](https://github.com/zzstoatzz/plyr.fm/pull/2402): artist detail avatar
  fallback, retaining authored-avatar precedence and field provenance.
- [#2403](https://github.com/zzstoatzz/plyr.fm/pull/2403): Home body playback,
  independent like/queue controls on rows and chart cards, shared like state.
- [#2404](https://github.com/zzstoatzz/plyr.fm/pull/2404): navigation alignment,
  removal of the redundant Home heading, shared share icon, production icon assets.
- [#2405](https://github.com/zzstoatzz/plyr.fm/pull/2405): all documented web
  shortcuts, focused-row Space behavior, and the music-to-radio handoff race.

Next web deployment `42086262440` serves `f4e6cd0c36121846266ad40268f01167de19a0da`.
Next API deployment `42085752294` serves the avatar change. Public checks exercised
real disposable-PDS OAuth/likes, catalog audio, queue additions without interruption,
all documented shortcuts, and real radio pause/resume. Appview metric writes were
blocked in these browser scenarios. Branding checks loaded real artist artwork and
verified the exact favicon/touch-icon bytes. The affected-route audit passed 40
rendered states in Chrome against public assets; local exported assets also passed
40 states each in Chrome and WebKit. Branding was checked in both engines at
390/1280px in both themes. Physical iOS and screen-reader behavior remain untested.
A WebKit branding navigation timed out during rollout; its isolated post-rollout
check passed. That is a narrower claim than uninterrupted device acceptance.

Normal production was not promoted. Its `production-fe` branch remained
`99334ecb0830fcd8eef411dad35f857361f48d43`; production web/API health returned 200.

## What the tree actually looks like

At this checkpoint, `next/app/src` has 76 TS/TSX files (~5.5k lines), route files
have ~940 lines, and the browser/helper CJS scripts have ~2.5k lines. The largest
client files are `pds.ts` (416), `playback.tsx` (277), `Catalog.tsx` (261), and
`AccountCatalog.tsx` (237). These sizes alone do not justify a rewrite.

The backend has 168 Zig files (~29.8k lines), including fuzzing, tests and generated
Unicode data. `postgres_composed_track_store.zig` is 1,505 lines, but its first large
integration test begins at line 701. The 1,091-line snapshot adapter starts its tests
at line 527. Generated grapheme tables account for another 2,068 lines. Treating all
of that as runtime complexity would give the wrong priorities.

## Recommended cleanup order

### 1. Consolidate browser verification tooling

The scripts repeat browser startup, export routing, media interception, write
blocking, viewport/theme loops and diagnostics. `pds-browser-fixture.cjs` already
provides a useful shared OAuth boundary; extend that approach instead of adding
another runner per feature.

Introduce one harness with explicit fixture/export/public modes and immutable build
snapshots. A running browser must never read a directory another export is replacing;
that caused missing-asset failures during this work. Preserve real-PDS and real-audio
cases alongside deterministic failures, and report which boundary was simulated.
Make browser/module paths discoverable through the project commands.

Acceptance: existing scenarios run through one documented command, identify their
asset revision, retain mutation blocking, and save a screenshot/console/network
summary on failure. This is the smallest useful first PR.

### 2. Give client reads and mutations a clear home

`CatalogPieces.tsx` combines UI primitives with `useResource`/`usePages`.
`use-portal-pages.ts` separately implements retained pages and focus invalidation;
`catalog-changes.ts` tracks owner-scoped revisions; `pds.ts` caches viewer likes;
`like-interactions.ts` shares optimistic membership. Those policies are useful but
are currently spread between component and transport modules.

Extract the existing hooks and mutation reconciliation into a small data layer with
explicit keys, lifetimes, cancellation and retry rules. Define public resource keys
separately from viewer-DID/session/record-URI/CID keys. Preserve the distinction between
PDS acceptance and appview visibility. Membership, count and liker-list reconciliation
should have one documented owner, rather than each screen inventing optimistic rules.
Do not replace everything with a generic query library before measuring the need.

Acceptance: navigating Home → track → Back retains correct viewer state; sign-out
cannot leak it; late responses cannot overwrite another account; a lost write response
can retry without duplicate records; request counts and warm-navigation times do not
regress. Keep the portal's loaded cursor-chain and scroll behavior.

### 3. Narrow playback subscriptions and transport ownership

`PlaybackProvider` constructs one context value containing both commands and the
250ms audio status. `CatalogRoute` consumes that value, so ticking status can propagate
through whole catalog screens. Radio separately owns an audio player and registers a
toggle callback with the shell. Today's delayed-status handoff bug is concrete evidence
that the boundary needs attention.

First separate stable playback commands from status subscriptions, profiling render
counts before and after. Then make active-source handoff explicit for music, radio and
Jam synchronization. Keep audio ownership above navigation, the listened-time accounting
hook shared, and queue entries occurrence-based. This is an extraction of proven
behavior, not another player rewrite or a new persistence mechanism.

Acceptance: status ticks do not rerender command-only catalog consumers; only one
source plays; navigation never recreates the audio owner; rapid toggle/track changes,
radio handoff, queue duplicates, retry and accounting regressions remain green.

### 4. Organize the client by feature, without redesigning it

`Catalog.tsx` dispatches search, track, artist and collection pages. `AccountCatalog.tsx`
mixes library rendering, collection editing, playlist selection and mutation helpers.
The flat source directory makes unrelated features appear equally coupled.

Move incrementally toward `features/catalog`, `features/collections`,
`features/player`, `features/jams`, `features/account`, shared `ui`, and a small data
boundary. Keep Expo route files thin. Move web/native file pairs together. Extract
shared controls from actual repeated semantics; do not force Home's body-play row,
queue drag row and creator edit row into one component with many switches.

Acceptance: one feature's page and controller are easy to find; the shared design
primitives remain authoritative; web/native exports and route behavior are unchanged.
Mechanical moves belong in separate commits from behavior changes.

### 5. Reduce backend adapter sprawl while preserving trust boundaries

Keep `api → application → domain/store` and the distinction between authenticated
projection writes and public indexed reads. The small application modules already
make request validation and bounded store calls explicit.

The useful extraction targets are the composed track adapter's row decoder and shared
SQL projection/policy fragments, plus safe disposable-Postgres fixtures currently
repeated across large integration tests. Artist avatar disagreement illustrates why
shared presentation-source selection deserves a named policy. Preserve field-level
provenance and account/moderation admission checks when sharing it.

Do not replace these stores with a generic repository/ORM or move visibility filtering
into the client. Split tests by behavior without hiding SQL parameter order, transaction
scope, repository locks or allocator lifetime.

Acceptance: identical cursor/order/policy results, real-Postgres tests, bounded query
counts, and retained `EXPLAIN` checks. Snapshot rollback, decoder-version rebuild and
verified-commit ordering tests must survive any extraction.

### 6. Keep runtime composition and routing legible as endpoints grow

`main.zig` wires API adapters and dispatches worker roles; `api/router.zig` combines
HTTP policy with a long endpoint chain. Extract role-specific construction and small
endpoint-family dispatch functions when adding the next family. Keep CORS, errors,
body limits and admission consistent at the HTTP boundary. No framework replacement
or route-contract change is warranted.

## Things this review does not justify

Keep Neon/Postgres. Folder size does not establish a storage problem or a reason to
add Redis caching. Any new cache needs explicit freshness, visibility and invalidation
rules backed by measurements. Preserve independently verified ingestion, direct PDS
writes, owner-private preferences and creator-owned Jam Spaces. Label retained
production read adapters (`CatalogEmbed.tsx`, `radio-track.ts`, login discovery) clearly
rather than silently expanding their authority.

Cutover rehearsal, legacy URL migration, SDK/MCP, moderation expansion and a broad UI
redesign remain outside this cleanup pass. I would do the harness and data-layer
extractions first, and take the remaining cleanups alongside the next feature that
actually touches those boundaries.
