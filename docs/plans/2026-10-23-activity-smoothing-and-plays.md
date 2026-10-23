# plan: activity page smoothing and play history

**date**: 2026-10-23

## goal

make the activity chart readable at a glance, and add plays as a series,
with a history reconstructed from the teal.fm scrobbles plyr wrote for its
own listeners. only plyr-origin plays by plyr accounts count; a listener's
Spotify or Apple Music scrobbles never do.

## current state

measured on production, 2026-10-23.

**the chart draws raw counts with straight segments.** `ActivityChart.svelte`
joins one point per bucket. roughness (mean jump between neighboring points
divided by the mean count) is high where the buckets are smaller than plyr's
volume:

| range | buckets | zero buckets | roughness |
|---|---|---|---|
| day | 24 hourly | 16 | — |
| week | 168 hourly | 99 | 1.30 |
| month | 30 daily | 4 | 0.53 |
| year | 365 daily | 51 | 0.90 |
| all | 70 monthly | 54 | — |

coarser buckets help less than averaging: week at 6-hour buckets is still
0.88 (the daily cycle is real), year at weekly buckets 0.65. a centered
rolling mean over the existing buckets gets week (12h) to 0.12, month (3d) to
0.22, year (7d) to 0.15, while keeping every bucket.

**all-time starts in january 2021.** six tracks (1309–1314) carry record
`createdAt` values of jan 1 2021–2023, set by their creator. plyr began in
october 2025, so the all-time axis spends 54 of 70 months on nothing.

**plays have no timestamps in postgres.** `tracks.play_count` is a counter
incremented in `api/tracks/playback.py` (web) and `api/subsonic/endpoints.py`;
18,402 plays across 1,189 tracks. `share_link_events` timestamps only plays
through share links. logfire keeps `POST /tracks/{track_id}/play` spans for
about a month (earliest 2026-09-23), so it is not a history source.

