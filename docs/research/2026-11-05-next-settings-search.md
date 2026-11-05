# Next Home, Settings and Search verification

November 5, 2026. The scope was quieter Home actions, usable Settings, and Search
informed by the existing iOS app, including verification of the new backend.

## References and resulting behavior

Production `TrackItem.svelte` deliberately collapses mobile actions to one menu.
Next Home rows and chart cards now expose one menu, retaining body playback and
separate title/artist links. Like, queue and playlist actions stay available in
the menu through the existing direct-PDS mutation path. No new write authority or
preference storage was introduced.

The iOS app at `a8750b4a2fc229a0ffa1442a8150bf73d97e0027` supplied the useful Search
shape: `mobile/app/(tabs)/(home,search)/search.tsx`, `SearchField.tsx` and
`SearchResultRow.tsx`. Next uses a compact mixed list in backend rank order, artwork,
a kind label and whole-row track playback. Other result types remain links. Full
track metadata is fetched only on selection. Type filters and 20→50 result expansion
use the existing bounded API contract. There is no claim of cursor pagination or tag
search; the backend supports tracks, artists, albums and playlists.

Settings now has icon-led appearance/playback/account sections with compact value
rows. Theme, font, scale and accent choices open focused pickers. The existing
local/private-Space preference ownership and sync logic are unchanged. Navigation
rows remain links; settings that act on the current screen remain buttons.

Search reads abort on replacement, clear or unmount. Aborted reads do not retry;
stale results and pending track selections cannot win after a changed query or
navigation. GET deadlines now cover response-body reads as well as headers. Space
works directly after a result is selected, preserving the shared player shortcuts.

## Backend findings

The existing search implementation already had strict UTF-8/query/limit validation,
exact/prefix/substring/fuzzy ranking, type filters, canonical record identities,
field provenance and account/moderation visibility checks. It was not replaced.

The broad-query plan did expose an avoidable join: track metrics were hydrated for
all candidates before the result limit. Ranking does not depend on play counts.
The new query ranks and limits first, then hydrates metrics for the selected hits.
Ordering, match tiers and visibility admission remain unchanged.

The isolated search benchmark also still expected the retired artist table instead
of the actor-identity projection. That fixture is repaired. Separately, Zig's test
run step could reuse a cached successful result despite changed external services.
Declaring that step side-effecting reruns tests while retaining compilation caching.

### Local measurements

Disposable PostgreSQL 16, release backend, 20,000-track fixture, five-second samples.
These are local diagnostics, not Neon or end-user latency promises.

| case | median | p95 | notes |
|---|---:|---:|---|
| selective exact search, concurrency 1 | 2.22 ms | 2.68 ms | after change |
| selective exact search, concurrency 16 | 6.54 ms | 10.78 ms | ~2,357 requests/s, no errors |
| broad two-character search, before | 192.20 ms | 203.43 ms | 19,900 candidate metric probes |
| same broad search, after | 108.43 ms | 110.42 ms | 20 metric probes for 20 results |

The selective query uses the title trigram index. Broad short queries still scan and
rank many matches; the fix does not pretend that every search is a two-millisecond
operation. A public pre-deploy sample was ~148 ms median including network overhead.

`next/backend/scripts/check_search_plan.py` runs the actual source SQL with
`EXPLAIN ANALYZE` against the isolated `zig_bench` fixture and checks that metric
probe loops do not exceed the result limit. The pre-fix real plan fails that bound.
Prepare the fixture using `just zig bench-search`, then run:

```sh
uv run --project backend python next/backend/scripts/check_search_plan.py
```

On Homebrew systems, use the explicit OpenSSL paths documented in the backend README
when building Zig. The benchmark refuses other database names. No new storage system,
cache, migration, SDK or cutover work was introduced.

## Verification boundaries

- All 198 Zig tests executed against disposable Postgres and Redis. Added real-store
  checks cover match-tier order, stable limits, Unicode and literal percent/underscore
  searches; existing unavailable/private/moderation checks remain intact.
- Chrome and WebKit at 390/1280px in both themes exercised Settings pickers, invalid
  accent input, saved preferences after reload, search filters/expansion/clear/empty/
  retry, cancellation, Space and audio continuity through artist navigation.
- Those deterministic cases use catalog/search response fixtures and real catalog
  audio. They block appview metric writes. Home's separate flow uses real disposable
  PDS OAuth and like/unlike writes, including state across Home/detail navigation.
- The public-assets Chrome audit passed 44 rendered states with no selected-rule axe
  violations or root overflow. Settings was also checked at 130% interface scale.
- Real-catalog mode uses public assets and the actual Next Search API: it finds and
  plays “Sounds of the Drone Mix,” then finds an artist and navigates without stopping
  audio. Chrome and WebKit passed phone/desktop × light/dark cases.
- Physical devices, native gestures and screen-reader interaction remain unverified.
  Native bundle exports are build checks, not device acceptance.

Repeat controlled and real-catalog browser checks from the repository root:

```sh
node next/app/scripts/check-settings-search.cjs
SETTINGS_SEARCH_REAL_CATALOG=true node next/app/scripts/check-settings-search.cjs
```

`SETTINGS_SEARCH_DIST` selects an immutable local export; omit it for public assets.
`SETTINGS_SEARCH_BROWSER=webkit` selects WebKit. Browser/module-path overrides follow
the existing verification scripts. The fixture preference seed can be applied once
so reload checks exercise persistence instead of resetting preferences.

Merged changes: #2407 (test execution), #2408 (search hydration and regressions),
#2409 (Home menu), #2410 (Settings), #2411 (Search). These deploy only to Next.
Normal production was not promoted; `production-fe` remained
`99334ecb0830fcd8eef411dad35f857361f48d43` and production web/API health stayed green.
