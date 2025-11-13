# [plyr.fm](https://plyr.fm)

music on [atproto](https://atproto.com)

<details>
<summary>tech stack</summary>

### backend
- **framework**: [FastAPI](https://fastapi.tiangolo.com) (Python)
- **database**: [Neon PostgreSQL](https://neon.com) (serverless)
- **storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible)
- **hosting**: [Fly.io](https://fly.io) (2x shared-cpu VMs)
- **auth**: [atproto OAuth 2.1](https://atproto.com/specs/oauth) ([forked SDK](https://github.com/zzstoatzz/atproto))

### frontend
- **framework**: [SvelteKit](https://kit.svelte.dev) (TypeScript)
- **runtime**: [Bun](https://bun.sh)
- **hosting**: [Cloudflare Pages](https://pages.cloudflare.com)
- **styling**: vanilla CSS (lowercase aesthetic)

### deployment
- **ci/cd**: GitHub Actions
- **backend**: deploy to stg on merge to `main`, deploy to prod on release
- **frontend**: preview deploy on merge to `main`, production deploy on release

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
# install dependencies
uv sync
just frontend install

# run backend (hot reloads at http://localhost:8001)
just run-backend

# run frontend (hot reloads at http://localhost:5173)
just frontend dev

# run transcoder (hot reloads at http://localhost:8082)
just transcoder run
```

</details>

<details>
<summary>features</summary>

### for listeners
- ✅ browse latest tracks
- ✅ stream audio with controls
- ✅ mobile-friendly player
- ✅ share tracks via URL
- ✅ view play counts
- ✅ like tracks
- ✅ queue tracks
- ✅ view liked tracks

### for artists
- ✅ OAuth login with ATProto
- ✅ upload tracks with metadata and artwork
- ✅ edit track metadata
- ✅ delete tracks

</details>

<details>
<summary>deployment</summary>

automatic via GitHub Actions:

```bash
git push origin main  # deploys both frontend and backend
```

see [docs/deployment/environments.md](docs/deployment/environments.md) for details.

</details>

<details>
<summary>project structure</summary>

```
plyr.fm/
├── src/backend/            # backend (python)
│   ├── api/               # fastapi routes
│   ├── models/            # database models
│   └── storage/           # r2 storage
├── frontend/              # frontend (svelte)
│   ├── src/lib/          # components, types
│   └── src/routes/       # pages
├── docs/                  # documentation
├── .github/workflows/     # ci/cd
├── Justfile               # task runner recipes
└── README.md
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
- **backend API**: https://api.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm

## documentation

- [deployment guide](docs/deployment/environments.md)
- [configuration](docs/configuration.md)
- [full documentation](docs/README.md)
