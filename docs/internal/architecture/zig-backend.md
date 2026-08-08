---
title: "Zig backend architecture"
---

## purpose

the Zig backend is a re-architecture of plyr.fm as an ATProto appview, not a
line-for-line port of the Python service. Python tests and incident notes are
evidence about observable behavior and failure modes. They are not authority
for boundaries that made Postgres or R2 into accidental sources of truth.

## authority model

1. **the PDS is canonical.** User-authored music metadata, collections,
   interactions, and referenced blobs belong in signed ATProto records and the
   user's PDS. A successful local database write never makes a user action
   canonical.
2. **ingestion establishes trust.** Records entering the index must come through
   a verified repository path: commit signature, MST diff, record operation,
   and blob CID. Jetstream delivery alone is notification, not proof.
3. **Postgres is derived.** It is a query-optimized materialized view of verified
   repository state plus explicitly local operational state. The content index
   must be rebuildable without treating an old Postgres row as truth.
4. **R2 is a verified mirror.** Mirrored audio is keyed by the digest of bytes
   that match the blob CID. R2 improves playback, scanning, and resilience; it
   does not decide what a track is or whether it exists.
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

## write path

The steady-state write path is:

```text
client -> authenticated PDS write -> verified repo ingestion -> derived indexes
                                      -> verified blob mirror -> async analysis
```

An API request may coordinate or prepare the PDS write. It must not declare
success merely because Postgres or R2 accepted data. Pending rows are operation
state and expire or reconcile; they are not unpublished canonical tracks.

## process roles

One `plyr-backend` binary has explicit roles selected by `MODE`:

- `api`: stateless HTTP and WebSocket appview surface;
- `ingester`: verified relay/repository ingestion and reconciliation;
- `worker`: Docket task execution for mirrors, analysis, exports, and repair.

There is deliberately no implicit "all" role. Each process owns a bounded
resource and failure domain, matching the existing Fly process-group split.

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

The first end-to-end content slice is a public track projection:

1. consume and verify an `fm.plyr.*` repository commit;
2. validate the track record and referenced blob;
3. project it into a new derived track index;
4. mirror verified audio by content digest;
5. serve the indexed track and mirror URL;
6. remove it from serving after a verified delete.

That slice proves the authority, trust, index, storage, and deletion boundaries
before OAuth-coordinated publishing or the full legacy API surface is added.
