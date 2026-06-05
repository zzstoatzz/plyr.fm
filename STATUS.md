# plyr.fm - status

## long-term vision

### the problem

today's music streaming is fundamentally broken:
- spotify and apple music trap your data in proprietary silos
- artists pay distribution fees and streaming cuts to multiple gatekeepers
- listeners can't own their music collections - they rent them
- switching platforms means losing everything: playlists, play history, social connections

### the atproto solution

plyr.fm is built on the AT Protocol (the protocol powering Bluesky) and enables:
- **portable identity**: your music collection, playlists, and listening history belong to you, stored in your personal data server (PDS)
- **decentralized distribution**: artists publish directly to the network without platform gatekeepers
- **interoperable data**: any client can read your music records - you're not locked into plyr.fm
- **authentic social**: artist profiles are real ATProto identities with verifiable handles (@artist.bsky.social)

### the dream state

plyr.fm should become:

1. **for artists**: the easiest way to publish music to the decentralized web
   - upload once, available everywhere in the ATProto network
   - direct connection to listeners without platform intermediaries
   - real ownership of audience relationships

2. **for listeners**: a streaming platform where you actually own your data
   - your collection lives in your PDS, playable by any ATProto music client
   - switch between plyr.fm and other clients freely - your data travels with you
   - share tracks as native ATProto posts to Bluesky

3. **for developers**: a reference implementation showing how to build on ATProto
   - open source end-to-end example of ATProto integration
   - demonstrates OAuth, record creation, federation patterns
   - proves decentralized music streaming is viable

---

**started**: October 28, 2025 (first commit: `454e9bc` - relay MVP with ATProto authentication)

---

## recent work

### June 2026

#### radio stations + tuner dial + diversity + per-user liked state (PRs #1530→#1548, prod June 5, release 2026.0605.172049 + frontend-only follow-ups)

**why**: radio launched as a single undifferentiated stream that one prolific artist (long DJ sets) dominated, with no way to pick a vibe. It also leaked tracks from deactivated accounts and AI "slop", was broken on mobile (reload loop, accidental station switches, cramped layout), and the like button never reflected what the signed-in listener had already liked.

