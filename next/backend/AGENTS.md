# next backend

## boundaries

- Keep `src/api/` responsible for HTTP dispatch and response mapping. Put
  catalog use cases in `src/internal/application/`, using the existing store
  interfaces; keep SQL and connection handling in their concrete adapters.
  Wire dependencies at startup rather than opening stores from handlers.
- Keep domain and protocol decisions independent of HTTP and database clients.
  For coordinator changes, preserve the separation between
  `src/internal/jams/server.zig`, its model/protocol and its persistence modules;
  do not put queue transition
  rules in socket handlers or implement them again in a store.
- Keep discovery, verification and projection distinct. Ingestion transports
  supply candidates and proofs; the projection verifier establishes authority
  before a store applies changes. Preserve atomic commit/snapshot application.
  A failed or partial fetch must never authorize deletion; see
  [collection proofs](docs/collection-proofs.md).
- Extend the owning subsystem and its interface before adding another service
  or shared utility. Extract a responsibility when it has an independent
  contract; do not scatter one operation across forwarding-only modules.

## checks

From the repository root, run `just zig check`. Changes to Postgres adapters
also require `just zig test-postgres`; Redis coordination requires
`just zig test-redis` and `just zig test-play-http`. Use the dedicated disposable
services these recipes configure, never a deployment database for tests.

Test application outcomes through store interfaces and persistence semantics
against the real adapters. For untrusted-input or state-machine changes,
extend the existing property harness with a regression for the failure mode;
commands and replay instructions are in the [backend readme](README.md).
