# Third-party API improvements

Source: [Tangled issue #6](https://tangled.org/zzstoatzz.io/plyr.fm/issues/6),
renderg.host's report about plylst. The user subsequently authorized staging
landing of the API stack and an owner-selected album link. Production promotion
remains separate.

## Chunks

1. Audio HTTP semantics: expose proxy range headers, preserve upstream 416,
   and make the legacy `HEAD ?cors=1` path return upstream file metadata.
   Keep access checks and ordinary HEAD authorization behavior.
2. Metadata serialization: include stored track duration, restore artwork and
   play totals discarded by the global album schema, and return stored album
   creation times in list/detail responses. Version the album cache. Coordinate
   the additive track response with the Python SDK's checked API contract.

## Deferred decisions

- Album tags/hidden flags need album-level aggregation and visibility semantics.
- Artist-editable release dates need a data model and publishing contract.
- Upload-time waveform peaks need a storage/processing design.
- Third-party usage policy, rate-limit promises and play attribution need an
  explicit product decision; this stack makes no new promise or identifier.
- No historical metadata backfill or writes to artists' PDS records.

## Verification

Endpoint regressions must fail before each fix, using real PostgreSQL and Redis
and mocking only upstream network/storage boundaries. Run backend lint, the full
backend suite and API/SDK contract gates. Review the complete stack against access
control, cache compatibility, HTTP framing, and client compatibility before handoff.

## Metadata contract

`duration` is nullable integer seconds read from `Track.extra`; no PDS fetch or
backfill runs on reads. The SDK Track model preserves it for sync/async and MCP
responses; the CLI text view is unchanged. Album `created_at` is the local album
row's creation timestamp, not a release date or a guarantee of the PDS record's
`createdAt`. Global album artwork follows the existing cover/avatar fallback.

The backend and client check each other's `main` contract in CI. The client
checker now accepts optional response properties appearing or disappearing during
rollout, while rejecting required-field changes, shared-field type changes and
request drift. Both old-server and proposed-server compatibility pass.

## Adversarial self-review

Reviewed the audio PR's complete diff and the metadata/client diffs against the
report, not just their happy paths. The full suite caught a regression-fixture
collision: Redis persists between tests in a worker, so parameterized albums now
use distinct cache keys. No surviving implementation correctness finding:

- Gate checks precede upstream HEAD/GET. `cors=1` does not authorize listeners,
  disclose signed URLs, or change original-download restrictions.
- Upstream HEAD resources close before return. A 416 GET retains its body and
  length together; returning an empty response with an upstream body length
  would break HTTP framing. Other upstream refusals remain gateway failures.
- Proxy headers remain allow-listed; header exposure does not expand origins.
- Metadata comes from loaded rows and existing builders, with no new per-track
  PDS/SQL request, data rewrite, tag policy, or hidden-track aggregation.
- Album cache generation changes with the response shape. Required creation
  timestamps are supplied by every builder, including mutation responses.
- SDK duration defaults to None for older servers; both repositories have the
  same minimal contract delta and proposed-backend compatibility passes.

Review is a self-review, not an independent human or agent approval. Live
production, browser, and staging behavior has not been claimed or exercised.
