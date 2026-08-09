---
title: "Zig verified authored-profile projection boundary"
---

## decision

The signed `fm.plyr.actor.profile/self` repository record is authoritative only
for the music-specific profile claims it contains: avatar URI, bio, and authored
timestamps. It is not the authority for current handle, PDS location, account
availability, local display name, preferences, or the separate
`app.bsky.actor.profile` record.

The live and complete-repository verifiers authenticate the commit, MST path,
record CID, and DAG-CBOR block before `profile_record.zig` decodes it.
`profile_change.zig` then binds those fields to the canonical AT URI and commit
proof without knowing a table name. The profile NSID is environment-aware and
required as `PROFILE_COLLECTION_NSID`; runtime code does not hard-code it.

## invariants

- `$type` equals the configured profile collection and the repository key is
  literally `self`. A syntactically valid different rkey is still invalid.
- `createdAt` is required and both timestamps are calendar-valid ATProto RFC
  3339 datetimes.
- `avatar`, when present, is valid UTF-8 and an absolute URI. Parsing does not
  attest that its origin is trusted or that bytes exist there.
- `bio` obeys both independent lexicon limits: 2,560 UTF-8 bytes and 256
  extended grapheme clusters.
- Create, update, and delete operation shapes are distinct. Updates and deletes
  require the prior DAG-CBOR CID authenticated by the commit diff.

The shared string boundary uses Zg's `Graphemes` module directly rather than its
umbrella module. Tests cover combining marks, ZWJ emoji families, regional
indicator flags, byte limits, and invalid UTF-8. The same boundary closes the
previously missing 256-byte/64-grapheme validation on list names. Code-point
counting is deliberately not used as an approximation for grapheme clusters.

## persistence and reconciliation

`plyr_index.profile_records` is a rebuildable projection with canonical repo
identity, authored fields, commit CID/revision, index time, and durable deletion
state. Database constraints repeat the literal `self` path and tombstone shape.
It has no foreign key to the legacy artist table.

Live profile changes, list changes, track changes, and repository-head advance
commit in one Postgres transaction. Tests seed a newer profile, apply a valid
list mutation followed by an older profile mutation, and assert that profile
conflict rolls back the list and repository head. A complete authenticated
snapshot tombstones a previously active profile when `self` is absent. The real
Alembic upgrade and downgrade are exercised against the disposable
`relay_test` database.

The Postgres tests intentionally rebuild shared schemas and public fixtures.
They now use one process-wide test lock, and destructive fixture setup first
proves the database name is exactly `relay_test`; this removes ordering races as
the Zig test suite grows.

## account and REST boundary

Relay `#account` events describe an account as observed by the emitting relay.
They are not sufficient evidence about the DID's current PDS. Canonical account
availability will resolve the current DID document and query that PDS's
`com.atproto.sync.getRepoStatus`; inability to resolve or check must not hide an
account. Infrastructure conditions such as throttling or desynchronization also
must not become account-level deletion.

Verified REST artist/track composition therefore waits for that separate
availability projection. It will join independently attributed authored
profile, DID identity, delivery, discovery, moderation, and local-preference
facts rather than laundering the legacy artist row under one `verified` label.

## measured cost

The mixed signed-CAR benchmark now contains 100 lists, 100 tracks, and the one
allowed profile. Five 50-iteration `ReleaseFast` samples on the Apple M5 Pro
ranged from 542,714 to 554,583 ns per repository; the median was 546,768 ns,
equivalent to 1,828.93 repositories/s or 367,614.78 projected records/s for the
201-record fixture. The CAR is 17,945 bytes. Verification includes signature,
block hashes, MST structure, strict record decoding, and projection-command
construction; it excludes network and Postgres.

The production-shaped linux/amd64 ReleaseSafe image is 35,211,364 bytes and
contains a 12,789,880-byte executable. Relative to the preceding track-only
image, Unicode grapheme validation plus verified profile decoding, verification,
and persistence added 26,526 image bytes and 119,304 executable bytes. A cold
Docker compile of the generated Unicode data took 337.4 seconds, which is now a
recorded build-cost guardrail even though it does not affect runtime resource
use.
