---
title: "contributing"
---

plyr.fm is open source on [tangled.org](https://tangled.org/zzstoatzz.io/plyr.fm). contributions welcome.

## prerequisites

- [uv](https://docs.astral.sh/uv/) (Python 3.11+)
- [bun](https://bun.sh/) (frontend)
- [just](https://just.systems/) (task runner)

## quickstart

```bash
gh repo clone zzstoatzz/plyr.fm
cd plyr.fm

uv sync
cd frontend && bun install && cd ..

cp .env.example .env
# edit .env with your credentials

# terminal 1
just backend run

# terminal 2
just frontend run
```

visit http://localhost:5173 to see the app.

## workflow

1. check [`STATUS.md`](https://github.com/zzstoatzz/plyr.fm/blob/main/STATUS.md) for active tasks
2. [open an issue](https://github.com/zzstoatzz/plyr.fm/issues) describing the change
3. branch from `main`, make your changes
4. open a PR — never push directly to main

## useful commands

```bash
just backend run          # start backend
just frontend run         # start frontend
just backend test         # run tests (from repo root)
just backend lint         # lint python (ruff)
just frontend check       # lint svelte
just backend migrate-up   # apply migrations
```

## conventions

- **type hints** required everywhere (Python and TypeScript)
- **async everywhere** — never block the event loop
- **lowercase aesthetic** in naming, docs, and commits
- SvelteKit with **Svelte 5 Runes** (`$state`, `$derived`, `$effect`)
- use `uv` for Python (never `pip`)

detailed internal documentation (environment setup, deployment, architecture) is available to active contributors in the `docs-internal/` directory.
