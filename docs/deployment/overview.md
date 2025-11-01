# deployment overview

relay uses automated deployments for both frontend and backend.

## architecture

- **frontend**: cloudflare pages (automatic from main branch)
- **backend**: fly.io (automatic via github actions)
- **storage**: cloudflare r2 for audio files
- **database**: neon postgresql (serverless)

## preview deployments

cloudflare automatically creates preview deployments for all branches:
- preview URLs: `https://<hash>.relay-4i6.pages.dev`
- preview builds use production backend and database
- CORS is configured to allow all `*.relay-4i6.pages.dev` subdomains

**note**: preview deployments currently share production backend/database. see [`database-migrations.md`](./database-migrations.md) for details on environment separation.

## deployment workflow

### automatic deployments

both frontend and backend deploy automatically on push to `main`:

**frontend (cloudflare pages)**:
- triggers on any change to `main` branch
- builds with: `cd frontend && bun install && bun run build`
- output: `frontend/.svelte-kit/cloudflare`
- production URL: https://relay-4i6.pages.dev

**backend (fly.io)**:
- triggers only when backend files change (`src/`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `fly.toml`)
- deploys via `.github/workflows/deploy-backend.yml`
- uses `FLY_API_TOKEN` secret
- production URL: https://relay-api.fly.dev

### manual deployments

if needed, you can still deploy manually:

```bash
# frontend
cd frontend && bun run build
bun x wrangler pages deploy .svelte-kit/cloudflare --project-name relay

# backend
flyctl deploy
```

## environment variables

### cloudflare pages

set in cloudflare dashboard under **Settings → Environment variables**:

- `PUBLIC_API_URL`: `https://relay-api.fly.dev`

### fly.io

set in `fly.toml` or via `flyctl secrets`:

- `DATABASE_URL`: neon connection string
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: cloudflare r2 credentials
- `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`: atproto OAuth credentials

### github actions

set in GitHub repo under **Settings → Secrets → Actions**:

- `FLY_API_TOKEN`: fly.io deploy token (created with `fly tokens create deploy`)

## troubleshooting

### frontend deployment fails

check cloudflare pages build logs:
1. go to cloudflare dashboard → pages → relay
2. click on latest deployment
3. view build logs

common issues:
- missing `PUBLIC_API_URL` environment variable
- build fails locally (test with `cd frontend && bun run build`)

### backend deployment fails

check github actions logs:
1. go to github repo → actions
2. click on failed workflow run
3. view logs

common issues:
- invalid `FLY_API_TOKEN` secret
- fly.toml misconfiguration
- missing secrets on fly.io

### preview deployments: CORS errors

if preview deployments show CORS errors, verify backend CORS configuration in `src/relay/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https://([a-z0-9]+\.)?relay-4i6\.pages\.dev$",
    allow_origins=["http://localhost:5173"],
    # ...
)
```

this regex pattern allows:
- `https://relay-4i6.pages.dev` (production)
- `https://4f113bf9.relay-4i6.pages.dev` (preview with hash subdomain)
- `http://localhost:5173` (local development)

### database migrations fail

see [`database-migrations.md`](./database-migrations.md) for troubleshooting migration issues

## monitoring

- **frontend**: cloudflare pages analytics in dashboard
- **backend**: `flyctl logs` or fly.io dashboard
- **database**: neon console metrics

## costs

current setup is very cost-effective:

- **cloudflare pages**: free tier (unlimited requests, 500 builds/month)
- **cloudflare r2**: ~$0.16/month for 1000 tracks
- **fly.io**: ~$5/month (2x shared-cpu-1x VMs)
- **neon**: free tier (0.5GB storage, 191 compute hours/month)

**total**: ~$5-6/month for MVP
