# Legacy tag annotations in Next

The familiar tag catalog mixes canonical tags and historical application tags.
[#2201](https://github.com/zzstoatzz/plyr.fm/pull/2201) began publishing tags in
October2026; older records migrate only when their owner supplies an authorized
session. An absent public field intentionally preserves old SQL tags until that
happens. Before this change, opted-in ML genre tags also wrote only SQL. There is
no per-membership manual/ML provenance, so the import must say `legacy-plyr`,
never claim the artist authored the tags or that every tag is machine-derived.

Read-only production aggregates on November5 found1358 tracks,592 tagged,172
marked PDS-synced and420 pending migration. The public-visible subset is589
tracks:171 marked synced and418 pending;315 pending tracks also have genre
predictions, which is correlation rather than per-tag origin. Top tag membership
splits (synced/pending) include electronic16/142, ambient4/63, folk1/23 and
house3/43. Dropping pending annotations would remove most familiar tags. These
are recorded migration flags, not a fresh repository verification of every row.

## Storage and import

Migration0033 creates `plyr_index.legacy_track_tags`, separately keyed by canonical
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
credentials. It fails rather than silently truncating above10000 tracks.

Audit and import read `PLYR_TAG_TARGET_DATABASE_URL`:

```sh
uv run scripts/next_legacy_tags.py audit /tmp/tags.json \
  --target-database neondb --target-host '<verified Next branch hostname>'
uv run scripts/next_legacy_tags.py import /tmp/tags.json \
  --target-database neondb --target-host '<verified Next branch hostname>'
```

The operator verifies the endpoint in Neon first. The exact hostname/database and
existing `plyr-zig-next` or `plyr-zig-test` marker must match. A source fingerprint
also blocks the same source/target. Import transactions process at most100 tracks,
lock matching canonical/tag rows, normalize tags with the shared SQL function,
and insert only into the separate annotation table. They do not publish PDS
records, alter canonical projections or read Python tables at runtime. Repeating
the same artifact inserts nothing; this is a frozen migration, not ongoing
synchronization with the old database. Logs report eligible and skipped counts by
missing record, changed CID, unknown tag evidence and explicit canonical field.

## Verification

`uv run scripts/check_next_legacy_tags.py` exercises actual local PostgreSQL source
and target databases (`zig_tag_source` and `zig_tag_annotations` on5435), including
source privacy/migration filtering, normalization, exact-CID admission, explicit
empty suppression, unknown evidence, same-target/wrong-target guards and repeated
import. It uses disposable SQL fixtures; it does not stand in for PDS verification.
Ruff check/format pass for both scripts.

A separate Neon rehearsal cloned the isolated Next branch (`next-zig`, staging
project `frosty-math-37367092`), applied0032/0033 there and independently repaired
two real public repositories with the actual Zig verifier. A public-only source
snapshot contained418 tracks/1478 memberships. Audit admitted40 exact-CID,
verified-absent tracks and skipped69 missing and309 unknown tag states. Import
inserted160 normalized memberships; the second run inserted0. A final SQL check
confirmed all160 had the expected source, current CID and verified absence fence.
The rehearsal branch was deleted after evidence collection. The parent Next
branch, production database and PDS records were not written by this rehearsal.

The final Next import remains a separate step after review, deployment and normal
verified reconciliation. Its admitted/skipped counts may differ as repositories
change; unknown or mismatched records must continue to be skipped.
