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

#### header polish cluster — desktop info icon + floating section titles + Escape-to-close (PRs #1429→#1431, frontend-only deploy May 23)

**why**: three QoL items rolled into one frontend deploy.

1. The mobile header's top-left info icon (opens a modal with platform stats + bsky/source/docs/status/report links) had no desktop equivalent — desktop users couldn't see platform stats anywhere.
2. Section titles ("top tracks", "artists you know", "tracks") on the home page were flat against busy backgrounds (especially over custom-background images or the live ambient theme).
3. Neither the feedback modal nor the more/links menu closed on Escape, even though `AudioRevisionsSheet` / `BottomSheet` already established that pattern.

**what shipped**:
- **#1429** (initial cut): added `<LinksMenu />` to `.margin-left` on desktop and made the 4 existing bsky/status/tangled/docs social icons coexist with it; added a new `--text-elevation` CSS variable (theme-aware: stronger on dark, lighter on light) applied via a global `.section-title` class on the three home-page h2s.
- **#1430** (review feedback): dropped the inline social-links cluster — the LinksMenu modal contains those same links, so surfacing them inline next to the icon was redundant. Single info icon is now the only top-left affordance, mirroring the mobile-first pattern. Also swapped the generic SVG circle-info for a typographic asterisk (`✻` U+273B) rendered in the inherited font — shares typography with the rest of the UI, reads as a "footnote/aside" affordance.
- **#1431**: window-level keydown handler on `FeedbackModal` and `LinksMenu` — Escape closes when open, no-op otherwise. Same pattern already used in `AudioRevisionsSheet` and `BottomSheet`.

**design notes**:
- The `--text-elevation` variable is positioned as a reusable token. Polish-PR candidates: extend to settings/portal/costs h2s, page-hero titles, dialog titles — once we know the dark-mode shadow (`0 1px 3px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2)`) reads well on the home page first.
- Asterisk glyph picked over generic icon, three-dot kebab, and wordmark variants. Trade-off: relies on the user's chosen font (Georgia by default) having a distinctive asterisk — should still be recognizable in mono / Inter / system-ui but may look mundane in some.
- Volume-control behavior question came up mid-thread (does our volume slider duplicate system volume?): confirmed current behavior is correct — `<audio bind:volume>` is per-element by spec on every platform, matches Spotify/YouTube/Apple Music. The slider is already hidden via `display: none` at `@media (max-width: 768px)` in `PlaybackControls.svelte:425`, so iOS's read-only `audio.volume` quirk is already handled.

---

#### notification + now-playing fixes traced from "woody isn't getting DMs" (PRs #1425, #1426, release 2026.0522.162731, May 22)

**why**: user mentioned during a deploy-prep conversation that they hadn't been getting DMs for new track uploads. Logfire showed the last successful `send_dm` span fired **2026-05-16 21:23 UTC**; zero since. The production release `2026.0517.034304` had deployed at **2026-05-17 03:43 UTC** — **one minute before** the bsky.social WAF JA4 block began (03:44 UTC, per the prior incident entry below). Every process that came up during the WAF window had `NotificationService.setup()` 403 at `bsky.social/xrpc/com.atproto.server.createSession`, silently leaving `recipient_did = None`. Two compounding bugs kept the service broken even after the WAF was lifted:

1. **`setup()` ran exactly once at process startup** — there was no retry path, so the workers stayed broken until the next deploy. Even after the WAF lifted at 21:44 UTC, the worker processes still had `recipient_did = None`.
2. **`_send_track_notification` set `track.notification_sent = True` unconditionally** after the call returned, even when `send_track_notification` returned `None` ("recipient not set, skipping"). This permanently locked out the Jetstream identity-update consumer (which calls the same hook on every identity event) from retrying.

Net effect: **13 production tracks between 2026-05-17 19:01 UTC and 2026-05-18 17:37 UTC** were marked sent without ever generating a DM, and even after fixing the service no automated retry could fire for them.

