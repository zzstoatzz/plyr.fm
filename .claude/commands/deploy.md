# deploy

deploy to production with preflight checks.

## preflight checks

run these checks and report any issues before proceeding:

1. **clean working tree** - `git status` should show nothing to commit
2. **on main branch** - `git branch --show-current` should be `main`
3. **up to date with origin** - `git fetch origin && git status` should not be behind
4. **no open PRs from your branch** - check for any unmerged work

## analyze changes

determine what changed since last release:

```bash
just changelog
```

categorize changes:
- **backend changes**: anything in `backend/`, `scripts/`, root config files
- **frontend changes**: anything in `frontend/`
- **docs only**: only changes to `docs/`, `STATUS.md`, `*.md` files

report the change summary to the user.

## deployment decision

based on the changes:
- if **backend changes**: full release needed (`just release`)
- if **frontend only**: can use `just release-frontend-only` (faster)
- if **docs only**: no deployment needed, but can release if desired

ask for confirmation before proceeding.

## execute deployment

if confirmed:

1. run `just release` (or `just release-frontend-only` if applicable)
2. push to tangled remote: `git push tangled main --tags`
3. report the release tag and deployment status

## post-deployment

remind the user to:
- monitor fly.io dashboard for backend deployment status
- check https://plyr.fm once deployment completes