**teal.fm holds a partial history.** plyr wrote `fm.teal.alpha.feed.play`
until 2026-08-15 and has written `fm.teal.feed.play` since (#1823). the record shapes
differ:

| collection | plyr marker | link field |
|---|---|---|
| `fm.teal.alpha.feed.play` | `musicServiceBaseDomain: "plyr.fm"` | `originUrl` |
| `fm.teal.feed.play` | `musicServiceUri: "https://plyr.fm"`, `submissionClientAgent: "plyr.fm/…"` | `originUri` |

a `listRecords` scan of the 64 accounts with scrobbling enabled read 1.1M teal
records; 4,357 are plyr-origin, from 39 listeners, every month from 2025-12
to 2026-10. 317 of those link to `localhost` dev servers. that is about 22% of
counted plays, and less recently (september: 178 scrobbles, while logfire saw
460 play requests in sep 23–oct 3 alone). teal recovers the *shape* of past
listening, not its volume.

**the stream archive is the wrong tool for this slice.** `planSnapshot` on
stream.waow.tech for both teal collections and the 64 DIDs plans 116,799
blocks, about 35 GB: heavy scrobblers' records sit in nearly every block.
one DID alone plans 8 blocks. per-repo `listRecords` reads only the records
(an estimated few hundred MB for all 1.1M) and is the right shape. the archive stays the
right tool for a whole-network drain, not a sparse per-user slice.

## decisions

defaults chosen here; reject any of them in review.

- **smoothing is a centered rolling mean, client-side.** window per range:
  day 3 hours, week 12 hours, month 3 days, year 7 days; all-time stays raw
  monthly. the line is drawn with a monotone cubic (no overshoot below zero).
  the raw counts stay visible as faint bars behind the line, and the readout
  shows the bucket's raw count with the average beside it.
- **the current partial bucket does not feed the average.** the line ends at
  the last complete bucket; the partial bucket shows only as its raw bar, so
  "now" never looks like a drop.
- **all-time starts at plyr's launch month (2025-10).** events dated earlier
  are excluded from the histogram; they did not happen on plyr then.
- **plays are a second series, not added to activity.** plays outnumber
  activity events several times over and would flatten them. the chart gets
  an `activity` / `plays` toggle; the endpoint gets `series=plays`.
- **plays from now on: a `track_plays` table.** one row per counted play
  (`track_id`, `played_at`, `source`), inserted in the same transaction as
  `play_count += 1` in both the web and subsonic paths. no listener DID:
  aggregate charts do not need to know who listened.
- **plays before that: teal backfill, labeled.** a one-off script reads
  plyr-origin teal plays from every plyr account's repo with `listRecords`,
  drops `localhost` origins and tracks that no longer exist, and inserts them
  as `source = 'teal'` at their `playedTime`. the chart draws the stretch
  before tracking began in a distinct style, labeled "scrobbled plays only",
  so the partial history never reads as the full count.
- **the backfill runs on heavypad, not the laptop.** an estimated few hundred
  MB of record reads; small for heavypad, against the rule for local bandwidth.

## not doing

- **the stream archive for this backfill** — measured at ~35 GB for the
  slice; recorded above so it is not re-tried. an archive key for plyr is
  not needed by this plan.
- **listener identity on plays.** no per-listener history, no "who played".
- **scaling teal counts up to estimate total plays.** an estimate would be
  invented data.
- **logfire as a source** — a month of retention.
- **live teal ingestion.** plyr writes its own scrobbles; `track_plays`
  already sees every play first.

## phases

### phase 1: smooth the chart and fix all-time

**changes**:
- `frontend/src/lib/activity-smoothing.ts` (new): pure `rollingMean(counts,
  window, completeCount)` and `monotonePath(points)`.
- `frontend/src/lib/components/ActivityChart.svelte`: raw bars, smoothed line,
  readout with raw count and average.
- `backend/src/backend/api/activity.py`: all-time `start` clamps to
  `2025-10-01`.
- `docs/internal/frontend/activity-chart.md`: smoothing and the all-time
  start.

**success criteria**:
- [ ] unit tests for `rollingMean` (edges, partial bucket) and `monotonePath`
      (never below the baseline)
- [ ] histogram test: an event dated 2021 does not start all-time in 2021
- [ ] `ui-check`: every range at 390px and 1280px, both themes, hover and
      keyboard inspection

### phase 2: record plays

**changes**:
- `backend/src/backend/models/track_play.py` plus a migration: `track_plays
  (id, track_id → tracks ON DELETE CASCADE, played_at, source)`, index on
  `played_at`.
- `api/tracks/playback.py` and `api/subsonic/endpoints.py`: insert alongside
  the increment; deduped plays insert nothing.
- `api/activity.py`: `series=plays` buckets `track_plays.played_at` with the
  same ranges and zero fill.

**success criteria**:
- [ ] a counted play writes exactly one row; a deduped play writes none
      (web and subsonic)
- [ ] `series=plays` zero-fills every range; `series` absent is unchanged

### phase 3: backfill from teal, then show plays

**changes**:
- `scripts/backfill_teal_plays.py`: resolve each plyr account's PDS, page
  both collections, keep plyr-origin non-localhost records whose track id
  exists, insert `source = 'teal'`; `--dry-run` prints counts by month.
  idempotent on (`track_id`, `played_at`, `source`).
- histogram response gains `tracked_since` (first `source != 'teal'` play)
  so the chart can style the scrobbled stretch.
- `ActivityChart.svelte`: the `activity` / `plays` toggle and the labeled
  scrobbled stretch.

**success criteria**:
- [ ] dry run on heavypad against production reports ~4,000 rows, matching
      the coverage scan
- [ ] staging first, then production; play series verified on plyr.fm at both
      widths

## testing

- smoothing: a single spike, all zeros, a range shorter than the window.
- plays: counted, deduped, subsonic, deleted track (cascade).
- backfill: both record shapes, localhost dropped, unknown track dropped,
  re-run inserts nothing.
