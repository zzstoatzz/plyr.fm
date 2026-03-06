---
title: "contributing"
---

# contributing

guide for contributing to plyr.fm.

## getting started

### prerequisites

- **python**: 3.11+ (managed via [`uv`](https://docs.astral.sh/uv/))
- **bun**: for frontend development
- **postgres**: local database (optional — can use neon dev instance)

### setup

```bash
gh repo clone zzstoatzz/plyr.fm
cd plyr.fm

# install dependencies
uv sync
cd frontend && bun install && cd ..

# configure environment
cp .env.example .env
# edit .env with your credentials (see local-development/setup for details)

# start backend (terminal 1)
just backend run

# start frontend (terminal 2)
just frontend run
```

visit http://localhost:5173 to see the app. see [local development setup](./local-development/setup.md) for complete environment configuration, database setup, and troubleshooting.

## development workflow

1. **check [`STATUS.md`](https://github.com/zzstoatzz/plyr.fm/blob/main/STATUS.md)** for active tasks and known issues
2. **create a GitHub issue** describing the change (we use GitHub Issues, not Linear)
3. **branch from `main`**, make your changes
4. **open a PR** for review — never push directly to main
5. merging to `main` auto-deploys to **staging** (`stg.plyr.fm`). production requires `just release`

### running tests

```bash
# from repo root (not from backend/)
just backend test

# specific test file
uv run pytest tests/api/test_tracks.py -v

# with coverage
uv run pytest --cov=backend
```

always add regression tests when fixing bugs.

### linting

```bash
just backend lint    # python (ruff)
just frontend check  # svelte (svelte-check)
```

### database migrations

```bash
# create migration after model changes
just backend migrate "description of change"

# apply migrations
just backend migrate-up
```

see [database migrations](./deployment/database-migrations.md) for the full workflow.

## conventions

### code style

- **type hints required** everywhere — Python and TypeScript
- **async everywhere** — never block the event loop. use `anyio`/`aiofiles`
- **lowercase aesthetic** in naming, docs, and commit messages
- **imports at the top** of files — only defer imports to break circular dependencies
- **keep it simple** — MVP over perfection

### python

- use `uv` for everything (never `pip`)
- use `uv run` to execute scripts and tools
- prefer walrus operator (`:=`) for assign-and-check patterns
- inline pass-through intermediate variables into constructor calls

### frontend

- SvelteKit with **Svelte 5 Runes** — use `$state`, `$derived`, `$effect`
- see [state management](./frontend/state-management.md) for patterns

### ATProto

- NSIDs are environment-aware via settings (`fm.plyr.dev` for dev, `fm.plyr` for prod) — never hardcode them
- session IDs live in HttpOnly cookies — never use `localStorage` for auth

## useful commands

```bash
# development
just backend run              # start backend
just frontend run             # start frontend
just backend test             # run tests
just backend lint             # lint python
just frontend check           # lint svelte

# database
just backend migrate "msg"    # create migration
just backend migrate-up       # apply migrations

# infrastructure
just dev-services             # start redis (docker)
just dev-services-down        # stop redis
just tunnel                   # expose backend via ngrok
```

## project structure

```
plyr.fm/
├── backend/src/backend/
│   ├── api/              # public endpoints
│   ├── _internal/        # auth, PDS, uploads
│   ├── models/           # SQLAlchemy schemas
│   ├── storage/          # R2 and filesystem
│   └── utilities/        # config, helpers
├── frontend/src/
│   ├── routes/           # pages (+page.svelte, +page.server.ts)
│   └── lib/              # components & state (.svelte.ts)
├── services/
│   ├── transcoder/       # audio transcoding (Rust)
│   ├── moderation/       # content moderation (Rust)
│   └── clap/             # ML embeddings (Python, Modal)
├── scripts/              # admin scripts (uv run scripts/...)
├── docs/                 # architecture & guides
└── STATUS.md             # living status document
```

## further reading

- [local development setup](./local-development/setup.md) — full environment config and troubleshooting
- [backend configuration](./backend/configuration.md) — settings and environment variables
- [state management](./frontend/state-management.md) — Svelte 5 runes patterns
- [deployment environments](./deployment/environments.md) — staging vs production
- [tools](./tools/) — logfire, neon, pdsx, and other dev tools
