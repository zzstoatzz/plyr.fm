## problem

currently have only two environments:
- **local development** → connects to dev database
- **production** → deployed from main branch

this means every merge to main immediately goes to production with no staging validation. no way to test changes in a production-like environment before user-facing deployment.

## desired outcome

implement three-tier deployment strategy:

| environment | trigger | frontend URL | backend URL | database | purpose |
|-------------|---------|--------------|-------------|----------|---------|
| **development** | local | localhost:5173 | localhost:8000 | neon dev | local development |
| **staging** | push to main | staging.relay.{domain} | staging-api.fly.dev | neon staging | pre-production validation |
| **production** | github release | relay.{domain} | relay-api.fly.dev | neon prod | user-facing deployment |

## workflow

1. **local development**:
   - developer works on feature branch
   - connects to dev database
   - tests locally

2. **staging deployment** (automatic):
   - PR merged to main
   - github actions deploys:
     - frontend → cloudflare pages (staging)
     - backend → fly.io (staging app)
   - uses staging database
   - team validates changes

3. **production release** (manual):
   - create github release (e.g., `v1.2.3`)
   - github actions deploys:
     - frontend → cloudflare pages (production)
     - backend → fly.io (production app)
   - uses production database
   - users see changes

## implementation plan

### 1. neon database setup
currently have 2 databases, need 3:
- `relay-dev` (existing)
- `relay-staging` (new)
- `relay-prod` (existing)

### 2. fly.io apps
currently have 1 app, need 2:
- `relay-api` (production)
- `relay-api-staging` (new)

each with separate environment variables:
```
DATABASE_URL → neon staging/prod
R2_BUCKET_NAME → relay-staging/relay-prod
FRONTEND_URL → staging/production frontend URL
CORS_ALLOWED_ORIGINS → staging/production domains
```

### 3. cloudflare pages
configure multiple environments:
- production branch: `production` (new branch)
- preview branch: `main` (current behavior becomes staging)

environment variables:
```
PUBLIC_API_URL → staging vs production backend
```

### 4. github actions workflows

**.github/workflows/deploy-staging.yml**:
```yaml
name: deploy staging
on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: flyctl deploy --app relay-api-staging
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**.github/workflows/deploy-production.yml**:
```yaml
name: deploy production
on:
  release:
    types: [published]

jobs:
  promote-to-production:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          git checkout -b production
          git push origin production --force
      - run: flyctl deploy --app relay-api
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 5. database migrations

**staging**: automatic via fly.io release command (re-enable after fixing timeouts)
**production**: manual approval before release
- option A: require manual migration before release
- option B: github actions workflow with approval gate
- option C: fly.io release command with longer timeout

## files requiring changes

1. `.github/workflows/deploy-staging.yml` (new)
2. `.github/workflows/deploy-production.yml` (new)
3. `fly.toml` → `fly.staging.toml` + `fly.production.toml`
4. cloudflare pages settings - branch configuration
5. `README.md` - document deployment process
6. `docs/deployment/` - new deployment guide

## infrastructure costs

current: ~$5-6/month
after:
- fly.io staging app: +$5/month (shared-cpu-1x)
- neon staging database: free tier (5GB limit)
- cloudflare pages: free (unlimited)

**new total**: ~$10-11/month

## migration steps

1. create neon staging database
2. create fly.io staging app
3. configure staging environment variables
4. create github actions workflows
5. configure cloudflare pages branches
6. test staging deployment
7. create first production release
8. update documentation

## benefits

- catch bugs before production
- validate database migrations safely
- team can test changes in production-like environment
- clear release process with versioning
- rollback capability via github releases

## priority

**high** - required for safe deployment practices before opening to users

## dependencies

- requires custom domain for staging subdomain
- addresses anxiety mentioned in STATUS.md about deployment safety

## related issues

- complements #8 (runtime resilience) by enabling safe testing
- supports #26 (session hardening) by allowing staging validation
