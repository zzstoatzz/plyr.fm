---
title: "environment separation strategy"
---

plyr.fm uses a simple three-tier deployment strategy: development → staging → production.

## environments

| environment | trigger | backend URL | database | redis | frontend | storage |
|-------------|---------|-------------|----------|-------|----------|---------|
| **development** | local | localhost:8001 | plyr-dev (neon) | localhost:6379 (docker) | localhost:5173 | audio-dev, images-dev (r2) |
| **staging** | push to main | api-stg.plyr.fm | plyr-stg (neon) | plyr-redis-stg (fly.io) | stg.plyr.fm (main branch) | audio-staging, images-staging (r2) |
| **production** | github release | api.plyr.fm | plyr-prd (neon) | plyr-redis (fly.io) | plyr.fm (production-fe branch) | audio-prod, images-prod (r2) |

## workflow

### local development

```bash
# terminal 1: start redis
just dev-services

# terminal 2: start backend (with docket enabled)
DOCKET_URL=redis://localhost:6379 just backend run

# terminal 3: start frontend
just frontend run

# optional: start transcoder
just transcoder run
```

connects to `plyr-dev` neon database, local Redis, and uses `fm.plyr.dev` atproto namespace.

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
- build command: `cd frontend && bun install && bun run build`
- build output: `frontend/.svelte-kit/cloudflare`
- production branch: `production-fe`
- production environment: `PUBLIC_API_URL=https://api.plyr.fm`, `SKIP_DEPENDENCY_INSTALL=1`
- custom domain: `plyr.fm` (also `www.plyr.fm`)

**plyr-fm-stg** (staging):
- framework: sveltekit
- build command: `cd frontend && bun install && bun run build`
- build output: `frontend/.svelte-kit/cloudflare`
- production branch: `main`
- production environment: `PUBLIC_API_URL=https://api-stg.plyr.fm`, `SKIP_DEPENDENCY_INSTALL=1`
- custom domain: `stg.plyr.fm`

### docs

**plyr-fm-docs**:
- framework: astro (starlight)
- deployed via GHA workflow (`.github/workflows/deploy-docs.yml`) using `wrangler pages deploy`
- triggers on push to `main` when `docs/public/**` or `docs/site/**` change
- build command: `cd docs/site && bun install && bun run build`
- build output: `docs/site/dist`
- custom domain: `docs.plyr.fm`

### secrets management

all secrets configured via `flyctl secrets set`. key environment variables:
- `DATABASE_URL` → neon connection string (env-specific)
- `DOCKET_URL` → redis URL for background tasks (env-specific, use `rediss://` for TLS)
- `FRONTEND_URL` → frontend URL for CORS (production: `https://plyr.fm`, staging: `https://stg.plyr.fm`)
- `ATPROTO_APP_NAMESPACE` → atproto namespace (environment-specific, separates records by environment)
  - development: `fm.plyr.dev` (local `.env`)
  - staging: `fm.plyr.stg`
  - production: `fm.plyr`
- `ATPROTO_CLIENT_ID`, `ATPROTO_REDIRECT_URI` → oauth config (env-specific, must use custom domains for cookie-based auth)
  - production: `https://api.plyr.fm/oauth-client-metadata.json` and `https://api.plyr.fm/auth/callback`
  - staging: `https://api-stg.plyr.fm/oauth-client-metadata.json` and `https://api-stg.plyr.fm/auth/callback`- `OAUTH_ENCRYPTION_KEY` → unique per environment
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
- logfire: filter on `deployment_environment = 'staging'` (top-level column, not in attributes)
- backend logs: `flyctl logs -a relay-api-staging`
  - target a single process group: `flyctl logs -a relay-api-staging --process-group worker`

**production**:
- logfire: filter on `deployment_environment = 'production'`
- backend logs: `flyctl logs -a relay-api`
  - target a single process group: `flyctl logs -a relay-api --process-group worker`

both environments split the backend into two fly process groups in the same app: `app` (uvicorn) and `worker` (docket consumer). see [background tasks](/backend/background-tasks/) for the architecture.

## costs

approximate monthly spend; check fly.io billing for current numbers.

- fly.io backend (production): 2× `app` (shared-cpu-1x, 1GB) + 1× active `worker` (shared-cpu-1x, 2GB) + 1× standby `worker` (stopped, near-zero cost)
- fly.io backend (staging): 1× `app` (shared-cpu-1x, 1GB) + 1× active `worker` (shared-cpu-1x, 1GB) + 1× standby
- fly.io transcoder: auto-scales to zero when idle
- fly.io self-hosted Redis: 1× shared-cpu-1x, 256MB per env
- neon postgres: starter plan (3 environments)
- cloudflare pages: free (frontend hosting)
- cloudflare R2: ~$0.16/month (6 buckets across dev/staging/prod)

note: prod's split sizing (`app=1GB`, `worker=2GB`) replaced the prior single 1GB process group after the 2026-04-30 OOM incident — see [upload-oom-cycle runbook](/runbooks/upload-oom-cycle/).

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

## cloudflare access (staging only)

staging environments are protected with Cloudflare Access to prevent public access while maintaining accessibility for authorized developers.

### configuration

**protected domains**:
- `stg.plyr.fm` (frontend) - requires GitHub authentication
- `api-stg.plyr.fm` (backend API) - requires GitHub authentication

**public bypass paths** (no authentication required):
- `api-stg.plyr.fm/health` - uptime monitoring
- `api-stg.plyr.fm/docs` - API documentation
- `stg.plyr.fm/manifest.webmanifest` - PWA manifest
- `stg.plyr.fm/icons/*` - PWA icons

### how it works

1. **DNS proxy**: both `stg.plyr.fm` and `api-stg.plyr.fm` are proxied through Cloudflare (orange cloud)
2. **access policies**: GitHub OAuth or one-time PIN authentication required for all paths except bypassed endpoints
3. **shared authentication**: both frontend and API share the same eTLD+1 (`plyr.fm`), allowing the `CF_Authorization` cookie to work across both domains
4. **application ordering**: bypass applications for specific paths (`/health`, `/docs`, etc.) are ordered **above** the wildcard application to take precedence

### requirements for proxied setup

- **Cloudflare SSL/TLS mode**: set to "Full" (encrypts browser → Cloudflare → origin)
- **Fly.io certificates**: both domains must have valid certificates on Fly.io (`flyctl certs list`)
- **DNS records**: both domains must be set to "Proxied" (orange cloud) in Cloudflare DNS

### debugging access issues

**if staging is still publicly accessible**:
1. verify DNS records are proxied (orange cloud) in Cloudflare DNS
2. check application ordering in Cloudflare Access (specific paths before wildcards)
3. verify policy action is "Allow" with authentication rules (not "Bypass" with "Everyone")
4. clear browser cache or use incognito mode to bypass cached responses
5. wait 1-2 minutes for Access policy changes to propagate

**if legitimate requests are blocked**:
1. check if path needs a bypass rule (e.g., `/health`, `/docs`)
2. verify bypass applications are ordered above the main application
3. ensure bypass policy uses "Bypass" action with "Everyone" selector
