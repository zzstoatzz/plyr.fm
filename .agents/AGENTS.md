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
    *   **Deploy:** Merging to `main` auto-deploys to **staging** (`stg.plyr.fm`). Production backend changes require `just release`; frontend-only changes use `just release-frontend-only` (see `docs/internal/deployment/environments.md`). Never deploy locally.
*   **ATProto NSIDs:** namespaces are environment-aware via settings (e.g., `fm.plyr.dev` (dev), `fm.plyr` (prod)). **Never** hardcode outside of scripts. these are fully-qualified hostname in Reverse Domain-Name Order, not urls.
*   **Auth Security:** Session IDs live in HttpOnly cookies. **Never** touch `localStorage` for auth.
*   **Async Everywhere:** Never block the event loop. Use `anyio`/`aiofiles`.
*   **Type Hints:** Required everywhere (Python & TypeScript).
*   **Communication:** Use emojis sparingly and strictly for emphasis.
*   **No paragraph comments in code.** Rationale and mechanism explanations live in STATUS.md, docs, commit messages, and PR bodies — never as multi-line comment blocks in the middle of code. A comment, when warranted at all, is one short line.
*   **DO NOT UNNECESSARILY DEFER IMPORTS.** Put imports at the top of the file where they belong. Deferred imports inside functions are only acceptable for avoiding circular imports - not for "lazy loading" or other reasons.

## 🛠️ Stack & Tooling
*   **Backend:** FastAPI, Neon (Postgres), Cloudflare R2, Fly.io.
*   **Frontend:** SvelteKit (Svelte 5 Runes), Bun, Cloudflare Pages.
*   **Observability:** Logfire.
*   **`just` use the justfiles!**
*   **use MCPs** for access to external systems, review docs/tools when needed
*   **Access preflight:** For operational work, verify GitHub, Fly, Neon, and Cloudflare access at the start rather than discovering missing access mid-incident. See `docs/internal/tools/agent-access.md`.
*   **Moderation writes:** `MODERATION_AUTH_TOKEN` authorizes protected labeler endpoints. `MODERATION_BSKY_PASSWORD` is a Bluesky app password used only for the labeler's ATProto service declaration; it cannot emit labels. Never print either secret.

### Neon Serverless Postgres
- `plyr-prd` (cold-butterfly-11920742) - production (us-east-1)
- `plyr-stg` (frosty-math-37367092) - staging (us-west-2)
- `plyr-dev` (muddy-flower-98795112) - development (us-east-2)
- `plyr-moderation` (rough-hall-37695610) - signed labels and moderation data (us-east-2)

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

## agent discovery

Shared project instructions live in `.agents/AGENTS.md`; root `AGENTS.md` and
`CLAUDE.md` resolve to this file. Scoped instructions live in `AGENTS.md` beside
the code they govern, with sibling `CLAUDE.md` symlinks for Claude compatibility.

Project skills live in `.agents/skills/<name>/SKILL.md`. Codex discovers them
automatically; `.claude/skills/<name>` symlinks expose the same sources to Claude.
Start with `onboard`; use `change` for project work and `contribute` for the
external-contributor setup. See `docs/internal/tools/skills.md` for the catalog.

Skill workflows do not grant permission to publish. Keep issues, PRs, comments,
merges, and releases local until Nate explicitly authorizes that action in this
project; existing authorization remains valid.
