# COSTS.md

> **Mandate.** This file tracks the infrastructure costs attributed to **plyr.fm** and
> what we're doing to bring them down. It is the running record of what this project
> spends, why, and a changelog of changes that moved the number. If the spend here is
> unjustified, that's a signal to clean up — not to ignore it.

> **The public `/costs` page now pulls live.** `scripts/costs/export_costs.py` was
> rewritten (2026-06-17) to fetch infra costs from the `hub.waow.tech` aggregator
> (line items tagged `project=="plyr.fm"`) and compute AuDD from our own DB — it no
> longer hard-codes any dollar figures. This file is the human-readable audit behind
> that feed. See [what the `/costs` page used to get wrong](#what-the-costs-page-used-to-get-wrong).

---

## summary

**As of 2026-06-17.** Figures are monthly. Confidence is noted per line because not
every provider exposes a clean per-project invoice; where a number is derived from
measured usage × public list price it's marked **est**, and where it could not be
verified from here it's marked **unverified**.

| provider | monthly | source | basis |
|---|---|---|---|
| **Fly.io** (compute) | **~$48** | hub feed | 6 apps; inventory × list price (counts stopped machines) |
| **Neon** (postgres) | **~$15** (feed) / compute-variable | hub feed + measured | feed splits Launch plan 4×$3.80; real driver is always-on moderation CU |
| **Cloudflare** (R2 + Pages + domain) | **~$1.2** (measured) / not in feed | measured directly | 21 GiB R2 over 10 GiB free + domain; **not yet attributed in the feed → $0 on the page** |
| **AuDD** (copyright) | **$5.00** | measured usage | $5 base, $0 overage (2.4k of 6k free reqs) |
| **Modal** (CLAP) / **Replicate** (genre) | negligible | — | per owner: not worth tracking; free-tier / scales to zero |

**Headline: ~$68/month** from the live feed (Fly $48 + Neon $15 + AuDD $5), plus ~$1.2
of Cloudflare the feed doesn't yet attribute. Not the ~$20 the old hard-coded page implied.
The gap was **Fly's true compute** (Redis omitted, stale numbers) and **Neon's always-on
moderation CU**.

> **Feed gap to fix upstream:** Cloudflare (R2 + domain) isn't tagged `project=="plyr.fm"`
> in `my-prefect-server` (`packages/mps/src/mps/costs/projects.py`), so the page shows
> Cloudflare = $0. It's only ~$1.2/mo, but attribute it there for completeness.

---

## detail by provider

### Fly.io — compute

Measured from `fly machines list` on 2026-06-17. Fly bills running time; **stopped**
machines incur ~$0 compute (volumes still bill). The per-app estimate below uses Fly's
shared-cpu list prices for the **running** machines; the inventory column counts every
machine (matches the `hub.waow.tech` inventory estimate, which is higher because it
doesn't discount stopped machines).

| app | machines | running est | inventory est (hub) |
|---|---|---|---|
| `relay-api` (prod backend) | 2×2GB worker, 2×1GB app — 2 running (1×2GB, 1×1GB), 2 stopped | ~$14.4 | $21.71 |
| `relay-api-staging` | 3×1GB — 2 running, 1 stopped | ~$11.4 | $14.92 |
| `plyr-moderation` | 1×256MB running | ~$1.9 | $3.19 |
| `plyr-redis` (prod) | 1×256MB running + 1GB vol | ~$2.1 | $3.19 |
| `plyr-redis-stg` | 1×256MB running + 1GB vol | ~$2.1 | $3.19 |
| `plyr-transcoder` | 2×1GB, both stopped (app suspended) | ~$0 | $2.08 |
| **total** | | **~$32** | **~$48** |

List prices used (shared-cpu-1x, 24/7): 256MB ≈ $1.94, 1GB ≈ $5.70, 2GB ≈ $8.69; volume $0.15/GB-mo.

- **prod vs non-prod**: prod ≈ relay-api + plyr-moderation + plyr-redis ≈ **$18 running**;
  non-prod ≈ relay-api-staging + plyr-redis-stg ≈ **$14 running** (the transcoder is idle/suspended).
- **truth source**: the Fly billing dashboard. The CLI doesn't expose a per-app invoice,
  so the above is an estimate. Reconcile against the dashboard before trusting to the dollar.

### Neon — postgres (serverless)

Neon billing is **org-level on a single plan** (org `nate`, `org-old-king-77916016`), not
per-project, so there is no clean per-project invoice. 4 of the org's 5 projects are plyr
(`plyr-prd`, `plyr-stg`, `plyr-dev`, `plyr-moderation`); the 5th (`follower-weight`) is unrelated.

**Storage is negligible** everywhere (all projects < 100 MB; prd is ~62 MB). **Compute
dominates**, and compute is billed in CU-hours. Month-to-date CU usage (≈17 days into the
billing month, `cpu_used_sec` / 3600, projected to a full month):

| project | autoscale (min–max CU) | suspend | MTD CU-h | ~full-month CU-h |
|---|---|---|---|---|
| `plyr-moderation` | **1–1 (fixed, always on)** | **disabled** | 402 | **~720** |
| `plyr-prd` | 0.25–2 | disabled | 202 | ~360 |
| `plyr-stg` | 0.25–1 | disabled | 101 | ~180 |
| `plyr-dev` | 0.25–0.25 | disabled | 6 | ~11 |

> ⚠️ **`plyr-moderation` runs a fixed 1 CU with autosuspend disabled — it never scales
> down.** That's ~720 CU-hours/month from a labeler that is idle most of the time, and it's
> the single largest compute consumer in the Neon footprint. This is exactly the cost the
> public page's flat "$5/month neon" hides. **Top cost-reduction target.**

Dollar figure depends on the org's plan tier (Launch includes 300 CU-h; overage ~$0.16/CU-h),
which can't be read from here — **verify the actual invoice in the Neon console.** Plan on it
being **well above the $5 the page claims** given ~1,250 plyr CU-h/month.

### Cloudflare — R2 + Pages + domain

R2 storage measured via the R2 usage API on 2026-06-17:

| bucket | objects | size |
|---|---|---|
| `audio-prod` | 939 | 19.79 GiB |
| `images-prod` | 660 | 0.42 GiB |
| `audio-private-prod` | 4 | 0.14 GiB |
| `audio-staging` | 320 | 0.47 GiB |
| `audio-dev` | 21 | 0.24 GiB |
| (other staging/dev/private + `plyr-stats`) | ~43 | < 0.02 GiB |
| **total** | | **~21.1 GiB** |

- **R2 storage**: 21.1 GiB − 10 GiB free = ~11 GiB billable × $0.015/GB-mo ≈ **$0.17/mo**.
  Egress is free (the reason we're on R2); Class A/B ops are negligible at this volume.
- **Pages**: free tier. **$0**.
- **Domain**: `plyr.fm` registration ≈ **~$1/mo** amortized.
- **Cloudflare total ≈ $1.2/mo.** (The old hard-coded $0.16 for R2 happens to still be about right.)

### AuDD — copyright detection

Measured from `copyright_scans ⋈ tracks` on prod (`plyr-prd`) on 2026-06-17:

- 58 scans in the last 30 days → **2,436 derived API requests** (1 req = 12s of audio).
- Free tier is 6,000 requests/month → **$0 overage**.
- **AuDD total = $5.00/mo** (indie-plan base only).

### Modal — CLAP mood-search embeddings  *(unverified)*

The `vibe-search` feature embeds audio/text via the Modal CLAP service
(`zzstoatzz--plyr-clap-*`). No Modal CLI or token is available locally, so spend can't be
measured from here. Modal includes a free monthly credit and the service scales to zero;
expected **~$0 (free-tier)**, but **confirm in the Modal dashboard**.

### Replicate — genre classification  *(unverified)*

Genre auto-tagging runs effnet-discogs on Replicate (scales to zero, ~$0.00019/run). No
token locally to query usage. Expected **< $1/mo**; confirm in the Replicate dashboard.

---

## what the `/costs` page used to get wrong

Until 2026-06-17 the page was fed by `export_costs.py`'s `FIXED_COSTS`, last touched
**2025-12-26**:

- **Fly** hard-coded at $11.66, **omitting `plyr-redis` and `plyr-redis-stg`**. Real ~$48.
- **Neon** hard-coded flat **$5.00**; the real driver (always-on moderation CU) was invisible.
- **Cloudflare** $1.16 — about right, but now reads from the feed (currently $0, unattributed).
- **AuDD** was already computed live — kept.

**Fixed:** the script now fetches Fly/Neon/Cloudflare from the `hub.waow.tech` feed
(`project=="plyr.fm"`) and computes AuDD from our DB. No dollar figures are hard-coded;
the only manual input is which services count as plyr.fm, and that mapping lives upstream
in `my-prefect-server`, not in this repo.

---

## how we might bring this down
- **`plyr-moderation` Neon project — ✅ DONE (2026-06-17):** endpoint `ep-frosty-credit-ae1vylok`
  was pinned at a fixed 1 CU with autosuspend off (~720 CU-h/mo always-on for a mostly-idle
  labeler). Now **autoscales 0.25–1 CU with scale-to-zero after 5 min idle** — it idles down to
  zero between scans. The single biggest hidden cost, eliminated.
- **non-prod Fly machines** (`relay-api-staging`, `plyr-redis-stg`): scale to zero when idle
  (`auto_stop_machines`) or tear down between use.
- **`plyr-transcoder`** is suspended with 2 idle 1GB machines — fine while idle, but delete
  the machines if it stays unused so it stops showing up in inventory estimates.
- **`relay-api`** is the biggest Fly line — right-size the 2GB worker and confirm the stopped
  machines actually stay stopped (auto-stop behaving) before anything else.
- **R2** is already cheap (~$0.17); no action needed.

## how to refresh this file
- **Fly**: `fly machines list -a <app>` for inventory; reconcile $ against the Fly dashboard.
- **Neon**: `mcp__plugin_neon_neon__list_projects` for per-project `cpu_used_sec` / autoscale
  config; read the actual bill from the Neon console (org-level).
- **R2**: Cloudflare API `GET /accounts/{acct}/r2/buckets/{bucket}/usage` per bucket.
- **AuDD**: query `copyright_scans ⋈ tracks` for 30-day requests (see `export_costs.py`).
- **Modal / Replicate**: their dashboards (negligible, not tracked).
- The live feed itself: `https://hub.waow.tech/api/costs.json` (filter `project=="plyr.fm"`).

## changelog
- **2026-06-17** — **applied the moderation fix:** `plyr-moderation` Neon endpoint
  `ep-frosty-credit-ae1vylok` switched from fixed 1 CU / no-suspend to autoscale 0.25–1 CU
  with scale-to-zero (5 min). Kills the ~720 always-on CU-h/mo.
- **2026-06-17** — rewrote `export_costs.py` to stop hard-coding: it now fetches Fly/Neon/
  Cloudflare from the `hub.waow.tech` feed and computes AuDD from our DB. Did the ground-truth
  audit behind it (Fly machine inventory, Neon per-project compute, R2 bucket sizes, AuDD usage).
  Surfaced the two costs the old page hid: real Fly compute (~$48 vs hard-coded $11.66, Redis
  omitted) and Neon's always-on 1-CU `plyr-moderation` project (~720 CU-h/mo — flagged for an
  autosuspend fix). Live total ~$68/mo vs the old page's ~$20.
- **2026-06-17** — initial cost notice (auto-scaffold; pointed at the live hub feed).
