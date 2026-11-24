# cutting plyr.fm over to next

## 0. gap audit, 2026-11-23 (read this first)

> copied into the repo 2026-11-24 as part of the handoff; see [README.md](README.md)
> for what changed since. where this file and the sections below disagree,
> section 0 and [flip-day.md](flip-day.md) are current.

**status, 2026-11-23 18:55 UTC** (flip steps: [flip-day.md](flip-day.md))
- M1 done: next calls no prod python api (#2949). iOS stops once the next OTA ships.
- M2 done: `/audio/{file_id}` and `/tracks/{id}` answered by the zig api (#2958).
- M3 done: ingester back up (#2959/#2960), heartbeat span (#2953). logfire alerts "next ingester silent or behind", "next api 5xx", "next workers logging errors" go to discord + phi.
- M4/M5 done: /terms, /privacy, robots, sitemap, manifest, old-page 301s (#2956). llms.txt still prod-api-shaped; rewrite with docs later.
- D7 done: atlas built in next (pgvector + daily workflow) #2952, getAtlas serving.
- cover checks call Claude directly (#2962).
- D3 done: osprey calls AuDD directly (#2984, secret set by nate, direct-pds scan verified). plyr-moderation's `/scan` has no next caller; next stopped pulling prod's labels (#2987). retire plyr-moderation at teardown.
- D2: gated legacy tracks stay unplayable on next for everyone (non-owners already 401). next must never read prod, so no bucket binding (#2982 closed). artists re-upload/re-close with next policies.
- N3 done: EXPO_TOKEN set; `next-ota.yml` (#2978/#2985) publishes iOS OTAs on merge. first: group b660394a on build 55's runtime.
- pre-flip: next api, jams, audio worker accept `https://plyr.fm` origin (#2977).
- M6 done: next indexes 1368 of prod's 1389 tracks (was 1298). #2970 keeps tracks whose PDS blob is oversize/video when audioUrl plays them; #2972 re-projected every repo. left: 7 on an unreachable PDS (rose.madebydanny.uk), 5 gone from their PDS, 2 records next's schema rejects, 4 missing covers, 3 prod rows with malformed space uris. `next catalog diff` runs daily.

re-surveyed after two days of shipping. selling music stays punted. one forced
re-sign-in at the flip is accepted. everything below is checked against main at
`0fdcf2d` and logfire, not carried over from the 11-21 survey.

**already closed since 11-21:** radio on zig (#2840–#2847), link preview cards +
oembed + old album/playlist link redirects (#2838/#2841/#2843), prod play counts
imported (#2850/#2852), not-found pages, measured durations (#2890), originals on
PDS (#2920), public CORS (#2922).

### must land before the flip

next-only (threads can ship these under standing approval):

| # | gap | evidence | work |
|---|---|---|---|
| M1 | **next still calls prod python in four places** | `api.plyr.fm` in `web/src/lib/embed/catalog.ts` (numeric track, legacy album, legacy playlist embeds), `app/src/Login.tsx` (iOS sign-in preview + PDS picker: `/auth/sign-in-preview`, `/auth/pds-options`), `app/src/radio-track.ts` (numeric radio ids), `web/src/lib/atlas/catalog.ts` (`/stats/atlas`) | embeds: use `getTrack?legacyId` + the edge's legacy redirects. iOS sign-in: serve preview + pds options from next (zig or client-side resolve). radio-track: next radio returns record ids, drop the numeric path. atlas: see D7 |
| M2 | **`api.plyr.fm` compat surface on zig** | only `/oembed` (redirect) and `/radio/*` are answered. `/audio/{id}` (gated prod records point there) and `/tracks/{id}` (third-party embeds, radio adapter) are not | add both, backed by `legacy_track_links`; `/audio/{id}` public → 301 to `audio.plyr.fm`, gated → per D2 |
| M3 | **no monitoring on next at all** | all 4 logfire alerts watch prod python. next's ingester logged ~1k errors/day unnoticed (IntWontFit on backoff writes; fixed in #2946) and logs no heartbeat, so "ingester dead" is invisible | ingester heartbeat log; alerts for ingester silent, api 5xx, upload/processing failures, radio dead air, to the same discord + phi channels prod uses |
| M4 | **terms + privacy + crawl basics** | next has no `/terms` `/privacy` routes (docs exist in `next/docs/legal/`), no `robots.txt`, `sitemap.xml`, `manifest.webmanifest` or `llms.txt` (prod has all) | pages from `docs/legal`, a "by signing in you agree to the terms" line on sign-in (rec, instead of prod's blocking accept step), plus the static crawl files and a sitemap from the edge worker |
| M5 | **old prod routes 404** | prod pages with no next route: `/u/{h}/liked`, `/for-you`, `/activity`, `/costs`, `/record`, `/at/…`, `/profile/setup`, `/terms`, `/privacy` | redirect each to its nearest next page (liked → artist page, for-you → home, profile/setup → edit-profile, costs → hub feed …) |
| M6 | **catalog reconcile** | 82 prod tracks with plays still not indexed on next (11-21), some legacy tracks lack artwork on next | diff by record uri against a read-only prod snapshot, explain each; re-run `next import legacy plays` after prod freezes; re-snapshot legacy playlists |

needs nate (decision, secret, account, or prod):

| # | item | one recommended option |
|---|---|---|
| D2 | prod supporter-gated tracks | owner-only on next, artists re-close with next policies |
| D3 | copyright scans | move the AuDD call into osprey, retire `plyr-moderation` |
| D7 | atlas data | copy CLAP vectors into next's neon (pgvector), keep modal for new uploads, drop turbopuffer |
| N1 | neon: next's db is a branch of the staging project | promote it to its own project before teardown (vendors thread) |
| N2 | iOS release: native build with scheme `fm.plyr` + `SITE_URL=plyr.fm`, App Store submission (screenshots, privacy label, demo account) | submit for review before the web flip; needs your mac + ASC metadata |
| N3 | OTA from CI | **done**: `EXPO_TOKEN` set, `next-ota.yml` publishes OTAs on merge |
| N4 | labeler identity | PLC op putting next's label key + endpoint on `moderation.plyr.fm`'s DID (needs its rotation key); stop `label_sync` pulling from prod |
| N5 | flip day | DNS, `SITE_URL`, deploy `plyr-radio` at the #2848 pin with `PLYR_PRESENCE=off`, prod freeze, announcement |

### can follow the flip

artist analytics (slim), remove-my-data / export, account deletion, plyrfm SDK +
MCP on XRPC (note: the weekly status podcast and `upload-audio.yml` upload with a
prod dev token and will break), docs site copy (`next/docs`, nate rewriting),
copyright/upload-stall DMs to nate (prod's bot), for-you, subsonic, activity feed.

### not gaps
emails (prod sends none), payments (punted), android (stays `fm.plyr.next`).

---
## the 11-21 plan (still the reference for costs, data, dns, sequence)

2026-11-21. read-only survey: nothing in prod or next was changed.

**the short version.** next can become plyr.fm once five things land: radio stops
reading the python backend, the legacy compatibility routes (old `/audio/{id}`
links, oembed, link-preview cards) are served by next, ToS acceptance is ported, the
catalog and play counts are reconciled against prod, and the next database moves
out from under the staging project. everything else either already exists on next
or is small enough to drop. selling music stays punted (the phase-0 buy/support
links already shipped are what we launch with).

running cost goes from **~$165/mo** (both stacks, today, measured 2026-11-23) to
**~$55–70/mo** (next only). neon is now measured, not guessed: ~$81/mo, because
all three databases run 24/7. full vendor inventory and the measured numbers are in
[vendors.md](vendors.md); the tables below are the 11-21 estimates, corrected where
noted.

---

## 1. what it costs, before and after

> **2026-11-23 refresh** (see [vendors.md](vendors.md)): neon measured from the
> consumption api, 10-23 → 11-23: `plyr-prd` ~$38 (0.5 CU 24/7), `plyr-moderation`
> ~$19 (0.25 CU 24/7 since 11-13, prod's polling keeps it awake), next's branch
> ~$23, egress ~$3. modal was $16.76 over the window and is now ~$0.10/day.
> **correction:** next has no embeddings and no CLAP cron; the atlas still comes
> from prod's db + turbopuffer. rows below that say otherwise are wrong (decision 7).

sources:
- **feed**: hub.waow.tech cost snapshot generated 2026-11-20 08:00 UTC, window
  10-21 → 11-20. fly = july list prices × measured 7-day uptime; r2 = stored GB.
  these are measured-usage estimates, not invoices.
- **logfire**: plyr-fm project, 11-07 → 11-21 (14 days).
- **est**: my estimate, basis given.
- **?**: couldn't reach it. neon console wasn't signed in in the browser, and the
  feed reports no amount for neon, modal, replicate, turbopuffer, logfire.

### today (both stacks running)

| line | $/mo | basis | after cutover |
|---|---:|---|---|
| fly `relay-api` (prod api + worker + jetstream; 2GB + 2×1GB at 100%) | 22.98 | feed | **retire** |
| fly `plyr-transcoder` (1GB, up 80%) | 4.76 | feed | **retire** (next has `plyr-next-processing`) |
| fly `plyr-redis` (docket) + vol + snaps | 2.22 | feed | **retire** |
| fly `relay-api-staging` | 1.27 | feed | **retire** |
| fly `plyr-redis-stg` + vol + snaps | 2.19 | feed | **retire** |
| fly `plyr-transcoder-staging` | 0.06 | feed | **retire** |
| fly `plyr-moderation` (rust labeler + AuDD `/scan`, 256MB) | 2.02 | feed | keep *or* retire, see decision 3 |
| fly `plyr-radio` (sister-radio adapter, 512MB + vol) | 4.30 | feed | keep (repoint at next) |
| fly `plyr-api-zig-canary` (next api 256MB + ingester 2x/1GB + 256MB) | 12.74 | feed | keep |
| fly `plyr-next-processing` (1GB, always on) | 5.92 | feed | keep (could auto-stop) |
| fly `plyr-jams-next` (2×256MB) | 4.04 | feed | keep |
| fly `plyr-redis-jams-next` + vol + snaps | 2.18 | feed | keep |
| fly `plyr-redis-next` | 2.02 | feed | keep, or fold into jams redis (−2.02) |
| r2 `audio-prod` 43.6 GB, `images-prod` 0.7 GB | 0.65 | feed | **keep forever** (every legacy track's audio lives here) |
| r2 `audio-private-prod` 13 GB | 0.19 | feed | keep until gated tracks are resolved (decision 2) |
| r2 `audio-private-staging` 46.7 GB (!) + `audio-staging` 1 GB | 0.71 | feed | **delete** after cutover |
| r2 `plyr-next-audio` 8.4 GB | 0.12 | feed | keep |
| domain plyr.fm | 1.00 | feed | keep |
| neon `plyr-prd` (0.25–2 CU, autosuspend off) | ~38 | est: june's ~360 CU-h/mo × $0.106 | **freeze** → scale-to-zero, ~0 compute |
| neon `plyr-stg` main branch | ~10–19 | est: june 180 CU-h; staging went on-demand in oct, so likely lower | **drop** (but see step 0: next lives in this project) |
| neon next branch (`next-zig` on plyr-stg, 0.25–1 CU, autosuspend off) | ~19 | est: measured 6.06 CU-h/day on nov 3–4 | keep; grows with prod traffic |
| neon `plyr-moderation`, `plyr-dev` | ~1–3 | est: both scale to zero | drop / drop |
| AuDD | 5.00 | measured in june (base fee, under free reqs) | keep or drop, decision 3 |
| turbopuffer (vibe search + atlas build) | ? | feed: not collected | **drop** (next does recs in neon pgvector) |
| modal CLAP, replicate genres, anthropic (atlas labels) | ~0–2 ? | june doc: free tier / pennies, unverified | drop prod paths; next's CLAP runs in GH Actions |
| logfire, cloudflare workers (space-stream, next audio worker), apple dev ($8.25/mo) | ? / shared | not plyr-attributed | unchanged |
| **total** | **~$150** | fly 66.70 measured-est + r2/domain 2.67 + neon ~70–80 est + AuDD 5 | |

### after (recommended retirement set)

| | $/mo |
|---|---:|
| fly next stack (api+ingester, processing, jams ×2, two redis) | 26.90 |
| fly `plyr-radio` | 4.30 |
| fly `plyr-moderation` (only if we keep AuDD via it) | 0–2.02 |
| room for a second api machine once prod traffic lands (est, 256MB) | ~2 |
| r2 + domain | ~1.96 |
| neon next db (today's measured ~19, padded for prod traffic) | ~20–30 est |
| AuDD | 0–5 |
| **total** | **~$55–70** |

notes:
- the saving is mostly `relay-api` (~$23) and neon prod/staging compute
  (~$50, estimated). **the neon number is the one to verify**: open the neon
  billing page for org `nate` and read the last invoice. if `plyr-prd` already
  scales to zero the saving is smaller.
- easy extras if wanted: fold `plyr-redis-next` into the jams redis (−$2),
  let `plyr-next-processing` auto-stop like the old transcoder did (−~$4, costs a
  cold start on the first upload after idle).
- prod traffic is small: 14 days of logfire show ~410k prod spans vs ~6.5k on next,
  642 play posts, 35 uploads, 55 sign-ins, and the single biggest route is radio
  listener polling (56k calls). next's api on one warm 256MB machine is very
  likely fine; a second machine is for redundancy, not load.

---

## 2. outcomes: what prod does vs what next covers

usage figures are logfire counts of top-level prod requests over the 14 days
11-07 → 11-21.

### already covered on next (no work)
browse, track/album/artist/playlist pages, playback, queue, jams, likes,
comments (opt-in), tags, search, upload with lossless processing, edit/delete,
portal, downloads, who-can-listen policies, phase-0 buy/support links,
people-you-know, queue suggestions, chapter wheel, settings, multi-account,
teal scrobble/status, in-app notifications, embeds (`/embed/*`, numeric legacy
ids resolved via `legacy_track_links`), stats page, moderation queue + reports +
own labeler + osprey, iOS app.

### must fix before cutover (blockers)

| gap | prod usage | why it blocks | work |
|---|---|---|---|
| **radio runs on prod python** | radio listeners 56k, state 11k, stations 1.7k (the busiest feature) | next's radio UI and the `plyr-radio` adapter both call `api.plyr.fm/radio/state`; turn off `relay-api` and radio goes silent. the "loved/fresh/deep-cuts/slop" samplers, presence counts and firehose live probe are ~1.5k lines in `backend/api/radio/` | **done on next 2026-11-21** (#2840/#2844/#2846/#2847; presence not ported). left for the flip: deploy `plyr-radio` at the #2848 pin with `PLYR_PRESENCE=off`; the reconcile must import prod's track durations, since tracks without one stay off the air |
| **legacy audio + api urls** | `/audio/{file_id}` 2k, `/tracks/{id}` 18k (mostly prod web + embeds + the radio adapter) | gated prod tracks write `audioUrl = api.plyr.fm/audio/{id}` into their PDS records, and third-party embeds/clients hit `api.plyr.fm/tracks/{id}` | serve a small compat surface from the zig api on `api.plyr.fm`: `/audio/{id}` (public → redirect to `audio.plyr.fm`, gated → per decision 2), `/tracks/{id}` read, `/oembed`, `/stats/atlas`. everything else 404s cleanly |
| **link preview cards** | `/oembed` 196 + every bluesky share | next web is a static SPA (`adapter-static`), so a plyr.fm link pasted into bluesky gets no title/art card. prod's SvelteKit SSR renders OG tags | a cloudflare pages function (or worker) that injects OG/twitter meta for `/track`, `/u`, `/album`, `/playlist`, `/jam` and serves `/oembed`, reading the zig api |
| **terms acceptance** | `/account/accept-terms` 16 | prod gates first use on accepting terms; next has the docs (`next/docs/legal/`) but no accept step | accept-terms on first sign-in (store in account preferences), `/terms` + `/privacy` routes or redirects to docs |
| **atlas reads prod** | `/stats/atlas` 339 | next's atlas page fetches `api.plyr.fm/stats/atlas`; `build-atlas.yml` builds it daily from the prod DB + turbopuffer | rebuild atlas from next's neon (pgvector) in the GH Actions cron; serve from next |
| **catalog + play-count reconcile** | — | prod says 1,386 tracks / 128 artists / 218 h / 19,683 plays. next says 1,298 / 113 / 147 h / 436 plays. play counts in next were seeded from *staging's* `public.tracks`, not prod | diff prod vs next by record uri; explain each missing track (private, owner-only, dead PDS, missing duration); re-import prod `play_count` as `legacy_import`; refresh `legacy_track_links` + unlisted snapshot per `next/backend/docs/legacy-track-links.md` |

### small gaps, fine to drop or do later

| prod feature | 14-day usage | recommendation |
|---|---:|---|
| artist analytics page | 315 | **port a slim version after cutover** (plays per track over time from next's receipts). artists do look at it |
| for you page | 258 | drop; queue suggestions + people-you-know cover it |
| oembed | 196 | covered by the link-preview work above |
| share links with ref-code attribution | 28 shares, 72 clicks | drop attribution; plain links keep working |
| developer tokens | 19 | drop; breaks the plyrfm python SDK/MCP (decision 5) |
| subsonic api (`/rest/*`) | 8 | drop |
| pds-save / pds migration check | 20 / 59 | drop (next writes to the PDS directly) |
| activity feed, `/at/…` viewer, `/record`, `/costs` | ≤10 | drop, or point `/costs` at the hub feed |
| indiemusi cross-posting | rare | drop |
| bot DMs about new uploads (`moderation.plyr.fm` bot) | low | drop |
| auto genre tags (replicate), CLAP into turbopuffer (modal) | 38 / 39 runs | drop; next's CLAP cron into pgvector replaces it |
| account deletion / data export | not measured | next has none. data lives in users' PDSes, but plyr-held audio in R2 doesn't. port a "remove my plyr data" action soon after cutover (doesn't need to block) |

### moderation, specifically
prod in 14 days: 42 AuDD copyright scans, 5 image scans, **10 labels committed,
3 moderation events**. most of prod's moderation spend is polling loops
(`publish_moderation_decisions` 10k runs, `sync_operator_labels` 4k,
`sync_copyright_resolutions` 4k checking scans that never resolve) plus 3.5k
`/moderation/sensitive-images` reads from the frontend. so yes: it labels a
little and acts on almost nothing.

next already has the replacement (event log, own labeler, osprey every 10 min via
GH Actions, report sheet + queue). the one tie is that osprey borrows prod's
`plyr-moderation` `/scan` for the AuDD key. at cutover either keep that tiny
service, or move the AuDD call into osprey and retire it (decision 3). the
labeler identity also has to move: next signs as `did:web:api.next.plyr.fm`;
labels consumers know `moderation.plyr.fm`. that's a PLC op adding next's
`#atproto_labeler` key and endpoint to the `moderation.plyr.fm` DID (needs its
rotation key), and setting `LABELER_DID` + `LABELER_SIGNING_KEY` on next.

---

## 3. data, identity, and devices

### what moves itself
tracks, likes, playlists/albums (`fm.plyr.list`), comments, profiles: these are
records in users' PDSes and next already indexes them from the firehose. no
copy needed, only the reconcile above.

### what only lives in prod's database (must be exported or consciously dropped)

| prod table / state | plan |
|---|---|
| `tracks.play_count`, `track_plays` | import totals into `track_metrics` as `legacy_import`; keep per-play history only in the frozen prod snapshot |
| numeric track ids | `legacy_track_links` manifest (runbook exists) |
| unlisted visibility | snapshot into `track_policies` (runbook exists) |
| supporter-gated / private tracks (`support_gate`, `audio-private-prod`, 13 GB) | decision 2 |
| comment opt-ins, preferences, queue | next already seeded comment opt-ins (#2761). prefs/queue: drop, users re-pick (small) |
| copyright scans, moderation decisions, sensitive-image flags | import active takedowns/labels into next's moderation log as `legacy_import`; drop scan history |
| oauth sessions, dev tokens, share links, jams, upload feedback, feature flags | drop |
| ToS acceptance records | carry the list of accepted DIDs into next prefs so people aren't asked twice (or just ask again; it's 128 artists) |

keep the prod neon project frozen (scale-to-zero, read-only role) as the archive
and rollback source; delete it only after a full quiet period.

### sign-in and re-consent
- prod is a confidential server-side oauth client (`api.plyr.fm`); next is a
  browser/native public client whose `client_id` derives from `SITE_URL`.
  sessions can't be carried over. **everyone signs in once after cutover**, and
  the consent screen will list next's scopes (including the `space:` scopes).
  say so in the announcement; it's a one-time tap.
- flip `SITE_URL` to `https://plyr.fm` in web, core, and the native build so the
  client metadata lives at `plyr.fm/oauth-client-metadata.json` and
  `plyr.fm/oauth-native-client-metadata.json`.
- **keep next.plyr.fm alive**: it's the lexicon authority for `fm.plyr.next.*`
  (space uris are baked into records), the jams `did:web:jams.next.plyr.fm`, and it
  should keep serving the native client metadata so already-installed testflight
  builds keep signing in until they update. redirect its pages to plyr.fm.

### dns
- `plyr.fm` → next's pages project (`plyr-fm-next`) instead of prod's sveltekit
  pages project. keep the old project around (not deleted) for rollback.
- `api.plyr.fm` → the zig api (add a fly cert on `plyr-api-zig-canary` for
  `api.plyr.fm`), serving the compat surface. keep `api.next.plyr.fm` as an alias.
- `audio.plyr.fm`, `images.plyr.fm`, `radio.plyr.fm` and the station subdomains,
  `jams.next.plyr.fm`: unchanged.
- lower TTLs ahead of time so rollback is a fast flip.

### iOS app store slot
the `fm.plyr` slot (ASC app 6820399998) has never had a public release, so
there's no installed base to migrate. what's needed:
- a **native build** (not OTA): url scheme becomes `fm.plyr` because atproto
  native oauth requires the redirect scheme to mirror the `client_id` host
  (`plyr.fm`). `SITE_URL` and the native client metadata change with it.
- app store review submission: privacy nutrition label, screenshots, review
  notes with a demo account, export compliance (already flagged). first public
  review can bounce, so submit it before the web flip, not after.
- android stays `fm.plyr.next` unless you want to ship it too.

### lexicons
- `fm.plyr.track/list/like/comment/actor.profile` stay as they are (shared with prod
  already). the legacy `avatarBlob` pair (#2759) ships as part of this release.
- breaking lexicon changes wait until after cutover and then move to a new NSID
  wholesale (your 11-17 call). don't publish lexicon schema records as part of
  cutover (your call to hold).
- spaces public beta is dec 1 and the space uri shape may change. cutting over
  doesn't depend on it, but **don't finalize `fm.plyr.release` policy uris before
  the beta shape is known**.

### rollback
- before the flip: prod is untouched; abort is free.
- after the flip, within the rollback window (prod machines stopped but not
  destroyed, prod neon frozen but alive, old pages project intact): flip dns
  `plyr.fm` + `api.plyr.fm` back, `fly scale count` relay-api back up.
- what rollback can't undo: records users wrote through next (they're the
  users'; prod's jetstream ingests them on restart, same collections), and new
  uploads whose audio only went to `plyr-next-audio` (prod would show them as
  broken until re-processed). the window should therefore be short, and we should
  watch for that.
- destroy prod fly apps, the staging neon branch and the staging r2 buckets only
  after the window closes.

---

## 4. sequence

no dates, per your rule. each step lists what can go wrong and what it waits on.

**0. move next's database out from under staging.** next's neon branch lives in
the `plyr-stg` project, which we want to delete. make the next branch the default
branch of that project and rename it (no data copy), or restore into a new
`plyr-next` project. *risk:* connection strings in fly secrets and the GH Actions
crons (osprey, CLAP) all change together. *waits on:* nothing.

**1. close the blocker gaps on next, behind next.plyr.fm** (each its own PR,
shipped to next as usual):
- 1a radio state/sampler/presence/live in zig; next web/app + `plyr-radio`
  pointed at it. *risk:* dead air; verify all five stations including firehose
  on/off-air fallback.
- 1b compat surface on the zig api: `/audio/{id}`, `/tracks/{id}`, `/oembed`,
  `/stats/atlas`. *risk:* gated-audio behaviour depends on decision 2.
- 1c link-preview function for pages. **done 2026-11-21** (#2838, #2841): live on
  next.plyr.fm, verified with bluesky's card fetcher. old `/u/{handle}/album/{slug}`
  links redirect; old `/playlist/{uuid}` links are not mapped yet.
- 1d terms accept + `/terms` `/privacy`.
- 1e atlas built from next's db.
- 1f moderation: AuDD path per decision 3; import prod's active labels/takedowns.

**2. dress rehearsal on next.plyr.fm.** reconcile catalog + play counts against a
fresh read-only prod snapshot; load `legacy_track_links` + unlisted; walk the
full matrix (route × phone/desktop × light/dark × signed in/out, upload, jam,
radio, embeds on a third-party page, legacy numeric links, a gated legacy
track). *waits on:* 1.

**3. ship the iOS release build to review** with `SITE_URL=plyr.fm`, scheme
`fm.plyr`. *risk:* app review rejection; this is the step with the least control,
which is why it goes before the flip. the app can go live a bit after web without
harm. *waits on:* 2, plus your app store metadata.

**4. pre-flip prep.** lower dns TTLs; add `api.plyr.fm` cert to the zig app;
prepare the labeler PLC op; draft the announcement ("sign in once more").
*waits on:* 2.

**5. the flip** (needs you, like any prod release):
- freeze prod writes (maintenance banner on prod; stop `relay-api` worker so no
  new prod-only uploads land).
- final export: play counts, legacy links, unlisted, labels → next.
- set `SITE_URL=plyr.fm`, deploy next web to the plyr.fm pages project, point
  `api.plyr.fm` at the zig api, apply the labeler PLC op + next labeler env.
- smoke: sign-in on web, playback, radio, an embed, a legacy `/track/1667` link,
  a bluesky link card, an upload.
- *risk:* oauth metadata cached by PDSes; first sign-ins are the canary.

**6. rollback window.** prod machines scaled to zero but kept, prod neon frozen,
old pages project kept. watch logfire for 404s on legacy routes and failed
sign-ins. *exit:* nothing alarming for a window you're comfortable with.

**7. teardown.** destroy `relay-api`, `relay-api-staging`, `plyr-transcoder`(+staging),
`plyr-redis`, `plyr-redis-stg`, (`plyr-moderation` per decision 3); delete
staging/dev neon and r2 buckets; freeze `plyr-prd` as an archive; cancel
turbopuffer/modal/replicate keys; move `next/` to the repo top level and the
legacy python/sveltekit code to an archive branch; update the hub cost
attribution.

**8. after cutover, in order of value:** artist analytics (slim), remove-my-data,
lexicon NSID move for breaking changes, spaces beta compatibility pass, selling
music when atmosphere money opens up.

---

## 5. decisions for nate

1. **retirement set**: retire prod fly apps, staging, turbopuffer, modal, replicate
   as listed above? (recommend yes)
2. **prod's supporter-gated/private tracks**: atprotofans is defunct, so the gate
   can't be verified any more. options: (a) make them owner-only on next and tell
   those artists to re-close with next's policies, (b) open them to signed-in
   listeners, (c) make them public. **recommend (a)**: no artist gets surprised by
   their private audio going public. i couldn't count how many tracks this is
   without prod db access; step 2 counts them.
3. **copyright scanning (AuDD, $5/mo + the `plyr-moderation` machine)**: keep it
   by moving the AuDD call into osprey and retiring `plyr-moderation`, or drop
   copyright scanning entirely since prod barely acts on it. **recommend keep via
   osprey**: cheap, and it's the one check that protects you from a takedown
   notice.
4. **`api.plyr.fm` → zig api with a small compat surface** (vs. a new hostname
   only). recommend the compat surface; old embeds and gated-track records point
   there.
5. **plyrfm python SDK / MCP + developer tokens**: they talk to the legacy REST
   api and will break. drop them at cutover and rebuild on the XRPC api later, or
   hold cutover for them. recommend drop now, rebuild later.
6. **rollback window length** before teardown is your call.
7. **atlas embeddings after cutover** (added 11-23): the atlas is built from prod's
   db + turbopuffer vectors + anthropic labels, and next has no embeddings. options:
   (a) copy the CLAP vectors into next's neon with pgvector, keep modal CLAP for
   new uploads (~$0–3/mo), drop turbopuffer; (b) keep turbopuffer + modal pointed
   at next; (c) drop the atlas. **recommend (a)**: one fewer vendor, ~1.4k vectors
   is tiny for postgres, and the atlas rework thread can build on it.
8. **logfire Team plan ($49, shared with the waow org)**: plyr prod python is most
   of the org's volume and goes away at cutover. whether to drop to the free tier
   then depends on your other projects; not a plyr decision, flagging it.
9. **EAS**: free plan, iOS builds 15/15 used, builds run on your mac. paying for
   EAS Starter would let release builds run without your mac. recommend staying
   free unless the mac dependency keeps biting (OTA from CI is live since
   #2978; only native/TestFlight builds still need the mac).
