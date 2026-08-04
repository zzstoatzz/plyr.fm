# research: player/queue/radio architecture — why source-conflict bugs manifest, and what mature players do differently

**date**: 2026-08-03
**question**: after #1757 (radio toggling ate the queue via a stale seek handler + cross-source position pollution), evaluate the player mechanics structurally: are there architectural reasons this class of bug manifests, and what can we learn from well-written open-source media players?

## summary

The bug class is structural, not incidental: one shared `<audio>` element has **many writers coordinating through reactive effects and implicit mode flags**, so nothing scopes work (listeners, async continuations, position bookkeeping) to the source it belongs to. Every mature player studied — MPD, mpv, ExoPlayer/media3, AVFoundation, vidstack, shaka-player, hls.js, feishin, jellyfin-web — converges on the same handful of counter-patterns: a single funnel that owns the element, per-load lifecycles that stale work cannot outlive, mode as an explicit single value rather than flag algebra, and intent (requests) separated from resulting state. None of them coordinate playback through the equivalent of `$effect`s watching shared mutable fields.

## findings: our architecture (the evidence)

Full writer inventory gathered 2026-08-03 against `main` (post-#1757). Highlights:

- **`player.paused` has 22 writer sites across 4 files** — it is simultaneously an input (the paused-sync effect at `Player.svelte:581` drives the element from it) and an output (DOM `onplay`/`onpause` at `Player.svelte:862-863` and three separate `play()`-rejection handlers write it back). The loop is stable only because the writes happen to be idempotent.
- **Mode is flag algebra, not a value.** "What owns the element" is the conjunction of three unrelated fields: `player.radio !== null` (`player.svelte.ts:42`), `jam.active`, and the implicit fallback "queue owns it when nothing else claimed it." Four separate call sites in `queue.svelte.ts` (`:552`, `:631`, `:655`, `:687`) must each remember to write `player.radio = null` when a queue action takes over. Forgetting one is a latent #1757.
- **The master arbitration effect** (`Player.svelte:610`) reads seven pieces of state and writes six (`player.currentTrack`, `paused`, `currentTime`, `shouldAutoPlay`, `previousQueueIndex`, `positionRestored`). Its correctness depends on Svelte's effect-flush batching; the fast-path advance carries a comment (`Player.svelte:~800-850`) warning that the fix holds only "as long as no `await` is introduced between these two adjacent lines."
- **Seven ad-hoc coordination latches** exist solely to sequence effects: `isLoadingTrack`, `positionRestored`, `leavingRadio`, `previousTrackId`, `previousFileId`, `previousQueueIndex`, `attachedTrackId/FileId`. Each is a hand-rolled substitute for a lifecycle the architecture doesn't have.
- **Listeners are not scoped to loads.** #1757's root cause was exactly this: `playRadio`'s station seek attached to the *element* (which persists) instead of to the *load* (which doesn't). The fix added manual tracking+removal — the pattern the codebase lacks generally. `attachResolvedSource` similarly relies on `{ once: true }` and dedup flags rather than symmetric teardown.
- **Position has three owners** (`player.currentTime` bound from the element, `queue.progressMs` persisted, `jam.progressMs` server-fed) and the persistence effect (`Player.svelte:130`) now enumerates four guard conditions describing when writing is legal — guards encoding, negatively, an ownership rule that is nowhere stated positively.
- **Three parallel playback stacks**: the main player, the embeds (`CollectionEmbed`, `RadioEmbed`, `embed/track`), and the record page each own separate audio elements and reimplement play/pause/mediaSession independently.
- Deferred from #1757: mediaSession handlers (`Player.svelte:65-105`) route `play/pause/nexttrack` to **queue** methods even while radio owns the element, so a lock-screen "next" pokes the queue underneath radio.

## findings: what the mature players do

### the convergent shape (native: MPD, mpv, media3, AVFoundation)

- **One serialized command channel; sources never touch engine state.** MPD's player thread accepts a closed command enum via a mutex/cond handshake — exactly one command in flight, acknowledged on completion (`src/player/Control.hxx`). mpv exposes *only* commands + observed properties ("direct access to player components is unavailable"); source switching is a command with explicit policy (`loadfile ... replace|append|append-play`). media3 requires all Player calls on one thread — serialization by construction.
- **Per-item lifecycles kill stale work by object identity.** AVFoundation observers attach to the `AVPlayerItem`, not the player — when the queue advances, old-item callbacks structurally cannot fire against the new item. No defensive checks needed.
- **Capability masks make "what's allowed right now" data.** media3's `getAvailableCommands()` returns a `COMMAND_*` set that changes with state and item (live radio simply lacks `COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM`); UI affordances and guard logic both derive from the mask instead of mode if-chains.
- **Transitions carry reasons.** media3's `onMediaItemTransition(item, reason)` / `onPositionDiscontinuity(reason)` distinguish `AUTO` / `SEEK` / `PLAYLIST_CHANGED`; mpv emits `MPV_EVENT_PLAYBACK_RESTART` so clients can gate on *settled* state. "User skipped" vs "ended naturally" is never inferred.

### the web frameworks (vidstack, video.js, shaka, hls.js)

- **Requests ≠ state** (vidstack, the most complete web treatment): user intent is dispatched as `media-*-request` events; `MediaRequestManager` (`core/state/media-request-manager.ts`) is the only code that calls the provider, and it records each pending request in a queue; `MediaStateManager` is the **only writer** of the media store, translating provider events back and pairing each with its originating request — so every state change knows whether it was user- or media-initiated.
- **Generation counters make stale async self-terminating** (shaka `lib/player.js`): every load/unload does `operationId_++` and re-checks it after every awaited step under a mutex, throwing an abort error if superseded. jellyfin-web threads an incrementing `playSessionId` through stream URLs for the same purpose.
- **Explicit reset whitelists on source change** (vidstack `RESET_ON_SRC_CHANGE`): which store keys reset vs persist (volume survives, `ended` doesn't) is a declared list, so nothing bleeds implicitly.
- **Symmetric attach/detach owns listener lifetime** (hls.js `base-stream-controller.ts`): `onMediaAttached` registers all element listeners, `onMediaDetaching` removes them all, nulls the media ref, and aborts in-flight loads; controllers run a named state enum (`IDLE`, `FRAG_LOADING`, `ENDED`, …).

### the closest peers (feishin, jellyfin-web)

- **feishin: component-per-source, mounted exclusively.** Radio and queue are *different components with different audio elements and different stores*; a single top-level renderer (`audio-players.tsx`) mounts exactly one based on mode. Switching source = unmount, so stale handlers are impossible by construction, and radio's progress callback is deliberately empty — it *cannot* write the queue's timestamp store. Remote-command handlers are gated `if (!isRadioActive)` in one place.
- **jellyfin-web: one façade, per-player state namespaces.** `playbackmanager.js` is the sole entry point; players are plugins behind an interface; per-player state lives in `playerStates[player.name]` so a background player can't clobber the active one. The shared `<audio>` plugin **unbinds and rebinds all listeners on every `setCurrentSrc`**, and `ended` fires a `'stopped'` event *carrying the src it belonged to* — the manager validates and decides; the element layer never calls `next()` itself.
- Notably: **neither uses a formal state machine or command queue** — ownership boundaries + lifecycle discipline suffice at app scale. The heavyweight machinery (vidstack/shaka) belongs to framework scale.

## why #1757 specifically fell out of our shape

Each of the three bugs maps to one missing pattern:

| bug | missing pattern | who has it |
|---|---|---|
| stale `loadedmetadata` seek fired on the next source | per-load listener scoping / symmetric detach | hls.js, jellyfin rebind-per-load, AVPlayerItem, feishin unmount |
| radio's clock overwrote `queue.progressMs` | per-source position namespacing / single position owner | feishin (radio can't write timestamps), jellyfin (`playerStates`), media3 (item-scoped position) |
| stop → queue autoplayed (and `lastUpdateWasLocal` staleness generally) | requests paired with resulting state; reason-tagged transitions | vidstack request queue, media3 transition reasons |

## recommendations (incremental — each stands alone)

1. **Load-session scoping inside `player.svelte.ts`** *(small; no API change; highest value/cost)*. Introduce a `loadId` generation counter incremented on every source attach (queue track, radio, jam). Every element listener registered for a load is stored on a session object and removed on the next attach; every async continuation (`resolveAudioSource` then-blocks, hls module loads, seek handlers) checks `loadId` before touching the element. This generalizes the #1757 fix from one handler to the whole file and subsumes `attachedTrackId/FileId` and the `assigned`-proxy checks. (shaka `operationId_`, jellyfin `playSessionId`.)
2. **Mode as one value.** Replace the `radio`-null / `jam.active` / implicit-queue algebra with a single discriminated `source: { kind: 'queue' } | { kind: 'radio', np } | { kind: 'jam', ... }` and **one** transition function that performs entry/exit (the four scattered `player.radio = null` sites collapse into it, as does `leavingRadio`). Exit actions — what resets, what persists — become an explicit list (vidstack's reset whitelist).
3. **A capability mask derived from `source`.** `canSeek`, `canNext`, `canPause`, `canScrub` as one derived object; footer controls, keyboard shortcuts, and mediaSession handlers all read it. This structurally fixes the deferred "lock-screen next pokes the queue during radio" and deletes the `radioMode` prop-threading. (media3 `COMMAND_*`.)
4. **Single funnel for element writes.** Move the remaining direct element manipulation (jam drift correction, repeat-one restart, hydration restore) behind engine methods so `player.svelte.ts` is the only file that touches `audioElement`. Effects become request-emitters. Optionally adopt vidstack's request-pairing later if "user paused vs browser paused" ambiguity bites again.
5. **Longer-term, opportunistic:** unify the embed/record stacks on the same engine (feishin's per-source component mounting is a good model for the embeds — they already are separate components; they should share the engine, not reimplement it), and namespace position per source so the persistence guard-list becomes structural.

Not recommended: a full XState-style machine or vidstack-scale request architecture — the peer apps (feishin, jellyfin) demonstrate ownership + lifecycle discipline is sufficient at our scale, and #1757's fix pattern extends naturally into recommendations 1–2.

## code references

- `frontend/src/lib/player.svelte.ts:42,112-160,248-280` — radio mode flag, playRadio seek lifecycle (post-#1757), stopRadio
- `frontend/src/lib/components/player/Player.svelte:130,483,581,610,673` — persistence guards, loader, paused-sync, master arbitration, autoplay latch
- `frontend/src/lib/queue.svelte.ts:552,631,655,687` — the four "leaves radio mode" writes
- `frontend/src/lib/jam.svelte.ts:414` — jam writing `queue.currentIndex` as a side-channel
- external: vidstack `core/state/media-request-manager.ts` / `media-state-manager.ts`; shaka `lib/player.js` (`operationId_`); hls.js `src/controller/base-stream-controller.ts`; feishin `src/renderer/features/player/components/audio-players.tsx`; jellyfin-web `src/components/playback/playbackmanager.js`, `src/plugins/htmlAudioPlayer/plugin.js`; MPD `src/player/Control.hxx`; media3 `androidx.media3.common.Player`

## open questions

- does recommendation 2 (source union) want to land before or with recommendation 1? they touch the same code; doing 1 first keeps each PR reviewable.
- jam is the least-exercised mode — before refactoring around it, decide whether its queue side-channel (`syncToQueue`) is behavior to preserve or a bug of the same species.
- embeds: worth unifying, or intentionally kept dependency-free for embed-page weight?
