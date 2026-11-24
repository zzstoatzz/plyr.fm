# plyr.fm vendors and cost (2026-11-23)

> update: decision 7 landed after this was written. the atlas is now built from
> next's own db with pgvector (#2952), so "next has no embeddings" below is out
> of date. OTA from CI is live (`EXPO_TOKEN` set).

read-only. nothing on any provider was changed. no provider exposed an invoice
through its api (fly, neon) or let me read billing history (cloudflare 403), so
every number below is usage or inventory × list price, not a bill.

**the short version.** plyr costs about **$165/mo** today, not the ~$150 the plan
said: neon is real money (~$81, all three databases run 24/7) and modal cost
~$17 last month before it settled. after cutover it drops to about **$60–70/mo**,
and nearly all of the saving arrives in one go when prod's `relay-api`, prod's
database and prod's moderation database go away. there's very little worth
cutting before cutover, so the main cost lever is cutting over.

## what we pay today

window 2026-10-23 → 11-23 unless noted.

| vendor | what | $/mo | source | after cutover |
|---|---|---:|---|---|
| **neon** `plyr-prd` | prod db, 0.5–2 CU, never suspends; sat at exactly 0.5 CU 24/7 since 10-14 | ~38 | consumption api × $0.106/CU-h | **freeze**, scale to zero (~0) |
| **neon** `plyr-moderation` | prod labeler db, 0.25 CU continuously since 11-13 (prod's polling loops keep it awake) | ~19 | same | **delete** |
| **neon** `plyr-stg` / `next-zig` branch | next's db (and staging main) | ~23 | same | keep, ~20–25 (it's next's only db) |
| neon egress + storage | storage under 1 GB total | ~3 | same | ~1 |
| **fly** `relay-api` | prod api + worker + jetstream | 23 | hub feed | **retire** |
| fly prod/staging leftovers | transcoder, staging api, 2 redis | ~10.5 | hub feed | **retire** |
| fly `plyr-moderation` | rust labeler + AuDD `/scan` | 2 | hub feed | retire (decision 3) |
| fly next stack | zig api + ingester + space consumer 12.7, processing 5.9, jams 4.0, 2 redis 4.2 | ~27 | hub feed | keep |
| fly `plyr-radio` | station adapter | 4.3 | hub feed | keep |
| **modal** `plyr-clap` | prod CLAP embeddings | 16.76 last window; ~$3 at today's $0.10/day | modal usage | see atlas below |
| **cloudflare** R2 | plyr holds 113 GB (of the account's 340). biggest: `audio-private-staging` 46 GB, `audio-prod` 44 GB | ~1.7 | r2 usage api | ~1 after deleting staging buckets |
| cloudflare workers paid | shared with other waow projects | 5 shared | — | unchanged |
| cloudflare pages, domain | pages free; plyr.fm domain | 1 | feed | unchanged |
| **AuDD** | copyright scans, indie base | 5 | june measurement | 0 or 5 (decision 3) |
| **turbopuffer** | prod vibe search + atlas vectors | ? | not reachable | drop or keep, see atlas below |
| **replicate** | genre suggestions (prod **and** next's audio worker) | pennies ? | not reachable | keep, next uses it |
| anthropic | atlas cluster labels, daily | pennies ? | not reachable | keep if atlas keeps labels |
| **logfire** | waow org on Team ($49). plyr-fm is the biggest producer: ~500k spans/14d, 83% of it prod python | 49 shared | logfire + 11-21 note | next emits ~23k/14d; see decision 8 |
| **expo / EAS** | free plan, iOS builds 15 of 15 used this period (builds run on your mac) | 0 | eas | see decision 9 |
| apple developer | $99/yr | 8.25 | — | unchanged |
| github actions | public repo | 0 | — | unchanged |

plyr-attributable total, excluding the shared workers/logfire/apple lines:
**~$165** (neon 83, fly 69, modal ~3–17, AuDD 5, cloudflare ~3).

## what next needs after cutover

| | $/mo |
|---|---:|
| fly next stack | 27 |
| fly `plyr-radio` | 4.3 |
| neon next db (today ~23, padded a bit for prod traffic) | 20–30 |
| neon `plyr-prd` frozen as the archive (storage only) | <1 |
| r2 + domain | ~2 |
| AuDD (if kept) | 0–5 |
| modal CLAP for new uploads (if atlas moves to pgvector) | 0–3 |
| **total** | **~$55–70** |

plus the shared lines that don't move: workers paid $5, apple $8.25, logfire.

## things the plan got wrong, now fixed in plan.md

- **neon was ~$81, not ~$70–80 estimated**, and `plyr-moderation` is back to
  running 24/7 (it was fixed in june; since 11-13 prod's moderation polling keeps
  it from ever idling). it disappears at cutover.
- **next has no embeddings.** the plan said next does recs in pgvector and runs
  CLAP in github actions. it doesn't: next's queue suggestions use tags and
  artists only, and the atlas is still built daily from **prod's database +
  turbopuffer + anthropic**. so cutting prod also cuts the atlas unless we move
  the vectors. that's decision 7, and it overlaps the atlas mockup thread.
- **next uses replicate** (genre suggestions in the audio worker), so replicate
  stays.

## cheap extras, any time

| change | saves | cost of doing it |
|---|---:|---|
| fold `plyr-redis-next` into the jams redis | ~2 | one more thing on the redis that holds jams + queues (128 MB, noeviction) |
| let `plyr-next-processing` auto-stop | ~4 | cold start on the first upload after idle |
| delete `audio-private-staging` (46 GB) and `audio-staging` | ~0.7 | none once staging is gone |
| check whether the ingester needs shared-2x/1GB | maybe ~4–6 | needs a memory measurement first |

## options looked at and not recommended

- **move next's db off neon** (self-hosted postgres on a small fly machine or the
  hetzner box). next's db would cost ~$3–5 instead of ~$20–25, but you'd own
  backups, upgrades and point-in-time restore, and lose branching. not worth ~$18.
- **fly managed postgres**: starts above what neon costs us.
- **cutting staging before cutover** (~$3.5): prod releases still go through it
  until the flip, so it isn't worth the risk for the money.

## where the numbers came from

- raw read (not in the repo): nate's mac, `~/tangled.org/_vendor-cost-2026-11-23/report.md` + json
- hub feed `hub.waow.tech/api/costs.json` (fly, r2). it still has no neon dollars.
- neon consumption api, per project/branch, 10-23 → 11-23
- logfire `plyr-fm` project, spans by service 11-09 → 11-23
- repo `COSTS.md` history and `.github/workflows/build-atlas.yml`,
  `next/services/audio/src/genres.ts`
