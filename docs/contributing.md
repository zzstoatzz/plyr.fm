---
title: "contributing"
description: "contribute to plyr.fm development"
---

plyr.fm is open source. development happens on [GitHub](https://github.com/zzstoatzz/plyr.fm) (mirrored to [tangled.org](https://tangled.org/zzstoatzz.io/plyr.fm)). contributions welcome — fork the repo and open a PR.

## using a coding assistant?

if you're using Claude Code, Cursor, Codex, or similar — copy the prompt below into your assistant to get oriented:

```
i want to contribute to plyr.fm. the repo is at https://github.com/zzstoatzz/plyr.fm

read the CLAUDE.md at the repo root for project context, then read STATUS.md
for active tasks. fork the repo, make your change on a branch, run linting
(just backend lint / just frontend check), add tests for bug fixes, and open a PR.

the stack is FastAPI + SvelteKit + Postgres + Redis. use `uv` for Python, `bun`
for frontend, and `just` as the task runner. see backend/.env.example for all
environment variables.
```

or install the [contribute skill](https://github.com/zzstoatzz/plyr.fm/tree/main/skills/contribute) for richer agent context.

## prerequisites

- [uv](https://docs.astral.sh/uv/) (Python 3.11+)
- [bun](https://bun.sh/) (frontend)
- [just](https://just.systems/) (task runner)
- [docker](https://www.docker.com/) (for Redis and test databases)

## quickstart

```bash
# fork on github, then clone your fork
gh repo fork zzstoatzz/plyr.fm --clone
cd plyr.fm

# install dependencies
uv sync
cd frontend && bun install && cd ..

# configure environment
cp backend/.env.example backend/.env
# edit backend/.env — see the setup guide linked below for details
```

### running the stack

```bash
# start redis (required for background tasks)
just dev-services

# terminal 1 — backend (port 8001, hot reloads)
just backend run

# terminal 2 — frontend (port 5173, hot reloads)
just frontend run
```

the backend needs a Postgres connection. you can use the [Neon](https://neon.tech) dev instance or a local Postgres — set `DATABASE_URL` in your `.env`. see [`backend/.env.example`](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/.env.example) for all configuration options and the [local development setup guide](https://github.com/zzstoatzz/plyr.fm/blob/main/docs-internal/local-development/setup.md) for detailed walkthrough.

## workflow

1. check [`STATUS.md`](https://github.com/zzstoatzz/plyr.fm/blob/main/STATUS.md) for active tasks
2. [open an issue](https://github.com/zzstoatzz/plyr.fm/issues) describing the change
3. fork the repo, branch from `main`, make your changes
4. open a PR from your fork

## useful commands

```bash
just backend run          # start backend
just frontend run         # start frontend
just dev-services         # start redis
just backend test         # run tests (spins up isolated postgres + redis)
just backend lint         # type check + ruff
just frontend check       # svelte type check
just backend migrate-up   # apply database migrations
```

## conventions

- **type hints** required everywhere (Python and TypeScript)
- **async everywhere** — never block the event loop
- **lowercase aesthetic** in naming, docs, and commits
- SvelteKit with **Svelte 5 Runes** (`$state`, `$derived`, `$effect`)
- use `uv` for Python (never `pip`)
- add regression tests when fixing bugs

detailed internal documentation (environment setup, deployment, architecture) is in [`docs-internal/`](https://github.com/zzstoatzz/plyr.fm/tree/main/docs-internal).
