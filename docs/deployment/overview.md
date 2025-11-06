# deployment overview

relay uses a three-tier deployment strategy. see [`environments.md`](./environments.md) for complete details.

## quick reference

| environment | frontend | backend | trigger |
|-------------|----------|---------|---------|
| **staging** | staging.relay-4i6.pages.dev | relay-api-staging.fly.dev | push to `staging` branch (frontend) <br> push to `main` (backend) |
| **production** | relay-4i6.pages.dev | relay-api.fly.dev | push to `production` branch (frontend) <br> github release (backend) |

## deployment workflow

### staging (automatic testing)
1. push backend changes to `main` → deploys to relay-api-staging
2. push frontend changes to `staging` branch → deploys to staging.relay-4i6.pages.dev
3. test end-to-end before promoting to production

### production (manual release)
1. validate changes in staging
2. create github release → deploys backend to relay-api
3. merge to `production` branch → deploys frontend to relay-4i6.pages.dev

## key files

- backend configs: `fly.toml` (production), `fly.staging.toml` (staging)
- backend deploy: `.github/workflows/deploy-backend.yml`, `.github/workflows/deploy-production.yml`
- frontend: cloudflare pages (configured via UI)
- migrations: see [`database-migrations.md`](./database-migrations.md)

## monitoring

- logfire: filter by `deployment_environment` (staging/production)
- fly.io: `flyctl logs -a relay-api` or `flyctl logs -a relay-api-staging`
- neon: separate databases per environment (relay-dev, relay-staging, relay)

for complete details, see [`environments.md`](./environments.md).
