---
name: contribute
description: Contributing to plyr.fm — an audio streaming app built on ATProto. Use when making changes to the plyr.fm codebase, fixing bugs, adding features, or opening pull requests.
metadata:
  author: zzstoatzz
  repo: https://github.com/zzstoatzz/plyr.fm
---

# how to contribute to plyr.fm

## step 1: orient yourself

read these files in the repo — they have everything you need:

- `CLAUDE.md` — project rules, stack, structure, conventions
- `STATUS.md` — active tasks and known issues
- `backend/.env.example` — all environment variables with comments
- `docs/internal/local-development/setup.md` — full local dev walkthrough

check [open issues](https://github.com/zzstoatzz/plyr.fm/issues) for things to work on.

## step 2: fork and set up

```bash
gh repo fork zzstoatzz/plyr.fm --clone
cd plyr.fm
uv sync && cd frontend && bun install && cd ..
cp backend/.env.example backend/.env
# edit backend/.env — DATABASE_URL is required, see the file for details
```

if you need to run the full stack locally, read `docs/internal/local-development/setup.md`. for frontend-only changes you may not need the backend running at all.

## step 3: make your change

- branch from `main`
- for bug fixes, add a regression test
- run `just --list` to see available commands (linting, tests, etc.)

## step 4: validate

```bash
just backend lint       # python: type check + ruff
just frontend check     # svelte: type check
just backend test       # runs tests with isolated docker postgres + redis
```

## step 5: open a PR

open a PR from your fork to `zzstoatzz/plyr.fm:main`. describe what changed and why.

PRs are the only way changes land — the main branch is protected.
