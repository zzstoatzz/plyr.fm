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

## verified commit transaction

A list operation is never persisted in isolation from repository-chain state.
The `verified_commit` boundary groups every relevant operation from one signed
repository commit with its authenticated prior MST root, post-state MST root,
commit CID, revision, DID, and indexing timestamp. The Postgres adapter locks
the repository's row in `plyr_index.repo_heads`, applies the entire batch, and
advances the head in the same transaction.

The compare-and-swap outcomes are intentionally explicit:

- no head means `needs_bootstrap`; a live diff cannot establish an initial
  trust root;
- an older revision is a harmless stale replay;
- the exact current revision, commit CID, and data root is idempotent;
- the same revision with different signed state is a conflict;
- a successor whose claimed prior data root differs from the locked head is a
  chain gap and requires authoritative repair.

If any list mutation fails, neither earlier mutations from that commit nor the
new repository head are committed. Tests induce a failure on the second
mutation and assert that the first mutation and head advance both roll back.
This is stricter and simpler than making per-record idempotence repair a
partially applied repository commit after a crash.

`commit_verifier.zig` is the only constructor for a live verified batch. It
uses `zat.verifyCommitDiff` with inversion enabled, validates the outer event
against the signed inner commit, and independently checks every operation CID
against the authenticated post-state MST. It accepts at most 200 operations and
2,000,000 CAR bytes. There is deliberately no legacy Sync 1.0 acceptance and no
lenient inversion fallback: missing `prevData`, rebase/too-big events, or an MST
gap route to full-repository repair rather than becoming projected data.

## complete repository bootstrap and repair

An unknown repository or live-chain gap is repaired only from a complete
`com.atproto.sync.getRepo` CAR. `snapshot_verifier.zig` asks Zat to verify the
commit signature, every block hash, deterministic MST layer structure, and the
presence of every record block before it extracts the configured list
collection. A malformed target-namespace record rejects the complete snapshot;
it is never silently dropped into a partially authoritative index.

The initial implementation bounds a repository CAR at 64 MiB and 250,000
blocks. Proof-pass allocations are released before the retained extraction
parse, so the two validation passes do not overlap in memory. Repositories over
that bound need a future streamed/spooled verifier rather than unbounded heap
growth in the ingestion process.

The snapshot Postgres adapter serializes concurrent bootstrap attempts per DID,
locks an existing head before repair, replaces every present list from the
authenticated snapshot, and turns any previously active list absent from that
snapshot into a tombstone at the snapshot revision. Its ordered members are
removed in the same transaction. The repository head becomes visible only with
the complete reconciliation; a newer local head makes the fetched snapshot
stale, and same-revision divergence is a conflict. This gives authenticated
absence the same durability as an observed live delete.

The same projection serves album detail first and later playlist and liked-list
reads without exposing its physical schema through the REST model.

## next slice

Connect destination-safe `getRepo` fetching and live firehose consumption to
the verified snapshot and commit transactions as an independently deployable
ingestion role. Album detail now joins list members to independently indexed
track records while retaining missing, private, and moderated positions without
silently substituting unrelated local rows. The first API canary remains
read-only and does not gain an ingestion process merely because this library
foundation now exists.

## verifier resource baseline

`just zig bench-snapshot` builds a deterministic signed full-repository CAR with
100 valid list records and measures 50 complete proof-and-extraction passes in
`ReleaseFast`. On the Apple M5 Pro development host with Zig 0.16.0, five warm
runs had a median of 286,853 ns per repository: 3,486 repositories/s or 348,611
records/s. The 9,024-byte fixture process peaked at 2,310,144 bytes RSS under
`/usr/bin/time -l`.

This is a CPU and allocation baseline for the authenticated snapshot core, not
a network, Postgres, large-repository, or production-capacity claim. The
fixture intentionally makes regression measurement cheap enough to run locally;
larger CAR-size sweeps and ingestion-role working-set measurements remain part
of deployment validation.

## runtime ingestion seam

The runtime coordinator is transport-independent and consumes five narrow
ports: durable repository-head reads, verified live-commit writes, verified
snapshot writes, signing-key resolution, and bounded complete-repository
fetches. It reports replay, bootstrap, repair, unavailable identity, invalid
signature, and invalid commit as different outcomes. None is an alias for
success.

A signature mismatch causes exactly one signing-key refresh and verification
retry for DID-key rotation. Ordinary commits use a bounded thread-safe LRU of
public signing keys; an ATProto identity event explicitly evicts that DID. A
cache allocation failure preserves the already resolved key instead of turning
successful identity resolution into an ingest outage.

Fetched CAR ownership is explicit and released on every verification outcome.
The initial Zat HTTP adapter accepts bytes only from an operator-configured
trusted endpoint and refuses redirects. Following a relay redirect to an
untrusted PDS without destination and resolved-IP validation would create an
SSRF path into the Fly private network. Direct relay-to-PDS operation therefore
remains disabled until that safety boundary is implemented and tested; this
fail-closed adapter is suitable for a trusted fetch proxy or local fixture.

These modules are library code and do not add a worker mode to the canary. The
first deployed API process remains read-only and cannot resolve identities,
fetch repositories, consume the firehose, or mutate `plyr_index`.
