---
name: contribute
description: Contributing to plyr.fm — an audio streaming app built on ATProto. Use when making changes to the plyr.fm codebase, fixing bugs, adding features, or opening pull requests.
metadata:
  author: zzstoatzz
  repo: https://github.com/zzstoatzz/plyr.fm
---

# contributing to plyr.fm

## orientation

1. read `CLAUDE.md` at the repo root — it has project structure, stack details, and rules
2. read `STATUS.md` for active tasks and known issues
3. check [open issues](https://github.com/zzstoatzz/plyr.fm/issues) for things to work on

## stack

- **backend**: FastAPI, SQLAlchemy, Neon Postgres, Cloudflare R2 — in `backend/`
- **frontend**: SvelteKit (Svelte 5 Runes), Bun — in `frontend/`
- **task runner**: `just` (justfiles at root, `backend/`, `frontend/`, etc.)
- **python**: always use `uv`, never `pip`
- **services**: Redis (via `just dev-services`), transcoder (Rust), moderation (Rust)

## making changes

1. fork `zzstoatzz/plyr.fm` on GitHub
2. branch from `main`
3. make your changes
4. run linting before committing:
   - `just backend lint` — python type checking + ruff
   - `just frontend check` — svelte type check
5. add regression tests for bug fixes (`just backend test` runs them)
6. open a PR from your fork — describe what changed and why

## key rules

- type hints required everywhere (Python and TypeScript)
- async everywhere — never block the event loop (`anyio`/`aiofiles`)
- lowercase aesthetic in naming, docs, commits
- imports at the top of files — only defer to break circular deps
- never hardcode ATProto NSIDs — they're environment-aware via settings
- session IDs in HttpOnly cookies — never use localStorage for auth

## running locally

```bash
uv sync && cd frontend && bun install && cd ..
cp backend/.env.example backend/.env
# edit backend/.env — needs DATABASE_URL at minimum

just dev-services    # redis
just backend run     # port 8001
just frontend run    # port 5173
```

see `backend/.env.example` for all env vars. see `docs-internal/local-development/setup.md` for detailed walkthrough.

## environment variables

the backend requires a `.env` file. key vars:

- `DATABASE_URL` — postgres connection (Neon dev instance or local)
- `ATPROTO_CLIENT_ID`, `ATPROTO_CLIENT_SECRET`, `ATPROTO_REDIRECT_URI` — OAuth config
- `STORAGE_BACKEND` — "filesystem" for local dev (no R2 needed)
- `DOCKET_URL` — redis URL for background tasks (optional, falls back to asyncio)

## useful commands

```
just backend run          # start backend (hot reload)
just frontend run         # start frontend (hot reload)
just dev-services         # start redis
just backend test         # run tests (isolated postgres + redis via docker)
just backend lint         # type check + ruff
just frontend check       # svelte type check
just backend migrate-up   # apply migrations
just backend migrate "msg" # create migration
```

## project structure

```
backend/src/backend/
├── api/          # public endpoints
├── _internal/    # auth, PDS, uploads
├── models/       # SQLAlchemy schemas
├── storage/      # R2 and filesystem
└── utilities/    # config, helpers

frontend/src/
├── routes/       # pages (+page.svelte, +page.server.ts)
└── lib/          # components & state (.svelte.ts)
```

## further reading

- `docs-internal/` — detailed architecture, deployment, testing docs
- `docs/lexicons/overview.md` — ATProto record schemas
- `backend/.env.example` — all configuration options
