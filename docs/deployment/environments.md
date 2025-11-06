# environment separation strategy

relay uses a simple three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend app | backend URL | database | frontend | storage |
|-------------|---------|-------------|-------------|----------|----------|---------|
| **development** | local | local server | localhost:8000 | relay-dev (neon) | localhost:5173 | relay-dev (r2) |
| **staging** | push to main | relay-api-staging | relay-api-staging.fly.dev | relay-staging (neon) | cloudflare pages (main) | relay-stg (r2) |
| **production** | github release | relay-api | relay-api.fly.dev | relay (neon) | cloudflare pages (main) | relay (r2) |

## workflow

### local development

```bash
# start backend
uv run uvicorn relay.main:app --reload --port 8000

# start frontend
cd frontend && bun run dev
```

connects to `relay-dev` neon database and uses `app.relay-dev` atproto namespace.

### staging deployment (automatic)

**trigger**: push to `main` branch

**backend**:
1. github actions runs `.github/workflows/deploy-backend.yml`
2. deploys to `relay-api-staging` fly app using `fly.staging.toml`
3. runs `alembic upgrade head` via `release_command`
4. backend available at `https://relay-api-staging.fly.dev`

**frontend**:
- cloudflare pages automatically deploys from `main` branch
- uses preview environment with `PUBLIC_API_URL=https://relay-api-staging.fly.dev`
- available at cloudflare-generated preview URL

**testing**:
- backend: `https://relay-api-staging.fly.dev/docs`
- database: `relay-staging` (neon)
- storage: `relay-stg` (r2)
- atproto namespace: `app.relay-staging`

### production deployment (manual)

**trigger**: create github release (e.g., `v1.0.0`)

**backend**:
1. github actions runs `.github/workflows/deploy-production.yml`
2. deploys to `relay-api` fly app using `fly.toml`
3. runs `alembic upgrade head` via `release_command`
4. backend available at `https://relay-api.fly.dev`

**frontend**:
- cloudflare pages production environment serves `main` branch
- uses production environment with `PUBLIC_API_URL=https://relay-api.fly.dev`
- available at `https://plyr.fm` / `https://www.plyr.fm` (custom domain) and `https://relay-4i6.pages.dev`

**creating a release**:
```bash
# after validating changes in staging:
gh release create v1.0.0 --title "v1.0.0" --notes "release notes here"
```

or via github UI: releases → draft new release → create tag → publish

**testing**:
- frontend: `https://plyr.fm` or `https://relay-4i6.pages.dev`
- backend: `https://relay-api.fly.dev/docs`
- database: `relay` (neon)
- storage: `relay` (r2)
- atproto namespace: `app.relay`

## configuration files

### backend

**fly.staging.toml**:
- app: `relay-api-staging`
- release_command: `uv run alembic upgrade head` (runs migrations)
- environment variables configured in fly.io

**fly.toml**:
- app: `relay-api`
- release_command: `uv run alembic upgrade head` (runs migrations)
- environment variables configured in fly.io

### frontend

**cloudflare pages**:
- framework: sveltekit
- build command: `cd frontend && bun run build`
- build output: `frontend/build`
- environment variables:
  - preview: `PUBLIC_API_URL=https://relay-api-staging.fly.dev`
  - production: `PUBLIC_API_URL=https://relay-api.fly.dev`

### secrets management

**staging secrets** (set via `flyctl secrets set`):
- `DATABASE_URL` → neon staging connection string
- `ATPROTO_CLIENT_ID` → `https://relay-api-staging.fly.dev/client-metadata.json`
- `ATPROTO_REDIRECT_URI` → `https://relay-api-staging.fly.dev/auth/callback`
- `ATPROTO_APP_NAMESPACE` → `app.relay-staging`
- `OAUTH_ENCRYPTION_KEY` → unique 44-char base64 fernet key
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` → r2 credentials
- `LOGFIRE_WRITE_TOKEN`, `LOGFIRE_ENABLED`, `LOGFIRE_ENVIRONMENT`
- `FRONTEND_URL` → cloudflare pages preview URL

**production secrets** (already configured):
- same structure but with production URLs and database
- `ATPROTO_APP_NAMESPACE` → not set (defaults to `app.relay`)
- `FRONTEND_CORS_ORIGIN_REGEX` → `^https://(([a-z0-9]+\.)?relay-4i6\.pages\.dev|(www\.)?plyr\.fm)$` (custom domain + cloudflare pages)
- additional: `NOTIFY_BOT_HANDLE`, `NOTIFY_BOT_PASSWORD`, `NOTIFY_ENABLED`

**local dev (.env)**:
- `ATPROTO_APP_NAMESPACE` → `app.relay-dev`

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
- fly.io logs: `flyctl logs -a relay-api-staging`

**production**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=production`
- fly.io logs: `flyctl logs -a relay-api`

## costs

**current**: ~$10-11/month
- fly.io production: $5/month (shared-cpu-1x)
- fly.io staging: $5/month (shared-cpu-1x)
- neon dev: free tier
- neon staging: free tier
- neon production: free tier
- cloudflare pages: free
- cloudflare R2: ~$0.16/month (shared across all environments)

## benefits

- **safe testing**: catch bugs in staging before production
- **migration validation**: test database changes in production-like environment
- **rollback capability**: releases enable version-based rollbacks via github
- **clear release process**: explicit versioning via github releases
- **single branch**: no branch management - just `main` and feature branches

## deployment history

1. ✅ staging backend deployed and validated (2025-11-06)
   - backend: https://relay-api-staging.fly.dev
   - database: relay-staging (neon)
   - storage: relay-stg (r2)
   - atproto namespace: `app.relay-staging`
2. ✅ production deployment workflow exists (`.github/workflows/deploy-production.yml`)
3. **next**: create first github release to deploy to production
