# environment separation strategy

plyr.fm uses a simple three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend URL | database | frontend | storage |
|-------------|---------|-------------|----------|----------|---------|
| **development** | local | localhost:8001 | plyr-dev (neon) | localhost:5173 | audio-dev, images-dev (r2) |
| **staging** | push to main | api-stg.plyr.fm | plyr-staging (neon) | stg.plyr.fm (main branch) | audio-staging, images-staging (r2) |
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
3. backend available at `https://api-stg.plyr.fm` (custom domain) and `https://relay-api-staging.fly.dev` (fly.dev domain)

**frontend**:
- cloudflare pages project `plyr-fm-stg` tracks `main` branch
- uses production environment with `PUBLIC_API_URL=https://api-stg.plyr.fm`
- available at `https://stg.plyr.fm` (custom domain)

**testing**:
- frontend: `https://stg.plyr.fm`
- backend: `https://api-stg.plyr.fm/docs`
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

**cloudflare pages** (two separate projects):

**plyr-fm** (production):
- framework: sveltekit
- build command: `cd frontend && bun run build`
- build output: `frontend/build`
- production branch: `production-fe`
- production environment: `PUBLIC_API_URL=https://api.plyr.fm`
- custom domain: `plyr.fm`

**plyr-fm-stg** (staging):
- framework: sveltekit
- build command: `cd frontend && bun run build`
- build output: `frontend/build`
- production branch: `main`
- production environment: `PUBLIC_API_URL=https://api-stg.plyr.fm`
- custom domain: `stg.plyr.fm`

### secrets management

all secrets configured via `flyctl secrets set`. key environment variables:
- `DATABASE_URL` → neon connection string (env-specific)
- `FRONTEND_URL` → frontend URL for CORS (production: `https://plyr.fm`, staging: `https://stg.plyr.fm`)
- `ATPROTO_CLIENT_ID`, `ATPROTO_REDIRECT_URI` → oauth config (env-specific, must use custom domains for cookie-based auth)
  - production: `https://api.plyr.fm/client-metadata.json` and `https://api.plyr.fm/auth/callback`
  - staging: `https://api-stg.plyr.fm/client-metadata.json` and `https://api-stg.plyr.fm/auth/callback`
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

- **merge PR to main**: deploys staging backend + staging frontend to `stg.plyr.fm`
- **run `just release`**: deploys production backend + production frontend to `plyr.fm`
- **database migrations**: run automatically before deploy completes
- **rollback**: revert github release or restore database from neon backup

## custom domain architecture

both environments use custom domains on the same eTLD+1 (`plyr.fm`) to enable secure cookie-based authentication:

**staging**:
- frontend: `stg.plyr.fm` → cloudflare pages project `plyr-fm-stg`
- backend: `api-stg.plyr.fm` → fly.io app `relay-api-staging`
- same eTLD+1 allows HttpOnly cookies with `Domain=.plyr.fm`

**production**:
- frontend: `plyr.fm` → cloudflare pages project `plyr-fm`
- backend: `api.plyr.fm` → fly.io app `relay-api`
- same eTLD+1 allows HttpOnly cookies with `Domain=.plyr.fm`

this architecture prevents XSS attacks by storing session tokens in HttpOnly cookies instead of localStorage.
