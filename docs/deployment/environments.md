# environment separation strategy

plyr.fm uses a simple three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend app | backend URL | database | frontend | storage |
|-------------|---------|-------------|-------------|----------|----------|---------|
| **development** | local | local server | localhost:8001 | plyr-dev (neon) | localhost:5173 | audio-dev, images-dev (r2) |
| **staging** | push to main | plyr-api-staging | plyr-api-staging.fly.dev | plyr-staging (neon) | cloudflare pages preview | audio-staging, images-staging (r2) |
| **production** | github release | plyr-api | plyr-api.fly.dev | plyr-prod (neon) | plyr.fm (cloudflare pages) | audio-prod, images-prod (r2) |

## workflow

### local development

```bash
# start backend
uv run uvicorn backend.main:app --reload --port 8001

# start frontend
cd frontend && bun run dev

# start transcoder (optional)
cd transcoder && just run
```

connects to `plyr-dev` neon database and uses `fm.plyr` atproto namespace.

### staging deployment (automatic)

**trigger**: push to `main` branch

**backend**:
1. github actions runs `.github/workflows/deploy-backend.yml`
2. deploys to `plyr-api-staging` fly app using `fly.staging.toml`
3. runs `alembic upgrade head` via `release_command`
4. backend available at `https://plyr-api-staging.fly.dev`

**frontend**:
- cloudflare pages automatically deploys from `main` branch
- uses preview environment with `PUBLIC_API_URL=https://plyr-api-staging.fly.dev`
- available at cloudflare-generated preview URL

**testing**:
- backend: `https://plyr-api-staging.fly.dev/docs`
- database: `plyr-staging` (neon)
- storage: `audio-staging`, `images-staging` (r2)
- atproto namespace: `fm.plyr`

### production deployment (manual)

**trigger**: create github release (e.g., `v1.0.0`)

**backend**:
1. github actions runs `.github/workflows/deploy-production.yml`
2. deploys to `plyr-api` fly app using `fly.toml`
3. runs `alembic upgrade head` via `release_command`
4. backend available at `https://plyr-api.fly.dev`

**frontend**:
- cloudflare pages production environment serves `main` branch
- uses production environment with `PUBLIC_API_URL=https://plyr-api.fly.dev`
- available at `https://plyr.fm` (custom domain)

**creating a release**:
```bash
# after validating changes in staging:
just release

# or manually via gh cli:
gh release create v1.0.0 --title "v1.0.0" --notes "release notes here"
```

or via github UI: releases → draft new release → create tag → publish

**testing**:
- frontend: `https://plyr.fm`
- backend: `https://plyr-api.fly.dev/docs`
- database: `plyr-prod` (neon)
- storage: `audio-prod`, `images-prod` (r2)
- atproto namespace: `fm.plyr`

## configuration files

### backend

**fly.staging.toml**:
- app: `plyr-api-staging`
- release_command: `uv run alembic upgrade head` (runs migrations)
- environment variables configured in fly.io

**fly.toml**:
- app: `plyr-api`
- release_command: `uv run alembic upgrade head` (runs migrations)
- environment variables configured in fly.io

**transcoder/fly.toml**:
- app: `plyr-transcoder`
- auto-scaling enabled (stops when idle)
- environment variables configured in fly.io

### frontend

**cloudflare pages**:
- framework: sveltekit
- build command: `cd frontend && bun run build`
- build output: `frontend/build`
- environment variables:
  - preview: `PUBLIC_API_URL=https://plyr-api-staging.fly.dev`
  - production: `PUBLIC_API_URL=https://plyr-api.fly.dev`

### secrets management

**staging secrets** (set via `flyctl secrets set`):
- `DATABASE_URL` → neon staging connection string
- `ATPROTO_CLIENT_ID` → `https://plyr-api-staging.fly.dev/client-metadata.json`
- `ATPROTO_REDIRECT_URI` → `https://plyr-api-staging.fly.dev/auth/callback`
- `ATPROTO_APP_NAMESPACE` → `fm.plyr`
- `OAUTH_ENCRYPTION_KEY` → unique 44-char base64 fernet key
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` → r2 credentials
- `LOGFIRE_WRITE_TOKEN`, `LOGFIRE_ENABLED`, `LOGFIRE_ENVIRONMENT`
- `FRONTEND_URL` → cloudflare pages preview URL
- `TRANSCODER_URL` → `https://plyr-transcoder.fly.dev`
- `TRANSCODER_AUTH_TOKEN` → shared secret for transcoder auth

**production secrets** (already configured):
- same structure but with production URLs and database
- `ATPROTO_APP_NAMESPACE` → `fm.plyr`
- `FRONTEND_CORS_ORIGIN_REGEX` → `^https://(www\.)?plyr\.fm$`
- additional: `NOTIFY_BOT_HANDLE`, `NOTIFY_BOT_PASSWORD`, `NOTIFY_ENABLED`

**transcoder secrets**:
- `TRANSCODER_AUTH_TOKEN` → shared with backend for authentication

**local dev (.env)**:
- `ATPROTO_APP_NAMESPACE` → `fm.plyr`

## database migrations

migrations run automatically on deploy via fly.io `release_command`.

**both environments**:
- use `alembic upgrade head` to run migrations
- migrations run before deployment completes
- alembic tracks applied migrations via `alembic_version` table

### rollback strategy

if a migration fails:
1. **staging**: fix and push to main
2. **production**:
   - revert via alembic: `uv run alembic downgrade -1`
   - or restore database from neon backup

## monitoring

**staging**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=staging`
- backend logs: `flyctl logs -a plyr-api-staging`
- transcoder logs: `flyctl logs -a plyr-transcoder`

**production**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=production`
- backend logs: `flyctl logs -a plyr-api`
- transcoder logs: `flyctl logs -a plyr-transcoder`

## costs

**current**: ~$15-20/month
- fly.io backend (production): $5-10/month (shared-cpu-1x, 256MB RAM)
- fly.io backend (staging): $5-10/month (shared-cpu-1x, 256MB RAM)
- fly.io transcoder: $0-5/month (auto-scales to zero when idle, 1GB RAM)
- neon dev: free tier (0.5GB storage)
- neon staging: free tier (0.5GB storage)
- neon production: free tier (0.5GB storage, 3GB data transfer)
- cloudflare pages: free (frontend hosting)
- cloudflare R2: ~$0.16/month (6 buckets: audio-dev, audio-staging, audio-prod, images-dev, images-staging, images-prod)

## benefits

- **safe testing**: catch bugs in staging before production
- **migration validation**: test database changes in production-like environment
- **rollback capability**: releases enable version-based rollbacks via github
- **clear release process**: explicit versioning via github releases
- **single branch**: no branch management - just `main` and feature branches

## deployment history

1. ✅ production backend deployed (plyr-api.fly.dev)
2. ✅ production frontend deployed (plyr.fm)
3. ✅ transcoder service deployed (plyr-transcoder.fly.dev)
4. ✅ staging environment configured (plyr-api-staging.fly.dev)
5. ✅ automated deployments via github actions
6. ✅ database migrations automated via fly.io release_command
