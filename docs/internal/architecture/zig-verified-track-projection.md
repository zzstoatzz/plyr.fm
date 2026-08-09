---
title: "Zig verified track projection boundary"
---

## decision

An `fm.plyr.track` record in an authenticated repository is the authority for
the track's authored catalog claims. A relay JSON object, legacy `tracks` row,
R2 key, pending upload, or successful HTTP request is not equivalent evidence.

The live and complete-repository verifiers hand authenticated DAG-CBOR values
to `track_record.zig`. `track_change.zig` then binds the decoded record to its
canonical AT URI, record CID, owner DID, and signed commit proof without knowing
the Postgres schema. Create and update become complete replacements; delete
becomes a durable tombstone.

## authored state versus app-view state

The verified projection preserves only claims the repository actually makes:

- title, authored artist name, file type, album, duration, description, and
  creation timestamp;
- featured-artist DIDs and creator-applied self-labels;
- declared image and audio URLs;
- declared raw audio blob CID, media type, and size;
- the support-gate type asserted by the author.

It does not infer or attest:

- that a declared URL has an allowed origin or a live object behind it;
- that R2 mirrors the blob or is allowed to serve it;
- current DID handle, display name, PDS, or account availability; the
  separately authored plyr profile is projected independently;
- public, unlisted, or private discovery policy not represented by this record;
- operator moderation, copyright analysis, plays, likes, or other derived data.

Those facts require independently attributed projections. In particular, a
signed `audioUrl` remains an authored declaration, not a delivery attestation.
Blob mirroring must verify bytes against the raw CID before publishing a
separate availability fact.

## validation invariants

- `$type` equals the configured environment-aware track NSID; no NSID is
  hard-coded in runtime code.
- Required strings and every bounded optional string are valid UTF-8 and obey
  lexicon byte-length limits.
- `createdAt` is a calendar-valid RFC 3339 timestamp, not merely non-empty text.
- At least one of `audioUrl` and `audioBlob` is present. URLs are syntactically
  absolute but are not fetched during verification.
- Duration is a non-negative ATProto safe integer.
- An audio blob is a strict CIDv1 raw/SHA-256 link, has an `audio/*` media type,
  and is no larger than 100 MiB.
- At most ten featured artists are accepted. Their DIDs and any retained legacy
  handle/display-name snapshots must themselves satisfy the referenced shape;
  only DIDs enter the projection.
- Self-label unions must use `com.atproto.label.defs#selfLabels`, contain no more
  than ten values, and satisfy the referenced value bounds.
- `supportGate.type` is bounded but not closed over the lexicon's
  `knownValues`. ATProto known values are forward-compatible hints, not enums.
- Create, update, and delete operation shapes are distinct, and updates or
  deletes require the previous DAG-CBOR CID proven by the commit diff.

The old Python path also rejects creation timestamps more than five minutes in
the future and checks CDN objects while ingesting. Those are app-view admission
and delivery policies, not properties of whether the repository record exists.
They will be represented separately rather than deleting authenticated source
state from the index.

## persistence and reconciliation

`plyr_index.track_records` stores current authored fields, canonical repo-path
identity, commit CID/revision, index time, and durable deletion state. It has no
foreign key to legacy artist or track tables: repository operations can arrive
in any cross-repository order, and the table must be rebuildable from signed
repositories alone.

A live signed commit applies all selected list and track changes before its
repository head advances in the same Postgres transaction. Tests place a newer
track projection in the transaction's path after a valid list mutation and
assert that the conflict rolls back both the list change and head advance.

A complete authenticated repository snapshot replaces every present target
record and tombstones any previously active target record absent from that
snapshot. Tests exercise track absence independently from list absence. This
supersedes the Python ingester's expiring Redis tombstones: an old create replay
cannot resurrect a track after the cache TTL expires.

## REST transition

The current `/v1/tracks` reads compose the authenticated record and profile
projections with canonical account-availability evidence. Matching legacy rows
are optional enrichments for publication/visibility policy, current
handle/display presentation, operator moderation, counters, and unverified R2
delivery. The public domain object attributes each field family through `sources`; its
`projection.verification: verified_repo` describes only the record path and
cannot launder transitional fields into authored truth.

A new PDS-only record is readable after repository and account verification,
using explicit derived defaults when no local policy exists. For PDS blob
mirrors, Python verifies the fetched bytes against the declared raw CID and
persists the URL/CID relationship in `plyr_index.track_delivery_origins`, bound
to the exact authored record CID. Zig may therefore mark that artifact verified
and attribute its R2 origin to `verified_delivery`. It does not invent a signed
availability attestation. URLs retained only in the legacy row remain visibly
unverified fallbacks.

## measured verifier cost

`just zig bench-snapshot` now builds one deterministic signed CAR containing
100 lists, 100 tracks, and one authored profile. Each measured pass verifies the signature, every
block hash and MST layer, walks the complete tree, strictly decodes both record
types, and constructs 201 projection commands.

On the Apple M5 Pro development host with Zig 0.16.0, the 17,945-byte fixture's
median across five 50-pass `ReleaseFast` samples was 546,768 ns per repository:
1,828.93 repositories/s or 367,614.78 records/s. This is a local CPU regression baseline,
not a Postgres, network, large-CAR, or Fly capacity claim.

The production-shaped linux/amd64 ReleaseSafe image is now 35,318,207 bytes and
contains a 13,191,464-byte executable. Current profile and Unicode costs are
recorded with the [`verified authored-profile projection`](zig-verified-profile-projection.md).
The image comparison is an artifact-size guardrail, not a runtime RSS measurement.
