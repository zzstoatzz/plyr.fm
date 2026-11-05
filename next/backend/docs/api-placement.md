# Next API placement

The Next database is Neon us-west-2. On November 5 UTC the only API Machine
was in iad, while the ingester was in sjc. Live play receipt logs measured
365–374 ms for both new receipts and duplicate lookups; the same transaction
path took approximately 2 ms against local Postgres. The three SQL commands
were four network round trips: BEGIN and COMMIT each used a simple-query
cycle, while the parameterized SELECT prepared/described and then bound/executed
in separate cycles. API-to-database distance is therefore material.

The desired API region is sjc (San Jose), an active West Coast region. Changing primary_region sets future placement;
it does not move an existing VM. The deployment workflow therefore runs
scripts/canary_placement.py after deploying the image and passing the normal
product smoke. The script is restricted to this repository's main-branch CI
and the isolated plyr-api-zig-canary app. It does not accept an app argument.

The existing, otherwise unused placement helper has been narrowed to this
operation. Its former generic prepare/restore/complete commands are removed.

## Relocation

1. Inspect live Machine JSON. Require one app process with services and no
   mounted volume. Ignore the ingester; refuse unexpected public service groups.
2. If the API is already in sjc, make no Machine changes.
3. Clone that exact API into sjc with a unique CI-run name. Fly's clone starts
   the replacement and retains the process group's configuration.
4. Poll the replacement's own checks. Require started state, passing checks and
   a ready response reporting index reachable. Verify image, environment,
   services, guest size, command and restart configuration match the deployed
   original. Revalidate identities and readiness before retiring the original.
5. Destroy only the original API ID. Confirm one API remains in sjc, then run
   the product smoke again through the public Fly hostname.

The original remains available until the replacement passes readiness. A
failed clone, unhealthy replacement or lost readiness removes only the exact
new replacement. If old retirement fails or its response is lost, the script
keeps the healthy replacement and fails visibly: it must not remove the only
working API after an uncertain destroy. Inventory ambiguity or concurrent
configuration changes fail closed and require operator inspection. A cancelled
runner can also require checking for a leftover replacement before rerunning.

No database, PDS, ingester placement, volumes or production application changes
are part of relocation. The replacement retains auto-stop/auto-start and the
same 256 MB size; successful completion leaves one API VM, not a second
always-on copy. Parent primary_region changes do not move existing ingesters.

## Verification

The tests exercise the actual orchestration against JSON command-boundary
fixtures: no-op placement, exact clone/retirement ordering, volume and multiple
API refusal, wrong configuration, clone partial failure, health failure, and
retirement response loss. They perform no Fly writes.

Run from backend:

    uv run pytest -q ../next/backend/scripts/test_canary_placement.py

After CI deploys, inspect actual Machine IDs/regions and collect new and duplicate
receipt elapsed_ms logs again. A changed config or a passing fixture test is not
evidence that the live API moved or that latency improved. Compare server
operation time separately from browser request time and audio startup.

## Measured result and statement reuse

CI run 41974327873 completed the move on November 5 UTC. The API is now Machine
811093f92976e8 in sjc; the old iad API was removed. The ingester remains Machine
82756da7779398 in sjc. Warm duplicate receipt requests after relocation measured
HTTP p50 177 ms and p95 207 ms over 20 requests, with server elapsed_ms 94–95 ms,
compared with 365–374 ms in the old region. These are observed samples, not SLOs.

The current path still uses four network cycles for its three SQL commands.
A local prototype named the SELECT with conn.rowOpts, and wire inspection
confirmed that a warm call omitted Parse and Describe messages. However,
pg.zig's cached branch sends a standalone Sync, then Stmt.prepareForBind waits
for ReadyForQuery before sending Bind/Execute. That awaited exchange replaces
the prepare/describe exchange; it does not remove a round trip. The cache-only
runtime change was therefore not shipped.

Named statements can still save parse/planning CPU, but that is different from
reducing network cycles. The broader prepared-statement read work in #2320
remains separate. Any future wire-latency optimization must remove the awaited
Sync barrier and be measured independently. The regional improvement above is
the verified change; no driver, pool or infrastructure expansion followed it.

## Provider references

- [Fly process groups](https://docs.fly.io/launch/processes): clone preserves a
  process group's commands, services and checks.
- [Fly Machine clone](https://fly.io/docs/flyctl/machine-clone/): explicit region
  selection; cloning a mounted volume would create a new empty volume, which is
  why this script refuses mounts.
- [Fly Machines resource](https://docs.fly.io/machines/api/machines-resource):
  Machine region, identity, configuration and check state.

## CLI failure diagnostics

The first relocation attempt targeted Seattle (sea), which Fly deprecated in its
[region consolidation](https://fly.io/blog/the-region-consolidation-project/).
The live region inventory no longer includes it. San Jose (sjc) is the closest
active Fly region to the Oregon database. Relocation now checks advertised
region availability before cloning. Capturing
subprocess output without reporting stderr hid the provider's reason, so that
run did not expose the provider error directly. Failures and timeouts now report
bounded stderr with the current
Fly token and its unprefixed form redacted. Raw inventory/config output is not
printed. Clone also receives the explicit fly.canary.toml path.

Fly v0.5.4's [clone implementation](https://github.com/superfly/flyctl/blob/v0.5.4/internal/command/machine/clone.go)
uses source.FullImageRef(), adding a digest pin to the copied image reference.
Configuration comparison normalizes that pin while independently requiring the
healthy replacement's actual image digest to match the source. Comparing the
raw image strings would incorrectly reject an otherwise identical clone.
The source's [config loader](https://github.com/superfly/flyctl/blob/v0.5.4/internal/command/command.go)
permits a missing default config when --app is supplied; missing fly.toml alone
is therefore not a demonstrated explanation for the first failure.
