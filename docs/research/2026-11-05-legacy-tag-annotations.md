# Legacy tag annotations in Next

The familiar tag catalog mixes canonical tags and historical application tags.
[#2201](https://github.com/zzstoatzz/plyr.fm/pull/2201) began publishing tags in
October 2026; older records migrate only when their owner supplies an authorized
session. An absent public field intentionally preserves old SQL tags until that
happens. Before this change, opted-in ML genre tags also wrote only SQL. There is
no per-membership manual/ML provenance, so the import must say `legacy-plyr`,
never claim the artist authored the tags or that every tag is machine-derived.

Read-only production aggregates on November 5 found 1,358 tracks, 592 tagged, 172
marked PDS-synced and 420 pending migration. The public-visible subset is 589
tracks: 171 marked synced and 418 pending; 315 pending tracks also have genre
predictions, which is correlation rather than per-tag origin. Top tag membership
splits (synced/pending) include electronic 16/142, ambient 4/63, folk 1/23 and
house 3/43. Dropping pending annotations would remove most familiar tags. These
are recorded migration flags, not a fresh repository verification of every row.

## Storage and import

Migration 0033 creates `plyr_index.legacy_track_tags`, separately keyed by canonical
URI, observed record CID and tag. It keeps source identity, legacy track ID,
source observation time and import time. It has no foreign-key cascade because
verified snapshot rebuilds replace projection rows. The effective read path must
still require a current verified tag projection with `tags_present=false` and
matching current CID; missing evidence never means absent. Explicit canonical
tags, including `[]`, override these annotations. A later title/audio edit changes
the CID and conservatively stops using the old annotation. Runtime queries apply
the same track visibility, availability and moderation policy as authored tags.

`uv run scripts/next_legacy_tags.py export --output /tmp/tags.json` reads
`PLYR_TAG_SOURCE_DATABASE_URL` in a repeatable-read, read-only transaction. It
exports only public-visible, pending legacy rows with canonical URI/CID pointers.
Private and owner-only tracks are excluded. The bounded artifact contains no
credentials. It fails rather than silently truncating above 10,000 tracks.

Audit and import read `PLYR_TAG_TARGET_DATABASE_URL`:

```sh
uv run scripts/next_legacy_tags.py audit /tmp/tags.json \
  --target-database neondb --target-host '<verified Next branch hostname>'
uv run scripts/next_legacy_tags.py import /tmp/tags.json \
  --target-database neondb --target-host '<verified Next branch hostname>'
```

The operator verifies the endpoint in Neon first. The exact hostname/database and
existing `plyr-zig-next` or `plyr-zig-test` marker must match. A source fingerprint
also blocks the same source/target. Import transactions process at most 100 tracks,
lock matching canonical/tag rows, normalize tags with the shared SQL function,
and insert only into the separate annotation table. They do not publish PDS
records, alter canonical projections or read Python tables at runtime. Repeating
the same artifact inserts nothing; this is a frozen migration, not ongoing
synchronization with the old database. Logs report eligible and skipped counts by
missing record, changed CID, unknown tag evidence and explicit canonical field.

## Verification

`uv run scripts/check_next_legacy_tags.py` exercises actual local PostgreSQL source
and target databases (`zig_tag_source` and `zig_tag_annotations` on 5435), including
source privacy/migration filtering, normalization, exact-CID admission, explicit
empty suppression, unknown evidence, same-target/wrong-target guards and repeated
import. It uses disposable SQL fixtures; it does not stand in for PDS verification.
Ruff check/format pass for both scripts.

A separate Neon rehearsal cloned the isolated Next branch (`next-zig`, staging
project `frosty-math-37367092`), applied 0032/0033 there and independently repaired
two real public repositories with the actual Zig verifier. A public-only source
snapshot contained 418 tracks/1,478 memberships. Audit admitted 40 exact-CID,
verified-absent tracks and skipped 69 missing and 309 unknown tag states. Import
inserted 160 normalized memberships; the second run inserted 0. A final SQL check
confirmed all 160 had the expected source, current CID and verified absence fence.
The rehearsal branch was deleted after evidence collection. The parent Next
branch, production database and PDS records were not written by this rehearsal.

## Final Next import

After verified backfill completed and the deployment of schema 0034 succeeded,
the frozen public artifact was imported into `next-zig` in the staging project,
branch `br-rapid-frog-af0th9op`, database `neondb`. The endpoint, database marker,
exact deployment commit and migration ledger were independently checked first.
The artifact SHA-256 was
`5d62fd0abebe86a7841e1bfbf2ac583382ed4e3a9d91336f6f87cc6badff1125`.

Audit admitted 350 of its 418 tracks and skipped 68 missing/deleted records.
There were no CID-mismatched, explicit-field or unknown-evidence exceptions.
The first import inserted 1,250 normalized memberships; the second inserted zero.
Independent SQL confirmed all 1,250 annotations across 350 tracks retained the
legacy source, matching current CID, verified absent tag field and version-3
repository head. Production and PDS records were not written.

A separate read-only audit checked all 171 public source tracks marked
`tags_pds_synced=true`: 166 had exact-CID verified nonempty tags, and five were
missing/deleted under current version-3 heads. None were verified-absent, explicitly
empty, CID-mismatched or unknown. At this checkpoint, excluding those source flags
did not omit any demonstrably safe legacy fallback.

The public API then returned electronic with 130 tracks (15 verified, 115 legacy),
experimental with 45 (11 verified, 34 legacy), and dub techno with six (one verified,
five legacy). The legacy-only tag `tech` returned its one actual track, matching
the frozen source artifact. Two real electronic pages returned four distinct
tracks; using their cursor with a different tag returned 400. These are current
verified-policy and Next-metric results, not a promise of identical production
counts or ranking.

Future audits/imports may admit different records as repositories change; missing,
unknown or mismatched evidence must continue to be skipped. Home deployment and
browser verification are separate from this completed data migration.
