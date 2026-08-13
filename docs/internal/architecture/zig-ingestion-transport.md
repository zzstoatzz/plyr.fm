---
title: "Zig verified ingestion transport"
---

## process authority

The API and ingestion processes are explicit roles of the same binary:

- `MODE=api` serves the read-only v1 surface. It never resolves identities,
  fetches repositories, or writes `plyr_index`;
- `MODE=repair` performs one authenticated complete-repository reconciliation
  for `INGEST_REPAIR_DID`, then exits. It requires `INDEX_MODE=required`, a
  database URL, and environment-aware track/list NSIDs;
- `MODE=ingester` owns the continuous signed `subscribeRepos` connection,
  verified projection writes, authoritative repair, and one source-scoped
  relay checkpoint. It never serves HTTP.

The repair role does not run migrations. Its database principal must be allowed
to update the Zig-owned projection tables, while the canary API keeps its
restricted read-only role. This is a process boundary, not a boolean feature
flag inside an HTTP handler.

Run a one-shot repair with:

```sh
DATABASE_URL=... \
TRACK_COLLECTION_NSID=fm.plyr.dev.track \
LIKE_COLLECTION_NSID=fm.plyr.dev.like \
LIST_COLLECTION_NSID=fm.plyr.dev.list \
just zig repair-repo did:plc:example
```

Run the continuous role with `just zig ingest`. `INGEST_RELAY_HOSTS` is a
comma-separated ordered set of `wss://` endpoints and defaults to
`wss://bsky.network`. `INGEST_RELAY_NAME` is the durable identity of their
shared sequence space; it defaults to `bsky.network` and deliberately does not
change when Zat rotates to another regional host.

## continuous acceptance boundary

The relay is consumed through Zat's fallible raw-frame callback. A decoded
callback would advance Zat's reconnect cursor before projection could report a
failure. The raw callback advances only after the application accepts the
frame, so malformed input, invalid proof, failed repair, and failed checkpoint
persistence all leave that sequence replayable.

The first scheduler is intentionally FIFO with exactly one borrowed frame and
one projection operation in flight. The WebSocket reader, TCP receive window,
and upstream provide bounded backpressure; there is no application queue to
overflow, drop, reorder, or watermark incorrectly. This preserves ordering for
every repository and follows the Zig Zen's preference for simple, explicit
control flow. Parallel per-DID chains are warranted only if measurements show
that verified repositories cannot keep up.

`plyr_index.relay_cursors` stores a monotonic sequence per configured relay
identity. Accepted progress is coalesced for four seconds. A crash can
therefore replay a short idempotent suffix, but cannot skip work: the cursor is
changed only after the frame's projection/repair succeeds, and a database write
never replaces a greater sequence with a smaller replay.

The process does not bootstrap every DID on the public network. At startup it
loads the interest set from authenticated `repo_heads`. Unknown repositories
are decoded and ignored until an operation touches the configured track or
list collection. The first such event triggers a complete authenticated PDS
snapshot and adds that DID to the interest set. Every later commit for that DID
is verified and advances its repository head even when the commit contains no
selected record, preserving MST continuity. Identity events evict cached
signing keys; watched sync events trigger authoritative repair; an
`OutdatedCursor` control frame fails the role rather than silently creating an
unfillable gap.

Account control events are outside the signed-record projection and currently
advance only the relay checkpoint. The
[`account-availability evidence boundary`](zig-account-availability.md) now
records authenticated repository activity and classifies destination-safe
current-PDS status responses without coupling signed records to the legacy
`artists` table. Relay account events now write only deduplicated schedule hints;
the separately supervised checker and periodic sweep own network reconciliation,
so untrusted PDS latency cannot block this firehose loop.

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

## live relay baseline

On 2026-08-08 the `MODE=ingester` role connected to `bsky.network` against the
disposable `relay_test` database, persisted cursor `32574925168`, restarted,
and resumed with that exact cursor in the subscribe URL. With an empty interest
set it used 14.2 MiB RSS on the Apple M5 Pro host. This is 32.8 times smaller
than the 466.1 MiB complete local FastAPI process, but the roles do different
work and the comparison is a resource guardrail rather than functional parity.

`just zig bench-ingest-dispatch` measures raw commit-frame decode plus
collection discovery. The one-million-frame ReleaseFast run processed a
240-byte irrelevant commit in 219 ns, or 4.57 million frames/second. It excludes
the network, cryptographic verification, PDS repair, and Postgres persistence;
its purpose is to prove that filtering the public firehose is not itself the
bottleneck.

The rebuilt production-shaped amd64 artifact is a 35,152,308-byte image, only
287,987 compressed bytes above the repair-enabled artifact. The uncompressed
ReleaseSafe executable is 12,531,312 bytes now that the firehose and WebSocket
code is reachable.

## still open

The separately supervised consumer, cursor, identity eviction, and synchronous
gap repair are implemented. Continuous deployment still needs:

- signal-driven graceful stop and final checkpoint flush;
- retry/backoff and observable state for PDS repairs that cannot complete
  synchronously;
- account/profile projection and verified blob mirroring; signed track records
  and durable track tombstones now share the repository transaction;
- ingestion health/lag metrics and an operator-visible poison-event policy;
- staging-native resource, failure, and large-CAR testing.

None of that belongs in `MODE=api`.
