# [plyr.fm](https://plyr.fm)

music on [atproto](https://atproto.com)

check the [plyr.fm artist page](https://plyr.fm/u/plyr.fm) for the latest [auto-generated](.github/workflows/status-maintenance.yml) development podcast!

<details>
<summary>tech stack</summary>

### backend
- **framework**: [FastAPI](https://fastapi.tiangolo.com)
- **database**: [Neon PostgreSQL](https://neon.com)
- **storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- **background tasks**: [docket](https://github.com/zzstoatzz/docket) (Redis-backed)
- **hosting**: [Fly.io](https://fly.io)
- **observability**: [Pydantic Logfire](https://logfire.pydantic.dev)
- **auth**: [atproto OAuth 2.1](https://atproto.com/specs/oauth)

### frontend
- **framework**: [SvelteKit](https://kit.svelte.dev) with Svelte 5 runes
- **runtime**: [Bun](https://bun.sh)
- **hosting**: [Cloudflare Pages](https://pages.cloudflare.com)
- **styling**: vanilla CSS (lowercase aesthetic)

### services
- **moderation**: Rust ATProto labeler for copyright/sensitive content
- **transcoder**: Rust audio conversion service (ffmpeg)

</details>

<details>
<summary>local development</summary>

### prerequisites

- [uv](https://docs.astral.sh/uv/) for Python
- [bun](https://bun.sh/) for frontend
- [just](https://github.com/casey/just) for task running
- [docker](https://www.docker.com/) for dev services (redis)

### quick start

```bash
# install dependencies
uv sync
cd frontend && bun install && cd ..

# start dev services (redis for background tasks)
just dev-services

# run backend (hot reloads at http://localhost:8001)
just backend run

# run frontend (hot reloads at http://localhost:5173)
just frontend run
```

### useful commands

```bash
# run tests
just backend test

# run linting
just backend lint
just frontend check

# database migrations
just backend migrate "migration message"
just backend migrate-up

# stop dev services
just dev-services-down
```

</details>

<details>
<summary>features</summary>

### listening
- audio playback with persistent queue across tabs
- like tracks, add to playlists
- browse artist profiles and discographies
- share tracks, albums, and playlists with link previews
- unified search with Cmd/Ctrl+K
- teal.fm scrobbling

### creating
- OAuth authentication via ATProto (bluesky accounts)
- upload tracks with title, artwork, tags, and featured artists
- organize tracks into albums and playlists
- drag-and-drop reordering
- timed comments with clickable timestamps
- artist support links (ko-fi, patreon, etc.)

### data ownership
- tracks, likes, playlists synced to your PDS as ATProto records
- portable identity - your data travels with you
- public by default - any client can read your music records

</details>

<details>
<summary>project structure</summary>

```
plyr.fm/
├── backend/              # FastAPI app
│   ├── src/backend/      # application code
│   │   ├── api/          # public endpoints
│   │   ├── _internal/    # services (auth, atproto, background tasks)
│   │   ├── models/       # database schemas
│   │   └── storage/      # R2 adapter
│   ├── tests/            # pytest suite
│   └── alembic/          # migrations
├── frontend/             # SvelteKit app
│   ├── src/lib/          # components & state
│   └── src/routes/       # pages
├── moderation/           # Rust labeler service
├── transcoder/           # Rust audio service
├── redis/                # self-hosted Redis config
├── docs/                 # documentation
└── justfile              # task runner
```

</details>

<details>
<summary>costs</summary>

~$20/month:
- fly.io (backend + redis + moderation): ~$14/month
- neon postgres: $5/month
- cloudflare (pages + r2): ~$1/month
- audd audio fingerprinting: $5-10/month (usage-based)

live dashboard: https://plyr.fm/costs

</details>

## links

- **production**: https://plyr.fm
- **staging**: https://stg.plyr.fm
- **API docs**: https://api.plyr.fm/docs
- **python SDK / MCP server**: [plyrfm](https://github.com/zzstoatzz/plyr-python-client) ([PyPI](https://pypi.org/project/plyrfm/))
- **documentation**: [docs/README.md](docs/README.md)
- **status**: [STATUS.md](STATUS.md)

### mirrors
- **github**: https://github.com/zzstoatzz/plyr.fm
- **tangled**: https://tangled.sh/@zzstoatzz.io/plyr.fm
