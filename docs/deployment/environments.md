# environment separation strategy

relay uses a three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend app | backend URL | database | frontend |
|-------------|---------|-------------|-------------|----------|----------|
| **development** | local | local server | localhost:8000 | relay-dev (neon) | localhost:5173 |
| **staging** | push to main | relay-api-staging | relay-api-staging.fly.dev | relay-staging (neon) | relay-4i6.pages.dev (preview) |
| **production** | github release | relay-api | relay-api.fly.dev | relay (neon) | relay-4i6.pages.dev (production) |

## workflow

### local development

```bash
# start backend
uv run uvicorn backend.main:app --reload --port 8000

# start frontend
cd frontend && bun run dev
```

connects to `relay-dev` neon database.

### staging deployment (automatic)

**trigger**: push to `main` branch

**process**:
1. github actions detects changes in backend files
2. runs `.github/workflows/deploy-backend.yml`
3. deploys to `relay-api-staging` fly app using `fly.staging.toml`
4. runs database migrations via `release_command`
5. app becomes available at `https://relay-api-staging.fly.dev`

**testing**:
- backend API: `https://relay-api-staging.fly.dev/docs`
- frontend: cloudflare pages preview deploy
- database: `relay-staging` (neon)

### production deployment (manual)

**trigger**: create github release (e.g., `v1.2.3`)

**process**:
1. github actions detects release publication
2. runs `.github/workflows/deploy-production.yml`
3. deploys to `relay-api` fly app using `fly.toml`
4. runs database migrations via `release_command`
5. app becomes available at `https://relay-api.fly.dev`

**creating a release**:
```bash
# after validating changes in staging:
gh release create v1.2.3 --title "v1.2.3" --notes "release notes here"
```

or via github UI: releases → draft new release → create tag → publish

## configuration files

### fly.io configurations

**fly.staging.toml**:
- app: `relay-api-staging`
- database: neon staging connection string
- OAuth redirect: `https://relay-api-staging.fly.dev/auth/callback`
- environment: staging

**fly.toml**:
- app: `relay-api`
- database: neon production connection string
- OAuth redirect: `https://relay-api.fly.dev/auth/callback`
- environment: production

### secrets management

**staging secrets** (set via `scripts/setup-staging-secrets.sh`):
- `DATABASE_URL` → neon staging connection string
- `ATPROTO_CLIENT_ID` → `https://relay-api-staging.fly.dev/client-metadata.json`
- `ATPROTO_REDIRECT_URI` → `https://relay-api-staging.fly.dev/auth/callback`
- `OAUTH_ENCRYPTION_KEY` → unique key for staging
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` → same as production (shared R2)
- `LOGFIRE_WRITE_TOKEN` → logfire token
- `LOGFIRE_ENVIRONMENT` → `staging`

**production secrets** (already configured):
- same structure but with production URLs and database

## database migrations

migrations run automatically on deploy via fly.io `release_command`:
```toml
[deploy]
  release_command = "uv run alembic upgrade head"
```

**staging**: migrations run on every push to main (low risk)
**production**: migrations run on release (review migrations before releasing)

### rollback strategy

if a migration fails:
1. **staging**: fix and push to main
2. **production**:
   - revert via alembic: `uv run alembic downgrade -1`
   - or restore database from neon backup

## cloudflare pages

**current configuration**:
- production branch: `main` (currently)
- all deployments use production backend

**TODO** (requires manual cloudflare configuration):
- set preview deployments to use staging backend URL
- configure environment variable: `PUBLIC_API_URL=https://relay-api-staging.fly.dev`

## monitoring

**staging**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=staging`
- fly.io logs: `flyctl logs -a relay-api-staging`

**production**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=production`
- fly.io logs: `flyctl logs -a relay-api`

## costs

**before**: ~$5-6/month (1 fly app, 2 neon databases)

**after**: ~$10-11/month
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
- **rollback capability**: releases enable version-based rollbacks
- **team validation**: team can test changes before user-facing deployment
- **clear release process**: explicit versioning via github releases

## next steps

1. run `scripts/setup-staging-secrets.sh` to configure staging secrets
2. merge environment separation PR
3. push to main → automatic staging deploy
4. validate staging deployment
5. create first production release
6. configure cloudflare pages preview deployments (manual step via UI)