**what shipped**:
- **station lineup** (`api/radio/`): the stream is now a set of distinct stations — `loved` (most-played, the default, back-compatible when `?station` is omitted), `fresh` (newest by rank-based recency), `deep-cuts` (underplayed back-catalog), and `slop` (AI/suno-tagged, reusing `DEFAULT_HIDDEN_TAGS`). Every non-slop station excludes slop; slop excludes the plyr.fm account's own tracks. Stations are bookmarkable at `/radio/<slug>`; the URL path is the source of truth.
- **diversity**: rank-decay weighting (`exp(-rank/RANK_DECAY)` over each station's lens ranking, not raw scores) bounds the tail so no single artist or catalog size swamps a station — replaced a naive airtime cap.
- **tuner dial** (#1539): replaced station tabs with a horizontal tuner dial + needle indicator; arrow keys and swipe flip stations (the swipe attachment bails on vertical-dominant / button-origin gestures).
- **per-user liked state** (#1546, #1548): `/radio/state` takes an optional session and returns `liked` per track via a single batch query (`get_user_liked_track_ids`); the page seeds `LikeButton` with it. Anonymous requests are unaffected. Like-from-radio works when signed in.
- **correctness**: deactivated atproto accounts are excluded from discovery (`Artist.deactivated`, persisted from `#account` firehose events + a backfill migration); long track titles clamp to two lines instead of blowing up the fixed-height layout.
- **mobile + layout polish**: fixed a reload loop (a `$effect` subscribing to `radio.state`; fixed with `untrack` + guard), accidental station switching, the header/tuner gap, and footer clipping. Artwork is now a contained square over a blurred ambient backdrop (no more weird wide-screen slice); the dial has a fixed width so it never resizes with the artwork; height-based media queries handle short/landscape viewports. The "inspired by radio.wisp.place / integration" credit moved onto the `live radio` header line, with integration opening as a right-anchored glass popover that doesn't reflow the page.

**technical notes / lessons**:
- **iOS autoplay across track boundaries**: `onEnded` must swap the audio `src` synchronously with no `await` in between, or iOS blocks `play()` and radio dies on every boundary. State advances optimistically; rotation refreshes in the background.
- **the liked-state bug was a missing `credentials: 'include'`** on the client `/radio/state` fetch — the HttpOnly session cookie never reached the backend, so `get_optional_session` was always `None`. The backend regression test overrode the session dependency directly, so it validated serialization but never cookie propagation and missed it. Authenticated fetches must send credentials.

---

#### transcode fully off the upload critical path + gated lossless (PRs #1519, #1517, #1524, prod June 4)

**why**: woody.fm's ~939 MB / 90-min AIFF *still* failed with "transcoding failed" and produced **no track** — most recently a 502 from the 1 GB / 1-shared-CPU transcoder on the WAV remux. #1461 had deferred the MP3 encode but kept a *synchronous WAV remux* as a smaller prerequisite on the publish path, explicitly accepting the residual risk that "a truly enormous file could still stall." It stalled. Second time the stated principle — track creation is the critical path, ancillary ops degrade gracefully — was missed on the transcode step specifically.

**what shipped**:
- **#1519 — no transcode on publish at all**: `_store_audio` no longer calls the transcoder. A non-web-playable upload (AIFF, browser-recorder webm/ogg) publishes the **raw staged source** as both the interim playable rendition *and* the preserved archival master (one shared storage object), flagged `needs_optimization`. The deferred `optimize_track_audio` docket job is now the only place a transcode happens. Interim cleanup is guarded — the post-swap delete is skipped when `interim_file_id == original_file_id`, so it never strips the original or 404s a client still streaming the interim. The interim plays for clients that support the source (AIFF in Safari/WebKit); others see "processing" until the MP3 lands — a short, intended window.
- **#1517 (closes #1408) — gated lossless finally allowed**: the old guard ("supporter-gated tracks cannot use lossless formats yet") existed because `_transcode_audio` saved its output to the *public* bucket, leaking gated content. Now `_transcode_audio` takes a `gated` flag and routes through `storage.save_gated()`; `audio_optimize` threads `is_gated` from `track.support_gate`, uses the auth-proxied `/audio/{file_id}` URL (private bucket has no public URL), and correctly skips the PDS blob for gated tracks. #1524 adds supporter-gated AIFF integration coverage.

---

#### coupled traffic report + API reference landing page (PRs #1521 June 1, #1507 May 30)

**#1521 — coupled traffic report**: `scripts/traffic_report.py` renders both traffic lenses side by side across `-d 1/7/30` — Cloudflare edge (total requests, bandwidth, cache-hit %, unique visitors, threats; includes logged-out CDN listening that never hits origin) vs Logfire app (authenticated requests, signed-in users, uploads, p95, 5xx). Two overlay charts make the gap legible: over the last 7d the edge served 81.7k requests but origin saw only 36.5k (~55% absorbed by the 81% cache), and 1,106 peak unique visitors vs 16 signed-in users/day — most listening is logged-out. Lenses degrade independently; the documented ceilings (Logfire 14d/query, CF ~30d retention) are baked in. Codifies the `traffic-overview` skill's gotchas in a runnable script.

**#1507 — API reference landing page**: `/developers/api-reference/` had 404'd since the developers page was first built (#1035) — `just api-ref` emitted per-router pages but no directory index. Fix keeps a curated landing page in `docs/site/templates/` that the recipe `cp`s back after each `mdxify` regen (which `rm -rf`s the dir).

---

### May 2026

See `.status_history/2026-05.md` for detailed history. May shipped: radio reborn as a player-mode source on the one footer player — not a second `<audio>` — plus the portal de-scroll redesign (#1473→#1498); the decoupled publish/optimize pipeline so lossless uploads create a track in seconds (#1461, #1462); "keep playing" continuous playback + unified queue items (#1450→#1455); the atproto client picker + deep-linkable settings (#1436→#1447); typed R2 storage keys closing a 6-month save/read drift bug class (#1413); the copyright paradigm (indiemusi.ch alpha) behind a flag (#1400→#1411); the 18-hour bsky.social WAF JA4 outage + friendly-503 response (#1414→#1419); BottomSheet unification + swipe-to-dismiss (#1423); audio-replace `createdAt` preservation (#1422); notification + now-playing race fixes (#1425, #1426); the header polish cluster (#1429→#1431); and the traffic-overview skill (#1427).

---

### April 2026

See `.status_history/2026-04.md` for detailed history.

---

### March 2026

See `.status_history/2026-03.md` for detailed history.

---

### February 2026

See `.status_history/2026-02.md` for detailed history.

---

### January 2026

See `.status_history/2026-01.md` for detailed history.

### December 2025

See `.status_history/2025-12.md` for detailed history.

### November 2025

See `.status_history/2025-11.md` for detailed history.

## priorities

### current focus

**radio is a lineup of stations picked via a tuner dial** (#1530→#1548, prod June 5): radio is no longer one undifferentiated stream — it's `loved` (the default, back-compatible when `?station` is omitted), `fresh`, `deep-cuts`, and `slop` (AI/suno-tagged quarantine), each bookmarkable at `/radio/<slug>` and selected via a horizontal tuner dial + needle. Rank-decay weighting (`exp(-rank/RANK_DECAY)` over each station's lens ranking) bounds the tail so no single prolific artist or catalog size swamps a station. Deactivated atproto accounts are excluded from discovery (persisted from `#account` firehose events + a backfill); per-user liked state is seeded into the radio like button via a single batched query. Plus a mobile/layout overhaul: reload-loop fix (`untrack` + guard on a `radio.state` effect), a contained square cover over a blurred ambient backdrop, a fixed-width dial, and height-based media queries for short/landscape viewports. **Lessons**: iOS needs a synchronous audio `src` swap in `onEnded` or radio dies on every track boundary; authed fetches need `credentials: 'include'` — the liked-state bug was a session cookie that never reached the backend, missed because the regression test stubbed the session dependency directly.

**transcode fully off the upload critical path** (#1519, #1517, #1524, prod June 4): track creation no longer depends on a transcode succeeding. A lossless upload publishes in seconds referencing its **raw source** as both the interim playable rendition and the archival master; *all* transcoding moved into the deferred `optimize_track_audio` job. Closes the woody.fm "939 MB AIFF → 502 → no track" failure for good — the second time the stated "never block track creation" principle had been missed on the transcode step specifically (#1461 had only deferred the MP3 encode, keeping a synchronous WAV remux that still stalled). #1517 also unblocked gated lossless uploads by routing the transcode output through `save_gated()` and threading `is_gated` through the optimize path. **Reusable pattern**: let the cheap-but-universal rendition be the publish contract; the expensive one is a deferred upgrade.

**radio as a player-mode source + portal de-scroll** (#1473→#1498, prod May 29): radio plays through the *one* footer player as a `radioMode` source, not a second `<audio>` — it persists across navigation, with `/embed/radio` for external sites. The artist portal became a tabbed Tracks·Albums pager + a `/portal/manage` drill-in with server-side track search/sort. **Lesson**: integrate into the existing player rather than bolting a parallel one alongside it (took 4 tries / 2 reverts to internalize). Detail now in `.status_history/2026-05.md`.

**developer tooling**: coupled traffic report (#1521) — Cloudflare edge vs Logfire app lenses side by side, surfacing ~81% edge cache absorption and that most listening is logged-out (1,106 peak visitors vs 16 signed-in users/day). API-reference docs landing page un-404'd (#1507). Earlier May work (decoupled publish/optimize #1461, "keep playing" #1450→#1455, copyright paradigm #1400→#1411, typed R2 keys #1413, the WAF incident #1414→#1419, BottomSheet unification #1423) is summarized under `### May 2026` and detailed in the archive.

**next**: **collection continuity (Part B of continuous playback)** — tapping a track *inside* a collection should queue the rest of it (today's row tap calls `playNow`, which drops the collection). The clean framing is to generalize the "next from" machinery we already shipped: the tapped collection becomes a labeled *playback context* ("next from: \<album/playlist\>") that plays after your explicit adds and falls through to For You when it ends. Held pending a design call on which surfaces count as ordered/queueable — albums & playlists are clear, artist catalogs (#1353) and feeds/search are fuzzier. enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (#958)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible, CDN via custom domains)
- background tasks: docket (Redis-backed)
- hosting: Fly.io (2x shared-cpu VMs)
- observability: Pydantic Logfire
- auth: ATProto OAuth 2.1

**frontend**
- framework: SvelteKit (v2.43.2)
- runtime: Bun
- hosting: Cloudflare Pages
- styling: vanilla CSS with lowercase aesthetic
- state management: Svelte 5 runes

**deployment**
- ci/cd: GitHub Actions
- backend: automatic on main branch merge (fly.io)
- frontend: automatic on every push to main (cloudflare pages)
- migrations: automated via fly.io release_command

**what's working**

**core functionality**
- ✅ ATProto OAuth 2.1 authentication
- ✅ multi-account support (link multiple ATProto identities)
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats and Media Session API
- ✅ timed comments with clickable timestamps
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming
- ✅ audio streaming via 307 redirects to CDN (audio.plyr.fm, edge-cached)
- ✅ lossless audio (AIFF/FLAC) — AIFF uploads publish instantly as a 16-bit WAV compatibility rendition; the MP3 streaming rendition + PDS blob are produced by a deferred background task without blocking the upload
- ✅ PDS blob storage for audio (user data ownership)
- ✅ play count tracking, likes, queue management
- ✅ "keep playing" — opt-in continuous playback from the For You feed when the queue runs dry ("next from: for you")
- ✅ queue items with artwork thumbnails + right-side drag-to-reorder (desktop + touch)
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ ML genre classification with suggested tags in edit modal + auto-tag at upload (Replicate effnet-discogs)
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble, genre classification)
- ✅ media export with concurrent downloads
- ✅ supporter-gated content via atprotofans
- ✅ listen receipts (tracked share links with visitor/listener stats)
- ✅ jams — shared listening rooms with real-time sync via Redis Streams + WebSocket
- ✅ 96x96 WebP thumbnails for artwork (track, album, playlist)

**albums**
- ✅ album CRUD with cover art
- ✅ ATProto list records (auto-synced on login)

**playlists**
- ✅ full CRUD with drag-and-drop reordering
- ✅ ATProto list records (synced on create/modify)
- ✅ "add to playlist" menu, global search results
- ✅ inline track recommendations when editing (CLAP embeddings + adaptive RRF/k-means)

**deployment URLs**
- production frontend: https://plyr.fm
- production backend: https://api.plyr.fm
- staging: https://stg.plyr.fm / https://api-stg.plyr.fm

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- trade-off: accepting higher latency for faster development

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API, integrated CDN

**why async everywhere?**
- I/O-bound workload: most time spent waiting on network/disk
- PRs #149-151 eliminated all blocking operations

## cost structure

current monthly costs: ~$20/month (plyr.fm specific)

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis + transcoder + moderation): ~$24/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- copyright scanning (AuDD): ~$5-10/month
- replicate (genre classification): <$1/month (scales to zero, ~$0.00019/run)
- logfire: $0 (free tier)

## admin tooling

### content moderation
script: `scripts/delete_track.py`

usage:
```bash
uv run scripts/delete_track.py <track_id> --dry-run
uv run scripts/delete_track.py <track_id>
uv run scripts/delete_track.py --url https://plyr.fm/track/34
```

## for new contributors

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or install the [contribute skill](.claude/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-06-05 (status-maintenance run covering May 24 → June 5: archived all the detailed May write-ups to `.status_history/2026-05.md` to get back under the 500-line cap, and documented the June work — the radio stations + tuner-dial cluster #1530→#1548 shipped to prod June 5, transcode moved fully off the upload critical path with gated-lossless support #1519/#1517/#1524, and the coupled traffic report #1521 + API-reference landing page #1507. The radio-stations and transcode items lead `### current focus`). previously 2026-05-29 (radio-as-player-mode + portal de-scroll redesign cluster #1473→#1498 — now in `.status_history/2026-05.md`).

