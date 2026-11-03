# collection-complete repository repair

A record listing is a discovery aid, not proof that a collection is complete.
Oversized repositories now use `sync.getLatestCommit` to select a root, then
`sync.getBlocks` to fetch that commit and the MST branches covering the four
configured plyr collections. No `listRecords` response authorizes a deletion.

The commit selector is untrusted until signature verification binds the
assembled CAR to the expected DID and its resolved signing key. Every fetched
block is hash-checked. The range walk proves every selected record and every
selected empty interval; missing nodes or record blocks abort the repair before
projection. Projection version 2 forces unchanged repositories to rebuild from
complete collection proofs instead of trusting old per-record snapshot heads.
Requests for an immutable old root can fail if the PDS no longer
retains a block; the next reconciliation fetches a fresh root. An individual
record proof remains the live-ingestion path.

The sparse CAR is complete for the configured collections, not for unrelated
Bluesky data. It can enter the existing atomic snapshot transaction because the
verifier enumerates the selected collections from the signed tree, independently
of caller-supplied record paths. A failed fetch cannot become an empty snapshot.

`getBlocks` may return a CAR with an empty roots array. The transport adapter
replaces that header with the selected root before passing the unchanged block
frames to Zat's hash-checking parser, which otherwise requires a nonempty root.
CAR version and framing remain checked; a response's roots are never evidence
of authorship or completeness.

## resource bounds

- 64 CIDs per request, at most 512 requests and 64 MiB of received CAR bytes.
- At most 16,000 unique blocks, 16,000 visited MST nodes, 256 tree levels, and
  2,000 selected records. The output CAR is also capped at 64 MiB.
- Unrelated subtrees are skipped by their authenticated key bounds.
- The source still tries the existing bounded full-repository fetch first;
  these bounds and timings describe its oversized-repository fallback.

## measurement

`just zig bench-collection <did>` performs three public, read-only fetches and
verifications. It never connects to a database or writes a PDS record. Set
`PROOF_BENCH_NSID` to benchmark another namespace. The output separates fetching
(including identity resolution) from cryptographic verification and projection
decoding, and reports request count and received bytes. It does not measure
Postgres projection time or the preceding full-repository overflow.

On November 3, 2026, from the maintainer's macOS workstation, a ReleaseFast build
against gingerbag1.bsky.social's public PDS returned 16 tracks, 6 lists and 1 like:
5 block requests, 12,999 received bytes, 1,983–2,280 ms fetch/identity time and
229–237 microseconds verification/decoding across three samples. These are
network-specific samples, not a p95 latency or throughput claim.

A second read against pfrazee.com (no plyr records) proved all selected
collections empty in 11 block requests and 5,911 received bytes. Across three
samples, fetch/identity took 2,437–5,282 ms and verification 116–160 microseconds.

## regression coverage

Tests construct signed repositories and hash-linked MSTs. They cover omitted
records, absent requested blocks, tampered block bytes, empty collections,
empty-root CAR responses, and skipping unrelated subtrees. PostgreSQL repair
also refuses an older snapshot when newer live records exist, before clearing
anything for a decoder rebuild.