**#1425 — notification resilience**:
- New `NotificationService.ensure_ready() -> str | None` that returns the recipient DID if cached, otherwise re-runs `setup()`. Rate-limited to one attempt per minute via `_SETUP_RETRY_COOLDOWN_S` so a sustained upstream outage doesn't get amplified into every-upload login attempts.
- All five `send_*_notification` methods (track / copyright / image / user-report / reaper) go through `ensure_ready()` and use the returned DID directly — also makes type-narrowing trivial vs the prior `if not self.recipient_did:` pattern that ty couldn't follow across the `await`.
- `_send_track_notification` only marks `notification_sent = True` when `result.success` is true, or when notifications are globally disabled (so Jetstream stops firing the hook for a deliberate no-op). Failed DM attempts now leave the row untouched so Jetstream can retry.
- 9 regression tests across `backend/tests/_internal/test_notification_service.py` and `test_post_create_hooks.py`.

**#1426 — now-playing burst race** (discovered while investigating why woody.fm was tripping the 30/min rate limit during the same upload session): production data showed bursts of **5–9 simultaneous `POST /now-playing/`** calls within ~85ms every 10 seconds. Cross-user impact: every active listener was hitting it proportional to playback length (zzstoatzz.io averaging 1.42 calls/active-sec, woody.fm 2.64).

Root cause: in `nowPlaying.report()`, the throttle bookkeeping (`lastReportTime` / `lastReportedState`) was updated **after** `await sendReport(...)`. `<audio bind:currentTime>` fires `timeupdate` at ~4–60Hz during playback, so Svelte's `$effect` calls `report()` dozens of times during the ~100ms it takes the first send to round-trip. Each intermediate call saw stale state, passed both throttle gates, and dispatched its own parallel `fetch`.

Fix: a two-line move — set the throttle state **before** `await sendReport(...)`. Subsequent effect runs during the in-flight send now see the updated fingerprint and early-return as intended.

**post-deploy verification** (release `2026.0522.162731`): both `app` and `worker` notification bots authenticated cleanly at 16:29 UTC. Zero "failed to authenticate" or "recipient not set" since. Single observed `POST /now-playing/` in the post-deploy hour was 1 OK / 0 throttled — the burst signature is absent.

