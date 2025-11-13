# plyr.fm

music streaming on ATProto

## what is plyr.fm?

plyr.fm is a music streaming platform built on the AT Protocol (ATProto), the same protocol that powers Bluesky. it combines:

- **OAuth 2.1 authentication** via ATProto for secure identity
- **artist profiles** synced with ATProto user profiles (avatar, display name, handle)
- **track metadata** published as ATProto records (shareable across the network)
- **audio storage** on cloudflare R2 for fast, scalable streaming
- **track editing** for artists to manage their catalog
- **play count tracking** to measure engagement

<details>
<summary>tech stack</summary>

### backend
- **framework**: FastAPI (Python)
- **database**: Neon PostgreSQL (serverless)
- **storage**: Cloudflare R2 (S3-compatible)
- **hosting**: Fly.io (2x shared-cpu VMs)
- **auth**: ATProto OAuth 2.1 (forked SDK)

### frontend
- **framework**: SvelteKit (TypeScript)
- **runtime**: Bun
- **hosting**: Cloudflare Pages
- **styling**: vanilla CSS (lowercase aesthetic)

### deployment
- **ci/cd**: GitHub Actions
- **backend**: automatic on backend file changes
- **frontend**: automatic on every push to main

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

# run backend (hot reloads)
just run-backend

# run frontend (hot reloads)
just frontend dev

# run transcoder (hot reloads)
just transcoder run
```

visit http://localhost:5173

</details>

<details>
<summary>features</summary>

### for listeners
- ✅ browse latest tracks
- ✅ stream audio with controls
- ✅ mobile-optimized player
- ✅ share tracks via URL

### for artists
- ✅ OAuth login with ATProto
- ✅ upload tracks (audio + metadata)
- ✅ edit track metadata
- ✅ delete tracks
- ✅ view play counts
- ✅ publish to ATProto

</details>

<details>
<summary>deployment</summary>

fully automatic via GitHub:

```bash
git push origin main  # deploys both frontend and backend
```

or using just:

```bash
just deploy-backend   # deploy backend to fly.io
just deploy-frontend  # deploy frontend to cloudflare pages
```

see [docs/deployment/overview.md](docs/deployment/overview.md) for details.

</details>

<details>
<summary>project structure</summary>

```
plyr.fm/
├── src/backend/            # backend (python)
│   ├── api/               # fastapi routes
│   ├── atproto/           # atproto integration
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
- fly.io transcoder: ~$0-5/month (auto-scales to zero when idle)
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
