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

### May 2026

#### bsky.social WAF JA4 collateral block — 18-hour OAuth outage (PRs #1414→#1419, May 17)

**why**: starting **2026-05-17 03:44 UTC**, every new OAuth flow for `*.bsky.social` users plus every token refresh against `bsky.social` started returning `400: failed to start OAuth flow: Failed to resolve handle: X` to end users. Underneath that user-facing 400, our backend's outbound `httpx` requests to `bsky.social/.well-known/oauth-authorization-server` and `*.bsky.social/.well-known/atproto-did` were getting a flat **403 Forbidden** from Bluesky's edge. Self-hosted PDS handles (anything not under `*.bsky.social`) continued to work fine — the failure mode was specific to bsky.social-hosted accounts. Discovered when aila (@ailawav.bsky.social) couldn't log in to test our DX fixes from #1393.

**root cause (confirmed with bluesky platform team)**: Bluesky's WAF auto-deployed a rule blocking three **JA4 TLS fingerprints** that had been driving a ~2× normal-traffic surge against `bsky.social/xrpc/com.atproto.server.createSession`. One of those fingerprints is the generic JA4 produced by **`uv:python3.12-bookworm-slim` (the Astral official image) + `httpx`** — an extremely common Python deployment shape that we happen to share with potentially thousands of other Python services. The actual abuser was someone else with the same fingerprint; we were collateral. Our total outbound to `bsky.social` over the 5 days leading into the incident was ~200 requests across both environments (peak <20/hour during normal user activity, the only sustained spike was retries of our own failed requests once the WAF block was already in place). Bluesky platform team manually undid the rule at **~21:44 UTC** (~18h after onset) and noted they're improving WAF precision to distinguish legitimate clients from attackers sharing a fingerprint with them.

**investigation arc** (each PR is a snapshot of what we thought the cause was at the time):

1. **#1414 (merged then reverted in #1415)** — initial read was "bsky's edge intermittently 403s `.well-known/atproto-did` for `*.bsky.social` handles." Shipped an AppView XRPC fallback in `_internal/atproto/handles.py:_resolve_handle_to_did` plus passed the resolved DID through to `OAuthClient.start_authorization` so the SDK could skip its own handle-resolution leg. This *did* get handle resolution to succeed, but the SDK then hit `bsky.social/.well-known/oauth-authorization-server` next and 403'd there too — the fix had only moved the failure one hop forward. Reverted same day.

2. **#1416 + #1417** — pivoted to "must be a User-Agent / fingerprint issue, the SDK sends generic `python-httpx/X.Y` and the edge is filtering on UA." Added `ATPROTO_USER_AGENT` env var support to our `zzstoatzz/atproto@oauth-full` fork ([commit](https://github.com/zzstoatzz/atproto/commit/4577e6532bb540a64d5037fde26d7921416a7058)) — module-level patch of `httpx._client.USER_AGENT` on import, opt-in via env var. Set to `plyr.fm/1.0 (+https://plyr.fm)` in `backend/fly.toml` (#1416) and `backend/fly.staging.toml` (#1417 fast-follow because the original PR only edited the prod toml). Verified at runtime that the UA was being sent — and the 403s continued, ruling out UA as the discriminator.

3. **#1418** — surfaced during the investigation: `ATPROTO_PDS_URL = 'https://pds.zzstoatzz.io'` was being set in both fly.toml files (since 2025-11-05) but **no code in the backend reads `settings.atproto.pds_url`** anywhere — every actual PDS lookup pulls the URL from the resolved DID document at runtime, per user. Removed the field from `AtprotoSettings`, the env var from both fly tomls, and the line from `backend/.env.example`. Misleading config drift, harmless because dead, cleaner gone.

4. **Reproduction matrix** — from staging fly machine (IAD, `python:3.12-bookworm-slim`):

   | Source | Client | Result |
   |---|---|---|
   | residential laptop | urllib (stdlib) | 200 |
   | residential laptop | httpx / requests / aiohttp | 200 |
   | fly.io egress | urllib (stdlib) | **200** |
   | fly.io egress | httpx, requests, aiohttp | **403** |

   So: **same machine, same IP, same target — only the request-shape changes the result, and only when paired with cloud egress**. Verified that User-Agent isn't the discriminator (custom UA, no UA, urllib's UA on httpx — all 403). Verified ALPN isn't the discriminator (no ALPN, http/1.1 only ALPN — still 403). Discriminator is at the TLS handshake layer — JA4 or similar fingerprint, not anything controllable from the HTTP-headers layer of an SDK.

