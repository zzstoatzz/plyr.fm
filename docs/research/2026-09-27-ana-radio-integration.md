# research: Ana's radio with the plyr.fm catalog

**Date:** 2026-09-27  
**Question:** Replace plyr's radio with Ana's radio, allow only plyr.fm tracks, and preserve existing stations.  
**Inspected:** plyr main `8c8a646d`; sister-radio `8e2ca57a5092e4c2d6087876421a7e16f9b43f2b`.

## Recommendation

Feasible, but this is an integration rather than a player swap. Adapt the listener experience and shared queue model into plyr, keeping our catalog, authentication, media delivery, and one persistent player. A literal sister-radio fork is possible, but requires replacing its media ingestion, adding station isolation, and bridging its SolidJS player to our Svelte app.

This investigation makes no runtime changes. The source linked from Brooke's deployed site's footer is [brookie.blog/brooke-fm](https://tangled.org/brookie.blog/brooke-fm); that repository identifies itself as a fork of [okami.mom/sister-radio](https://tangled.org/okami.mom/sister-radio). The upstream was inspected; Brooke's fork may contain additional UI differences.

## What upstream provides

- Rust/Axum, SQLite, SolidJS, and browser OAuth. Its README describes a standalone frontend, but that still expects its radio protocol and discovers remote stations; it is not a plyr API adapter.
- Shared current playback and mutable queue; WebSocket snapshots, listener avatars/counts, hearts, chat, and queue administration. See `src/radio/types.rs:9`, `src/radio/types.rs:109`, `src/routes/radio.rs:56`, and `frontend/src/pages/radio/RadioPage.tsx:568` in the upstream checkout.
- One station per server/database: playback repeatedly reads/writes `radio_state where id = 1` (`src/radio/service.rs:1695`). The station picker switches backend URLs (`frontend/src/shared/lib/stationSelection.ts`), rather than independent stations inside one backend.
- A local media library. Song records resolve to filesystem paths (`src/radio/types.rs:47`, `src/radio/service.rs:1055`); imports include file uploads, arbitrary HTTP URLs, yt-dlp sources, M3U playlists, and Subsonic (`src/routes/upload.rs:139`, `src/routes/subsonic_import.rs`). Hiding the upload panel does not remove these APIs.
- Imports and queue mutations already require an allowlisted admin DID (`src/routes/xrpc.rs:499`, `:641`, `:735`, `:1759`). They are not open anonymous uploads. Catalog-only enforcement must also constrain administrators; the reported `songs:add` and `radio:control` permissions use the same admin gate rather than separate roles.
- Skip exists as an authenticated admin action (`src/routes/xrpc.rs:866`), not listener voting. Adopting upstream alone would not resolve [plyr issue #2077](https://github.com/zzstoatzz/plyr.fm/issues/2077).
- Presence currently counts connected viewers, including a socket opened before playback, and accepts a client-supplied DID after format validation. For plyr, count actual listening sessions and derive identity from our authenticated session. The tracker is process-local (`src/routes/mod.rs:169`); plyr's multiple API instances require shared presence state.

## Preserve our stations

Keep station slugs, links, embed behavior, and selection rules; their existing policies can feed a mutable queue just as they feed today's rotation.

| Station | Existing policy to retain |
| --- | --- |
| `loved` | Rank by likes and plays, with catalog exploration. |
| `fresh` | Prefer newest uploads; no uniform exploration of old tracks. |
| `deep-cuts` | Favor older, underplayed material with broader sampling. |
| `slop` | AI-tagged tracks only, excluding the plyr.fm account's updates. |
| `firehose` | waow.tech's archived tracks, currently preempted by its external live HLS stream. |

Sources: `backend/src/backend/api/radio/stations.py:100`, `lenses.py:50`, `sampler.py`. Today the station clock is a cached rotation reseeded every four hours (`state.py:53`), not a mutable shared queue.

**Firehose needs an explicit product decision before implementation:** preserving live behavior conflicts with a literal catalog-only rule. Strict catalog-only mode retains the station but removes the external live source, playing eligible waow.tech archives. STATUS.md says those archives are unlisted, so that would currently leave it off air. Alternatively preserve the existing curated live-source exception. Neither should happen silently.

## Enforce catalog-only radio

1. Accept plyr track IDs (or resolve a plyr track link to an ID); never accept user-provided media URLs or audio bytes at radio endpoints. Resolve metadata and playable renditions on the backend. Track IDs, not shared media file IDs, identify queue entries.
2. Use the existing radio eligibility policy for automatic selection and any manual requests: public discovery, ungated, active artist, no operator exclusion, no adult-audio or copyright label (`backend/src/backend/api/radio/corpus.py:21`). Recheck eligibility when scheduling and when resolving playback; a queued track may subsequently become private, removed, or moderated.
3. Keep normal artist publishing through plyr's existing upload flow. This restriction concerns adding media directly to radio, not removing uploads from plyr itself.
4. If forking upstream, remove/disable file, URL, playlist-import and Subsonic import handlers on the server, and replace song storage with references to plyr tracks. Do not duplicate audio into the radio server. Our existing audio resolver already chooses the rendition/storage source (`state.py:59`). Catalog-only does not mean every byte must originate on the plyr.fm hostname.
5. Supply an explicit plyr station allowlist. Disable directory-based station discovery and arbitrary station selection through remembered URLs or query parameters; otherwise the UI still tunes to external audio without an upload.

## Integration choices

| Approach | Consequence |
| --- | --- |
| Adapt the experience and shared queue behavior in plyr (recommended) | Svelte presentation using our player; FastAPI/Redis presence and station state; reuse catalog policy and station selectors. No second auth or media library. |
| Fork sister-radio as a service | Replace ingestion/audio resolution; add station keys throughout playback, queues, history, events and presence, or operate separate instances; bridge auth and preserve the public plyr API and footer player. Most upstream reuse, substantially more integration. |
| Point upstream's standalone UI at plyr | Requires an adapter implementing its state, seek, songs, audio, WebSocket and control contracts. Does not by itself preserve our player or enforce station restrictions. |

Our `frontend/src/lib/radio.svelte.ts:1` intentionally drives the global player rather than owning an audio element. Upstream owns its own audio element (`RadioPage.tsx:375`). Embedding it untouched would introduce competing playback ownership and lose integration with our queue, navigation and media controls.

## Suggested implementation sequence

1. Rebuild `/radio/[[station]]` around the cover, now-playing details, station pills, upcoming queue and listener avatars. Retain station URLs, `/embed/radio`, `/radio/stations`, `/radio/state` and `/radio/state.json`; preserve anonymous listening. Keep the existing scheduler for this first independently reviewable change.
2. Add station-scoped presence with authenticated identity, anonymous counts, expiry, reconnect handling and cross-instance events. Our jam transport is useful prior art (`backend/src/backend/api/jams.py:263`, `backend/src/backend/_internal/jams.py:708`), but jam membership is not the same as active radio listening.
3. Replace four-hour rotations with authoritative per-station playback state and a short upcoming queue, replenished from the existing station policies. Advance atomically once across workers; persist current track and start time so restarts and reconnects preserve the shared clock. Decide listener skip semantics separately from upstream's admin skip.
4. Add catalog-backed requests/curation if desired. Chat and external syndication are separate scope, not prerequisites for replacing the radio experience.

Verification should cover rejection of arbitrary media sources through direct API calls; station isolation; a queued track becoming ineligible; concurrent advancement; reconnect/restart synchronization; expired presence and spoofed identities; all existing station filters and public API/embeds; and mobile playback through the one global player. Retain relevant existing radio tests (`backend/tests/api/test_radio.py`, `frontend/src/lib/player-radio.test.ts`).

## Remaining uncertainties

- Whether “adopt” means a maintained upstream fork or adapting the experience and behavior. Both are feasible; the latter fits our existing architecture better.
- Firehose live exception versus strict catalog-only playback.
- Upstream did not include a LICENSE/COPYING file or a package license declaration in the inspected checkout. Clarify reuse terms with Ana before copying implementation; no source was copied here.
- This was source inspection, not a running prototype or mobile playback verification.

## Implemented preview

Fork: https://tangled.org/zzstoatzz.io/plyr-radio, branch `feat/plyr-preview`.
Local checkout: `/Users/nate/tangled.org/zzstoatzz.io/plyr-radio`.
Preview: https://plyr-radio-preview.fly.dev (separate Fly app and SQLite volume).

The fork retains the upstream Rust server, signed embedded PDS and sister-radio
protocol. Its catalog adapter uses the public plyr.fm schedules for all five
existing stations. The tuner is restricted to those stations; upload/import and
queue/control mutations are rejected. Firehose excludes the external live relay
and currently has no catalog archives. Root loved is the single peer identity;
other stations have local `/stations/<slug>` routes. Public crawl announcements
are disabled for the preview.

Verified 35 Rust tests, frontend typecheck/build, deployed HTTP and WebSocket
smoke checks, desktop/mobile playback and navigation. Ana’s live player at
radio.wisp.place successfully played the preview as a remote station. OAuth
sign-in is not tested end to end; upstream presence DIDs are client-reported.
No existing plyr.fm deployment or production data was changed.

## In-app integration requirements (preview feedback)

The standalone preview proves sister-player interoperability, but does not share
plyr.fm authentication or appearance preferences. Its listener DID comes from
its own OAuth session. Upstream sends viewerHello on socket open, even before
playback begins, so its count represents connected viewers rather than active
listeners.

The user-facing radio should live at the existing `/radio/[[station]]` route,
using the global plyr.fm player and its shared preferences. Read font and accent
from existing design tokens (`--font-family`, `--accent`); user-selected accent
must take precedence over artwork-derived colors. No second settings store or
radio-specific login should be introduced.

Authenticated station presence is new plyr.fm backend work. Reuse the cookie
session and allowed-origin checks established by `backend/api/jams.py`, with
Redis-backed expiring presence across backend processes. Derive authenticated
DIDs server-side; never accept an arbitrary claimed DID as authentication.
Presence follows actual playback, station switches, pause, logout, disconnect,
and reconnect, including playback while navigating away from the radio page.
Deduplicate authenticated listeners across tabs; keep guests anonymous. Test
expiry and multi-process visibility with real Redis.

The signed station identity and read-only PDS protocol are a separate integration
concern. The existing fork adapter already proves them; it can remain behind the
scenes initially, but its presence view must use the same source as plyr.fm rather
than maintaining a second count. Moving that protocol into FastAPI is optional
and should not be conflated with styling or session integration.
