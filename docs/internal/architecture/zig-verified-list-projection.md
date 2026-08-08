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

## storage contract

The target Postgres shape is deliberately left to the adapter. It needs to
support, at minimum:

- canonical list URI and current record CID;
- owner DID, collection, record key, semantic list type, and authored metadata;
- ordered members keyed by list URI and position, each retaining track URI and
  strong-reference CID;
- commit CID, commit revision, and indexed timestamp;
- atomic replacement and cascading deletion.

This can become dedicated list and membership projection tables without binding
the REST domain to legacy `albums.id`, `tracks.album_id`, `playlists.items_json`,
or cached counts. The same projection serves album detail first and later
playlist and liked-list reads.

## next slice

Add an adapter that atomically persists these changes from a verified ingestion
process, then expose album detail by joining list members to independently
verified track projections. Missing, private, or moderated tracks must retain
their position semantics without silently substituting unrelated local rows.
