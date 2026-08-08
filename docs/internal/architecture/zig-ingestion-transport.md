---
title: "Zig verified ingestion transport"
---

## process authority

The API and ingestion processes are explicit roles of the same binary:

- `MODE=api` serves the read-only v1 surface. It never resolves identities,
  fetches repositories, or writes `plyr_index`;
- `MODE=repair` performs one authenticated complete-repository reconciliation
  for `INGEST_REPAIR_DID`, then exits. It requires `INDEX_MODE=required`, a
  database URL, and environment-aware track/list NSIDs.

The repair role does not run migrations. Its database principal must be allowed
to update the Zig-owned projection tables, while the canary API keeps its
restricted read-only role. This is a process boundary, not a boolean feature
flag inside an HTTP handler.

Run a one-shot repair with:

```sh
DATABASE_URL=... \
TRACK_COLLECTION_NSID=fm.plyr.dev.track \
LIST_COLLECTION_NSID=fm.plyr.dev.list \
just zig repair-repo did:plc:example
```

## direct PDS threat model

An ATProto DID document chooses its PDS service endpoint. That endpoint is
untrusted network input even when the repository bytes will later be
cryptographically verified. A naive redirect or ordinary hostname fetch can
reach loopback, Fly private networking, cloud metadata, or another internal
service before signature verification happens.

`safe_endpoint.zig` therefore enforces all of these before `getRepo`:

1. the service endpoint is a credential-free HTTPS origin, not a URL with a
   path, query, fragment, or embedded user info;
2. literal and DNS-resolved IPv4/IPv6 answers are classified before connect;
3. private, loopback, link-local, shared, documentation, benchmark,
   special-purpose, multicast, reserved, and IPv4-mapped equivalents fail;
4. every answer must be globally routable—a safe first answer cannot hide a
   private second answer;
5. one checked IPv4 address is pinned for the TCP connection while the
   original host remains the TLS certificate and SNI identity;
6. redirects remain disabled on the pinned request;
7. the CAR response is bounded to the snapshot verifier's 64 MiB limit.

Pinning removes DNS rebinding between validation and connection. TLS hostname
verification prevents the selected IP from substituting a certificate for a
different origin.

IPv6-only PDS endpoints currently return the explicit
`unsupported_endpoint` outcome. Zat v0.3.26's `ResolvedConnection` accepts an
IPv4 textual dial host; silently falling back to unpinned DNS for IPv6 would
undo the security boundary. This is a compatibility gap to close in Zat, not a
reason to weaken the application adapter.

## identity and repository verification

The DID document must identify the requested DID. Its signing method must be
exactly `{did}#atproto` and controlled by the same DID. A cached signing key is
used for the normal path; signature mismatch causes one fresh DID resolution
and one verification retry for legitimate rotation.

The fetched CAR is not trusted because its transport succeeded. The snapshot
verifier independently checks the signed commit, repository DID/revision/data
root, block CIDs, complete MST structure, and selected record blocks. Only then
does one Postgres transaction reconcile list records, ordered members,
authenticated absences, tombstones, and the durable repository head.

Unsafe endpoint, unsupported endpoint, endpoint missing, identity unavailable,
rate limited, repository missing, oversized, invalid signature, invalid
repository, projection failure, and successful/idempotent/stale outcomes remain
distinct. The process exits successfully only for `applied`, `idempotent`, or
`stale`.

## exercised path

On 2026-08-08 the complete role was run twice against a public repository and
the disposable local `relay_test` database. The first run resolved the DID and
PDS, performed the pinned TLS fetch, verified the complete CAR, and atomically
installed its head as `applied`; the second returned `idempotent`. A direct SQL
read confirmed the same DID and valid TID revision in `plyr_index.repo_heads`.

Linking the destination guard, DID/PDS clients, and repair coordinator raised
the production-shaped amd64 image from 33,237,999 to 34,864,321 bytes. This is
a 1,626,322-byte packaging cost; it does not start those dependencies in the
API role. Runtime RSS remains a Fly-native measurement gate.

That exercise found a real lower-level integration defect before deployment:
Zat's pinned-address transport connects before `std.http.Client.request`, while
the standard request path normally initializes the CA bundle and certificate
clock. The adapter now performs the same locked one-time initialization before
the pinned TLS dial. Without the live local exercise, the code compiled and its
pure safety tests passed but the first production fetch would have panicked.

## still open

The one-shot role proves destination-safe bootstrap and repair. Continuous
operation still needs a separately supervised relay/firehose consumer with:

- bounded frame and work queues;
- durable cursor/checkpoint semantics;
- identity-event key eviction;
- gap-triggered repair scheduling and retry/backoff;
- shutdown/drain behavior and ingestion health metrics;
- staging-native resource and failure testing.

None of that belongs in `MODE=api`.
