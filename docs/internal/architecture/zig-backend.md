---
title: "Zig backend architecture"
---

## purpose

the Zig backend is a re-architecture of plyr.fm as an ATProto appview, not a
line-for-line port of the Python service. Python tests and incident notes are
evidence about observable behavior and failure modes. They are not authority
for boundaries that made Postgres or R2 into accidental sources of truth.

## authority model

1. **authority belongs to a claim, not a database.** User-authored music
   metadata, collections, interactions, and media references belong in signed
   ATProto records. Content CIDs identify bytes. A media service may attest that
   it hosts those bytes. Plyr's labeler owns its operator assertions. A
   successful local database write never makes any of those claims canonical.
2. **ingestion establishes trust.** Records entering the index must come through
   a verified repository path: commit signature, MST diff, record operation,
   and blob CID. Jetstream delivery alone is notification, not proof.
3. **Postgres is derived.** It is a query-optimized materialized view of verified
   repository state plus explicitly local operational state. The content index
   must be rebuildable without treating an old Postgres row as truth.
4. **R2 is a retrieval origin.** Mirrored audio becomes eligible for playback
   only after its bytes match the declared content CID. R2 improves playback,
   scanning, and resilience; its URL is neither content identity nor proof that
   the current bytes were verified. That relationship must be persisted as an
   explicit fact before the API claims it.
5. **deletion follows authority.** A canonical delete or account state change
   removes the object from discovery. Cleanup of derived rows and mirrored
   bytes may be asynchronous, but stale storage must not keep content live.

## allowed local state

Some state is local by nature and must be named as such rather than mixed into
the content model:

- OAuth sessions, DPoP material, one-time exchange state, and rate-limit state;
- ingestion cursors, delivery leases, retry state, and reconciliation results;
- moderation decisions issued by plyr's labeler;
- aggregates and search/ranking artifacts that can be recomputed;
- temporary upload and publication state needed to complete a PDS write.

If product state cannot yet be represented on the PDS, that is a schema or
protocol gap. A local column may bridge the gap temporarily only when the gap,
owner, reconciliation rule, and deletion behavior are explicit.

## claim authority matrix

| claim | authority | appview treatment |
|---|---|---|
| artist-authored track metadata | signed artist repository record | verified, rebuildable projection |
| artifact identity | CID of the complete bytes | validate the narrow DASL/BDASL profile |
| media-key authorization or derivation | signed repository record and provenance chain | retain signer and parent references |
| current artifact availability | service-owned origin attestation | index separately from the artifact |
| plyr moderation assertion | signed label or append-only moderation event | project for policy, preserve issuer |
| rank, count, cached profile | appview computation | explicitly derived and timestamped |
| queue, task, session | owning operational service | local state with explicit lifecycle |

This follows DASL's retrieval model: the CID is the authority for returned
bytes, while a hostname is only a retrieval hint. See
[`dasl-media.md`](dasl-media.md) for the protocol and Streamplace prior art.

## write path

The steady-state write path is:

```text
client -> authenticated PDS write -> verified repo ingestion -> derived indexes
                                      -> verified blob mirror -> async analysis
```

An API request may coordinate or prepare the PDS write. It must not declare
success merely because Postgres or R2 accepted data. Pending rows are operation
state and expire or reconcile; they are not unpublished canonical tracks.

## implementation boundary

This branch implements the versioned REST appview plus two deliberately
separate ingestion roles. `MODE=api` serves read-only HTTP; `MODE=repair`
authenticates and reconciles one complete repository, then exits;
`MODE=ingester` continuously consumes signed relay frames and owns verified
projection writes and repair. They share libraries but never start each other.
Docket workers remain separate future process roles.

The REST layer depends on interfaces for indexed state, PDS commands, blobs,
moderation, and asynchronous work. Those implementations can remain Python
services during migration or become Zig libraries/services later. Keeping the
interfaces explicit lets the API advance without silently expanding this
branch into a second big-bang backend rewrite.

Redis and Docket remain target infrastructure. Python pydocket and Zig Docket
are not wire-compatible, so they use separate namespaces and migrate complete
producer/worker slices rather than sharing task messages. See
[`zig-background-work.md`](zig-background-work.md).

The API process treats its index as required configuration. `INDEX_MODE=disabled`
exists only for deliberate contract tests and indexless development; it does not
silently turn a production configuration mistake into a healthy deployment.
`/health` reports liveness and `/ready` reports whether the product dependency is
configured. PostgreSQL work is bounded independently by `DATABASE_POOL_SIZE`
(default `8`), while connection handlers are bounded by `MAX_CONNECTIONS`
before accept.

## migration rules

- Preserve an existing HTTP behavior when it is useful and consistent with the
  authority model; do not preserve it solely for parity.
- Prefer dual-running and shadow comparisons over sharing mutation ownership.
- The Python database may seed a transition, but the target content index is
  defined from verified PDS state.
- Every derived table documents its rebuild input and reconciliation rule.
- Every R2 object documents the CID/digest proof that permits it to exist.
- Environment-aware NSIDs come from settings and are never hard-coded.
- Session identifiers remain HttpOnly-cookie credentials and never enter
  browser local storage.

## first vertical slice

The first REST slice is the read-only public
[`GET /v1/tracks/{track_id}` resource](zig-v1-track.md):

1. define the canonical public representation and error envelope;
2. read through an index interface rather than a concrete legacy table;
3. expose canonical AT URI/CID and derived playback availability separately;
4. prove the complete HTTP-to-Postgres path with unit and integration tests.

Cursor pagination and stable filters begin with the subsequent track collection
endpoint; they are not smuggled into the detail resource.

The same boundary now supports the anonymous track collection and
[`GET /v1/artists/{identifier}`](zig-v1-artist.md). Artist lookup keeps DID as
canonical identity, treats handles as aliases, and exposes the provenance of
legacy profile and preference fields rather than presenting the current tables
as authoritative.

[`GET /v1/albums?artist_did={did}`](zig-v1-album-collection.md) applies the
same rule to albums: the list-record AT-URI is identity, while local UUIDs and
presentation fields are never mistaken for PDS-authored state.

[`GET /v1/albums/{album_id}`](zig-v1-album-detail.md) now reads the shared
[`verified list projection boundary`](zig-verified-list-projection.md). It
preserves every ordered strong reference from verified DAG-CBOR repository
blocks and hydrates only exact public URI/CID matches, rather than fetching or
inventing membership during a REST request.

[`GET /v1/tracks/{track_id}/playback`](zig-v1-playback.md) resolves an explicit
playback capability independently of catalog metadata. It prefers exact
record-CID-bound delivery evidence, labels author-declared HTTPS fallbacks as
unverified, and makes authorization and byte availability distinct states.

Signed commit and snapshot ingestion now persist the
[`verified track projection`](zig-verified-track-projection.md) and
[`verified authored-profile projection`](zig-verified-profile-projection.md)
alongside list state. The separate
[`account-availability evidence boundary`](zig-account-availability.md) records
verified repository activity atomically and defines destination-safe
current-PDS checks. The track REST adapter now composes those verified sources
with canonical-URI application-policy and metrics projections, plus explicitly
attributed transitional R2 delivery fields. Access and operator moderation
share one physical row to keep reads cheap, but retain independent source and
observation fields so their writers cannot overwrite one another. Blob
mirroring, metrics, and policy/delivery projections remain independent; field-level
provenance prevents verified authored fields from laundering those local claims
into source truth.
