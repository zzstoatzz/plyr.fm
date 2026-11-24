# next cutover handoff (2026-11-24)

the project's focus is **next**: the zig backend (`next/backend`), the SvelteKit
web app (`next/web`), the Expo iOS app (`next/app`) and the shared TypeScript
core (`next/core`), live at next.plyr.fm and api.next.plyr.fm. legacy prod (the
python `backend/`, sveltekit `frontend/`, `services/transcoder`, and their
workflows at plyr.fm / api.plyr.fm) is being retired: next takes over the
plyr.fm domains at the flip, then prod is torn down.

this folder is meant to be enough on its own. a session with only this repo and
`gh` should be able to pick the migration up from here.

| file | what it is |
|---|---|
| [plan.md](plan.md) | the cutover plan. section 0 (gap audit) is the live must-have list; sections 1–5 are the reasoning on costs, data, identity, dns, sequence, decisions |
| [flip-day.md](flip-day.md) | the step list for the flip, rollback window and teardown |
| [vendors.md](vendors.md) | every vendor, what it costs today, and what survives the cutover |
| [tangled-move.md](tangled-move.md) | proposal to move next's repo + CI onto tangled.org (not started) |

## done

- **next is off prod at runtime.** next calls nothing on legacy prod's api,
  buckets or services (#2949 removed the last `api.plyr.fm` calls; #2982, which
  would have bound prod's private bucket, was closed). the only things that
  read prod are cutover migration workflows: `next catalog diff` and
  `next import legacy plays`, both read-only on prod.
- **compat surface on zig:** `/audio/{id}`, `/tracks/{id}`, `/oembed`, `/radio/*`
  (#2958). old prod page routes 301 to their next equivalents (#2956).
- **radio on zig** (#2840–#2847); `plyr-radio` waits for its flip-day deploy.
- **link preview cards + oembed** from the edge worker (#2838/#2841/#2843).
- **legal + crawl basics:** `/terms`, `/privacy`, robots, sitemap, manifest
  (#2956), `llms.txt` (#2979).
- **monitoring:** ingester heartbeat (#2953), logfire alerts "next ingester
  silent or behind", "next api 5xx", "next workers logging errors", to discord
  + phi.
- **moderation:** osprey calls AuDD directly (#2984, `AUDD_API_TOKEN` set) and
  covers go to Claude directly (#2962); next stopped pulling prod's labels
  (#2987). `plyr-moderation` has no next caller.
- **indexer + catalog:** next indexes 1368 of prod's 1389 tracks; the
  remainder is explained in plan.md section 0 (M6). decoder changes need a
  `projection_version` bump in `postgres_verified_snapshot_store.zig`, or
  unchanged repos are never re-parsed. `next catalog diff` runs daily.
- **play counts** imported from prod (#2850/#2852); the import is idempotent
  and runs once more after prod freezes.
- **atlas on next's db** (pgvector + daily workflow, #2952), on web and iOS
  (#2950).
- **iOS OTAs from CI:** `next-ota.yml` publishes on any merge to main touching
  `next/app` or `next/core` (`EXPO_TOKEN` set). a native fingerprint change
  makes it skip; that needs a TestFlight build instead.
- **short links:** tracks, albums and playlists use `trk_<plc>.<rkey>` (and
  `alb_` / `pls_`) ids (#2999); old long links 301. three codec copies must
  agree: `next/backend/src/internal/identity/record_id.zig`,
  `next/core/src/record-ids.ts`, `next/web/edge/link-preview.js`.
- next accepts the `https://plyr.fm` origin already (#2977).

## left for flip day

full list with order and owners in [flip-day.md](flip-day.md). the big ones:

- **db move (N1):** next's neon db is a branch of the `plyr-stg` project.
  promote it to its own project before staging is deleted; every connection
  string (fly secrets, `ZIG_NEXT_*_DATABASE_URL` GitHub secrets) changes at once.
- **iOS release build (N2):** native build with `EXPO_PUBLIC_SITE_URL=https://plyr.fm`
  and scheme `fm.plyr`, submitted to App Store review before the web flip.
  `next/app` takes over the `fm.plyr` App Store slot (never publicly released).
- **labeler (N4):** a PLC op putting next's label key + endpoint on
  `moderation.plyr.fm`'s DID.
- **DNS + domains:** `plyr.fm` / `www.plyr.fm` to the `plyr-fm-next` pages
  project, `api.plyr.fm` to `plyr-api-zig-canary` (cert first), lower TTLs ahead.
- **prod freeze + final imports**, `plyr-radio` deploy, smoke, announcement
  (everyone signs in once more; that's accepted).

## open decisions

- **tangled move:** four decisions in [tangled-move.md](tangled-move.md)
  (OK the mirror force-push; go/no-go; one repo or split; who agents push as).
- **supporter-gated legacy tracks** stay unplayable on next for everyone
  (decided: D2). next never reads prod, so no bucket binding. artists re-upload
  or re-close them with next's policies. what to tell those artists is open.
- **lexicons:** breaking changes wait until after the cutover, then move to a
  new NSID wholesale. don't publish lexicon schema records yet. next-only NSIDs
  live under `fm.plyr.next.*` and survive the cutover (space uris are baked
  into records).
- **AI upload scan budgets** (in progress): sampled AuDD scans plus per-account
  and global daily scan budgets, tracks over budget stay out of discovery until
  scanned. an "ai" tag is disclosure, never a scan exemption.
- **#146 content-addressed audio:** open question for next's storage (full
  hashes, a standard blob reference shape, RASL-style retrieval); not a
  cutover blocker.
- the rest of plan.md section 5 (retirement set, rollback window length,
  dropping the legacy SDK/MCP + dev tokens, logfire plan, EAS plan).

## standing rules for contributors

- **never depend on legacy prod.** next must not call prod's api, read its
  buckets or use its services, not even as a fallback. migration workflows
  may read prod's db, read-only.
- **prod ships only via `just release`** (a GitHub release runs
  `deploy-prod.yml`). merging to main auto-deploys next's api; next web
  deploys from `check-svelte-next.yml`. never deploy locally.
- new next services go under `next/services/*` with their own Fly app and
  workflow; don't put next code in `backend/`, `frontend/` or
  `services/transcoder`.
- after a deploy, check the live site with the `next/web/scripts/check-live-*.mjs`
  checks, and at phone widths.
- next has no users yet, so next-only deploys, backfills, OTAs and TestFlight
  builds ship without a hold. lexicon changes (one-way doors) need nate's review.