5. **#1419 — friendly upstream error** (the only PR worth keeping):
   - New `_bsky_edge_block_error(exc, handle)` helper in `_internal/auth/oauth.py` that detects two failure shapes from production spans: `ValueError: Failed to resolve handle: <X>.bsky.social` (handle resolution leg) and exception messages containing `403 Forbidden` + `bsky.social` (auth-server-metadata leg).
   - When detected, returns **503** with `"Bluesky's servers are currently blocking sign-in requests from our backend. This is a temporary upstream issue on Bluesky's side, not an account problem — please try again in a few minutes. Tracking: https://github.com/bluesky-social/atproto/issues/4764"` instead of the stack-trace-flavored 400.
   - Wired into both `start_oauth_flow` (new logins) and `start_oauth_flow_with_scopes` (copyright scope-upgrade).
   - Real account errors (typos on non-bsky domains, etc.) keep the existing 400 — only the specific upstream-edge-block pattern is rewritten.
   - 4 regression tests in `tests/_internal/test_bsky_edge_block_error.py`.

**investigation comment posted on [bluesky-social/atproto#4764](https://github.com/bluesky-social/atproto/issues/4764#issuecomment-4472548569)** with the full reproduction matrix and host scoping (every path on `bsky.social` × httpx-from-cloud = 403; `public.api.bsky.app` and `plc.directory` unaffected because they're separate CF zones with different WAF rules).

**lessons**:
- **JA4 fingerprint collisions are a real risk for Python services on common base images**. We share an indistinguishable TLS handshake with potentially thousands of other services on uv + python:3.12-bookworm-slim + httpx. When any one of them misbehaves badly enough to trigger a WAF rule, we get caught.
- **No client-side bypass without significant work.** Verified that `httpx`, `requests`, and `aiohttp` all share the same JA4 (all 403 in identical conditions). Bypasses considered but not shipped: `curl_cffi` (impersonates real browser TLS, ~50 LOC SDK-fork change) or switching Docker base to a less-common one (alpine/musl). Bluesky platform team is fixing the precision on their side, so we're not pursuing these.
- **The handle-resolution-fallback PR was the wrong fix** because the failure shape was multi-hop: get past handle resolution, hit the next bsky.social `.well-known/*` request, fail there too. Shipping it would have given us a slightly different stack trace at the next hop, not a working flow. Reverting promptly was correct.
- **Friendly error UX matters** even when the bug isn't yours: a 400 with `Failed to resolve handle: X` reads like a typo-your-handle problem; a 503 with `Bluesky is currently blocking us, try again in a few minutes` reads like the actual situation. #1419 is what would have prevented confused users + DM threads in the first hour of the next incident of this shape.

---

#### first external contribution + local-dev DX (PRs #1393, #1394, #1395, May 12)

**why**: @ailawav.bsky.social (aila / @AilaScott on GitHub) forked the repo to contribute and hit two undocumented papercuts on first run — the frontend needed a `.env` nobody had told her about (sample audio wouldn't load without it), and the backend's `DOCKET_URL` defaulted to `""`, requiring a running Redis even for local dev where Redis is overkill.

**what shipped**:
- **#1393** (aila — first external PR merged): `DOCKET_URL` default flips from `""` to `"memory://"` so `just backend run` works against an in-process queue out of the box. production / staging override via env var, unchanged
- **#1394**: new `frontend/.env.example` with `PUBLIC_API_URL=http://localhost:8001`; `docs/public/contributing.md` and `docs/internal/local-development/setup.md` now include `cp frontend/.env.example frontend/.env` in the quickstart
- **#1395**: ruff-format pass on #1393 to keep the tree clean

**why it matters**: the contribution path now works end-to-end without insider knowledge. every new contributor between #1394 landing and the next regression will find what aila had to discover by reading source. external PR #1393 also validated that #1373's `CONTRIBUTING.md` actually gets people to the right place.

---

#### upload outage cluster — streaming end-to-end + ops backstops (PRs #1389, #1390, #1391, May 10–12)

**why**: production was silently broken from **2026-05-06 18:56 UTC → 2026-05-10 19:02 UTC** — almost 4 days. every track upload stranded at "uploading to storage… 100%" forever. `POST /tracks/` returned 200 and queued a `run_track_upload` task, but the docket worker process group was OOM-dead and nothing was draining the queue. discovered by @cameron.stream tweeting about it, **not** by any internal alerting. 9 stranded users. full postmortem at `docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md`.

**root cause was structural**: the upload pipeline buffered the **entire audio file** in worker memory at four distinct points (R2 read, transcode result, PDS `uploadBlob`, CLAP embedding base64). with `concurrency=10` and post-upload fan-out, each in-flight upload held the bytes 3–5× simultaneously. on the cold-start backlog drain after a deploy, a long-form upload OOM-killed the 2 GB worker. fly's default `restart.policy = on-failure max_retries = 10` gave up after 10 consecutive OOMs and left the machine `stopped`.

**what shipped** (three PRs, layered):

1. **#1389 — structural fix: stream audio end-to-end**
   - `StorageProtocol.stream_file_data()` (async iter of chunks) + `head_file()` (for Content-Length); new `_signed_streaming_post` helper that supports DPoP retries with body factories (upstream `make_authenticated_request` exhausts an async iterator on its inner retry)
   - transcoder client streams response → `/tmp` via `httpx.AsyncClient.stream` + `aiofiles`; `_transcode_audio` and `_upload_to_pds` stream R2 → /tmp / PDS uniformly. `TranscodeInfo.transcoded_data: bytes` removed entirely
   - Modal CLAP service now accepts `audio_url` and Range-fetches the first ~12 MB itself (model only uses the first 30 s); the worker no longer downloads or base64-encodes
   - `migrate-to-PDS`, `restore-revision`, and PDS backfill task all moved off `get_file_data`
   - **regression test**: 60-min mono WAV (~150 MB) generated via ffmpeg at fixture time, uploaded through the real API, polled to completion. future PRs that re-buffer fail CI instead of an angry user tweet. CI integration-tests timeout 15 → 30 min to accommodate it
   - **also imports 19 historical retros** from local `sandbox/` into `docs/internal/retrospectives/` — convention has existed since 2025-11 but nothing was reviewable / cross-linkable until now
   - **post-merge action**: redeploy Modal CLAP service (`uvx modal deploy services/clap/app.py`); `audio_b64` path kept for backwards-compat so redeploy can lag merge

2. **#1390 — never-give-up worker restart + silence alert runbook**
   - `backend/fly.toml`: scoped `[[restart]]` block for `processes = ["worker"]` with `policy = "always"` (was on-failure / max_retries=10). singleton consumer of the upload queue has no scenario where giving up is correct; worst case is a noisy restart loop, which is what the silence alert catches
   - `app` keeps fly's default (it has HTTP health checks + redundancy)
   - new runbook `docs/internal/runbooks/worker-silence-alert.md`: logfire saved query that fires when (1) the HTTP API accepted ≥1 `POST /tracks/` in a 5-min window AND (2) the worker emitted **zero** task-execution spans. condition (2) is the load-bearing part — "queue is being added to but nothing is being executed" is the exact shape of the May 6 failure. saved-query wiring is a manual one-time UI step; the runbook is reviewable

3. **#1391 — stuck-job reaper (symptom-side detector)**
   - direct user-symptom check: a `jobs` row in `status='processing'` whose `updated_at` is >10 min old is, by definition, a user staring at a stuck progress bar — regardless of why
   - `jobs` schema gains `file_id` / `file_type` / `is_gated` (nullable) populated by both upload entry points after staging, so the reaper deletes the staged R2 blob from the **right bucket** before failing the row. composite index `idx_jobs_reaper_scan` on `(type, status, updated_at)`
   - new docket Perpetual at `backend/_internal/tasks/reaper.py`, runs every 60 s. marks row failed → best-effort R2 cleanup → sends **one batched bsky DM per reap** (not per stuck job) summarizing affected users. batched DM is deliberate: a May-6-style outage would otherwise produce 9 separate DMs and risk bsky rate-limiting
   - reuses the existing bsky DM client / recipient resolution; no new infra or secrets

**decisions / trade-offs**:
- streaming chunks vs. presigned-URL pulls: every stage either streams chunks or hands Modal a URL to range-fetch. **no `await body.read()` into bytes anywhere on the audio path.** encoded as a hard rule in agent memory so future PRs can't regress it
- reaper threshold: 10 min. `updated_at` ticks forward at every phase boundary, so a legitimate slow upload still has fresh `updated_at`. if false-positives appear, either bump to 15/20 OR add a heartbeat ping inside `_signed_streaming_post` (5-line change)
- reaper marks-failed-immediately, no retry. retry would require storing full upload kwargs on the job row — deferred until we observe a class of recoverable failures
- one batched DM per reap rather than per stuck job

**still open**: fly worker tcp health check (catches running-but-stuck, not in-scope for the May 6 OOM-kill specifically); upstream `atproto_oauth.OAuthClient` body-factory support (then `_signed_streaming_post` can be removed).

---

#### private playlists v2 + visibility toggle (PRs #1386, #1387, #1388 — superseding closed #1385, May 9–10)

**why**: every other playlist app has a private mode. plyr.fm didn't — every playlist was published to the user's PDS and discoverable. needed a privacy story now, but atproto's permissioned-data substrate ("spaces") is in active development upstream and realistically ~end of summer 2026 ([dholms's spec](https://dholms.leaflet.pub/3mhj6bcqats2o), [PDS branch](https://github.com/bluesky-social/atproto/compare/permissioned-data), [tranquil-pds#72](https://tangled.org/tranquil.farm/tranquil-pds/issues/72)). question to answer: build a forward-looking abstraction that mirrors the substrate so storage swaps cleanly later, or take the simplest app-layer shape and decide migration per-feature when the substrate lands?

**design evolution — v1 (#1385, closed) → v2 (#1386, merged)**:

v1 (#1385) built a full backend `Space` abstraction: new `spaces` / `space_members` / `space_records` tables mirroring the protocol shape exactly (flat member list, no read/write distinction, no tier column), a `plyr-space://` URI scheme that one-line-swaps to `ats://` when the substrate lands, `get_or_create_personal_space` lazy-creating a single-member space on first private playlist, separate `_internal.spaces` module with `can_read` / membership ops mirroring `com.atproto.space.*` XRPC. ~26 tests across spaces + private-playlists. the bet: build the storage interface today so feature code doesn't change when the substrate ships.

**closed in favor of v2** because the substrate timing is uncertain (the upstream PDS branch is ~30 commits but lexicons aren't stable) and the `Space` abstraction was speculative — no second consumer in this PR. drafts and members-only jams would have validated the abstraction but they aren't built yet, and v1's `Space` shape was pinned to today's reading of an upstream spec that's still being revised. shipping the abstraction now bets that the shape we coded against matches what lands later; getting it wrong is more expensive than a v2-to-substrate migration later when the spec is concrete.

#1384 currently classifies private playlists as "may always stay app-layer; degenerate single-user case" against dholms's framing of permissioned data as a *shared social context* primitive. **that framing is too narrow.** the natural product trajectory for a private playlist is "private → selectively shared with a few people" — that's a multi-member permissioned context, exactly what the substrate is for. so the v2 shape isn't a permanent answer; it's the simplest thing that works for the single-user case today, and the substrate is the right home the moment collaborative-playlist UX shows up. #1384's classification table should be updated to reflect that.

**v2 (#1386) — what shipped**:
- migration `5c56f12bc84d`: `is_private boolean` + `items_json jsonb` on the existing `playlists` table, `atproto_record_uri` / `atproto_record_cid` nullable. that's the whole storage shape — no new tables
- create-modal two-card visibility picker (public / private, accent-border selection). private creates skip the PDS round-trip entirely; items live inline in `items_json`
- every playlist endpoint branches on `is_private`. new `/lists/playlists/{id}/reorder` handles both paths uniformly (replaces the legacy rkey-keyed reorder for playlists)
- `Playlist.atproto_record_uri` becomes `string | null` end-to-end (TS types + frontend)

**existence-leak hardening** (the part worth the most review — inherited verbatim from #1385's audit, this is the bit a hostile non-member must not be able to walk around):

non-members shouldn't be able to distinguish "exists but I can't read" from "doesn't exist." anything subtler is a leak.

| leak surface | fix | what it would have leaked |
|---|---|---|
| mutation endpoints | non-owners get **404, not 403** via `_assert_can_mutate` on all 5 paths (`add_track`, `remove_track`, `reorder`, `update`, `delete`, `upload_cover`) | "this playlist exists" via 403 vs 404 distinguishability |
| `/search` | `WHERE is_private = false` on the trigram name match | playlist names |
| `/oembed` | 404 for private (no auth path on this endpoint) | title + owner via twitter/leaflet/bluesky embed preview cards — would have surfaced anywhere the URL was pasted |
| `/activity` | no `CollectionEvent` emitted for private creates or for adding tracks to private playlists; defense-in-depth `WHERE is_private = false` on the SQL feed query | private playlist existence + composition via the public activity feed |
| `/playlists/by-uri` | only matches public URIs (private has `atproto_record_uri = NULL`) | resolution of leaked PDS URIs (defensive — private playlists don't write to PDS, so this is theoretically unreachable) |
| `list_artist_public_playlists` | excludes private regardless of `show_on_profile` setting | profile-page enumeration |

verified-safe paths (audited, no change required): `ingest.py` jetstream/PDS event handlers look up by `atproto_record_uri` which is NULL for private, so private playlists are **invisible to the firehose by construction** — events never match. `/activity/histogram` counts `collection_events` without joining `playlists`, but since we don't emit events for private writes the count isn't biased.

13 e2e tests in `tests/api/test_private_playlists.py` cover the 5 mutation paths, the 6 leak surfaces, plus owner-can-read / non-owner-404 / anonymous-404 / list filters / add+remove+reorder+delete lifecycle.

**#1387 — visibility toggle** (originally deferred in #1385 as "comes alongside artist drafts," landed standalone the same day): extends `PATCH /lists/playlists/{id}` with `is_private`. private→public writes `items_json` to a new PDS list record and clears the JSONB; public→private snapshots current PDS items into `items_json` (preserving order + cids) and best-effort deletes the PDS record. `show_on_profile` resets to false on either transition — visibility changed, the user opts back in if they want. ordering rule: **persist new state → update row → clean up old state**. failures during new-state abort the transition; cleanup failures are logged and tolerated.

**#1388 — UI polish**: the new "make public" / "make private" button no longer stretches like a text input.

**the trade-off we're owning**: app-layer privacy. plyr.fm's backend can read these records by definition — that's true of every "private" feature on every SaaS product, but worth saying explicitly since the rest of the platform is designed around user-owned PDS storage. anything that needs *cryptographic* guarantees against a hostile/compromised plyr backend must wait for the substrate; private playlists today are v0 listener-organization, not security-critical state.

**collaborative playlists are the obvious next step**, and they're the trigger for substrate adoption: "private → selectively shared" is a multi-member permissioned context, exactly the shape dholms's spec serves. when that UX shows up, the migration path is to lift `items_json` onto a shared SpaceRecord and add a member list — which is what v1 (#1385) prefigured, minus the speculation about today's lexicon shape. #1384's substrate-time plan column should reflect "yes, when sharing lands" rather than "may always stay app-layer."

**docs**: `docs/public/listeners.md` now mentions private playlists in passing with the "why it's app-layer for now + substrate on the way" framing (one paragraph after the build-a-playlist step + parenthetical in the feature list).

---

#### cover-art background scrim — readability fix (PR #1381, May 8, closes #1374)

**why**: @incognitothief reported that on the track-detail page with *use currently playing track's artwork as background* enabled, title text and *add to queue* were invisible against a light cover. same root cause showed up on home, playlists, albums, embeds, activity, profile pages — every route with text directly on the body background.

**what shipped**: a single layer change rather than patching ~15 transparent-on-body offenders. `body::before` now composites a theme-aware flat-color scrim on top of the cover image inside the same blur (`rgba(10,10,10,0.65)` dark / `rgba(250,250,250,0.65)` light, alpha picked so pure-white covers still hit ≥4.5:1 WCAG AA contrast with `--text-primary`). cover still tiles, blurs, and shows through at 35% transmittance — atmosphere instead of competing with content. user-chosen custom background images are deliberately untouched (explicit aesthetic choice).

---

#### artist identity backfill from bsky (PR #1382, May 8)

**why**: artists whose bsky identity changed before #1200 (Jetstream identity-event sync, 2026-03-30) never got their plyr.fm row updated — the consumer didn't exist when those events fired. surfaced today: a user who changed their handle on 2026-03-04 still appears under their old handle two months later. additionally `ingest_identity_update` only syncs `handle` / `pds_url` / `avatar_url`, so an auto-default `display_name` (`== handle` from `ensure_artist_exists`) stays stuck until the user manually touches their profile.

**what shipped**: new admin script `scripts/backfill_artist_identity.py` following the existing backfill shape (uv shebang, asyncio + semaphore, `--dry-run`, `--limit`, `--concurrency`, `--did` for spot fixes). per artist: fetch bsky profile → diff stored row vs profile → apply (or print). `display_name` is **only** updated when it currently equals the stored `handle` (the auto-default marker) so deliberately-set display names are preserved. when `Artist.handle` changes, `UserSession.handle` is updated in lockstep, matching what `ingest_identity_update` does for live events.

---

#### default-hide suno + voice memo tag (PR #1383, May 8)

`suno` joins `ai` / `ai-slop` in `DEFAULT_HIDDEN_TAGS` (backend `utilities/tags.py` + frontend `preferences.svelte.ts`) so fresh accounts default to hiding it. existing users keep whatever they have — `DEFAULT_HIDDEN_TAGS` only applies to fresh preference rows; existing users add `suno` from the tag filter UI if they want. `/record` now tags voice captures with `voice memo` (space, matches the normalized form) instead of `voice-memo`.

---

#### backlog-maintenance skill (PR #1396, May 13)

new `.claude/skills/backlog-maintenance/SKILL.md` codifying the triage rules that were previously living only in memory. propose-and-wait flow over labels and closes; the strict `good first issue` bar (small scope ≠ good-first — deep state / creds / unsettled product judgment / upstream blockers / "annoying state issues" all disqualify); stale-close heuristics (link dumps without acceptance criteria, superseded work, owner comments indicating a tool has shipped). explicit "if zero candidates exist, say so" — don't stretch the bar. born out of the triage pass that landed `good first issue` on #1348 and closed #494 (pmgfal supersedes it). skill files are repo-checked and shared across contributors; memory files are local-only — moving the rules out of memory makes them reviewable for the next contributor running the skill.

---

#### jam deep-link join toast (PR #1378, May 7)

**why**: @hipstersmoothie.com reported that following Tynan's `plyr.fm/jam/0toyxh1w` share link, signing in, and ending up on the homepage looked like the join hadn't worked. logfire spans confirmed the #993 intent-preservation cookie landed him on `/jam/[code]` correctly and `jam.join()` returned 200 — he then re-tapped the share link twice over the next ~90s, each time re-joining, because the home landing gave no acknowledgement.

**what shipped**:
- `frontend/src/routes/jam/[code]/+page.svelte`: fire `toast.success(\`joined ${host_display_name}'s jam\`)` after a successful page-onMount join, before the existing `goto('/')` to home. falls back to `'joined jam'` if `data.preview` failed to load
- two-line diff. layout's auto-rejoin path (queue/jam reconnect on every page mount) is unaffected — toast only fires when the user actually arrives at `/jam/[code]`

**why a toast and not a routing change**:
- there is no jam page UI for authed users — `/jam/[code]` only renders `<p>joining jam...</p>` before `goto('/')`. the actual jam UI is the global queue panel, which `+layout.svelte` already auto-opens on `jam.active` transition
- so "stay on /jam/[code]" would be staying on an empty page. the gap was acknowledgement, not destination

---

#### comic sans actually renders on mobile (PR #1377, May 6)

**why**: the comic sans font option's stack was `'Comic Sans MS', 'Comic Sans', cursive`. iOS and Android don't ship Comic Sans MS, so mobile fell through to the generic `cursive` family — Snell Roundhand on iOS, something else on Android. desktop (macOS/Windows) had Comic Sans MS preinstalled and masked the issue.

**what shipped**:
- added [Comic Neue](https://fonts.google.com/specimen/Comic+Neue) (free open-source clone) to the Google Fonts preload and to the stack as a pre-cursive fallback
- desktop with local Comic Sans MS keeps using the local font (no extra fetch); mobile gets Comic Neue

---

#### live theme celestial logo — shipped, lived in prod for ~36h, then ripped out (PRs #1375, #1376, #1380, May 6–7)

**arc**: #1375 (May 6, 00:04Z) added a `live_logo_celestial_enabled` opt-in setting that rendered the plyr.fm SVG mark as a location/time-aware sun or moon when live theme was active. #1376 (May 6, 13:43Z, ~13h later) removed the setting and made the celestial layer inherent to live theme — the logo sky belongs to the same product surface as the gradient, a second toggle was the wrong abstraction. both shipped to prod via `just release-frontend-only`. #1380 (May 7, 21:15Z) ripped the celestial layer out entirely — it was live in prod and the user didn't like how it looked once seen at scale on the actual site. rest of live theme (gradient + ambient color from location/weather) is unchanged.

**lesson**: aesthetic calls don't always survive contact with prod. the experiment closed cleanly because the inherent version (#1376) made the revert a delete rather than a deprecation — no `live_logo_celestial_enabled` rows to migrate. fast forward / fast revert is the right shape for visual experiments where staging can't fully predict the live-app feel.

---

#### CONTRIBUTING.md (PR #1373, May 5)

added a top-level `CONTRIBUTING.md` pointing at the public docs at `docs.plyr.fm/contributing` and the local `.claude/skills/contribute/SKILL.md` for AI coding assistants. surfaces the contribution path for drive-by visitors who don't otherwise crawl `docs/`.

---

#### georgia as default font + deploy-docs misconfig (PR #1371, May 5)

**why**: informal poll favored georgia over the previous mono default. only changes the resolved default for users who never explicitly picked a font; explicit choices (including mono) are preserved by the `?? DEFAULT_FONT` fall-through, since `ui_settings.font_family` is absent from the JSONB until the user sets it.

**what shipped**:
- `DEFAULT_FONT: 'mono' → 'georgia'` (`preferences.svelte.ts`), `FONT_OPTIONS` reordered to lead with georgia
- body CSS fallback in `+layout.svelte` updated to Georgia stack (covers the moment before JS sets `--font-family`)
- docs site `--sl-font` switched to Georgia in `docs/site/src/styles/custom.css`. `--sl-font-system-mono` kept for code blocks
- accepted: one-frame mono → georgia flash on first post-deploy load for users with stale `localStorage['fontFamily'] === 'mono'` (cache was written from the resolved default, not raw `font_family`)

**incident surfaced during rollout**:
- merging the PR shipped Georgia to the **app** (staging, then prod via `just release-frontend-only`) but `docs.plyr.fm` kept serving mono
- diagnosis: `deploy-docs.yml` was succeeding to a Cloudflare Pages project on the **wrong account**. the `CLOUDFLARE_API_TOKEN` GitHub secret had been minted in the Prefect/work account (since 2026-03-06); the workflow was happily deploying into a black-hole project there while `docs.plyr.fm` is bound to the personal-account project (`plyr-fm-docs`, subdomain `plyr-fm-docs-9ac.pages.dev`)
- the personal-account project had not received a CI deploy since 2026-04-19 (commit `a4977bc2`, the last manual `wrangler` push). luckily only one PR (this one) actually changed `docs/site/**` in that window, so no backlog of stale docs — only the font change was missing
- fix: rotated `CLOUDFLARE_API_TOKEN` to a new token scoped to the personal account with Pages:Edit, updated `CLOUDFLARE_ACCOUNT_ID` to `3e9ba01cd687b3c4d29033908177072e`, re-ran the workflow. docs.plyr.fm now serves Georgia from a freshly-built bundle

**lesson**:
- a deploy that "succeeds" but never updates the user-facing surface is almost worse than a failure. consider: a sanity check at the end of `deploy-docs.yml` that GETs `https://docs.plyr.fm/_astro/<known-bundle>.css` (or the fresh hash from the build) and asserts the deploy actually moved the production alias

---

#### image pipeline cleanup (PRs #1364-1366, May 3)

**why**: phone JPEGs typically store the sensor in landscape with an EXIF `Orientation` tag asking viewers to rotate at display time. browsers honor it; PIL doesn't. cropped/resized WebP thumbnails came out sideways for any track whose source had a non-identity tag. surfaced as @incognitothief / @zzstoatzz.io's "day and age" cover rendering rotated everywhere except the detail page (which read the unrotated `image_url`).

**what shipped**:
- **EXIF orientation** (#1364) — `ImageOps.exif_transpose` on upload + thumbnail generation. backfill script (`scripts/backfill_image_orientation.py`) reprocessed historical assets
- **two upload paths consolidated** (#1365) — `_internal/image_uploads.process_image_upload` (used by edit paths: tracks PATCH, albums, playlists) and `api/tracks/uploads.stage_image_to_storage` (used by the upload pipeline) were two parallel functions doing the same job with subtly different behavior. #1364's `normalize_orientation` only landed in the first one. consolidated, same anti-pattern as #1363's resolver dup
- **iPhone MPO normalization + backfill fix** (#1366) — iPhone JPEGs are recognized by Pillow as `MPO` (Multi-Picture Object), not `JPEG`. the `_PIL_SAVE_FORMAT` mapping in #1364 was missing `'mpo'`, so `save_format` came back None and `normalize_orientation` silently skipped 13 of 20 affected prod images. also unwrapped storage proxy in the backfill script

**decisions**:
- backfill is opt-in via script rather than a one-time migration — tracks are content-hashed so re-upload would change keys and break `audioUrl` references in PDS records
- followed up with two new issues filed today (#1367 auto-purge CF cache when R2 image overwritten, #1368 data integrity for orphan `image_id` refs) — kept as backlog rather than rolled into this cluster

---

#### canonical DID storage with read-time profile resolution (PRs #1362-1363, May 3)

**why**: closes #1355. 3 prod tracks (918, 938, 88) rendered "feat." with no name because `track.features` rows had `displayName` (camelCase) but the frontend reads `display_name` (snake_case). root cause was deeper than case: identity metadata (handle, displayName, avatar) was denormalized into both the PDS record AND the DB row, so it drifted on every profile change.

**what shipped**:
- **lexicon relaxed** — `featuredArtist.required` from `["did","handle"]` → `["did"]`, marked handle/displayName deprecated. consumers should resolve from DID
- **profile resolver** — new `_internal.atproto.profiles.resolve_dids()`: JOIN artists table → in-process LRU → bsky `getProfile` fallback. `TrackResponse.features` becomes typed `list[FeaturedArtist]`, populated by resolver, never returns raw JSONB
- **resolver consolidation** (#1363) — found two parallel features-from-handles resolvers drifted apart in error semantics: `resolve_featured_artists` in `_internal/atproto/handles.py` (lenient, used by upload) vs `resolve_feature_handles` in `api/tracks/metadata_service.py` (strict, used by edit). consolidated into one with a configurable `strict` flag, killed ~80 lines of duplication

**decisions**:
- read-time resolution over write-time normalization — chose to take the resolver hit on every API read rather than rewrite all historical track records. profile changes propagate instantly without backfill
- LRU + DB-first means most lookups never hit bsky getProfile, so the read-time cost is negligible after warmup
- full design rationale in `docs/internal/plans/featured-artist-references.md`

---

#### docket worker on its own fly process group (#1359, May 1)

**why**: 2026-04-30 incident — one user's album upload OOM'd uvicorn and produced 502s + silent logouts. before this PR, `relay-api` ran uvicorn AND a docket Worker in the same process; any background-task OOM took the HTTP server with it. structural fix from #1357.

**what shipped**:
- two fly process groups: **`app`** runs just uvicorn (opens a Docket *client*, no Worker, sized for HTTP fan-out only); **`worker`** runs just the Docket Worker via dedicated `backend.worker` entrypoint (no HTTP, sized at 2GB for the in-memory upload pipeline)
- `_internal/background.py` split into `docket_client_lifespan()` and `docket_worker_lifespan()`. `main.py` switches to client lifespan (one-line change). new `backend/worker.py` mirrors observability setup
- `fly.toml` declares both process groups, machines auto-distribute

**decisions**:
- a runaway upload task can now only OOM its own machine; HTTP stays up. the cost is one extra always-on worker machine — worth it for clean isolation

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

**bsky.social WAF JA4 incident resolved upstream** (#1414–#1419, May 17): 18-hour outage where every new `*.bsky.social` login + every token refresh against `bsky.social` returned 403. Bluesky's WAF auto-blocked the generic JA4 fingerprint shared by `uv:python3.12-bookworm-slim + httpx` (us + many other Python services) after a different app with the same fingerprint surged createSession traffic. Bluesky platform team manually undid the rule + is improving precision. #1419 ships a friendly 503 (instead of stack-trace 400) for the next time something of this shape happens. #1414 (handle-resolution fallback) reverted same day because it only papered over one of two failure legs. Investigation comment posted on bluesky-social/atproto#4764 with full reproduction matrix.

**first external contribution merged**: @ailawav.bsky.social (aila / @AilaScott on GitHub) shipped #1393 — a `DOCKET_URL=memory://` default so local dev doesn't require Redis. follow-ups #1394 (`frontend/.env.example` + setup-guide updates) and #1395 (ruff cleanup) closed the surrounding DX gaps she hit on first run, so the contribution path now works end-to-end without insider knowledge.

**upload outage class fully closed**. the 2026-05-06 → 05-10 silent OOM-loop outage (4 days, 9 stranded users, discovered via @cameron.stream's tweet not internal alerting) is fixed end-to-end across three PRs: #1389 streams audio at every stage (R2 → worker → PDS, R2 → worker → Modal, transcode in/out via `/tmp` + `aiofiles`) with a 60-min long-form regression test guarding the buffer points; #1390 sets `restart.policy = always` on the worker process group + adds a logfire silence-alert runbook keyed on "queue is being added to but nothing is being executed"; #1391 adds a docket-Perpetual reaper that fails any upload job stuck in `processing` >10 min, cleans up its R2 blob (new `file_id` / `file_type` / `is_gated` cleanup-hint columns on `jobs`), and sends one batched bsky DM per reap. the "audio must stream end-to-end" rule is encoded in agent memory so future PRs can't regress it.

**private playlists shipped — and the design collapsed from v1 to v2 mid-flight**: closed PR #1385 built a full backend `Space` abstraction (tables mirroring atproto's permissioned-data spec, `plyr-space://` URI scheme, one-line-swap migration story) — closed in favor of #1386, which is just `is_private boolean` + `items_json jsonb` on the existing `playlists` table. the lesson: don't pre-build abstractions against a spec that's still being revised upstream; ship the simplest shape that works and migrate when the substrate is concrete. v2 carries the same 6-surface existence-leak audit (mutations 404 not 403, `/search` / `/oembed` / `/activity` / `/by-uri` / `list_artist_public_playlists` all filter or refuse; ingest.py is firehose-invisible by construction). #1387 added the post-creation toggle (private→public publishes a PDS record; public→private snapshots into `items_json` and best-effort deletes); #1388 fixed the toggle button's text-input stretch. **collaborative playlists are the obvious substrate trigger**: "private → selectively shared with a few people" is a multi-member permissioned context, which is exactly what dholms's spec is for — #1384's classification of private playlists as "may always stay app-layer; degenerate single-user case" should be updated to reflect that.

**polish + DX**: cover-art background scrim (#1381, closes #1374) — single-layer fix for ~15 sites where transparent foreground collapsed against light covers; artist identity backfill from bsky (#1382) for rows missed by the pre-#1200 identity-event window; suno hidden by default + voice memo tag normalization (#1383); backlog-maintenance skill (#1396) so the strict good-first-issue rules live in the repo not in memory.

**carried forward from prior cycles**: jam deep-link join toast (#1378), mobile Comic Sans fallback (#1377), celestial logo experiment shipped + lived ~36h + ripped (#1375→#1376→#1380), `CONTRIBUTING.md` (#1373), georgia default font + deploy-docs misconfig fix (#1371), image pipeline cleanup (#1364-1366), canonical DID storage for featured artists (#1362-1363), docket worker on its own fly process group (#1359).

**next**: fly worker tcp health check (running-but-stuck detector — symptom-side complement to the silence alert); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop the `_signed_streaming_post` helper); deploy-docs sanity check (assert prod alias moved); #1314/#1315 (audio replace race follow-ups), sheets unification (#1348, good-first-issue), `config.py` decomposition.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- harden file format support — revisit transcoding pipeline (FLAC graduated in #1189, AIFF still transcodes)
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
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-05-17 (bsky.social WAF JA4 collateral-block outage — 18h OAuth failures resolved upstream after the bluesky platform team manually undid the rule; #1414 handle-resolution fallback reverted because the failure was multi-hop; #1416/#1417 SDK fork ATPROTO_USER_AGENT env var turned out not to matter — TLS-fingerprint-level discriminator, not UA; #1418 removed dead ATPROTO_PDS_URL config drift; #1419 friendly 503 for next time; first external contribution from @ailawav.bsky.social earlier in the cycle; 4-day upload OOM outage closed end-to-end via streaming refactor + ops backstops + stuck-job reaper; private playlists app-layer v2 + visibility toggle; cover-art scrim; artist identity backfill; backlog-maintenance skill).

