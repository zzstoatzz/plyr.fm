## problem

currently using cloudflare-generated domain `relay-4i6.pages.dev` which is:
- not stable or memorable for users
- hardcoded in FastAPI CORS configuration
- not suitable for production deployment
- creates tight coupling between frontend deployment and backend configuration

## desired outcome

1. **custom domain acquisition and setup**
   - register domain (e.g., `relay.fm`, `relay.music`, etc.)
   - configure DNS with cloudflare
   - set up SSL/TLS certificates

2. **environment-specific subdomains**
   - `relay.{domain}` → production
   - `staging.relay.{domain}` → staging (main branch)
   - `dev.relay.{domain}` → development (optional, could stay localhost)

3. **backend configuration updates**
   - remove hardcoded domains from CORS
   - use environment variables for allowed origins
   - support multiple environments via configuration

## implementation considerations

### domain setup
- cloudflare pages supports custom domains
- fly.io supports custom domains
- need to configure both frontend and backend

### CORS configuration
currently in `src/relay/main.py`:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://relay-4i6.pages.dev"],  # hardcoded
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

should become:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,  # from env
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### environment variables needed
- `CORS_ALLOWED_ORIGINS` (comma-separated list)
- `FRONTEND_URL` (for OAuth redirects)
- `BACKEND_URL` (for API base URL)

## files requiring changes

1. `src/relay/config.py` - add domain configuration settings
2. `src/relay/main.py` - update CORS to use env vars
3. `fly.toml` - add custom domain configuration
4. cloudflare pages settings - configure custom domain
5. `README.md` - document domain configuration

## dependencies

- domain registration ($10-15/year)
- DNS configuration (cloudflare)
- SSL certificate setup (automatic with cloudflare)

## priority

**high** - blocks professional deployment and creates maintenance burden with hardcoded values

## related issues

- depends on three-environment strategy for staging subdomain
