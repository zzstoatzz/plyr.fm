# Third-party API improvements

Source: [Tangled issue #6](https://tangled.org/zzstoatzz.io/plyr.fm/issues/6),
renderg.host's report about plylst. Stop at reviewed, tested PRs; do not merge or
deploy this stack.

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
