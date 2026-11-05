# Next API placement

The Next database is Neon us-west-2. On November 5 UTC the only API Machine
was in iad, while the ingester was in sjc. Live play receipt logs measured
365–374 ms for both new receipts and duplicate lookups; the same transaction
path took approximately 2 ms against local Postgres. The three sequential
transaction round trips make API-to-database distance material.

The desired API region is sea. Changing primary_region sets future placement;
it does not move an existing VM. The deployment workflow therefore runs
scripts/canary_placement.py after deploying the image and passing the normal
product smoke. The script is restricted to this repository's main-branch CI
and the isolated plyr-api-zig-canary app. It does not accept an app argument.

The existing, otherwise unused placement helper has been narrowed to this
operation. Its former generic prepare/restore/complete commands are removed.

## Relocation

1. Inspect live Machine JSON. Require one app process with services and no
   mounted volume. Ignore the ingester; refuse unexpected public service groups.
2. If the API is already in sea, make no Machine changes.
3. Clone that exact API into sea with a unique CI-run name. Fly's clone starts
   the replacement and retains the process group's configuration.
4. Poll the replacement's own checks. Require started state, passing checks and
   a ready response reporting index reachable. Verify image, environment,
   services, guest size, command and restart configuration match the deployed
   original. Revalidate identities and readiness before retiring the original.
5. Destroy only the original API ID. Confirm one API remains in sea, then run
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

## Provider references

- [Fly process groups](https://docs.fly.io/launch/processes): clone preserves a
  process group's commands, services and checks.
- [Fly Machine clone](https://fly.io/docs/flyctl/machine-clone/): explicit region
  selection; cloning a mounted volume would create a new empty volume, which is
  why this script refuses mounts.
- [Fly Machines resource](https://docs.fly.io/machines/api/machines-resource):
  Machine region, identity, configuration and check state.