**still open**: backfill DMs for the 13 stranded tracks (one-off `UPDATE tracks SET notification_sent = false WHERE id IN (...)` against the affected window — surfaces them to Jetstream's identity-update consumer or a script-driven re-fire). Logged as a known issue.

---

#### BottomSheet frame + Instagram-style swipe-to-dismiss (PR #1423, closes #1348, May 17)

**why**: five different bottom-sheet implementations (`LikersSheet`, `AudioRevisionsSheet`, `Queue`, and inline sheets in route pages) each invented their own backdrop / handle / animation / aria semantics. PR #1342 had extracted a swipe gesture into an attachment, but only `LikersSheet` used it — and the gesture only fired on the tiny 36×4px decorative handle, which is bad UX. The next sheet added would quietly diverge again.

**what shipped**:
- New `frontend/src/lib/components/BottomSheet.svelte` frame that owns backdrop, handle affordance, `role="dialog"` + `aria-modal` + `aria-label`, Escape-to-dismiss, focus trap + restore, `inert` on the backdrop while closed, `prefers-reduced-motion`, and `safe-area-inset-bottom`. Consumers provide `{ open, onClose, ariaLabel, children }` plus optional `maxWidth` / `maxHeight` / `centerOnDesktop`.
- `swipe-to-dismiss.ts` rewritten to **Instagram-comments style** — gesture binds on the whole sheet, not the handle. Activates only when motion is dominantly vertical-down **and** the inner scroller (`.sheet-content` by default) is at `scrollTop === 0`. Once the user has scrolled into the content, a downward swipe scrolls; once back at top, the next swipe drags the sheet. Mouse pointers excluded (close button + backdrop + Escape cover them).
- `LikersSheet` and `AudioRevisionsSheet` migrated onto the frame. `AudioRevisionsSheet` keeps its 600px+ centered-modal behavior via `centerOnDesktop` and gains focus management for the first time.

**scope notes**: the other "sheets" listed in the issue (playlist / album / liked route pages) are centered modals or contain no actual bottom-sheet markup — left out of scope. `Queue.svelte` is a global panel, not a sheet. Backgrounded-inert-while-open (the more aggressive aria pattern) requires DOM portaling and was kept simple as inert-when-closed; not yet seen as a practical focus-leakage issue.

---

#### audio-replace preserves PDS record `createdAt` (PR #1422, May 17)

**why**: when a user replaced the audio file on an existing track, the new PDS record was written with the **current** timestamp rather than the original track's `createdAt`. Replaces should look like edits — a new revision of the same record, not a new record entirely. The track's chronological position in the user's feed shouldn't jump to "now" just because they re-uploaded the audio bytes.

**what shipped**: `backend/src/backend/api/tracks/audio_replace.py` carries the original PDS record's `createdAt` through to the replacement write. New regression test in `backend/tests/api/track_audio_replace/test_pipeline.py` asserts the timestamp is preserved across the replace path.

---

#### traffic-overview skill — multi-horizon report via Logfire + Cloudflare API MCP (PR #1427, May 22)

**why**: the user asked "how have things been going" and wanted a tool that emits a multi-horizon (24h / 7d / 30d / 90d / 180d) traffic + performance read. Existing tooling was scattered: `scripts/cf_analytics.py` (Cloudflare GraphQL CLI, needed `.env` tokens not committed) and ad-hoc Logfire queries. No unified entry point, no documented gotchas, no awareness of what each tool can actually reach.

**what shipped**: new `.claude/skills/traffic-overview/SKILL.md` (~80 lines) that codifies:
- **Two lenses**: Logfire (app-server view — per-route p95/p99, errors, user identity) for ≤14d horizons; Cloudflare edge MCP (`mcp__plugin_cloudflare_cloudflare-api__execute`, via the cloudflare plugin's OAuth) for 24h–30d, with cache % / bytes / threats that Logfire can't see.
- **Hard ceilings** discovered empirically: Logfire MCP caps every query at a **14-day window**; Cloudflare `httpRequests1dGroups` retention is **~30 days** even on paid plans (querying for 180d returned 34 days). The skill explicitly instructs the model not to fabricate 90d/180d numbers.
- **Six gotchas that silently bite**: the CF MCP unwraps the GraphQL `data:` envelope (data lives at `r.result.viewer.zones`, NOT `r.result.data.viewer.zones`); use `date_geq` not `date_gt` (the latter skips the boundary day); DataFusion `GROUP BY` needs the expression verbatim not by alias; `approx_percentile_cont(duration, 0.95) * 1000` gives p95 in ms; `service_name` is `plyr-api` everywhere so filter by `deployment_environment`; `/health` is ~60% of request volume so exclude it for "real" traffic.
- **No more shared secrets**: the cloudflare plugin's OAuth means there's no `SCRIPT_CF_API_TOKEN` to manage. accountId is pre-set; zone ID is hardcoded in the skill.

Side-fix included in the PR: `scripts/cf_analytics.py`'s `httpRequests1dGroups limit: 100 → 200` (still useful as a CLI fallback for anyone with the older token-based setup, even though the real ceiling is CF retention, not the limit).

**lesson**: building this empirically — running the queries in real time, hitting the limits, documenting them in the skill before they bit again — produced a much tighter SKILL.md than designing it upfront would have. Final document went 165 → 83 lines after trimming non-load-bearing prose.

---

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

#### copyright paradigm — indiemusi.ch alpha shipped behind a flag (PRs #1400→#1411, May 14–16)

**why**: [Hilke's blog post on indiemusi.ch](https://hilkeu.leaflet.pub/3mhzj3ouxx22k) describes a 10-record lexicon family on atproto for capturing music rights metadata — interestedParty splits in basis points, publishingOwner identities (individual or company), ISWC/ISRC/IPI identifiers. it's already published as `com.atproto.lexicon.schema` records on `did:plc:lcmrbur2pydmpelfcs7fjbdx`. plyr.fm now offers it as the first opt-in **copyright paradigm**: a track flagged as copyrighted writes `ch.indiemusi.alpha.song` + `ch.indiemusi.alpha.recording` records to the user's PDS alongside the existing `fm.plyr.track`, with the audio routed through the supporter-gated storage path (private R2 bucket, no PDS blob, no public URL).

**what shipped (eight PRs, ordered)**:

1. **#1400 — phase 1 / foundation**: `IndiemusiSettings` config section, migration `16cfa67553bd` (`user_copyright_configs` row per user + `tracks.copyright_song_uri` / `copyright_recording_uri` columns), pydantic input models, and create/update/delete helpers for `actor.publishingOwner` / `song` / `recording` records under `backend/_internal/atproto/records/ch_indiemusi/`. 13 unit tests verify we emit records byte-equivalent to what real indiemusi clients write — basis-point royalty splits, `publishingOwner` inlining, `companyName` vs `firstName`/`lastName` variants. **intentionally NOT shipped**: Hilke's DRM layer (encrypted audioBlob + RSA-wrapped grants) — conflicts with our streaming-end-to-end rule from #1389; we use the existing supporter-gated audio path instead.

2. **#1401 — phase 2 / portal section + scope-upgrade plumbing**: new `api/copyright.py` router (`GET /config`, `POST /setup`, `POST /disconnect`). setup branches on whether the session already has indiemusi scopes — if not, kicks off an OAuth scope upgrade with the form data stashed on the pending row + `redirect_to=/portal`; if so, writes the record in place. `AtprotoSettings.resolved_scope_with_extras` cleanly composes teal + indiemusi (and any future paradigms) into the requested OAuth scope. migration `2ff28fd69210` adds `paradigm_data jsonb` + `redirect_to` to `pending_scope_upgrades`. Frontend gets a new `CopyrightSection.svelte` component in the portal (extracted because `portal/+page.svelte` is at its loq limit, 3.8k lines).

3. **#1402 — phase 3 / upload + edit rights, per-track endpoints, audio gating**: `support_gate` JSONB gains a `type` discriminator (`{"type": "copyright"}` joining the existing `{"type": "any"}`). single `_check_gate_access` helper in `api/audio.py` branches on type — `copyright` requires any authenticated session (no atprotofans check). `POST /tracks/{id}/copyright` writes the song + recording pair, sets the gate, populates the URI columns; `DELETE` clears them. upload-time path accepts a `copyright` Form field (mutually exclusive with `support_gate`). `CopyrightRightsPanel.svelte` wired into both the upload form and the portal edit form.

4. **#1403 — phase 3 review findings, the load-bearing fixes**:
   - **P1.1 audio migration on edit-time toggle**: before, `POST /tracks/{id}/copyright` set the gate and wrote rights records but left `r2_url` populated and `fm.plyr.track.audioUrl` pointing at the public R2 URL — third-party PDS readers could fetch the audio directly, bypassing the gate. fix detects the public→copyright transition, schedules `schedule_move_track_audio(to_private=True)`, nulls `r2_url`, and rebuilds the PDS record with the auth-proxied `/audio/{file_id}` URL. `clear_track_rights` is symmetric.
   - **P2.1 backend mutex**: copyright and supporter gates are mutually exclusive in the UI; `write_track_rights` now raises 400 if a track already carries a non-copyright gate (UI was the only enforcement before).
   - **P1.2 disconnect blocked when copyright-gated tracks exist**: before, disconnect deleted the config + publishingOwner record, leaving any gated tracks orphaned with no escape hatch. now returns 409 with the list of blocking tracks; the portal surfaces it as a toast directing the user to the edit form.
   - **P2.2 atprotofans probe skips copyright gates**: the supporter-status HTTP call at three call sites (`listing.py`, `for_you.py`) now filters out `type == "copyright"` tracks (pure waste otherwise).
   - **P3 royalty totals**: `additional_interested_parties` is now validated to sum ≤ 10000 basis points for both mechanical and performance splits — primary party was previously being clamped to `max(0, 10000 - sum)`, so additionals summing to 15000 emitted a record with aggregate splits at 150%.

5. **#1404 — IPI / ISWC / ISRC format validation**: screenshot showed "asdfasdf" sailing through as an IPI. now: `IPI_PATTERN = r"^\d{11}$"` (CISAC spec), `ISWC_PATTERN = r"^T-?\d{9}-?\d$"`, `ISRC_PATTERN` for CC+XXX+YY+NNNNN. inline frontend errors. the hyphenated period-grouped ISWC form (`T-DDD.DDD.DDD-C`, 15 chars) was deliberately rejected because the lexicon enforces maxLength=13.

6. **#1405 — declare indiemusi scopes in oauth client metadata**: required so the OAuth grant accepts them. coupling-locking test asserts every scope token from `IndiemusiSettings.scope_tokens()` is also present in `client-metadata.json` so future scope additions can't drift.

7. **#1407 — copyright uploads don't require atprotofans**: `requires_atprotofans_check` on the upload path was branching on truthy `support_gate` rather than `type == "any"`. copyright-flagged users without atprotofans setup were being blocked at upload-validate. fix narrowed the check.

8. **#1409 — publishingOwner record manager**: Hilke pointed out that any user opening plyr.fm with existing `publishingOwner` records on their PDS would get a duplicate created by our single-form setup. After design review (with codex pushing back on the initial overload-link-to-uri instinct), shipped a small CRUD manager modeled like the tags UX — `GET /copyright/publishing-owners` (with `in_use` + `needs_scope_upgrade` per row), `POST` (create), `PUT /{rkey}` (edit, merge-preserve), `DELETE /{rkey}` (PDS deleteRecord), `POST /use-owner` (DB-only link, no putRecord — plyr "claims" the existing record as in-use). The **merge-preserve write contract** is the load-bearing bit: every edit fetches the record fresh from PDS, strips only known modeled keys, spreads validated input back. Unknown fields (Hilke's hypothetical `taxId`, future lexicon extensions) are preserved untouched. individual↔company switches actually clear stale firstName/lastName. `pending_scope_upgrades.paradigm_data` becomes a discriminated union (`{"action": "create" | "edit" | "use"}`) so the scope-upgrade callback dispatches correctly. `CopyrightSection.svelte` rewritten from a single form into a card list.

9. **#1410 — feature-flag the whole thing behind `copyright-paradigm`**: lets the merged code (phases 1-3 + all fixes, already in main) ship to prod dormant. flag-enrolled users get the full UX; everyone else gets a 404 on `/copyright/*` endpoints and a hidden frontend section — same shape as `vibe-search`. `_check_copyright_paradigm` (the login-time scope-extension probe) requires BOTH config row AND flag — without this, a user opted in pre-rollout would keep re-requesting indiemusi scopes on every fresh login even after we'd disabled the feature for them, defeating the rollback path. **404 not 403** so the rollout boundary isn't leaked.

10. **#1411 — disconnect is DB-only; use-owner tolerates unknown fields**: post-#1409 cleanup. disconnect no longer deletes the publishingOwner record (it's a user-owned PDS record; we shouldn't auto-delete on app disconnect — the explicit-delete button on the card list handles that). `use-owner` no longer 400s if the record has fields outside our model — same merge-preserve principle, app-layer doesn't get to police shape.

**rollout shape**: 1) land flag (#1410, merged), 2) `just release` to prod (dormant), 3) `uv run scripts/enable_flag.py did:plc:xbtmt2zjwlrfegqvch7fboei copyright-paradigm` for own DID, 4) dogfood on prod, 5) broaden (Hilke, other partners), 6) drop the flag check.

**design notes**:
- `support_gate` JSONB is extended with a type discriminator rather than introducing a parallel column. storage / gating semantics are identical to supporter-gating (private bucket, auth-proxied serving) — only the access check at serve time differs. cost: the field name is slightly misleading for the copyright case; benefit: every storage code path (upload, audio serving, audio replace, R2 URL synthesis) just works untouched.
- streaming access is "any authenticated listener" — not monetization-gated, not anonymous. constraint was "not as a public PDS blob, not on the public R2 URL," not "paid only."
- co-writer / publisher editing is plumbed end-to-end on the backend (`additionalInterestedParties`) but the UI is a future enhancement. for now the user is the only `interestedParty` written, auto-derived from their portal config.

---

#### typed R2 storage keys — make save/read extension drift unrepresentable (PR #1413, May 17)

**why**: woody.fm hit it in production 2026-05-16 — five `.aif` uploads stranded at "× staged audio file missing from storage." files were sitting in R2 the whole time at `audio/<id>.aif` but `R2Storage.stream_file_data` / `head_file` / `get_url` / `delete` were all looking at `audio/<id>.aiff` because they normalized via `AudioFormat.from_extension`. `R2Storage.save` stored under the raw extension. drift between two halves of the same module.

**this is a recurring bug class**: five separate incidents over six months ([#332](https://github.com/zzstoatzz/plyr.fm/pull/332), [#797](https://github.com/zzstoatzz/plyr.fm/pull/797), [#849](https://github.com/zzstoatzz/plyr.fm/pull/849), [#1202](https://github.com/zzstoatzz/plyr.fm/pull/1202), and woody.fm) where save and read disagreed about the extension to use. #797 (2026-01-25) flipped save to the raw filename extension to fix a DB-stored-`'aiff'`-but-file-is-`.aif` case, but forgot to update the readers — that's the regression woody.fm tripped four months later.

**what shipped**:
- new `backend/src/backend/storage/keys.py`: `AudioKey` / `ImageKey` frozen dataclasses. Construct via `from_filename(file_id, filename)` at upload time or `for_file(file_id, file_type)` when rehydrating from the DB. `__post_init__` validates against `AudioFormat` / `ImageFormat`. `.key` property is the single source of truth.
- `r2.py`: every key-construction site (19 of them, audited end-to-end) goes through one of those types. save returns `file_id`; readers take `(file_id, file_type)` and construct the key internally. Public protocol stays compatible, no callsite migration.
- `AudioFormat.all_stored_extensions()` yields every extension we might find in R2 **including aliases** (`.aif` AND `.aiff`). Fallback-scan paths in `delete` / `get_url` use it; old code iterated `AudioFormat` directly and silently skipped `.aif` because `.aiff` is the canonical enum value.
- **test fixture hygiene**: `generate_drone` now applies a random phase offset per call (callers needing determinism opt in via `phase_offset_rad=0.0` or `deterministic=True`). This matters because the existing `test_upload_aif` integration test passed against staging at 06:04 UTC on the same day prod users were hitting the bug at 18:42 UTC. The deterministic fixture (2-second A4 drone, identical content) hashed to the same `file_id` every run; staging R2 still had a pre-#797 `audio/<drone-file-id>.aiff` blob from when save used canonical extensions. The buggy reader was finding that stale blob and reporting success for months.

**tests**: 54 unit tests for `AudioKey` / `ImageKey` (validation, alias preservation, immutability, equality); 24 round-trip tests parametrized over every audio + image extension + alias proving save's key == every reader's key — `('song.aif', 'aif')` is the specific case that would have caught woody.fm; 4 fixture-invariant tests pinning the new randomized-by-default behavior.

---

#### copyright paradigm follow-ups (PRs #1412, May 16; #1421, May 17)

**#1412 — listeners docs refresh**: trimmed the "data sovereignty" prose that was reading as marketing slop; added an inline like-icon example to the intro. one of those edits where killing your darlings tightens the page.

**#1421 — README points local-dev at canonical sources**: trimmed the stale setup snippet from the top-level README; the contributing path now lives in CONTRIBUTING.md and docs.plyr.fm. 41-line deletion, 1 line added.

---

#### archived — earlier May entries (May 1 – May 13)

**why**: this section was getting unwieldy. moved entries with detailed write-ups to `.status_history/2026-05.md`. covers the upload-outage streaming cluster (#1389-#1391, ~4-day silent outage discovered via @cameron.stream's tweet), the first external contribution (#1393-#1395, @ailawav.bsky.social), private playlists v2 (#1386-#1388, design collapsed from v1's Space abstraction), cover-art scrim (#1381), artist identity backfill (#1382), suno/voice-memo tag defaults (#1383), the backlog-maintenance skill (#1396), jam deep-link toast (#1378), comic-sans-on-mobile (#1377), the celestial-logo experiment shipped-then-ripped (#1375/#1376/#1380), CONTRIBUTING.md (#1373), georgia-default-font + the deploy-docs misconfig surfaced during rollout (#1371), image pipeline cleanup (#1364-#1366), canonical DID storage with read-time profile resolution (#1362-#1363), and the docket worker process-group split (#1359).

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

**copyright paradigm — indiemusi.ch alpha shipped behind `copyright-paradigm` flag** (#1400→#1411, May 14–16): plyr.fm's first opt-in copyright paradigm. flagged tracks write `ch.indiemusi.alpha.song` + `recording` records to the user's PDS alongside the `fm.plyr.track` and route audio through the existing supporter-gated storage path (private R2, auth-proxied, no PDS blob). Three foundational PRs (#1400 phase 1 config + record writers, #1401 portal section + OAuth scope-upgrade plumbing, #1402 upload + edit forms + per-track endpoints), five follow-ups (#1403 review fixes including the load-bearing P1.1 audio migration on edit-time toggle, #1404 IPI/ISWC/ISRC format validators, #1405 oauth-metadata scope coupling lock, #1407 atprotofans check narrowed, #1409 the publishingOwner record manager with merge-preserve writes after Hilke flagged the duplicate-on-existing-record case), and finally #1410 the feature flag itself so the merged code ships to prod dormant. #1411 disconnect-is-DB-only is the cleanup. **Rollout shape**: flag-on for own DID, dogfood, broaden to Hilke + partners, then drop the flag. The merge-preserve write contract (`fetch fresh from PDS → strip known modeled keys → spread validated input back`) is the reusable pattern — unknown fields preserved, individual↔company switches actually clear stale state, blanking a field removes it.

**typed R2 storage keys close a 6-month recurring bug class** (#1413, May 17): woody.fm's `.aif` uploads stranded because `save` stored at `audio/<id>.aif` while every reader looked at `audio/<id>.aiff`. Same drift bit four prior times (#332, #797, #849, #1202). New `AudioKey` / `ImageKey` frozen dataclasses make save/read mismatch unrepresentable at the type level. 19 R2 callsites audited end-to-end. Bonus: the integration test fixture had been masking the bug for months because the deterministic A4 drone hashed to the same file_id every run and found a pre-#797 stale R2 blob — now defaults to a random phase offset per call.

**header polish cluster** (#1429→#1431, frontend-only deploy May 23): desktop got the top-left info-icon affordance mobile has had forever — single asterisk (`✻`) glyph in the brand font, consolidated so the menu is the only surface for stats/links. New `--text-elevation` token + global `.section-title` class gives home-page section h2s a subtle floating drop-shadow. Escape now closes the feedback modal and the more/links menu.

**notification + now-playing fixes traced from "woody isn't getting DMs"** (#1425, #1426, release 2026.0522.162731, May 22): the May 17 production deploy started one minute before the bsky.social WAF block hit, so every process came up with a 403'd `NotificationService.setup()` and silently dropped all subsequent DMs. Compounding bug: `_send_track_notification` was marking `notification_sent = true` unconditionally even on the no-op "recipient not set" path, locking out Jetstream's identity-update retry route. #1425 adds `ensure_ready()` (1-min cooldown re-setup) and conditional mark; 13 stranded tracks in the affected window still need a one-off backfill. Same investigation surfaced #1426 — `nowPlaying.report()` was racing its own throttle, producing 5–9 simultaneous `POST /now-playing/` per 10s bucket flip on every active listener. Two-line fix moves the throttle state-update before the `await`.

**bsky.social WAF JA4 incident resolved upstream** (#1414–#1419, May 17): 18-hour outage where every new `*.bsky.social` login + every token refresh against `bsky.social` returned 403. Bluesky's WAF auto-blocked the generic JA4 fingerprint shared by `uv:python3.12-bookworm-slim + httpx` (us + many other Python services) after a different app with the same fingerprint surged createSession traffic. Bluesky platform team manually undid the rule + is improving precision. #1419 ships a friendly 503 (instead of stack-trace 400) for the next time something of this shape happens. #1414 (handle-resolution fallback) reverted same day because it only papered over one of two failure legs.

**sheets unified + Instagram-style swipe** (#1423, closes #1348, May 17): one `BottomSheet.svelte` frame replaces five hand-rolled sheet implementations. Gesture-from-anywhere with scroll-aware activation (only dismisses when the inner scroller is at top, otherwise scroll consumes the gesture). `LikersSheet` and `AudioRevisionsSheet` migrated.

**developer tooling**: `traffic-overview` skill (#1427, May 22) gives a multi-horizon Logfire + Cloudflare MCP read with access ceilings documented (14d Logfire query window, ~30d CF retention).

**next**: enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); backfill DMs for the 13 stranded tracks (`UPDATE tracks SET notification_sent = false WHERE id IN (...)`); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- 13 production tracks created between 2026-05-17 19:01 UTC and 2026-05-18 17:37 UTC are marked `notification_sent = true` with no DM ever sent (collateral damage of the WAF-window deploy + the unconditional-mark bug now fixed in #1425). Eligible for a one-off backfill via `UPDATE tracks SET notification_sent = false WHERE id IN (...)` against the affected window — Jetstream's identity-update consumer will pick them up, or fire the hook directly via a script.
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

this is a living document. last updated 2026-05-24 (status maintenance — added detailed write-ups for the copyright paradigm cluster #1400→#1411 and the typed-R2-keys fix #1413 that had shipped May 14–17 without yet making it into STATUS.md; archived the May 1–13 detailed entries to `.status_history/2026-05.md`).

