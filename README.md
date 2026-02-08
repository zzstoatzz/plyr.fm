# [plyr.fm](https://plyr.fm)

audio streaming app

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
- **transcoder**: Rust audio conversion service (ffmpeg, Fly.io)
- **moderation**: Rust ATProto labeler for copyright/sensitive content (Fly.io)
- **mood search**: [CLAP](https://github.com/LAION-AI/CLAP) audio embeddings ([Modal](https://modal.com))
- **genre classification**: [effnet-discogs](https://replicate.com/) ML tagging ([Replicate](https://replicate.com))
- **vector search**: [turbopuffer](https://turbopuffer.com) for semantic audio queries

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
- browse by artist, album, tag, or playlist
- share tracks and albums with embeddable players and link previews
- mood search - describe a vibe, get matching tracks (CLAP embeddings)
- unified search with Cmd/Ctrl+K (fuzzy match across tracks, artists, albums, tags, playlists)
- genre browsing and tag filtering
- platform media controls (Media Session API)
- teal.fm scrobbling and now-playing reporting

### creating
- OAuth authentication via ATProto (bluesky accounts), multi-account support
- upload tracks with title, artwork, tags, and featured artists
- lossless audio support (AIFF/FLAC) with automatic MP3 transcoding for universal playback
- auto-tagging via ML genre classification
- organize tracks into albums and playlists with drag-and-drop reordering
- timed comments with clickable timestamps
- artist support links and supporter-gated content
- copyright scanning via audio fingerprinting
- content reporting and automated sensitive content filtering

### data ownership
- tracks, likes, playlists synced to your PDS as ATProto records
- bulk media export (download all your tracks)
- portable identity - your data travels with you
- public by default - any client can read your music records

> some features may be paywalled in the future for the financial viability of the project. if you have thoughts on what should or shouldn't be gated, open a [discussion on GitHub](https://github.com/zzstoatzz/plyr.fm/discussions) or [tangled](https://tangled.sh/@zzstoatzz.io/plyr.fm).

</details>

<details>
<summary>project structure</summary>

```
plyr.fm/
├── backend/              # FastAPI app & Python tooling
│   ├── src/backend/      # application code
│   ├── tests/            # pytest suite
│   └── alembic/          # database migrations
├── frontend/             # SvelteKit app
│   ├── src/lib/          # components & state
│   └── src/routes/       # pages
├── services/
│   ├── transcoder/       # Rust audio transcoding (Fly.io)
│   ├── moderation/       # Rust content moderation (Fly.io)
│   └── clap/             # ML embeddings (Python, Modal)
├── infrastructure/
│   └── redis/            # self-hosted Redis (Fly.io)
├── docs/                 # documentation
└── justfile              # task runner
```

</details>

<details>
<summary>costs</summary>

~$25/month:
- fly.io (backend + transcoder + redis + moderation): ~$14/month
- neon postgres: $5/month
- cloudflare (pages + r2): ~$1/month
- audd audio fingerprinting: $5-10/month (usage-based)
- modal (CLAP embeddings): free tier / scales to zero
- replicate (genre classification): <$1/month

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
