# plyr.fm Developer Context

**music streaming on AT Protocol**

## 🚨 Critical Rules & Workflows
*   **Read `STATUS.md` First:** Always check for active tasks and known issues.
*   **Workflow:**
    *   Use **GitHub Issues** (not Linear).
    *   **PRs:** Always create for review; never push to main directly.
    *   **Deploy:** Automated via Actions (Backend: Fly.io, Frontend: Cloudflare Pages). Never deploy locally.
*   **ATProto Namespaces:** namespaces are environment-aware via settings (e.g., `fm.plyr.dev`, `fm.plyr`). **Never** hardcode outside of scripts
*   **Auth Security:** Session IDs live in HttpOnly cookies. **Never** touch `localStorage` for auth.
*   **Async Everywhere:** Never block the event loop. Use `anyio`/`aiofiles`.
*   **Type Hints:** Required everywhere (Python & TypeScript).
*   **Communication:** Use emojis sparingly and strictly for emphasis.

## 🛠️ Stack & Tooling
*   **Backend:** FastAPI, Neon (Postgres), Cloudflare R2, Fly.io.
*   **Frontend:** SvelteKit (Svelte 5 Runes), Bun, Cloudflare Pages.
*   **Observability:** Logfire.
*   **`just` use the justfile!
*   **use MCPs for access to external systems, review docs/tools when needed

## 💻 Development Commands
*   **Setup:** `uv sync && just frontend install`
*   **Backend:** `just run-backend` (or `uv run uvicorn backend.main:app --reload`)
*   **Frontend:** `just frontend dev` (or `cd frontend && bun run dev`)
*   **Tests:** `just test`
*   **Linting:** `just lint`
*   **Migrations:** `just migrate "message"` (create), `just migrate-up` (apply)

## 📂 Project Structure
```
plyr/
├── src/backend/
│   ├── api/          # Public endpoints
│   ├── _internal/    # Auth, PDS, Uploads logic
│   ├── models/       # SQLAlchemy schemas
│   ├── storage/      # R2 and filesystem adapters
│   └── utilities/    # Config, helpers
├── frontend/         # SvelteKit app
│   ├── src/routes/   # Pages (+page.svelte, +page.server.ts)
│   └── src/lib/      # Components & State (.svelte.ts)
├── scripts/          # Admin scripts (uv run scripts/...)
├── docs/             # Architecture & Guides
└── STATUS.md         # Living status document (Untracked)
```

this file ("AGENTS.md") is symlinked to `CLAUDE.md` and `GEMINI.md` for maximal compatibility.