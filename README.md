# relay

decentralized music streaming on ATProto

## what is relay?

relay is a music streaming platform built on the AT Protocol (ATProto), the same protocol that powers Bluesky. it combines:

- **OAuth 2.1 authentication** via ATProto for secure, decentralized identity
- **artist profiles** synced with ATProto user profiles (avatar, display name, handle)
- **track metadata** published as ATProto records (shareable across the network)
- **audio storage** on cloudflare R2 for fast, scalable streaming
- **track editing** for artists to manage their catalog
- **play count tracking** to measure engagement

## tech stack

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

## quick start

### local development

\`\`\`bash
# backend
uv sync
uv run uvicorn relay.main:app --reload --port 8001

# frontend (new terminal)
cd frontend && bun install && bun run dev
\`\`\`

visit http://localhost:5173

## features

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

## deployment

fully automatic via GitHub:

\`\`\`bash
git push origin main  # deploys both frontend and backend
\`\`\`

see [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md) for details.

## project structure

\`\`\`
relay/
├── src/relay/              # backend (python)
│   ├── api/               # fastapi routes
│   ├── atproto/           # atproto integration
│   ├── models/            # database models
│   └── storage/           # r2 storage
├── frontend/              # frontend (svelte)
│   ├── src/lib/          # components, types
│   └── src/routes/       # pages
├── docs/                  # documentation
├── .github/workflows/     # ci/cd
└── README.md
\`\`\`

## costs

~$5-6/month for MVP:
- cloudflare pages: free
- cloudflare r2: ~$0.16
- fly.io: $5
- neon: free

## links

- **production**: https://relay-4i6.pages.dev
- **backend API**: https://relay-api.fly.dev
- **repository**: https://github.com/zzstoatzz/relay

## documentation

- [deployment guide](docs/cloudflare-deployment.md)
- [latest status](sandbox/2025-10-31-status-update.md)
- [archived docs](sandbox/archive/)
