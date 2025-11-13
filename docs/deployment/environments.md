# environment separation strategy

plyr.fm uses a simple three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend URL | database | frontend | storage |
|-------------|---------|-------------|----------|----------|---------|
| **development** | local | localhost:8001 | plyr-dev (neon) | localhost:5173 | audio-dev, images-dev (r2) |
| **staging** | push to main | relay-api-staging.fly.dev | plyr-staging (neon) | cloudflare pages preview (main) | audio-staging, images-staging (r2) |
| **production** | github release | api.plyr.fm | plyr-prod (neon) | plyr.fm (production-fe branch) | audio-prod, images-prod (r2) |

## workflow

### local development

```bash
# start backend (hot reloads)
just run-backend

# start frontend (hot reloads)
just frontend dev

# start transcoder (hot reloads)
just transcoder run
```

connects to `plyr-dev` neon database and uses `fm.plyr` atproto namespace.

### staging deployment (automatic)

**trigger**: push to `main` branch

**backend**:
1. github actions runs `.github/workflows/deploy-staging.yml`
2. runs `alembic upgrade head` via `release_command`
3. backend available at `https://relay-api-staging.fly.dev`

**frontend**:
- cloudflare pages automatically creates preview builds from `main` branch
- uses preview environment with `PUBLIC_API_URL=https://relay-api-staging.fly.dev`

**testing**:
- backend: `https://relay-api-staging.fly.dev/docs`
- database: `plyr-staging` (neon)
- storage: `audio-staging`, `images-staging` (r2)

### production deployment (manual)

**trigger**: run `just release` (creates github tag, merges main → production-fe)

**backend**:
1. github actions runs `.github/workflows/deploy-prod.yml`
2. runs `alembic upgrade head` via `release_command`
3. backend available at `https://api.plyr.fm`

**frontend**:
1. release script merges `main` → `production-fe` branch
2. cloudflare pages production environment tracks `production-fe` branch
3. uses production environment with `PUBLIC_API_URL=https://api.plyr.fm`
4. available at `https://plyr.fm`

**creating a release**:
```bash
# after validating changes in staging:
just release
```

this will:
1. create timestamped github tag (triggers backend deploy)
2. merge main → production-fe (triggers frontend deploy)

**testing**:
- frontend: `https://plyr.fm`
- backend: `https://api.plyr.fm/docs`
- database: `plyr-prod` (neon)
- storage: `audio-prod`, `images-prod` (r2)

## configuration files

### backend

**fly.staging.toml** / **fly.toml**:
- release_command: `uv run alembic upgrade head` (runs migrations before deploy)
- environment variables configured via `flyctl secrets set`

### frontend

**cloudflare pages**:
- framework: sveltekit
- build command: `cd frontend && bun run build`
- build output: `frontend/build`
- production branch: `production-fe`
- preview branch: `main`
- environment variables:
  - preview: `PUBLIC_API_URL=https://relay-api-staging.fly.dev`
  - production: `PUBLIC_API_URL=https://api.plyr.fm`

### secrets management

all secrets configured via `flyctl secrets set`. key environment variables:
- `DATABASE_URL` → neon connection string (env-specific)
- `ATPROTO_CLIENT_ID`, `ATPROTO_REDIRECT_URI` → oauth config (env-specific URLs)
- `OAUTH_ENCRYPTION_KEY` → unique per environment
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` → r2 credentials
- `LOGFIRE_WRITE_TOKEN`, `LOGFIRE_ENVIRONMENT` → observability config

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
- backend logs: `flyctl logs -a relay-api-staging`

**production**:
- logfire: environment filter `LOGFIRE_ENVIRONMENT=production`
- backend logs: `flyctl logs -a relay-api`

## costs

**current**: ~$25-30/month
- fly.io backend (production): ~$10/month (shared-cpu-1x, 256MB RAM)
- fly.io backend (staging): ~$10/month (shared-cpu-1x, 256MB RAM)
- fly.io transcoder: ~$0-5/month (auto-scales to zero when idle)
- neon postgres: $5/month (starter plan)
- cloudflare pages: free (frontend hosting)
- cloudflare R2: ~$0.16/month (6 buckets across dev/staging/prod)

## workflow summary

- **merge PR to main**: deploys staging backend, creates frontend preview
- **run `just release`**: deploys production backend + production frontend together
- **database migrations**: run automatically before deploy completes
- **rollback**: revert github release or restore database from neon backup
