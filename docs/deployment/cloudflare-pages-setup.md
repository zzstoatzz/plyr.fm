# cloudflare pages environment setup

manual configuration steps for setting up staging and production frontend environments.

## overview

relay uses branch-based frontend deployments:
- **staging branch** → `staging.relay-4i6.pages.dev`
- **production branch** → `relay-4i6.pages.dev`

this gives you static URLs for both environments while maintaining full separation.

## prerequisites

✅ staging branch created and pushed to GitHub
✅ production branch created and pushed to GitHub

## cloudflare dashboard configuration

### step 1: update production branch

1. navigate to [cloudflare pages dashboard](https://dash.cloudflare.com/8feb33b5fb57ce2bc093bc6f4141f40a/pages)
2. click on **relay** project
3. go to **settings** → **builds & deployments**
4. under **production deployments**, click **configure production deployments**
5. change production branch from `main` to `production`
6. click **save**

**result**: only commits to `production` branch will deploy to `relay-4i6.pages.dev`

### step 2: configure branch deployments

1. in **settings** → **builds & deployments**
2. under **preview deployments**, select **custom branches**
3. add branch pattern: `staging`
4. optionally add: `main` (for testing main before production)
5. click **save**

**result**: commits to `staging` branch deploy to `staging.relay-4i6.pages.dev`

### step 3: set environment variables for staging

1. go to **settings** → **environment variables**
2. click **add variable**
3. set the following for **preview** environment:
   - variable name: `PUBLIC_API_URL`
   - value: `https://relay-api-staging.fly.dev`
   - environment: **preview** (check the box)
4. click **save**

**result**: staging frontend connects to staging backend

### step 4: set environment variables for production

1. in **settings** → **environment variables**
2. click **add variable** (or edit existing if already set)
3. set the following for **production** environment:
   - variable name: `PUBLIC_API_URL`
   - value: `https://relay-api.fly.dev`
   - environment: **production** (check the box)
4. click **save**

**result**: production frontend connects to production backend

### step 5: trigger initial deployments

1. go back to **deployments** tab
2. find the latest deployment for `staging` branch
3. click **...** → **retry deployment** (if needed)
4. repeat for `production` branch

## verification

after configuration:

**staging**:
- url: https://staging.relay-4i6.pages.dev
- backend: https://relay-api-staging.fly.dev
- should show empty state (staging database is empty)

**production**:
- url: https://relay-4i6.pages.dev
- backend: https://relay-api.fly.dev
- should show existing data

## workflow

### deploying to staging

```bash
# push changes to main
git checkout main
git add .
git commit -m "feat: new feature"
git push

# backend deploys automatically to staging (relay-api-staging)

# sync staging branch with main for frontend
git checkout staging
git merge main
git push

# frontend deploys automatically to staging.relay-4i6.pages.dev
```

### deploying to production

```bash
# after validating in staging, promote to production
git checkout production
git merge main
git push

# frontend deploys automatically to relay-4i6.pages.dev

# create release tag for backend
gh release create v1.0.0 --title "v1.0.0" --notes "release notes"

# backend deploys automatically to production (relay-api)
```

## troubleshooting

**staging frontend not updating?**
- check that `staging` branch is in custom branches list
- verify `PUBLIC_API_URL` is set for preview environment
- check cloudflare pages build logs

**production frontend still on main?**
- verify production branch is set to `production` in settings
- redeploy production branch if needed

**CORS errors?**
- verify `PUBLIC_API_URL` matches the backend you're trying to reach
- check backend CORS configuration in fly.io secrets

## cleanup (optional)

**delete old preview deployments**:
- wrangler CLI doesn't support this
- manually delete from cloudflare dashboard → deployments → filter by preview → delete individually
- old previews don't cost anything, just clutter the list
