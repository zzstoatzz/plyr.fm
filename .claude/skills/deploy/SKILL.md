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

Report the change summary and which release command you've determined, then **ask the user to confirm before executing**. The changes determine the command, but the user must approve it.

## execute deployment

1. run the appropriate release command — `scripts/release` already mirrors to the `tangled` remote, no separate push step needed
2. report the release tag and deployment status

## post-deployment

watch the deploy yourself — don't offload this to the user. use `gh run watch` on the relevant workflow run so you get a live status stream and can react to failures immediately:

```bash
# after `just release` prints the release tag, find the deploy runs it triggered
gh run list --limit 5 --event release              # backend deploy runs
gh run list --limit 5 --branch production-fe       # frontend deploy runs
# then watch them
gh run watch <run-id> --exit-status
```

once both deploys complete:
- spot-check https://plyr.fm (prod frontend) and `curl -sf https://api.plyr.fm/health` (prod backend)
- report the outcome to the user with the run URLs
