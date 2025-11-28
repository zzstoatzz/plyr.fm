# [plyr.fm](https://plyr.fm)

music on [atproto](https://atproto.com)

<details>
<summary>tech stack</summary>

### backend
- **framework**: [FastAPI](https://fastapi.tiangolo.com)
- **database**: [Neon PostgreSQL](https://neon.com)
- **storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **hosting**: [Fly.io](https://fly.io)
- **auth**: [atproto OAuth 2.1](https://atproto.com/specs/oauth) ([fork with OAuth implementation](https://github.com/zzstoatzz/atproto))

### frontend
- **framework**: [SvelteKit](https://kit.svelte.dev)
- **runtime**: [Bun](https://bun.sh)
- **hosting**: [Cloudflare Pages](https://pages.cloudflare.com)
- **styling**: vanilla CSS (lowercase aesthetic)

</details>

<details>
<summary>local development</summary>

### prerequisites

- [uv](https://docs.astral.sh/uv/) for Python package management
- [bun](https://bun.sh/) for frontend development
- [just](https://github.com/casey/just) for task running (recommended)

### quick start

using [just](https://github.com/casey/just):

```bash
# install dependencies (uv handles backend venv automatically)
uv sync # For root-level deps, if any, and initializes uv
just frontend install

# run backend (hot reloads at http://localhost:8001)
just backend run

# run frontend (hot reloads at http://localhost:5173)
just frontend dev

# run transcoder (hot reloads at http://localhost:8082)
just transcoder run
```

</details>

<details>
<summary>features</summary>

### listening
- audio playback with persistent queue across tabs/devices
- like tracks with counts visible to all listeners
- browse artist profiles and discographies
- share tracks and albums with nice link previews

### creating
- well-scoped OAuth authentication via ATProto (bluesky accounts)
- upload tracks with title, artwork, and featured artists
- organize tracks into albums with cover art
- edit metadata and replace artwork anytime
- track play counts and like analytics
- publish ATProto track and like records to your PDS

</details>


<details>
<summary>project structure</summary>

```
plyr.fm/
├── backend/              # FastAPI app & Python tooling
│   ├── src/backend/      # application code
│   │   ├── api/          # public endpoints
│   │   ├── _internal/    # internal services
│   │   ├── models/       # database schemas
│   │   └── storage/      # storage adapters
│   ├── tests/            # pytest suite
│   └── alembic/          # database migrations
├── frontend/             # SvelteKit app
│   ├── src/lib/          # components & state
│   └── src/routes/       # pages
├── transcoder/           # Rust audio service
├── docs/                 # documentation
└── justfile              # task runner
```

</details>

<details>
<summary>costs</summary>

~$25-30/month:
- fly.io backend (production): ~$10/month (shared-cpu-1x, 256MB RAM)
- fly.io backend (staging): ~$10/month (shared-cpu-1x, 256MB RAM)
- fly.io transcoder: TBD (not in use yet)
- neon postgres: $5/month (starter plan)
- cloudflare pages: free (frontend hosting)
- cloudflare r2: ~$0.16/month (6 buckets across dev/staging/prod)

</details>

## links

- **production**: https://plyr.fm
- **API docs**: https://api.plyr.fm/docs
- **python SDK**: [plyrfm](https://github.com/zzstoatzz/plyr-python-client) ([PyPI](https://pypi.org/project/plyrfm/))
- **repository**: https://github.com/zzstoatzz/plyr.fm

## documentation

- [deployment guide](docs/deployment/environments.md)
- [configuration](docs/configuration.md)
- [full documentation](docs/README.md)
