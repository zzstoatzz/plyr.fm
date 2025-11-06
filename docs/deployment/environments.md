# environment separation strategy

relay uses a three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend app | backend URL | database | frontend | storage |
|-------------|---------|-------------|-------------|----------|----------|---------|
| **development** | local | local server | localhost:8000 | relay-dev (neon) | localhost:5173 | relay-dev (r2) |
| **staging** | push to main (backend) <br> push to staging (frontend) | relay-api-staging | relay-api-staging.fly.dev | relay-staging (neon) | staging.relay-4i6.pages.dev | relay-stg (r2) |
| **production** | github release (backend) <br> push to production (frontend) | relay-api | relay-api.fly.dev | relay (neon) | relay-4i6.pages.dev | relay (r2) |

## workflow

### local development

```bash
# start backend
uv run uvicorn backend.main:app --reload --port 8000

# start frontend
cd frontend && bun run dev
```

connects to `relay-dev` neon database.

### staging deployment

**backend (automatic on main push)**:

1. push to `main` branch
2. github actions runs `.github/workflows/deploy-backend.yml`
3. deploys to `relay-api-staging` fly app using `fly.staging.toml`
4. runs database migrations via `release_command`
5. backend available at `https://relay-api-staging.fly.dev`

**frontend (manual sync)**:

```bash
# sync staging branch with main
git checkout staging
git merge main
git push
```

cloudflare pages automatically deploys to `https://staging.relay-4i6.pages.dev`

**testing**:
- frontend: `https://staging.relay-4i6.pages.dev` (static URL)
- backend: `https://relay-api-staging.fly.dev/docs`
- database: `relay-staging` (neon)
- storage: `relay-stg` (r2)

### production deployment

**frontend (manual promotion)**:

```bash
# after validating staging, promote to production
git checkout production
git merge main
git push
```

cloudflare pages automatically deploys to `https://relay-4i6.pages.dev`

**backend (github release)**:

```bash
# create release tag
gh release create v1.2.3 --title "v1.2.3" --notes "release notes here"
```

or via github UI: releases → draft new release → create tag → publish

**process**:
1. github actions detects release publication
2. runs `.github/workflows/deploy-production.yml`
3. deploys to `relay-api` fly app using `fly.toml`
4. runs database migrations via `release_command`
5. backend available at `https://relay-api.fly.dev`

**testing**:
- frontend: `https://relay-4i6.pages.dev` (static URL)
- backend: `https://relay-api.fly.dev/docs`
- database: `relay` (neon)
- storage: `relay` (r2)

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
- `ATPROTO_APP_NAMESPACE` → `app.relay-staging` (isolated ATProto collection)
- `OAUTH_ENCRYPTION_KEY` → unique key for staging
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` → same as production (shared R2)
- `LOGFIRE_WRITE_TOKEN` → logfire token
- `LOGFIRE_ENVIRONMENT` → `staging`

**production secrets** (already configured):
- same structure but with production URLs and database
- `ATPROTO_APP_NAMESPACE` → not set (uses default `app.relay`)

**local dev (.env)**:
- `ATPROTO_APP_NAMESPACE` → `app.relay-dev` (throwaway collection for testing)

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

**configuration** (see [cloudflare-pages-setup.md](./cloudflare-pages-setup.md) for detailed instructions):

**branches**:
- `production` branch → `relay-4i6.pages.dev` (production URL)
- `staging` branch → `staging.relay-4i6.pages.dev` (staging URL)

**environment variables**:
- staging (`preview` environment): `PUBLIC_API_URL=https://relay-api-staging.fly.dev`
- production (`production` environment): `PUBLIC_API_URL=https://relay-api.fly.dev`

**manual configuration required**:
1. change production branch from `main` to `production` in cloudflare dashboard
2. add `staging` to custom branch deployments
3. set environment variables for each environment
4. trigger initial deployments

see [cloudflare-pages-setup.md](./cloudflare-pages-setup.md) for step-by-step instructions.

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

## deployment history

1. ✅ staging and production branches created
2. ✅ R2 storage separated by environment (relay-dev, relay-stg, relay)
3. ✅ staging backend deployed and validated (2025-11-06)
   - backend: https://relay-api-staging.fly.dev
   - database: relay-staging (neon)
   - storage: relay-stg (r2)
4. **next: configure cloudflare pages** (see [cloudflare-pages-setup.md](./cloudflare-pages-setup.md))
5. sync staging branch with main for first frontend deploy
6. validate full staging environment:
   - frontend: https://staging.relay-4i6.pages.dev
   - backend: https://relay-api-staging.fly.dev
7. promote to production when ready:
   - frontend: merge main → production
   - backend: create github release
