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

### April 2026

#### browser observability + now-playing flood fix (PRs #1224-1225, Apr 2-3)

**why**: a login redirect failure had zero frontend traces to debug — backend spans showed success, but something broke between the 303 redirect and the frontend. separately, a single user's client hammered `POST /now-playing/` every 5 seconds for an hour (2,758 requests), driving p95 latency to 2.9s and max to 13.6s across the entire API. zero 5xx errors, but the app felt down for everyone.

**what shipped**:
- **browser observability** (#1224): `@pydantic/logfire-browser` SDK auto-instruments fetch, document-load, user-interaction, and XHR. telemetry proxied through `POST /logfire-proxy/{path:path}` on the backend (via `logfire.experimental.forwarding.logfire_proxy`) so the write token stays server-side. `traceparent` headers propagate to the API for distributed tracing — a single trace now spans browser → API → database. service name `plyr-web` distinguishes from backend's `plyr-api` in Logfire
- **now-playing throttle fix** (#1225): the frontend's `progressBucket` rounded to 5 seconds but the throttle interval was 10 seconds — the state fingerprint changed mid-throttle, bypassing the "skip if unchanged" check and firing reports every 5s instead of 10s. aligned bucket granularity to match `REPORT_INTERVAL_MS` (10s). backend: replaced `@limiter.exempt` with `30/minute` rate limit as a server-side safety net (normal playback is 6/min, generous headroom for rapid play/pause/seek)

**incident timeline** (2026-04-02 23:17–23:40 UTC):
- 23:17: traffic spikes to 1,624 requests/minute (10x normal), p95 = 1.6s
- 23:18: 458 requests, p95 = 2.9s, max = 3.0s
- 23:22: second spike, max latency hits 13.6s
- 23:38: third spike, 1,945 requests/minute, max = 7.8s
- 00:00: traffic returns to normal (~30 requests/minute)
- root cause: joebasser.com's client firing `POST /now-playing/` every 5s for ~1 hour

---

#### album AT-URI resolution + search modal polish (PRs #1222-1223, Apr 2)

**what shipped**:
- **album AT-URI fix** (#1223): the `/at/[...uri]` catch-all route only resolved tracks and playlists. album AT-URIs (`fm.plyr.album`) returned 404. refactored the route to use a generic list resolver that handles both playlists and albums through the existing `/lists/*/by-uri` endpoints. added regression tests
- **search modal** (#1222): centered vertically in viewport, enhanced glass effect

---

#### homepage tag filtering + backend performance (PRs #1216-1220, Apr 2)

**why**: the homepage had no way to positively filter tracks by genre. you could hide tags (negative filter) but not say "show me electronic and ambient." the dedicated `/tag/[name]` page only supports one tag and navigates away from the homepage. separately, the `GET /tracks/` endpoint was 250-1200ms for authenticated users due to an uncached external HTTP call to atprotofans.com for supporter validation on every single request.

**what shipped**:
- **tag filter chips**: horizontal scrollable row of popular tag chips below "latest tracks." multi-select with OR logic (tracks matching any selected tag). per-tag hue colors via deterministic hash. selected tags sort to the left. selection persists in localStorage across page refreshes
- **backend `tags` query param**: `GET /tracks/?tags=electronic&tags=ambient` filters to tracks matching any selected tag. composes with hidden tag filtering. skips Redis cache when tags are active
- **tag ranking by plays**: tags are now ordered by total play count (sum of `play_count` across all tracks with that tag) instead of just track count. surfaces genres with actual listener engagement
- **atprotofans Redis cache**: supporter validation results cached in Redis with 5-min TTL per (supporter, artist) pair. eliminates the 80-1100ms external HTTP call on repeat page loads
- **parallelized supporter validation**: `asyncio.create_task()` kicks off the atprotofans call immediately after getting the track list, running concurrently with batch aggregations (~19ms), PDS resolution (~58ms), and image resolution. previously these all ran sequentially

**performance impact** (authenticated users, production):
- before: 250-1200ms (validate_supporter was 82% of request time on slow calls)
- after (cache miss): ~170ms (validate_supporter runs in parallel with other work)
- after (cache hit): ~170ms (no external call at all)

---

#### Fly HTTP health checks + outage retro (PR #1214, Apr 2)

**why**: production outage (~6 min, 02:34-02:40 UTC Apr 2). after a deploy, Fly auto-stopped one machine for low traffic. the remaining machine became unresponsive but Fly had no health checks configured — it kept reporting the machine as "started" while it served nothing. when a replacement machine finally started, it was OOM killed (1GB exhausted in 20 seconds from queued request burst). manual `fly machine restart` was required to recover.

**what shipped**:
- added `[[http_service.checks]]` to both `fly.toml` and `fly.staging.toml` — Fly now polls `GET /health` every 10s with a 5s timeout and 30s startup grace period
- Fly will auto-restart machines that stop responding, eliminating the class of outage where a frozen process goes undetected

**what we learned**:
- the Dec 2025 database pool fixes (pool_size=10, max_overflow=5, connection_timeout=10s) were already in place — initial analysis incorrectly blamed stale recommendations
- the queue listener is already decoupled from the app lifecycle (`asyncio.create_task`, catches all exceptions) — it was not the cause of the process death
- what actually froze the remaining machine is still unknown (no Logfire output for 6 minutes while Fly reported it as "started"). possible causes: memory pressure on 1GB VM, blocked event loop, or a hard crash whose Fly event was truncated from the 5-event log
- full retro: `sandbox/retrospectives/2026-04-02-deploy-outage-oom-kill.md`

---

#### AT-URI top-level route resolution (PRs #1206, #1208, Apr 1)

**why**: every atproto app should support AT-URIs as top-level routes ([streamplace/streamplace#1012](https://github.com/streamplace/streamplace/issues/1012)). this lets anyone paste `https://plyr.fm/at://did:plc:xxx/fm.plyr.track/rkey` and land on the right page.

**what shipped**:
- new SvelteKit catch-all route at `/at/[...uri]` that parses AT-URIs via `AtUri` from `@atproto/api`, resolves them against existing backend `/tracks/by-uri` and `/lists/playlists/by-uri` endpoints, and 301 redirects to the canonical page (`/track/{id}`, `/playlist/{id}`)
- handles browser normalization of `://` in URL paths
- follow-up (#1208): replaced 7 instances of manual `.split("/")` AT-URI parsing across backend and frontend with proper library utilities (`parse_at_uri()` wrapper in Python, `AtUri` class in TypeScript)

---

#### track detail page: title width + metadata disclosure (PR #1205, Apr 1)

**why**: long track titles like "better hate (jessica pratt cover)" wrapped onto two lines because `.track-info-wrapper` was capped at `max-width: 600px`. the inline description also added visual weight without user opt-in.

**what shipped**:
- widened `.track-info-wrapper` from `max-width: 600px` to `min(900px, 90%)` — long titles stay on one line on desktop, 90% prevents edge-touching on narrower viewports
- replaced the inline collapsible description (gradient mask + "show more/less" toggle) with a circled `(i)` icon in the stats row that slides open a metadata panel on click. only renders when `track.description` exists

---

#### WebSocket hardening (PRs #1203-1204, Apr 1)

**what shipped**:
- **security** (#1203): origin validation rejects WebSocket upgrades from non-allowlisted origins, `session_id` omitted from client-facing messages
- **reliability** (#1204): idle timeout disconnects inactive connections, per-IP rate limiting and connection limits prevent abuse

---

#### Jetstream identity sync + image URL fix (PRs #1200-1202, Mar 31)

**what shipped**:
- **handle sync** (#1200): Jetstream identity events now trigger handle updates — when an artist changes their handle on Bluesky, plyr.fm picks it up automatically instead of waiting for their next sign-in
- **image URL fix** (#1202): R2 storage keys use the original file extension, but the image URL construction wasn't preserving it. images uploaded as `.jpeg` were served with `.jpg` URLs (or vice versa), returning 404s from R2
- **docs homepage** (#1201): pinned track 778 on docs homepage, deduplicated tracks-by-artist in the showcase

---

### March 2026

#### graceful OAuth error handling (PR #1198, Mar 29)

**why**: users with older self-hosted PDS instances that don't support `include:` permission sets got raw JSON (`{"detail":"OAuth callback failed: Scope mismatch: ..."}`) instead of a human-readable error when signing in.

**what shipped**:
- OAuth callback errors now redirect to the homepage with `?auth_error=<code>` instead of returning JSON
- frontend shows a toast with the error — scope mismatch explains the PDS didn't grant required permissions and may not support permission sets yet (8s duration), expired/failed get standard 5s toasts
- URL is cleaned after displaying the toast

---

#### FLAC uploads graduated + lossless badge redesign (PRs #1189-1190, #1193, Mar 25-27)

**why**: FLAC was behind a feature flag requiring transcoding, but every modern browser has supported native FLAC playback since 2017 (Chrome 56+, Firefox 51+, Safari 11+). the feature flag was outdated.

**what shipped**:
- FLAC uploads now GA — stored directly without transcoding, available to all users
- AIFF still transcodes to MP3 (browsers can't play AIFF natively)
- lossless badge evolved through three iterations: diamond icon with "lossless" text and pulsing glow (#1189) → icon-only with tooltip (#1190) → removed floating badge entirely, replaced with subtle accent-tinted card border and inline "lossless" text in the metadata row (#1193)

---

#### activity page fixes (PRs #1194-1197, Mar 27-28)

**what shipped**:
- **ambient theme race condition** (#1197): `auth.initialize()` used a boolean flag that conflated "started" with "completed". the activity page's `onMount` (child mounts before parent in Svelte) called it without `await`, setting the flag before the fetch finished. the layout's `onMount` then returned immediately — `isAuthenticated` was still `false`, so `preferences.initialize()` and `ambient.activate()` never ran. fixed by replacing the boolean with a stored Promise so all concurrent callers wait for the same in-flight auth check
- **lava-bg z-index** (#1194-1195): lava blobs were at the same z-index as the themed background, occluding the ambient gradient. moved to `z-index: 0` so blobs sit in front of the background but behind page content
- **tags overflow** (#1196-1197): tag badges overflowed card boundaries on mobile. added `max-width: 100%` constraint and `text-overflow: ellipsis` on individual badges, with `flex-shrink: 0` on the "+N" counter so it stays visible

---

#### collection activity feed + RichText + observability fixes (PRs #1172, 1183-1185, Mar 23-24)

**RichText unification** (#1183): track descriptions and comments now auto-link URLs using the shared `RichText` component (already used on artist bios). removed 39 lines of inline URL parsing code from the track page. comments gained markdown link support (`[text](url)`) and better domain/path detection.

**collection activity feed** (#1172): new `collection_events` table (append-only event log) tracking playlist creation, album releases, and tracks added to playlists. the `/activity` page now surfaces these alongside existing events (uploads, likes, comments, joins) with type-colored accents and histogram inclusion. events cascade on delete (SET NULL → omitted from feed).

**CLAP text embedding timeout** (#1184): the CLAP client used a single 120s timeout for both audio (background task) and text (user-facing search) embedding requests. when Modal cold starts, semantic search hung for 14+ seconds waiting for a 408 from Modal. split into separate timeouts: 120s for audio embedding (background tasks can wait) and 5s for text embedding (user-facing search fails fast). configurable via `MODAL_TEXT_TIMEOUT_SECONDS`.

**integration test notification leak** (#1185): integration tests on staging were sending DM notifications about test tracks. root cause: Jetstream processes events with a lag. tests create a track, verify it, then delete it — all before Jetstream catches up. when Jetstream finally processes the create event, the DB row is gone, so it creates the track from scratch with `notification_sent=False` and fires the DM. the tombstone system (designed to prevent ghost tracks) couldn't help because Jetstream processes events in order — the create comes before the delete. fix: suppress notifications and copyright scans from both Jetstream ingest paths on staging. defense-in-depth: the hooks layer also marks `notification_sent=True` when skipping, preventing the finalize-pending path from double-firing.

---

#### artwork documentation + R2 image fix (PRs #1176-1178, Mar 22-23)

**what happened**: user `jdhitsolutions.com` reported "I just don't see all of the image that I expect" on their track artwork. investigation via Logfire spans revealed two separate issues:

1. **R2 image self-deletion bug** (#1176): when editing a track and re-submitting the same image file, the content hash produces the same `image_id`. the old cleanup logic unconditionally deleted the "previous" image — which was the file just uploaded. confirmed via traces: Jeff hit this 3 times on track 833 (Mar 20-21). the image only survived the third attempt because the previous deletes had already removed the old file, so cleanup found nothing to delete. fix: one-line guard (`if old_image_id and old_image_id != new_image_id`) in tracks, albums, and playlists.

2. **no artwork guidance**: all display contexts use `object-fit: cover` on square containers, center-cropping non-square images. no documentation existed anywhere telling creators about this.

**what shipped**:
- R2 deletion guard + regression test in tracks, albums, and playlists (#1176)
- theme-aware description fade (CSS `mask-image` instead of `linear-gradient` pseudo-element)
- internal docs: `docs-internal/backend/image-formats.md` — full pipeline reference (#1177)
- public docs: artwork guidelines in `docs/artists.md`, image parameter docs in API reference (#1178)

---

#### logfire observability fix (PR #1130, Mar 22)

**why**: spans in Logfire showed `service_name: unknown_service` and had no user identity attached, making it impossible to trace who was making requests or filter by service.

**what shipped**:
- set `service_name="plyr-api"` in `logfire.configure()`
- tag HTTP spans with `user.did` and `user.handle` via `_tag_span_with_user()` in both `require_auth` and `get_optional_session` auth dependencies
- rewrote logfire querying guide with `deployment_environment` filtering and top-level column usage

**note**: this PR was opened Mar 16 but sat unmerged until Mar 22 when we noticed null user identity on a terms acceptance span. the fix was already correct — just never merged.

---

#### DID-based profile URLs (PR #1173, Mar 22)

**why**: community request from `@blooym.dev` — ATProto DIDs are immutable, so `plyr.fm/u/did:plc:xxxx` links survive handle changes, giving artists stable permalinks.

**what shipped**:
- `/u/did:plc:xxxx` resolves to artist profile (DID → handle lookup for backend calls)
- sub-pages (liked, album) work with DID URLs
- error page shows appropriate messaging for DID 404s

---

#### AcoustID → AuDD revert (PR #1174, Mar 22)

**the arc**: PR #1163 (Mar 20) replaced AuDD (~$5/1000 requests) with fpcalc + AcoustID (free) for copyright scanning. the chromaprint.zig work (see below) had proven fingerprint generation worked, and AcoustID's API was straightforward. the migration shipped with costs page updates, privacy policy changes, and a flurry of follow-up fixes (#1164, #1166-1171) for the costs export shape mismatch and legal date sync issues.

**why it was reverted**: AcoustID does whole-file fingerprint matching — it generates one fingerprint for the entire upload and looks for that fingerprint in its database. this works for identifying exact songs, but plyr.fm needs segment-level detection: a 60-minute DJ set with 1 minute of copyrighted material won't match, because the whole-file fingerprint looks nothing like the original 3-minute song's fingerprint. same problem with sample-heavy tracks or remixes that contain fragments of copyrighted material surrounded by original content. AuDD does segment-level analysis — it scans within the audio to find partial matches, which is exactly what copyright moderation requires. the $5-10/month cost is worth it for the detection accuracy.

**what was kept from the AcoustID arc**:
- `check_legal_dates` pre-commit hook (#1168) — catches stale privacy policy dates and terms version mismatches
- costs export CI-only guard and release tag checkout (#1166) — script shape always matches deployed frontend
- `check-legal-dates` narrowing to `+page.svelte` only (#1171)

**what was restored**: full AuDD integration in moderation service (9 files), AuDD billing logic in costs export/dashboard, privacy policy references, terms versioning date.

**deploy incident**: the moderation service was down for ~1 hour during the revert (22:25–23:24 UTC, Mar 22). the new binary required `MODERATION_AUDD_API_TOKEN` but the secret hadn't been set yet — service crashed on startup in a loop. once the token was set the service recovered, but the first AuDD call returned `error_code: 19` ("Recognition failed: Internal error") from AuDD's side. subsequent scans succeeded — two copyright scans processed successfully (01:09 and 02:55 UTC, Mar 23), and `sync_copyright_resolutions` has been running clean every 5 minutes since. filed #1165 remains relevant — a staging environment for the moderation service would have caught this.

---

#### costs export tied to release tags + legal date guard (PRs #1166-1168, Mar 20)

**why**: merging PR #1163 (AuDD → AcoustID) changed the costs JSON shape (`audd` → `copyright_scanning`), which broke the production `/costs` page. the hourly `export_costs.py` runs from `main`, but the production frontend deploys on a separate release cadence — so the script's output shape changed before the frontend was ready for it. separately, the privacy policy content was updated (#1164) but the backend `terms_last_updated` config wasn't bumped, so users weren't prompted to re-accept.

**what shipped**:
- costs export workflow now checks out the **latest release tag** instead of `main`, so the script shape always matches the deployed frontend. data stays fresh (hourly from prod DB), but the shape only changes when a release is cut
- CI-only guard on `export_costs.py` — refuses non-dry-run outside GitHub Actions
- pre-commit hook (`check-legal-dates`) that catches two things: stale privacy policy "Last updated" dates when content changes, and `LegalSettings.terms_last_updated` falling behind the privacy policy date
- removed dead `R2_BUCKET` / `R2_PUBLIC_BUCKET_URL` env vars from the workflow (script uses `R2_STATS_BUCKET` with defaults)
- bumped `terms_last_updated` from `2026-02-06` to `2026-03-20`
- filed #1165 for moderation staging environment (same class of problem — deploys directly to prod)

---

#### chromaprint.zig — standalone audio fingerprinting in pure zig (Mar 19)

**why**: plyr.fm pays AuDD ~$5/1000 requests for copyright moderation fingerprinting. AcoustID is a free, open-source alternative that uses Chromaprint fingerprints, but the official library requires FFmpeg. we wanted a zero-dependency fingerprinting tool.

**what shipped**: a standalone zig 0.16 library at [`@zzstoatzz.io/chromaprint.zig`](https://tangled.sh/@zzstoatzz.io/chromaprint.zig) that generates Chromaprint audio fingerprints and looks them up on AcoustID — no FFmpeg, no C dependencies, just a static binary.

- ported the core algorithm from Andrew Kelley's [groovebasin](https://codeberg.org/andrewrk/groovebasin) implementation (~578 lines)
- wrote a pure zig radix-2 Cooley-Tukey FFT (4096-point, comptime twiddle factors) to replace FFmpeg's `av.TXContext`
- WAV reader for PCM16/Float32 mono 11025 Hz (replaces FFmpeg's decode pipeline)
- AcoustID HTTP client with gzip-compressed POST (`std.compress.flate`)
- MusicBrainz enrichment (recording ID → title/artist)
- **fingerprints are an exact match against `fpcalc`** (the reference C implementation) — verified on real plyr.fm tracks including a rickroll flagged by the moderation system

**technical notes**:
- zig 0.16 has massive breaking changes from 0.15 (new `Io` context threading, `std.process.Init` for main, `client.fetch()` replacing `client.open()`). notes captured in memory for upcoming SDK migrations (zat, etc.)
- AcoustID returns HTTP 400 (not 200) for API errors — discovered by testing with an expired test key. the JSON body must be parsed regardless of HTTP status
- AcoustID's docs recommend compressed POST because fingerprints are large (~5KB base64). switched from query-string GET to gzip POST
- the pure zig approach means the moderation service can embed fingerprinting directly instead of calling an external API

**what happened next**: PR #1163 integrated AcoustID into the moderation service, but AcoustID does whole-file matching — it can't detect copyrighted segments within longer uploads (DJ sets, sample-heavy tracks). reverted to AuDD in #1174 (see above for full explanation). the chromaprint.zig library remains a standalone tool and learning exercise — the fingerprinting itself works perfectly, it's AcoustID's whole-file matching model that doesn't fit plyr.fm's moderation needs.

---

#### ambient theme polish (PRs #1158-1161, Mar 19)

temperature unit detection for US users (Fahrenheit vs Celsius from browser locale), gradient banding reduction via interpolated color stops (7 stops instead of 3), and cached weather data for instant theme restore on page load.

---

#### homepage activity integration — failed experiment (PRs #1151-1156, Mar 19)

**goal**: inject life into the homepage by surfacing recent platform activity (likes, uploads, comments, joins).

**attempt 1 — floating pills** (#1151): glassmorphic pill-shaped elements drifting across the page background with CSS keyframe animations. identical shapes for all event types, slow 25-45s drift cycles, visible for ~75% of each cycle. deployed to staging: looked like dopey submarines hanging around the background. not ephemeral, not legible, not visually distinct between event types. **3/10.**

**attempt 2 — restyled pills** (#1152): distinct shapes per event type (circles, rectangles, speech bubbles), faster 14-24s cycles visible only ~25% of the time, type-colored backgrounds with glow. better than v1 but still fundamentally the same problem — random floating elements in the background look corny regardless of styling. **5/10.**

**attempt 3 — text echoes** (#1153): researched internet.dev's text-first design philosophy. stripped all card/pill chrome, rendered bare monospace text with type-colored glow, added sonar ring ping animations, JS-driven slot cycling with staggered timing. more refined than the pills but the core concept of randomly positioned background elements was still bad. still corny.

**attempt 4 — activity shelf** (#1155): abandoned the background approach entirely. built a horizontal scroll section (like top tracks / artists you know) with compact `ActivityCard` components, plus dismissible sections with localStorage persistence. closer to the right idea structurally, but the cards weren't good enough and the overall execution didn't meet the bar.

**outcome**: all four attempts reverted (#1154, #1156). homepage is back to its pre-experiment state. the `ActivityCard`, `FloatingActivity`, and `dismissed-sections` modules were all deleted.

**lessons**:
- floating/background elements for activity feeds are a fundamentally bad idea — they look gimmicky regardless of visual polish
- research into design systems (internet.dev, Spotify shelves, etc.) was useful but didn't compensate for weak visual execution
- should have started with the simplest inline approach (attempt 4) instead of the most ambitious one (attempt 1)
- the activity data is available via `/activity/` API and the dedicated `/activity` page — homepage integration remains an open question

---

#### frontend validation alignment (PR #1148, Mar 18)

audited every backend validation limit (lexicon schemas, pydantic models, manual checks) against frontend form enforcement. found 8 fields with backend limits but no frontend `maxlength`, one upload path missing a client-side file size check, and two limit mismatches between the lexicon and API layer.

**what shipped**:
- raised API comment text limit from 300 to 1000 to match the `fm.plyr.comment` lexicon (network-wide scan confirmed no existing records exceed 254 chars)
- raised `HandleSearch` default `maxFeatures` from 5 to 10 to match the `fm.plyr.track` lexicon (max in the wild: 2)
- added `maxlength` on track title (256), album name (256), bio (2560), playlist name (256), tag input (50 per tag), search inputs (100)
- added character counters on description, bio, and comment fields (follows existing `FeedbackModal` pattern)
- capped `TagInput` at 10 tags with a "maximum 10 tags" message
- added 20MB image size check on portal track artwork upload (was the only upload path without client-side validation)

---

#### collapsible track descriptions (PRs #1144-1146, Mar 18; superseded by #1205)

long track descriptions were pushing the track page layout down with no way to collapse them. added a collapsible wrapper that truncates descriptions taller than ~5 lines (128px) with a fade-out gradient. the "show more" toggle started as a bare left-aligned text link, then was restyled as a centered pill button with chevron indicators (▾/▴) to match the existing `.pill-btn` pattern used in Queue and tag badges. **replaced in #1205** with the metadata disclosure icon approach.

---

#### handle typeahead migration (PRs #1140-1141, Mar 17)

**why**: switching handle autocomplete to [`typeahead.waow.tech`](https://typeahead.waow.tech) — a community ATProto actor search service (Zig ingester on Fly.io → Cloudflare Worker + D1/FTS5) — revealed that the backend `/search/handles` endpoint was just a passthrough proxy. no auth, caching, or transformation — just an extra hop adding ~500ms of latency.

**what shipped**:
- switched from Bluesky's `searchActorsTypeahead` to the community typeahead service (#1140)
- moved the call entirely to the frontend, eliminating the unnecessary backend proxy (#1141)
- backend `/search/handles` endpoint removed from the router (underlying code stays for SDK consumers)
- configurable via `PUBLIC_TYPEAHEAD_URL` env var, degrades to empty results on failure

---

#### RSS feed removal (PR #1139, Mar 17)

**why**: per-artist RSS feeds (shipped in PR #1045, Mar 6) were an over-eager introduction — added speculatively without clear demand. 19 total hits in 30 days confirmed it. the `feedgen` + `lxml` dependencies weren't worth carrying for something nobody asked for.

**what shipped**:
- removed `feeds.py` module, tests, `feedgen`/`lxml` dependencies, and `<link rel="alternate">` tags from artist/album/playlist pages

---

#### ambient weather theme — "live" (PRs #1127-1136, Mar 16)

**why**: plyr.fm had dark/light/system themes but no personality. the ambient "live" theme adds a location-aware atmospheric background that reflects real weather conditions — making the app feel connected to the listener's environment.

**what shipped**:
- new "live" theme option alongside dark/light/auto in both desktop and mobile settings
- fetches weather from Open-Meteo API using device geolocation, renders gradient background based on conditions (clear/cloudy/rain/snow/fog/storm × day/night × temperature warmth)
- full UI tinting: 12 CSS variables (glass surfaces, borders, track cards, backgrounds) are blended with weather-derived tint colors at 6-15% strength
- live is a first-class peer theme, not a toggle layer — server-persisted per account via new `theme` column on `user_preferences` (alembic migration)
- localStorage is a flash-prevention cache synced from server, not source of truth

**technical notes**:
- initial implementation (#1127-1132) built live as a separate toggle, which caused bugs on account switch (light base + ambient gradient = broken UI). redesigned in #1134 to make live a peer of dark/light/system
- theme was never server-persisted before this work — it was purely localStorage. added the DB column and wired preferences.fetch() to sync server → localStorage → DOM
- accent color had the same sync gap (#1136): server stored it, but preferences.fetch() never applied it to the DOM or localStorage. on fresh loads, `--accent` fell back to CSS default blue regardless of saved preference
- geolocation is cached device-global (`ambient_location` in localStorage) — survives theme switches for instant re-activation. old DID-scoped keys are auto-migrated
- live resolves to dark base theme (CSS class `theme-dark`), with gradient overlay and tinted variables on top

---

#### CORS open access + Jetstream fixes (PRs #1106-1107, Mar 14)

**why**: CORS was restricted to `*.plyr.fm` subdomains, blocking third-party ATProto clients and embeds from calling the API. separately, the Jetstream consumer was crash-looping due to OpenTelemetry span errors, and PDS uploads failed silently on transient network errors.

**what shipped**:
- CORS now allows any HTTPS origin to call the API
- fixed Jetstream crash loop caused by OTEL span context errors
- added retry logic for PDS upload network failures

---

#### AT-URI lookup endpoints (PR #1123, Mar 15)

**why**: external ATProto clients need to resolve `at://` URIs to plyr.fm page URLs. without this, a client that discovers a `fm.plyr.track` record on the network has no way to link to it on plyr.fm.

**what shipped**:
- `GET /tracks/by-uri?uri=at://...` and `GET /playlists/by-uri?uri=at://...` endpoints
- returns the track/playlist object if found, 404 otherwise

---

#### docs rewrite + UX polish (PRs #1108-1120, Mar 14-16)

**what shipped**:
- rewrote listeners and creators docs pages — lead with experience, not protocol jargon
- reordered upload form: required fields first
- PDS tooltip on upload form explaining what "store on your PDS" means
- fixed liker profile links interrupting playback (#1121)
- PDS tooltip hover uses delayed hide to prevent flicker (#1110)

#### March 1-12

See `.status_history/2026-03.md` for detailed history including Jetstream real-time ingestion, community feedback response, public docs restructure, activity feed, embed glow bar, and infrastructure fixes.

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

Browser observability live (#1224) — frontend traces now flow to Logfire via `plyr-web` service, enabling distributed tracing from browser through API to database. now-playing flood incident investigated and fixed (#1225) with both client-side throttle alignment and server-side rate limit safety net. next: monitor browser telemetry volume (add sampling if needed); investigate what froze the remaining machine during the Apr 2 outage; add a staging environment for the moderation service (#1165).

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- harden file format support — revisit transcoding pipeline (FLAC graduated in #1189, AIFF still transcodes)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (Osprey rules engine PR #958 — on hold pending infrastructure consolidation, see #907)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible)
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
- ✅ audio streaming via 307 redirects to R2 CDN
- ✅ lossless audio (AIFF/FLAC) with automatic transcoding for browser compatibility
- ✅ PDS blob storage for audio (user data ownership)
- ✅ play count tracking, likes, queue management
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
- **internal docs**: [docs-internal/](docs-internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-04-03 (browser observability, now-playing flood fix).

