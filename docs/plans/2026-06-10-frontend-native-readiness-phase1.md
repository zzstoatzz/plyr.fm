# plan: frontend native-readiness phase 1 — collection pages as proving ground

**date**: 2026-06-10
**issue**: #1578 (parent tracker)

## goal

prove the extraction pattern from #1578 on the highest-impact surface — collection
detail pages (playlist + album) — via a series of small, behavior-preserving PRs.
each PR moves product logic out of route components into named `$lib` modules,
following the repo's existing idioms (flat `$lib/*.ts` modules, attachment-style
interaction helpers, `docs/internal/frontend/*.md` pattern docs).

## current state

- `src/routes/playlist/[id]/+page.svelte` is 2589 lines (~707 script / ~837 markup /
  ~1041 css) with 15+ responsibilities and 8+ hand-rolled `fetch` calls
  (add/remove track, reorder, rename, visibility, cover upload, delete, search,
  recommendations). no playlist/album action module exists anywhere in `$lib`.
- `src/routes/u/[handle]/album/[slug]/+page.svelte` (1293 lines) duplicates the
  playlist page's rituals nearly byte-for-byte: the ~85-line drag/touch reorder
  handlers (playlist 545–637, album 293–380), play/queue buttons, cover upload,
  delete-confirmation modal, edit-mode toggle.
- existing managers the pages already use correctly: `queue.svelte.ts`
  (`playNow`/`addTracks`), `playback.svelte.ts` (`playQueue`/`guardGatedTrack`),
  `tracks.svelte.ts` (likes). the gap is collection *mutations*.
- test tooling: vitest + jsdom configured, only 2 test files exist
  (`SensitiveImage.test.ts`, `RadioEmbed.test.ts`). no e2e harness.
- verification decision: local dev instance driven via chrome-devtools MCP with a
  signed-in session (user signs into the MCP-controlled chrome once against
  localhost). baseline screenshots + network logs captured before each refactor,
  re-run after.

## not doing

- no iOS/android work, no framework changes, no visual redesign (per #1578)
- no behavior changes in any PR of this phase — pure extraction/dedup
- no generated API contracts yet (that's a separate child issue of #1578)
- not touching track detail / settings / portal in this phase — the pattern gets
  documented first, then repeated via child issues

## verification harness (before phase 1, no PR)

1. user runs `just frontend run` + `just backend run` (already hot-reloading)
2. user signs into the MCP-driven chrome against localhost
3. create a scratch playlist with a few tracks; capture the **baseline**: for each
   behavior (play, queue, enter edit mode, drag-reorder, add track, remove track,
   rename, toggle visibility, upload cover, delete), record screenshot + network
   requests + console state
4. after each PR's changes: re-run the same checklist, diff against baseline
   (same endpoints hit, same payload shapes, same UI states, no new console errors)

## phases

### phase 1 (PR 1): playlist action module

**changes**:
- `frontend/src/lib/playlist-actions.ts` (new) — typed functions wrapping every
  playlist mutation currently inlined in the route: `addTrackToPlaylist`,
  `removeTrackFromPlaylist`, `reorderPlaylist`, `updatePlaylistMetadata`
  (name / show_on_profile / is_private), `uploadPlaylistCover`, `deletePlaylist`,
  plus the search + recommendations fetches. consistent error handling; route
  keeps owning toasts/UI state.
- `frontend/src/lib/playlist-actions.test.ts` (new) — vitest with mocked fetch:
  correct endpoints/methods/payloads, error propagation
- `frontend/src/routes/playlist/[id]/+page.svelte` — replace the 8+ inline fetch
  rituals with calls into the module. no markup/css changes.

**success criteria**:
- [ ] `bun run test` passes (new tests prove endpoint/method/payload contracts)
- [ ] `just frontend check` + `bun run lint` + `uvx loq` clean
- [ ] browser checklist matches baseline (every mutation fires the same request
      and lands in the same UI state)

### phase 2 (PR 2): album action module

**changes**:
- `frontend/src/lib/album-actions.ts` (+ test) — same shape for album endpoints
  (metadata edit, cover upload, track removal, delete)
- `frontend/src/routes/u/[handle]/album/[slug]/+page.svelte` — consume it

**success criteria**:
- [ ] same gates as phase 1, album-page checklist vs baseline

### phase 3 (PR 3): shared drag-reorder module

**changes**:
- `frontend/src/lib/list-reorder.ts` (new) — extract the duplicated desktop drag +
  touch reorder handlers into one reusable module, following the
  `horizontal-swipe.ts` / `swipe-to-dismiss.ts` attachment pattern
- both collection pages consume it (~170 duplicated lines deleted)

**success criteria**:
- [ ] desktop drag-reorder + touch reorder verified in browser on both pages
      (chrome-devtools `drag` + emulated touch), order persists after save/reload

### phase 4 (PR 4): shared collection UI primitives

**changes**:
- `frontend/src/lib/playback.svelte.ts` (or new module) — `playCollection` /
  `queueCollection` helpers replacing the duplicated play/queue button logic.
  note: this is the seam STATUS.md's "collection continuity (Part B)" wants —
  keep the helper shaped so a labeled playback context can attach later.
- replace both hand-rolled delete modals with the existing confirm-dialog
  component (or extract one if none is reusable)

**success criteria**:
- [ ] play-all / queue-all from both pages behaves identically to baseline
- [ ] delete flows confirmed in browser on scratch collections

### phase 5 (PR 5): decompose playlist route + document the pattern

**changes**:
- split `playlist/[id]/+page.svelte` into sub-components (header/hero, track
  list, edit panel, modals) under `frontend/src/lib/components/` or colocated
- `docs/internal/frontend/collection-pages.md` (new) — document the proven
  pattern: route = load + compose; product actions in `$lib` modules;
  interactions as attachments; web-only concerns at the edge
- file child issues on #1578 for repeating the pattern (track detail, settings,
  portal manage) and check off the corresponding parent checkboxes

**success criteria**:
- [ ] playlist page renders/behaves identically (full browser checklist)
- [ ] file sizes: playlist route script well under its current 707 lines;
      no loq suppressions added manually
- [ ] pattern doc reviewed; child issues filed

## testing

- every phase: vitest + svelte-check + eslint + `uvx loq` locally before PR
- browser checklist per phase (owner flows, signed-in local session)
- key edge cases to exercise: reorder then navigate away without saving;
  visibility toggle with pending edits (the flush-pending path, playlist 405–453);
  cover upload validation failure; delete → redirect; gated-track guard on play
- after each merge: staging spot-check on stg.plyr.fm
