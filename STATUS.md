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

### August 2026

#### 502 followers, and the first full accounting (August 5)

**why**: the @plyr.fm account crossed 500 followers with very little self-promotion,
which prompted the first end-to-end usage accounting since launch — recorded for the
numbers, and for what trying to measure them exposed.

**the numbers** (August 5, 2026):
- lifetime, from the prod DB and `GET /stats`: 999 tracks / 121 hours of audio from 97
  publishing artists; 442 atproto accounts have signed in, accruing ~40–50/month with no
  dead months; 13,384 plays; 474 likes; 141 albums; 44 playlists; 48 jams. December's
  432-track month was one artist (pyxorium.com) uploading a 379-track back catalog —
  checked in the DB before annotating, because the first guess ("the continuous
  publisher") was wrong.
- last 30 days, from the Cloudflare edge and Logfire: 564k edge requests, 184 GB served,
  ~74% of bytes from cache; peak 1,599 unique visitors/day (avg ~899) against 90 distinct
  signed-in users; 109 5xx (~0.05%). A 96k-request burst (Jul 19) and a 4,278-threat bot
  swarm from one NL source (Aug 4) were both absorbed at the edge; the app saw neither.

**what measuring revealed**: **plays over time is historically unknowable.** `play_count`
is a counter on the track row, not an event stream, so the only trend window is Logfire's
14-day retention on `/tracks/{id}/play` — ~73 plays/day, flat, and not comparable to the
~48/day lifetime average because radio plays only started counting on July 1 (#1622). A
real curve needs a play-events table or a daily snapshot of `/stats` whose deltas become
the series; deliberately not built, since it is new surface. The honest read on the rest
is accumulation, not acceleration.

#### /atlas — a 2D semantic map of the catalog (#1766–#1768, August 4)

**why**: discovery has been lists all the way down — feeds, tags, radio. But every public
track already has a 512-dim CLAP embedding in turbopuffer for mood search, which is
exactly the input a spatial surface needs. `/atlas` (unlisted, noindex) puts the catalog
on a pan/zoom canvas positioned by how tracks *sound*, adapted from pub-search's atlas,
which pioneered the pipeline and the renderer.

**what shipped**:
- `scripts/build_atlas.py` (standalone uv script): eligibility mirrors the radio corpus —
  public/supporters, ungated, active artist, no adult-audio or copyright label —
  replicated in raw SQL against the projected label columns, because an anonymous
  chosen-for-you surface should follow radio's rules. Vectors export from turbopuffer,
  then PCA→50, UMAP→2D for display, and a **separate** UMAP→10D for HDBSCAN.
- two cluster tiers, named by c-TF-IDF over titles and tags of core members, refined into
  2–4 word region names by claude haiku (keyword fallback with no API key).
- daily rebuild via `.github/workflows/build-atlas.yml` → `atlas.json` in the stats
  bucket, proxied by a new `GET /stats/atlas` exactly like `/stats/costs`. The pub-search
  lesson is that a static map fossilizes.
- canvas 2D renderer: sprite-stamped points over a spatial grid index, gaussian nebulae
  per cluster, and one shared label-collision economy in priority order (regions → fine
  clusters → track titles by plays+likes → artist handles). Semantic zoom ends at actual
  cover art, drawn flat — the #1756 rule holds. Click a track and the normal footer
  player takes it; artists with 2+ tracks are avatar circles at their catalog centroid.
- two follow-ups: the first CI dispatch failed because `NEON_DATABASE_URL_PRD` is in
  sqlalchemy form and psycopg rejects it (#1767), and review on prod produced bigger
  sprites plus artist circles visible from the whole-map view under a zoom-scaled cap, so
  one dominant catalog can't own the overview (#1768).

**technical notes**: clustering runs on the 10D projection rather than the 2D display,
because clustering the display projection turns its artifacts into cluster boundaries
(measured in pub-search: the fine tier scored worse than chance in 2D). PCA is float64 —
randomized SVD overflows in float32 at these magnitudes. Live payload as of August 5: 921
points, 13 coarse regions, 61 fine clusters, 44 artist circles; tier granularity is
`n//60` / `n//160`, so it drifts as the catalog grows and relabels daily. Deferred on
purpose: a nav link, a live-radio overlay, the atlas as a PDS blob, deep links, on-map
search, and pub-search's WebGL rotating-planet layer.

#### public audio is analyzed, and derived data is published (#1769, August 4)

the atlas crossed a line the legal pages hadn't. Everyone whose tracks sit in the vector
store had accepted the Feb 2026 terms — the embedding pipeline and version-aware
re-acceptance shipped together in #848 — but the atlas publishes embedding-*derived* data
about the whole public catalog to anonymous visitors, with no per-artist ask. That stance
is now written down instead of implied: terms §2 states that public content is analyzed
automatically (embeddings, genre classification, copyright fingerprinting, aggregate
catalog views) and that derived data (similarity coordinates, suggested genres, cluster
labels) may be publicly visible; privacy §3 says the same from the data-use side.
`terms_last_updated` moved to 2026-08-04, so existing users are re-prompted — consent to
the new state is collected, not assumed. Deliberately unchanged: auto-tag stays opt-in per
upload, because writing tags to your track is mutation consent; and the jetstream
known-DID ingest gate stays, since opening ingest beyond signed-in artists is a separate
product decision.

#### embeds die in sandboxed iframes (#1770, August 4)

**why**: a radio embed nested inside a sandboxed iframe (a Leaflet document, in the
report) never hydrated — it sat frozen on its SSR'd "tuning…" state. An iframe sandboxed
without `allow-same-origin` gets an opaque origin, where merely *accessing*
`window.localStorage` throws `SecurityError` — which `typeof localStorage !== 'undefined'`
and `browser` guards don't catch. `jam.svelte.ts` touched `sessionStorage` in a
module-level singleton constructor, so the whole bundle threw at import time and hydration
never ran.

**what shipped**: `safe-storage.ts` wraps both storages with every access — including the
property access itself — in try/catch (the MDN idiom), and every call site in the root
layout and the state modules it imports was swapped; the inline flash-prevention script in
`<svelte:head>`, which can't import, got a local shim. Backend CORS now accepts the
literal `Origin: null` those iframes send, without which the embed hydrates and every
fetch is blocked. That loosens nothing: prod and staging already allow any https origin,
and session cookies are HttpOnly and scoped to plyr.fm. No in-memory persistence
fallback — an embed not remembering preferences is correct behavior for an embed.

#### counting users from the network instead of the database (#1761, August 4)

`scripts/users_over_time.py` counts plyr.fm users straight from atproto: every signed-in
user gets an `fm.plyr.actor.profile` record in their own PDS, so `listReposByCollection`
on lightrail → slingshot `resolveMiniDoc` → each PDS's `getRecord` yields a `createdAt`
per user and a cumulative plotext curve in the terminal, with no database and no
credentials. 351 repos held the collection at the time, fewer than the `artists` table,
because the record's `createdAt` is when the *record* was written — users predating the
profile upsert are time-shifted or absent. That gap is documented in the module docstring
rather than smoothed over: it is the atproto-native number.

#### learning from sister-radio, and what we kept (#1752–#1756, August 3)

**why**: [sister-radio](https://tangled.org/okami.mom/sister-radio) (the radio behind
radio.wisp.place, which `/radio` already credits) does several things on its listener page
worth adopting. #1752 tracks the full list; the first slice shipped — and half of it was
then deliberately removed.

**what shipped**:
- an ambient wash derived from the on-air artwork (#1753): accent colors sampled from the
  cover drive a page-level glow, plus a `theme-color` tint for mobile chrome.
  **currently inert in production** — the images hosts send no
  `Access-Control-Allow-Origin`, so the canvas sampling fails closed and the page keeps
  its neutral look until a CORS header is added (held for an infra sign-off).
- long track titles marquee via the existing `ScrollingText` instead of clamping.
- layout repairs the work surfaced (#1754, #1755): the rotation deck no longer pins to the
  viewport bottom with a dead band above it, the station title is two deliberate rows, and
  a short viewport can no longer compress the station column under the deck.
- `/radio` fits its viewport with **no vertical scrolling** (#1756): the artwork is the
  page's one flexible element, sized from the space left after the fixed chrome.

**decisions** (both standing rules now): the CRT treatment shipped in #1753 and was
removed in #1756 — it drew on top of artists' cover art, which is the artist's intentional
presentation, never the platform's to decorate; effects derived *from* the art are fine,
effects *over* it are not. And `/radio` is an appliance, not a document: if space runs
short, content scales — scrolling is not the fallback.

#### three player bugs, one disease (#1757, #1759, #1762, August 3–4)

**why**: toggling radio tune-in/stop with tracks in the queue made the player "eagerly
consume and skip" through up-next; separately, switching stations while tuned in could
leave the radio on-air but silent. all three bugs were work outliving the load it
belonged to, on the one shared `<audio>` element.

**what shipped**:
- #1757: `playRadio`'s station-position seek waited on `loadedmetadata` via a bare handler
  that was never removed — after stopping radio, the *queue track* that re-attached got
  seeked to `min(station position, duration)` = its own end, fired `ended`, advanced, and
  repeated: the queue eaten one track per boundary, with a spurious play count each time.
  Also fixed there: radio's clock was overwriting the listener's saved queue position, and
  stopping radio autoplayed the queue — stop now re-stages it paused where it was.
- #1759: the #1757 restage ran before the jam sync branch and stranded jam
  participants paused when radio released the player; jam keeps its pre-#1757 behavior.
- #1762: a rapid station flip supersedes a load before its `play()` settles, and the
  dead load's rejection (`AbortError`) ran an unguarded catch that paused the *new*
  station — on-air, silent, footer showing play. rejections now bail unless their load
  still owns the element.

**technical notes**: the pattern (stale handler, stale clock, stale rejection) is
structural, and `docs/research/2026-08-03-player-architecture.md` (#1758) writes up why
it recurs and what nine mature players do instead — see current focus. jam remains the
least-exercised mode with no automated coverage.

#### the radio switched tracks mid-song, by design (#1760, August 4)

**why**: multiple listeners reported the radio randomly changing track deep into long
songs. Two server-side discontinuities: the rotation cache TTL was 60s while the sampler's
ranking reads live signals, so a rebuild could reshuffle the loop **any minute** and
teleport `epoch % loop` mid-song; and the 4h period reseed replaced the loop wholesale at
an arbitrary offset — a 64-minute mix has a ~27% chance of straddling any given boundary,
which is why long tracks were the victims.

**what shipped**: rotations are pinned for their entire period (the first build IS the
rotation; the TTL setting is now just a kill switch), and period handovers land on
track boundaries: the first request of a new period pins an anchor (redis `SET NX`, so
every instance serves the same clock) at the moment the previous period's in-flight
track ends, computed from the *cached* previous rotation — a peek, never a rebuild,
because only what actually aired can hand over. during the grace window the old
rotation finishes its track while `up_next` advertises the new rotation's head, so the
client's natural ended→next flow rolls straight into the new period.

**technical notes**: `/radio/state` determinism is now anchored in the shared cache
rather than being a pure function of the clock; without redis it degrades to a clean
track start at each period boundary — never a mid-song landing. rotation metadata
(play/like counts in the payload) is now up to 4h stale; the per-request `liked`
overlay stays fresh.

**verified against a real boundary** (staging, 08:00 UTC, August 4): the in-flight track
played through the boundary and ended naturally at 08:00:05, the new rotation started at
track 0 at that instant, and 12 minutes of 30s sampling recorded zero mid-song switches.
The watcher initially flagged a false violation by diffing two stale snapshots — a check
on a shared clock has to re-derive what *should* be playing at the later instant.

#### the tag selection stays put (#1763, August 4)

the homepage tag row was one flat scroller, so browsing carried the clear chip and the
selection itself out of view — and a selection restored from a previous session that
wasn't in the fetched top-15 was invisible and undismissable. The active selection is now
pinned left, always visible and individually deselectable, rendered from the selection
itself rather than the fetched list; unselected tags scroll in the space that's left.

### July 2026

See `.status_history/2026-07.md` for detailed history: the live station that was on
air and silent (#1749, #1750); radio growing a live source with the `firehose`
station modelled as preemption (#1741–#1746); the firehose promising neither order
nor delivery (#1736, #1739, #1740); the staged-cleanup deletions of published audio
(#1732–#1735, #1737); artist spacing in the rotation (#1730); what an `#account`
event actually says and the identity task that never ran (#1725–#1729); label reach
and operational hygiene (#1709–#1718); and the July 1–25 moderation arc (#1620–#1706).

### June 2026

See `.status_history/2026-06.md` for detailed history (firehose dead-audioUrl verification #1616; copyright flags no longer silently wiped #1615; status-recap transcript #1613; client-logo keyline #1608/#1609; CF Pages lockfile incident #1606/#1607; live-infra costs feed #1599 + jetstream identity propagation #1603/#1604; ALAC-in-m4a transcode + radio/embed autoplay hardening #1596/#1597/#1598; local-dev fresh-DB onboarding #1584–#1586 + collections/design-system refactor #1579–#1591; the permissioned-data member-list pivot #1573/#1574; the June 10 prod release `2026.0610.034454`; radio embed station switching #1571; lexicon docs #1569; the private-media probe #1557→#1567; and the radio-stations + tuner-dial cluster #1530→#1548).

### November 2025 – May 2026

See `.status_history/` for detailed history, one file per month:
`2026-05.md`, `2026-04.md`, `2026-03.md`, `2026-02.md`, `2026-01.md`,
`2025-12.md`, `2025-11.md`.

## priorities

### current focus

**the catalog has a spatial surface** (#1766–#1768, August 4): `/atlas` is an unlisted pan/zoom map of every public track, positioned by CLAP-embedding similarity, with haiku-named regions, cover art at deep zoom, and click-to-play through the normal footer player. Rebuilt daily by a GitHub Actions workflow into the stats bucket and proxied at `GET /stats/atlas`. The legal pages were updated in the same window to say plainly that public audio is analyzed and that derived data may be published (#1769), with `terms_last_updated` bumped so existing users are re-prompted. **next in this arc**: a live-radio overlay, deep links, on-map search, and the question of whether the atlas should exist as an ATProto artifact rather than only a page — all deliberately out of v1.

**the player's structural problem is now written down** (#1757–#1762, August 3–4, plus `docs/research/2026-08-03-player-architecture.md`): four bugs in two days — a queue eaten by a stale seek handler, a jam left paused, a station on air and silent after a rapid flip, and server-side rotations teleporting mid-song — were all the same shape: work outliving the load it belonged to on one shared `<audio>` element, or a rotation rebuilt underneath a listener. 22 writers to `player.paused` across 4 files, mode as three unrelated flags, coordination by effect ordering. The research note surveys nine mature players (MPD, mpv, ExoPlayer, AVFoundation, vidstack, shaka, hls.js, feishin, jellyfin-web), which converge on single-funnel element ownership, per-load lifecycles, and explicit mode. **next in this arc**: load-session scoping, the first of five proposed adoptions; and any automated coverage at all for jam, which remains the least-exercised mode.

**radio has a live source** (#1741–#1750, July 30–31 — prod `2026.0730.225420`): the `firehose` station airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* of the rotation rather than an entry in it — the loop's position is derived from wall-clock time, and an unbounded broadcast inside it would dissolve that. A broadcast carries its own cover and credits its source, a negative liveness report gets a second opinion from the playlist, and the broadcaster is CDN-fronted so 1000 listeners cost its origin ~5 req/s instead of ~255. It then spent a day on air and silent (#1749, #1750): the tune-in path trusted `canPlayType`, which lies in Chrome, and then awaited a module import inside the tap handler, which spends mobile's autoplay permission. **next in this arc**: the station has no recorded fallback while its segments stay unlisted (see known issues); opening preemption to other broadcasters is gated on moderation, since live audio cannot be fingerprinted before it airs.

**the firehose promises neither order nor delivery, and bytes need owners** (#1732–#1740, July 30 — prod `2026.0730.072900`, `.181756`): a repo's commit history was re-emitted upstream and ingest applied each replayed state as current, so commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` cannot; then the same instance stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so the consumer now rotates across twelve hosts and detects a host gone blind on *our* collections specifically. Separately, staged-upload cleanup had been deleting published tracks' audio — a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from. 20 tracks across 7 artists broken, 13 recovered; playback now falls back to the artist's PDS blob and the refcount covers every media column. **next in this arc**: an alert, because none of this pages anyone; schedule `audit_media_integrity.py`; give `_MEDIA_REFERENCES` awareness of `r2_url`.

**moderation: from inert labels to recorded decisions** (#1691–#1718, July 24–27 — prod `2026.0725.035625` → `2026.0728.043224`): `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; `LabelContext.LIST` vs `VIEW` keeps labels shaping discovery rather than destinations; and underneath all of it `moderation_events` carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. Published contact is now `help@plyr.fm` / `dmca@plyr.fm`, and rate limits are keyed per client rather than per site (#1716, #1718). **next in this arc**: triage the 13 queued tracks; per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves. The DMCA surface itself is still incomplete (see known issues).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements this experimental surface). The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**identity, discovery and the queue** (#1620–#1730, July): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person — fixed at three levels, and the identity task that maintains the PDS cache is now actually registered with the worker (it had never run in production). The radio no longer plays one artist back-to-back (#1730). An experimental subsonic `/rest` shim lets off-the-shelf clients (Symfonium, Amperfy, Shelv) play plyr libraries with a developer token as the password (#1644–#1651); collection continuity queues the rest of an album or playlist as a labeled "next from" context (#1626); repeat-one shipped (#1653/#1654/#1657), reviving @AilaScott's #1518, with repeat-all deferred until the loop-vs-continuation interaction is designed.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **nothing records listening over time** (August 5 accounting): `play_count` is a counter on the track row, so plays-per-day exists only inside Logfire's 14-day retention and the history before that is unrecoverable. Every day without an append-only play-events table (or a daily `/stats` snapshot) is another day of curve we cannot draw later. Deliberately not built yet — it is new surface, and the shape of it is undecided.
- **the artwork accent wash is inert in production** (#1753): the images hosts send no `Access-Control-Allow-Origin`, so canvas sampling fails closed and `/radio` keeps its neutral look. A one-header infra change, held for sign-off.
- **nothing alerts a human when firehose ingest goes quiet** (#1739): the 11-hour blackout produced no page and was found only because a publisher's tracks looked wrong. #1740 makes the consumer heal itself and logs a warning when it rotates away from a blind host, but that is a breadcrumb, not an alarm. A Logfire alert on "zero `fm.plyr.*` dispatches in N minutes" is the missing piece, and the most valuable thing left from this window.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **a failed radio play retries forever** (#1750): while the mobile tune-in was broken, the console logged `playback failed: AbortError` on a loop rather than once — something retries a failed radio `play()` indefinitely. Harmless now that playback works, which is exactly why it is worth writing down: it turned a single failure into continuous noise and would do so again for any future playback fault.
- **live radio is verified under WebKit emulation, not on a phone** (#1750): Playwright's WebKit with iPhone emulation reports `ManagedMediaSource`, so the iOS code path is genuine, but it is neither Mobile Safari nor Android Chrome. Playwright's bundled Chromium is worse for this — it decodes raw HLS natively, so it cannot reproduce the desktop failure at all. Live playback has no automated coverage on a real mobile browser.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 3 of 997 tracks have a rev so far; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **13 tracks await triage in the review queue**, including track 64 (user report #5 from @vicwalker.dev.br). They are visible and playable in the dashboard now; nobody has made a call on any of them. A fingerprint match is not a finding — several read as covers or remixes the uploader performed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
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
- ✅ repeat-one on the player + queue sidebar toggle
- ✅ experimental subsonic-compatible surface at `/rest` (developer token as password)
- ✅ "keep playing" — opt-in continuous playback from the For You feed when the queue runs dry ("next from: for you")
- ✅ queue items with artwork thumbnails + right-side drag-to-reorder (desktop + touch)
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ moderation on signed ATProto labels — copyright de-listing, adult-audio
  preferences, creator self-labels, an append-only `moderation_events` log
  behind the dashboard queue, and public decision posts from @moderation.plyr.fm
- ✅ display-sized artwork renditions from the Cloudflare edge
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
- ✅ composite covers from member-track artwork when no explicit cover is set
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

current monthly costs: ~$68/month (plyr.fm specific) — the live `/costs` feed is the source of truth (#1599); the breakdown below is indicative, not hardcoded. `COSTS.md` is the human-readable audit.

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis ×2 + transcoder + moderation): the largest line; the prior ~$24 figure omitted both redis apps
- neon postgres: ~$5/month (moderation endpoint now autoscales 0.25–1 CU + scale-to-zero, was pinned always-on 1 CU)
- cloudflare (R2 + pages + domain): live feed reads $0 until CF is tagged `project=="plyr.fm"` upstream
- copyright scanning (AuDD): ~$5-10/month (computed from our own DB)
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

this is a living document. last updated 2026-08-05 (**status maintenance for the July 31 – August 5 window**. Archived the whole July detail block to `.status_history/2026-07.md`, taking STATUS.md from 630 lines to ~445. Documented the four things that had shipped since the last maintenance run and never been recorded here: **`/atlas`** (#1766–#1768), an unlisted 2D map of the catalog positioned by CLAP-embedding similarity — PCA→UMAP for display, a *separate* 10D UMAP for clustering, haiku-named regions, daily rebuild into the stats bucket behind `GET /stats/atlas`; the **legal codification** that public audio is analyzed and derived data may be published (#1769), with `terms_last_updated` bumped so consent is collected rather than assumed; **embeds surviving sandboxed iframes** (#1770), where merely *accessing* `localStorage` in an opaque origin throws and killed hydration at import time, plus `Origin: null` CORS; and **`users_over_time.py`** (#1761), which counts users from atproto records rather than the database. Also recorded the **502-follower milestone and the first full usage accounting** — 999 tracks / 121 hours from 97 artists, 442 accounts, 13,384 plays, 564k edge requests in 30 days — and the measurement gap it exposed: plays are a counter, not events, so the history is unknowable. Retired two known issues verified fixed against reality (private-media `loadComments` already sends `credentials`; track 1045's CDN URL now serves 206 with bytes) and added two new ones (nothing records listening over time; the artwork wash is inert pending a CORS header). Rewrote current focus around the atlas and the player-architecture arc. Recorded the podcast recap for July 31 – August 5.) previously 2026-08-04 (**the handover, observed**. Appended live verification to the #1760 entry: at the first real 4h boundary on the fixed code, the in-flight track played through the boundary and ended naturally, the new rotation started at track 0 at that instant, and 12 minutes of sampling recorded zero mid-song switches.) previously 2026-08-04 (**a radio day**. Adopted the first slice of sister-radio's listener-page ideas (#1752–#1756) and two standing rules out of it: never draw on artists' cover art, and `/radio` never scrolls vertically. Fixed three player bugs that were all stale work outliving its load on the shared audio element (#1757, #1759, #1762), wrote up the class in `docs/research/2026-08-03-player-architecture.md` (#1758), fixed the server-side mid-song track switches (#1760), and pinned the homepage tag selection (#1763).) previously 2026-07-31 (**the live station was on air and silent** — #1749/#1750: `canPlayType` lies in Chrome, and an `await` inside a tap handler spends mobile's autoplay permission). previously 2026-07-31 (**status maintenance for the July 25–31 window**, and the staged-cleanup audio deletions #1732–#1735/#1737). earlier entries are preserved in `.status_history/2026-07.md`.
