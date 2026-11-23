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
- **rules** (`rules/`): `rules/index.sml` decides what applies to a record;
  `rules/copyright.sml` is prod's "plays through" copyright rule;
  `rules/cover.sml` flags a cover that breaks plyr's image policy.
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
