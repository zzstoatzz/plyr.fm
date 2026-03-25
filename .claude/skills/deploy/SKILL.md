---
description: deploy to production with preflight checks
disable-model-invocation: true
---

# deploy

deploy to production with preflight checks.

## preflight checks

run these checks and report any issues before proceeding:

1. **clean working tree** - `git status` should show nothing to commit
2. **on main branch** - `git branch --show-current` should be `main`
3. **up to date with origin** - `git fetch origin && git status` should not be behind
4. **no open PRs from your branch** - check for any unmerged work

## analyze changes and deploy

determine what changed since last release:

```bash
just changelog
```

Use `git diff` on the commit range to determine which directories were touched. Then pick the right release command — this is not a choice, it's deterministic:

- **backend changes** (anything in `backend/`, `scripts/`, root config files like `pyproject.toml`): `just release` (full release — tags, bumps version, triggers backend + frontend deploy)
- **frontend-only** (only `frontend/`, `.claude/`, `docs/`, `STATUS.md`, other non-backend files): `just release-frontend-only` (skips backend deploy)
- **docs/config only** (only `.claude/`, `docs/`, `STATUS.md`, `.md` files, no runtime code): no deployment needed — tell the user and stop

Report the change summary and which release command you're running, then execute it. Do not ask the user to choose — the changes determine the command.

## execute deployment

1. run the appropriate release command
2. push to tangled remote: `git push tangled main --tags`
3. report the release tag and deployment status

## post-deployment

remind the user to:
- monitor fly.io dashboard for backend deployment status (if full release)
- check https://plyr.fm once deployment completes
