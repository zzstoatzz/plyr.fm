# plan: homepage feed switcher

**date**: 2026-04-12

## goal

the main infinite-scroll feed on the homepage (currently hardcoded to "latest tracks") becomes toggleable between "latest" and "for you". the toggle only appears for authenticated users whose for-you feed returns data. unauthenticated users see "latest tracks" exactly as today — no toggle, no change.

## current state

- homepage feed section: heading "latest tracks" (clickable to refresh), `TagFilter` + `HiddenTagsFilter`, infinite scroll via `TracksCache` singleton
- `TracksCache` (`$lib/tracks.svelte.ts`): global class with `tracks`, `loading`, `loadingMore`, `hasMore`, `nextCursor`, `activeTags`. fetches `/tracks/`, persists to localStorage, supports tag filtering and cursor pagination
- `/for-you` page: standalone route with its own fetch logic, auth gating, cold-start messaging, infinite scroll. fetches `/for-you/` with cursor pagination. no tag filtering (backend applies hidden-tag filtering server-side)
- top tracks period toggle: `cyclePeriod()` skips empty periods — the precedent for "don't show options that have no data"

## not doing

- backend tag filtering on `/for-you/` — it already respects hidden tags server-side; active tag selection is a "latest" concept
- removing the standalone `/for-you` route — it stays as a deep link
- "queue all" button on the homepage feed section
- cold-start messaging on the homepage — if for-you returns empty, the option simply doesn't appear
- adding more feed modes (easy to extend later — just add to the modes array)

## phases

### phase 1: ForYouCache state module

**changes**:
- new `frontend/src/lib/for-you.svelte.ts` — `ForYouCache` class following `TracksCache` pattern:
  - `tracks: Track[]`, `loading`, `loadingMore`, `hasMore`, `nextCursor`, `coldStart`
  - `fetch(force?)` → `GET /for-you/` with credentials
  - `fetchMore()` → cursor-based pagination
  - `invalidate()` → reset state
  - no localStorage persistence (scores drift between requests anyway)
  - no tag filtering (not applicable)
  - exported singleton: `export const forYouCache = new ForYouCache()`

**success criteria**:
- [ ] `just frontend check` passes
- [ ] module exports `forYouCache` with `fetch`, `fetchMore`, `invalidate`

### phase 2: homepage feed toggle

**changes**:
- `frontend/src/routes/+page.svelte`:
  - add `feedMode` state: `'latest' | 'for-you'`, persisted to localStorage key `feedMode`
  - on mount (for authenticated users only): probe `forYouCache.fetch()` — if it returns tracks, the for-you option is available. if empty, `feedMode` locks to `'latest'` and no toggle renders
  - the heading becomes: `latest tracks` or `for you`, with a toggle button (same `period-toggle` CSS class) showing the *other* option name — clicking swaps the feed mode
  - derive `tracks`, `loading`, `loadingMore`, `hasMore` from whichever cache is active based on `feedMode`
  - the `$effect` for `IntersectionObserver` calls `tracksCache.fetchMore()` or `forYouCache.fetchMore()` based on mode
  - `TagFilter` and `HiddenTagsFilter` only render when `feedMode === 'latest'`
  - the clickable-heading refresh behavior: in latest mode refreshes `tracksCache`, in for-you mode refreshes `forYouCache`
  - unauthenticated users: no toggle, no probe, "latest tracks" only — identical to today

**success criteria**:
- [ ] `just frontend check` passes
- [ ] unauthenticated: homepage looks identical to today
- [ ] authenticated with engagement: toggle appears, switching feeds swaps data source + hides/shows tag filters
- [ ] authenticated with no engagement: no toggle, just "latest tracks"
- [ ] feed mode persists across page reloads via localStorage
- [ ] infinite scroll works for both feeds
- [ ] switching feeds resets scroll position / pagination

## testing

- unauth visit: no toggle visible, "latest tracks" feed works as before
- auth visit (user with likes/playlist-adds): toggle appears, both feeds load, infinite scroll works in both
- auth visit (fresh user, no engagement): for-you probe returns empty, no toggle shown
- switch feeds mid-scroll: data resets cleanly, no stale tracks from previous feed
- tag filter state: tags applied in "latest" mode, switching to "for you" hides filters, switching back restores them
- localStorage persistence: reload page, feed mode is remembered
