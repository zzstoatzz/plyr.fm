# plyr.fm Developer Context

**audio streaming app**

## Reminders
- i am already hot-reloading the backend and frontend. i might also have ngrok exposing 8001
- check the justfiles. there's a root one, one for the backend, one for the frontend, and one for the transcoder etc

## 🚨 Critical Rules & Workflows
*   **Read `STATUS.md` First:** Always check for active tasks and known issues.
*   **Workflow:**
    *   Use **GitHub Issues** (not Linear).
    *   **PRs:** Always create for review; never push to main directly.
    *   **Deploy:** Merging to `main` auto-deploys to **staging** (`stg.plyr.fm`). Production requires `just release` (see `docs/deployment/environments.md`). Never deploy locally.
*   **ATProto NSIDs:** namespaces are environment-aware via settings (e.g., `fm.plyr.dev` (dev), `fm.plyr` (prod)). **Never** hardcode outside of scripts. these are fully-qualified hostname in Reverse Domain-Name Order, not urls.
*   **Auth Security:** Session IDs live in HttpOnly cookies. **Never** touch `localStorage` for auth.
*   **Async Everywhere:** Never block the event loop. Use `anyio`/`aiofiles`.
*   **Type Hints:** Required everywhere (Python & TypeScript).
*   **Communication:** Use emojis sparingly and strictly for emphasis.
*   **DO NOT UNNECESSARILY DEFER IMPORTS.** Put imports at the top of the file where they belong. Deferred imports inside functions are only acceptable for avoiding circular imports - not for "lazy loading" or other reasons.

## 🛠️ Stack & Tooling
*   **Backend:** FastAPI, Neon (Postgres), Cloudflare R2, Fly.io.
*   **Frontend:** SvelteKit (Svelte 5 Runes), Bun, Cloudflare Pages.
*   **Observability:** Logfire.
*   **`just` use the justfiles!**
*   **use MCPs** for access to external systems, review docs/tools when needed

### Neon Serverless Postgres
- `plyr-prd` (cold-butterfly-11920742) - production (us-east-1)
- `plyr-stg` (frosty-math-37367092) - staging (us-west-2)
- `plyr-dev` (muddy-flower-98795112) - development (us-east-2)

## 💻 Development Commands
*   **Backend:** `just backend run`
*   **Frontend:** `just frontend run`
*   **Tests:** `just backend test` (run from repo root, not from backend/)
*   **Linting:** `just backend lint` (Python) / `just frontend check` (Svelte)
*   **loq (line count):** when a file exceeds its limit, run `just loq-relax <file>` — never manually edit loq.toml or play code golf to fit
*   **Migrations:** `just backend migrate "message"` (create), `just backend migrate-up` (apply)

## 📂 Project Structure
```
plyr.fm/
├── backend/
│   └── src/backend/
│       ├── api/          # Public endpoints
│       ├── _internal/    # Auth, PDS, Uploads logic
│       ├── models/       # SQLAlchemy schemas
│       ├── storage/      # R2 and filesystem adapters
│       └── utilities/    # Config, helpers
├── frontend/             # SvelteKit app
│   ├── src/routes/       # Pages (+page.svelte, +page.server.ts)
│   └── src/lib/          # Components & State (.svelte.ts)
├── services/
│   ├── transcoder/       # Audio transcoding (Rust, Fly.io)
│   ├── moderation/       # Content moderation (Rust, Fly.io)
│   └── clap/             # ML embeddings (Python, Modal)
├── infrastructure/
│   └── redis/            # Self-hosted Redis (Fly.io)
├── scripts/              # Admin scripts (uv run scripts/...)
├── docs/                 # Architecture & Guides
└── STATUS.md             # Living status document
```

this file ("AGENTS.md") is symlinked to `CLAUDE.md` for maximal compatibility.