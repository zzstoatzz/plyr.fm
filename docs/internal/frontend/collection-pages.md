# collection pages — the extraction pattern

how the playlist and album detail routes are structured after the #1578
native-readiness series (#1579, #1581, #1582, #1583, and the playlist
decomposition PR), and the pattern to follow when giving another large route
the same treatment (track detail, settings, portal manage are next — see the
child issues on #1578).

## the layering

```
route (+page.svelte)          owns: load glue, optimistic state, toasts,
                              confirm-dialog state, edit-mode state
  │
  ├── product actions          $lib/<surface>-actions.ts — endpoints, payloads,
  │                            error extraction. throw Error; never toast.
  │                            (playlist-actions.ts, album-actions.ts)
  │
  ├── shared behavior          $lib modules used by several routes:
  │                            collection-playback.ts (play/queue + toast),
  │                            list-reorder.svelte.ts (drag/touch state machine)
  │
  └── presentation             components that render and call back:
                               $lib/components/playlist/* , ConfirmDialog
```

rules of thumb, in order of importance:

1. **routes never call `fetch`.** every endpoint the route needs lives in a
   `$lib/<surface>-actions.ts` module with contract tests (mocked fetch
   asserting endpoint/method/payload/credentials/error detail). the route
   composes actions with its local state and owns all toasts.
2. **the route owns optimistic state.** actions return data; the route applies
   it (`tracks = [...tracks, added]`) and reverts on failure. components never
   mutate domain state — they call back (`onAdd`, `onRemoveTrack`).
3. **interaction machinery is a module, not a copy.** anything gesture-shaped
   (drag-reorder, swipes) is a reusable state machine the markup binds to
   (`reorder.handleDragStart`), following `horizontal-swipe.ts`.
4. **modals are components.** confirmations are `ConfirmDialog` (native
   `<dialog>`, pending state, danger variant). flow-specific modals own their
   internal state entirely (AddTracksModal owns query/results/debounce and
   resets itself on close) and expose `open` as a `$bindable`.
5. **CSS moves with the markup.** a component carries every rule its template
   references; svelte-check's unused-CSS warnings police the route side after
   an extraction — drive them to zero. watch for cascade collisions the old
   single-file styles relied on (the playlist page had two `.spinner` rules
   where the later one won; the components carry the merged result).
6. **web-only concerns stay at the edge.** SSR/meta tags, `$page`, keyboard
   shortcuts, `localStorage` priming, and navigation stay in the route. a
   future native client should be able to reuse the actions + behavior layers
   wholesale and reimplement only the presentation/shell.

## verification expectations

these are refactors of live behavior, so each extraction PR carries:

- unit/contract tests for any new module
- a live browser pass against local dev (chrome-devtools MCP, signed-in)
  re-running the surface's behavior checklist and comparing the network log
  to the pre-refactor baseline — every mutation fires the same request from
  the same user gesture (see `.scratch/pr1-baseline.md` for the playlist
  checklist format)
- intentional non-behaviors called out in the PR body

## known deliberate divergences

- add-tracks search dedup filters by **track id**. the pre-refactor code
  filtered by `atproto_record_uri`, but `/search` results never included that
  field, so the dedup was a silent no-op; ids are returned and correct.
- the visibility/delete confirmations render in the browser top layer (native
  `<dialog>`) instead of a page-local overlay div.

## what is NOT yet extracted

- the playlist/album hero (artwork + title + meta + owner controls) — waiting
  on the design-system "collection header" primitive (#1578 child issue) so
  both pages converge on one component instead of two extractions.
- the album page's track list markup (it still renders rows inline; it shares
  the reorder module and actions already). converge it with
  `PlaylistTrackList` when the collection-header work lands.
