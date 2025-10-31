# cloudflare pages deployment guide

## overview

the relay frontend is deployed to **cloudflare pages** using direct uploads (not git-connected).

- **backend**: fly.io (see fly.toml)
- **frontend**: cloudflare pages
- **storage**: cloudflare r2 for audio files
- **database**: neon postgresql

## how cloudflare pages deployments work

### deployment types

1. **git-connected deployments** (not currently used)
   - automatic deploys on git push
   - production URL (`relay-4i6.pages.dev`) updates automatically
   - preview deployments for branches

2. **direct uploads** (current method)
   - manual deploys via `wrangler pages deploy`
   - each deploy gets immutable preview URL (e.g., `https://b5157854.relay-4i6.pages.dev`)
   - production URL only updates from git commits (if git is connected)

### current setup

we use **direct uploads** which means:
- ✅ fast deploys without pushing to git
- ✅ instant preview URLs for testing
- ❌ production URL (`relay-4i6.pages.dev`) doesn't auto-update
- ❌ preview URLs accumulate and aren't auto-cleaned

## deployment commands

### deploy frontend

```bash
cd frontend
bun run build
bun x wrangler pages deploy .svelte-kit/cloudflare --project-name relay
```

this creates a new deployment with a unique URL like `https://abc12345.relay-4i6.pages.dev`

### view all deployments

```bash
cd frontend
bun x wrangler pages deployment list --project-name relay
```

### delete old deployments

```bash
# delete a specific deployment by ID
bun x wrangler pages deployment delete <deployment-id> --project-name relay

# example
bun x wrangler pages deployment delete b5157854-fd7c-445e-9828-b48688aeb25b --project-name relay
```

**note**: old deployments don't incur storage costs (cloudflare dedupes static assets), but it's good practice to clean them up periodically.

## promotion strategy

### option 1: use preview URLs (current)
- test on preview URL like `https://abc12345.relay-4i6.pages.dev`
- share preview URL for testing
- no promotion needed

### option 2: connect to git (recommended for production)
1. in cloudflare dashboard: pages > relay > settings > builds & deployments
2. connect github repository
3. set production branch to `main`
4. every commit to `main` updates production URL automatically

### option 3: manual promotion
- cloudflare doesn't support promoting direct uploads to production
- to update production URL with uncommitted changes:
  1. commit changes to git
  2. push to main branch
  3. wait for automatic deploy (if git-connected)

## recommended workflow

### for development
```bash
# make changes
# test locally at http://localhost:5174

# deploy to preview URL for testing
cd frontend && bun run build && bun x wrangler pages deploy .svelte-kit/cloudflare --project-name relay

# test on preview URL: https://abc12345.relay-4i6.pages.dev
```

### for production releases
```bash
# 1. commit changes
git add .
git commit -m "description"

# 2. push to main (triggers auto-deploy if git-connected)
git push origin main

# 3. or manually deploy from committed code
cd frontend && bun run build && bun x wrangler pages deploy .svelte-kit/cloudflare --project-name relay --branch main
```

## cost & cleanup

### costs
- cloudflare pages free tier: unlimited static requests, 500 builds/month
- direct uploads count toward build quota
- old deployments don't incur storage costs (deduped)

### cleanup recommendations
1. **delete old preview deployments monthly**
   ```bash
   # list deployments older than 7 days
   bun x wrangler pages deployment list --project-name relay | grep "days ago\|weeks ago\|months ago"

   # delete each one
   bun x wrangler pages deployment delete <id> --project-name relay
   ```

2. **or connect to git** to use automatic cleanup
   - cloudflare auto-removes preview deployments after 30 days
   - production deployments persist

## production URLs

- **current preview**: varies (e.g., `https://b5157854.relay-4i6.pages.dev`)
- **production URL**: `https://relay-4i6.pages.dev` (only updates from git)
- **backend API**: `https://relay-api.fly.dev`

## troubleshooting

### "my changes aren't showing on the production URL"
- production URL only updates from git commits
- use the preview URL from your deploy output
- or commit changes and redeploy

### "I have too many preview deployments"
- delete old ones with `wrangler pages deployment delete`
- consider connecting to git for automatic cleanup

### "deployment failed"
- check build logs in cloudflare dashboard
- ensure `bun run build` works locally
- verify wrangler is authenticated: `bun x wrangler whoami`
