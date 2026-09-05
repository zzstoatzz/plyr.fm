# client interface contracts

The HTTP API owns behavior. The Python SDK shares typed sync/async namespaces;
the CLI renders them for terminals; the MCP curates reads for agents. Parity
means matching behavior where they overlap, with explicit omissions elsewhere.

`just check-client-contract` is an offline pre-commit gate. It builds OpenAPI
from router definitions without starting services or opening database connections,
then checks the reviewed client contract in `client-api.json`. Documentation-only
schema changes are ignored. The fixed dummy encryption key is only sufficient to
import route definitions; it is not a service credential.

The `interface contracts` workflow runs on every PR and main push. It checks out
`zzstoatzz/plyr-python-client` and runs its request/schema compatibility checker,
behavioral surface tests, SDK example signature checks, and generated-docs check against this backend. The
client repository performs the reciprocal check against this repository's main.
Live MCP deployment checks and Pi evaluations are separate, explicit commands;
network availability and model variability do not belong in pre-commit.

## changing a shared interface

1. Change the API and SDK together. Run the client repository's
   `scripts/check_api_contract.py --schema <export>` against the proposed API.
2. Add/update an operation in its `contracts/surfaces.json`. Map the CLI and MCP
   or explain why they omit it. Add a real HTTP-boundary case for each MCP tool.
3. Review affected response models, filters, access behavior and defaults. Refresh
   the client's `contracts/http.json` and copy the exact reviewed snapshot here.
4. Run `just check-interfaces` in the client, `just check-client-contract` here,
   and regenerate the client capability table with `just surfaces`.
5. Verify the deployment separately with `scripts/live_check.py --url
   https://plyrfm.fastmcp.app/mcp`; a successful hosted response can still come from
   an older build. Run the Pi scenarios when changing agent-facing behavior.

The snapshot covers the track/search/playlist/artist-identity/audio families used
by the client. Browser-only and other API-only services are not a promise of SDK
coverage. Extend the exporter and inventory when adopting another family.

For the initial rollout, merge the client changes before enabling this workflow:
it uses the new compatibility scripts from that repository's main branch.
