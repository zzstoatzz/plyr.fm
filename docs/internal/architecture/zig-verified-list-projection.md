---
title: "Zig verified list projection boundary"
---

## decision

Album, playlist, and liked-list membership is projected from the ordered strong
references in an `fm.plyr.list` repository record. A local album relationship,
Jetstream JSON event, PDS HTTP response, or cached item count is not sufficient
evidence of membership or order.

The reusable boundary has two stages:

1. `zat` decodes a firehose CAR, verifies every block hash, verifies the signed
   commit and MST operation, and connects the operation CID to the record block;
2. plyr decodes that verified DAG-CBOR record and emits one schema-independent
   list upsert or delete for an index adapter to apply atomically.

`list_record.zig` performs the second-stage structural decoding.
`list_change.zig` binds its result to canonical record identity and commit
provenance. Neither module opens a database connection or knows a table name.

## invariants

- The record `$type` must equal the configured environment-aware list NSID.
- `listType` must be one of `album`, `playlist`, or `liked`.
- Membership is bounded by the lexicon's 500-item limit and array order is
  preserved exactly with zero-based positions.
- Every member is a DAG-CBOR strong reference with a DID-authority record URI,
  record key, configured track collection, and strict CIDv1 SHA-256 CID.
- Text that merely resembles a CID is rejected; the DAG-CBOR value must be a
  link.
- Create, update, and delete shapes are distinct. Updates and deletes require a
  previous DAG-CBOR CID; deletes cannot carry a current record.
- Every change carries the verified commit CID, TID revision, and indexing
  timestamp. The adapter must persist that provenance with the projection.
- An upsert replaces metadata and the complete ordered member set in one
  transaction. It never patches positions against stale local membership.
- A delete removes the list and all derived membership regardless of whether
  mirrored media or legacy rows still exist.

## why the Python read path is not retained

The Python album detail route fetches the list record from the PDS while serving
the request. If that fetch fails, it sorts locally related tracks by creation
time and appends tracks absent from the record. This makes availability change
the meaning of an album and can present local state as author-owned order.

The Zig detail resource will instead read the last verified projection. If no
verified list version exists, that album is not ready for canonical detail; it
does not fabricate a track list. PDS reconciliation may refresh the projection,
but the REST request is not the ingestion or trust boundary.

## storage implementation

The domain and projection command remain independent of storage. The initial
Postgres adapter persists them in two tables under a dedicated `plyr_index`
schema:

- `list_records` stores canonical repo-path identity, current record fields,
  commit CID/revision, indexing time, and durable deletion state;
- `list_members` stores the exact zero-based order and each track strong
  reference, keyed by list URI and position.

An accepted upsert replaces the record and complete member set in one
transaction. Member arrays are sent with one `unnest` insert rather than one
round trip per item. A revision compare-and-swap makes a replay either
`applied`, `idempotent`, or `stale`; the same revision with different commit or
record identity is a conflict rather than last-write-wins corruption.

Deletes are durable tombstones, not physical record deletion. Retaining the
latest commit revision prevents an older create or update replay from
resurrecting a deleted list. Member rows are removed in the same transaction.
The tables deliberately have no foreign keys to legacy artists, albums,
playlists, or tracks because verified repository operations can arrive in
different orders and the projection must remain rebuildable.

The schema is managed by the existing Alembic release path but intentionally
is not represented as a Python ORM model. Alembic's default-schema
autogeneration therefore cannot turn the Zig projection into legacy domain
state. Runtime SQL always qualifies `plyr_index`; it never relies on session
`search_path`, which is also the safe form for
[Neon's transaction-mode pooler](https://neon.com/docs/connect/connection-pooling).
Migration smoke coverage applies and reverses the real revision against the
disposable `relay_test` database.

The same projection serves album detail first and later playlist and liked-list
reads without exposing its physical schema through the REST model.

## next slice

Connect the adapter to a verified repository ingestion/backfill process, then
expose album detail by joining list members to independently indexed track
records. Missing, private, or moderated tracks must retain their position
semantics without silently substituting unrelated local rows. The first API
canary remains read-only and does not gain an ingestion process merely because
the persistence adapter now exists.
