# plyr.fm

Read `STATUS.md` for active work and the scoped `AGENTS.md` beside the code being changed.
Use the root and component justfiles for development commands.

## workflow

- Track work in GitHub Issues. Use review PRs; never push directly to main.
- Merging main deploys staging. Production uses `just release`, or
  `just release-frontend-only` for frontend-only changes, through the
  [environment workflow](docs/internal/deployment/environments.md). Never deploy locally.
- For operational work, verify the required service access using
  [agent access](docs/internal/tools/agent-access.md).
- Project skills live in `.agents/skills/`: `onboard` for setup, `change` for
  project work, and `contribute` for external contributors. Work on the next
  client (`next/app`) uses `next-write-ui`, `next-unslop` and `next-review`.
  Preserve the `.claude/skills/` compatibility links.

## development and checks

Run from the repository root:

```sh
just backend run
just frontend run
just backend test
just backend lint
just frontend check
```

Use `just loq-relax <file>` for justified file-size limit changes; do not edit
`loq.toml` manually or compress code to satisfy it. Migrations use
`just backend migrate "message"` and `just backend migrate-up`.

## constraints

- AT Protocol namespaces come from environment-aware settings; do not hardcode
  NSIDs outside scripts.
- Authentication uses HttpOnly session cookies, never localStorage.
- Keep event-loop work nonblocking. Python and TypeScript require type hints;
  imports stay at the top except to resolve circular dependencies.
- Keep code comments short and specific; design rationale belongs in docs or commits.
- `MODERATION_AUTH_TOKEN` authorizes labeler writes. `MODERATION_BSKY_PASSWORD`
  declares the AT Protocol service and cannot emit labels. Never print either.
