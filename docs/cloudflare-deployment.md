# cloudflare deployment guide

## prerequisites

1. cloudflare account
2. domain configured in cloudflare (optional but recommended)
3. wrangler CLI installed: `npm install -g wrangler`

## setup steps

### 1. create r2 bucket

```bash
wrangler r2 bucket create relay-audio
```

this creates the bucket for audio storage.

### 2. generate r2 access keys

in cloudflare dashboard:
1. go to r2 > manage r2 api tokens
2. create api token with read & write permissions
3. save access key id and secret access key

### 3. set backend secrets

```bash
cd /path/to/relay

# database connection
wrangler secret put DATABASE_URL
# paste your neon postgres connection string

# r2 credentials
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY

# atproto oauth
wrangler secret put ATPROTO_CLIENT_ID
wrangler secret put ATPROTO_CLIENT_SECRET
```

### 4. configure environment variables

update `wrangler.toml` with your values:
- r2 bucket name (should be `relay-audio`)
- pds url (currently `https://pds.zzstoatzz.io`)
- r2 endpoint url: `https://<your-account-id>.r2.cloudflarestorage.com`
- r2 public url: custom domain or `https://pub-<id>.r2.dev`

### 5. deploy backend (python workers)

```bash
# from project root
wrangler deploy
```

this deploys your fastapi backend to cloudflare workers.

note: you'll get a url like `https://relay-api.<your-subdomain>.workers.dev`

### 6. configure frontend api url

update `frontend/wrangler.toml`:
```toml
[env.production.vars]
API_URL = "https://relay-api.<your-subdomain>.workers.dev"
```

### 7. deploy frontend (pages)

```bash
cd frontend

# build for production
bun run build

# deploy to pages
wrangler pages deploy .svelte-kit/cloudflare --project-name relay-frontend
```

you'll get a url like `https://relay-frontend.pages.dev`

### 8. configure custom domains (optional)

in cloudflare dashboard:
1. **frontend**: pages > relay-frontend > custom domains
   - add `relay.example.com`
2. **backend**: workers > relay-api > triggers > custom domains
   - add `api.relay.example.com`
3. **r2 public access**: r2 > relay-audio > settings > public access
   - add custom domain `audio.relay.example.com`

## cost estimate

### free tier (perfect for mvp):
- pages: unlimited static requests, 100k function requests/day
- workers: 100k requests/day
- r2: 10 gb storage, 1m class a ops, 10m class b ops
- **total: $0/month**

### paid tier (when you grow):
- workers: $5/month (10m requests)
- r2: ~$0.015/gb-month (100 gb audio = $1.50/month)
- **total: ~$5-10/month for moderate usage**

## local development

keep using current setup:
```bash
# backend
uv run uvicorn relay.main:app --reload --port 8001

# frontend
cd frontend && bun run dev
```

## testing deployment locally

```bash
# test backend with wrangler
wrangler dev

# test frontend
cd frontend && wrangler pages dev .svelte-kit/cloudflare
```

## troubleshooting

### python workers issues
- ensure `compatibility_flags = ["python_workers"]` in wrangler.toml
- python workers are in beta - some packages may not work
- use `pywrangler` for complex dependency bundling

### r2 access issues
- verify bucket exists: `wrangler r2 bucket list`
- check secrets are set: `wrangler secret list`
- ensure r2 endpoint url includes account id

### cors issues
- configure cors in workers for frontend access
- update frontend api url to match workers deployment

## next steps

1. set up ci/cd with github actions
2. configure domain dns in cloudflare
3. enable cloudflare analytics
4. set up error tracking (sentry, etc.)
