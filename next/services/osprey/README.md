# osprey (next's moderation rules)

[Osprey](https://github.com/roostorg/osprey), ROOST's rules engine, running
plyr's rules over the tracks next indexes. Matches become review flags in next's
moderation log (`plyr_moderation.events`), where they show up in the queue at
next.plyr.fm/moderation. A rule only flags; a person decides.

This is option B from the moderation plan: Osprey's real worker and SML, with
plyr's plugin for input, UDFs and output, and without Osprey's Kafka, Druid and
UI stack.

## how it fits

```
plyr_index.track_records ──▶ TrackInputStream ──▶ Osprey RulesSink ──▶ ModerationLogSink ──▶ plyr_moderation.events
   (indexed tracks)          (cursor in            (rules/*.sml +        (flags, scan record      (the review queue)
                              rule_cursors)         plyr UDFs)            and cursor, one txn)
```

- **input** (`src/plyr_osprey/tracks.py`): walks indexed tracks in
  `(ready_at_us, record_uri)` order, so edits come round again. A track's audio
  is the address next plays: its verified copy of the record's blob, else the
  record's `audioUrl`. A record written straight to a PDS (blob only) is ready
  when that copy lands, so it comes round then. A first run starts from now,
  not the whole catalog.
- **covers** (same file): a second walk, with its own cursor, over the cover
  art of tracks (`imageUrl`) and albums/playlists (`imageBlob`), however the
  record was written. A cover is checked where next shows it: a PDS blob at
  next's cover worker, which checks it against its CID.
- **holds** (same file): tracks held for scan budget come round again, before
  anything new, once their day has turned over.
- **rules** (`rules/`): `rules/index.sml` decides what applies to a record;
  `rules/copyright.sml` pays for a scan from the uploader's budget, or holds
  the track; `rules/fingerprint.sml` is prod's "plays through" copyright rule;
  `rules/volume.sml` flags an account (once at 20, 100 and 500 tracks in a
  day, not per track); `rules/cover.sml` flags a cover that breaks plyr's
  image policy.
- **UDFs** (`src/plyr_osprey/udfs.py`): `RecordingsPlayingThrough` fingerprints
  audio with AuDD and applies
  the evidence bar from prod (`evidence.py`); `ImagePolicyViolations` asks
  Claude about a cover with prod's image policy prompt (`image_scan.py`); `FlagForReview` is the effect a
  matched rule leaves; `UrlHost` is a helper.
- **output**: the flags for a track, its scan record and the cursor are written
  in one transaction. A failed scan isn't recorded as clean: the run stops and
  retries that track next time, and passes over it after 3 failures.
- **entity labels**: Osprey requires a labels service; `entity_labels.py` keeps
  them in `plyr_moderation.osprey_entity_labels`. No rule uses them yet.

## scan budget

A scan spends the uploader's `scan_seconds` quota (`plyr_quota`, next/backend
migration 0064; `src/plyr_osprey/budget.py`): the file's length as ffprobe
measures it (never the record's claim, which is the uploader's to write),
capped at three hours, from a daily allowance by tier (`new` an hour, `established` six
hours once five scans came back clean and none flagged, `unmetered` for an
operator's grant), within a ceiling for everyone together (30 hours a day).
Out of budget, the track is held (`plyr_moderation.scan_holds`): it plays from
its artist's page and its own link, but feeds, search, radio and charts leave
it out until it is scanned. A failed scan gives its budget back.

AuDD bills one request per 12 seconds it hears, so a long file is sampled
(`fingerprint.ScanPlan`): up to 10 minutes every chunk, up to 30 minutes one in
two, past that one in three, and never more chunks than were paid for. Sampled,
three samples in step count as playing through, where four successive chunks
do otherwise, so a recording has to play for about 60 seconds (one in two) or
85 (one in three) to be flagged, against 48 unsampled. A file ffprobe can't
measure is charged its claimed length or ten minutes, whichever is more, and
heard in full up to three hours. Self-tagging a track `ai`
changes none of this: it is a disclosure, never an exemption.

Limits live in the tables (`plyr_quota.meters`, `allowances`,
`account_tiers`), not here.

## running it

`scripts/setup` fetches Osprey at the pinned commit and installs this plugin
into its environment. `scripts/test` runs the tests (set `TEST_DATABASE_URL`
for the Postgres round trip). `scripts/run` runs the worker:

| env | |
| --- | --- |
| `DATABASE_URL` | next's Postgres (the writer login) |
| `AUDD_API_TOKEN` | AuDD, for fingerprinting |
| `ANTHROPIC_API_KEY` | the cover check |
| `OSPREY_DRAIN_ONCE` | `true` stops once caught up |
| `OSPREY_POLL_SECONDS` | otherwise, the wait when caught up (default 30) |
| `OSPREY_START_AT_US` | where the tracks walk's first run starts (default now) |
| `OSPREY_COVERS_START_AT_US` | where the covers walk's first run starts (default now) |
| `LIST_COLLECTION_NSID` | albums and playlists, for their covers (default `fm.plyr.list`) |

In production it runs every 10 minutes from `.github/workflows/next-osprey.yml`
with `OSPREY_DRAIN_ONCE=true`.

## scope until cutover

`rules/index.sml` scans audio next holds (`plyr-next-audio`): uploads made on
next.plyr.fm and next's copies of blobs from records written straight to a PDS.
Prod's own uploads are left to prod's scan, which next reads through the
labeler; scans cost money. At cutover, drop that condition.
