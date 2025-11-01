# database migrations

## current setup (automated)

relay uses **automated database migrations** via Fly.io release commands.

### how it works

1. **developer creates migration**: `uv run alembic revision --autogenerate -m "description"`
2. **developer commits and pushes**: migrations are in `alembic/versions/`
3. **deployment triggers**: Fly.io deployment starts
4. **release command runs**: `./scripts/migrate.sh` executes before new app version starts
5. **migrations apply**: `uv run alembic upgrade head` runs against production database
6. **deployment completes**: if migrations succeed, new app starts; if they fail, deployment fails

### files involved

- `scripts/migrate.sh`: migration script that runs on deployment
- `fly.toml`: configures release command (`release_command = './scripts/migrate.sh'`)
- `alembic/versions/`: directory containing all migration files
- `alembic/env.py`: alembic configuration (reads `DATABASE_URL` from environment)

## database environments

### current architecture

```
local development
├── frontend: http://localhost:5173
├── backend: http://localhost:8001
└── database: dev Neon PostgreSQL (via DATABASE_URL in .env)

cloudflare preview deployments
├── frontend: https://<hash>.relay-4i6.pages.dev
├── backend: https://relay-api.fly.dev (PRODUCTION)
└── database: production Neon PostgreSQL (PRODUCTION)

production
├── frontend: https://relay-4i6.pages.dev
├── backend: https://relay-api.fly.dev
└── database: production Neon PostgreSQL
```

### key insight

**preview deployments currently use production backend and production database.**

this is acceptable for a solo project but has risks:
- bugs in preview frontend could corrupt production data
- no isolated testing environment
- multiple developers would interfere with each other

## database connection resolution

### how the backend knows which database to use

the backend uses the `DATABASE_URL` environment variable:

**local development**:
```bash
# .env file
DATABASE_URL=postgresql+asyncpg://user:pass@dev-host/relay
```

**production (fly.io)**:
```bash
# set via: flyctl secrets set DATABASE_URL=...
DATABASE_URL=postgresql+asyncpg://user:pass@prod-host/relay
```

### how alembic knows which database to migrate

`alembic/env.py` reads `DATABASE_URL` from the environment:

```python
config.set_main_option(
    "sqlalchemy.url",
    os.environ.get("DATABASE_URL")
)
```

during Fly.io's release command:
1. Fly injects production `DATABASE_URL` as environment variable
2. `./scripts/migrate.sh` runs
3. `uv run alembic upgrade head` uses production `DATABASE_URL`
4. migrations apply to production database

**this is safe** because:
- each environment is self-contained
- no hardcoded database URLs
- impossible to accidentally run prod migrations against dev
- release command runs in the same environment as the app

## creating migrations

### automatic migration generation

```bash
# 1. make changes to models in src/relay/models/
# 2. generate migration
uv run alembic revision --autogenerate -m "add features column to tracks"

# 3. review generated migration in alembic/versions/
# 4. edit if needed (autogenerate isn't perfect)
# 5. test locally
uv run alembic upgrade head

# 6. commit and push
git add alembic/versions/
git commit -m "add features column migration"
git push
```

### manual migration creation

```bash
# for complex changes that autogenerate can't handle
uv run alembic revision -m "complex data migration"

# edit the generated file in alembic/versions/
# implement upgrade() and downgrade() functions
```

## migration safety

### deployment behavior

if migration fails:
- deployment stops
- old app version continues running
- no user impact
- developer sees error in fly.io logs

if migration succeeds:
- new app version starts
- users see new features
- database schema is up to date

### testing migrations

**before pushing**:

```bash
# test against local dev database
uv run alembic upgrade head

# verify schema changes
# use database client or:
uv run python -c "from relay.models import *; print(Track.__table__.columns)"
```

**after deployment**:

```bash
# check fly.io logs
flyctl logs

# verify migration ran
flyctl ssh console
>>> uv run alembic current
```

## future improvements

### when to add dev/staging environments

consider adding separate environments when:
- team grows beyond 1-2 developers
- preview testing causes production issues
- need to test migrations before production
- want to test integrations in isolation

### three-environment setup

```
local development
├── backend: http://localhost:8001
└── database: dev Neon PostgreSQL

preview deployments
├── frontend: https://<hash>.relay-4i6.pages.dev
├── backend: https://relay-api-dev.fly.dev (new dev backend)
└── database: dev Neon PostgreSQL

production
├── frontend: https://relay-4i6.pages.dev
├── backend: https://relay-api.fly.dev
└── database: production Neon PostgreSQL
```

**implementation steps**:

1. deploy dev backend to fly.io
   ```bash
   # copy fly.toml to fly.dev.toml
   # update app name to relay-api-dev
   flyctl apps create relay-api-dev
   flyctl secrets set DATABASE_URL=<dev-db-url> --app relay-api-dev
   flyctl deploy --config fly.dev.toml
   ```

2. configure cloudflare pages environments
   ```bash
   # production (main branch)
   wrangler pages deployment env set PUBLIC_API_URL=https://relay-api.fly.dev \
     --project-name relay --environment production

   # preview (other branches)
   wrangler pages deployment env set PUBLIC_API_URL=https://relay-api-dev.fly.dev \
     --project-name relay --environment preview
   ```

3. update github actions
   - add separate workflow for dev deployments
   - deploy to relay-api-dev on non-main branches

**cost impact**: adds ~$5/month for second fly.io app

### staging environment (optional)

if you add formal QA process:

```
local dev → dev database (testing)
preview → dev database (review)
staging → staging database (pre-production QA)
production → production database (live)
```

staging is for:
- final QA before production release
- testing migrations in production-like environment
- performance testing
- integration testing

**when to add**: team of 5+ engineers, formal release process

## troubleshooting

### migration fails on deployment

**symptom**: deployment fails, logs show alembic error

**steps**:
1. check fly.io logs: `flyctl logs`
2. identify the failing migration
3. fix the migration file locally
4. test locally: `uv run alembic upgrade head`
5. commit and push fix

### migrations out of sync

**symptom**: local database has different migrations than production

**fix**:
```bash
# check current revision
uv run alembic current

# check available migrations
uv run alembic history

# upgrade to latest
uv run alembic upgrade head

# or downgrade and re-apply
uv run alembic downgrade <revision>
uv run alembic upgrade head
```

### need to rollback migration

**symptom**: bad migration deployed to production

**immediate fix**:
```bash
# connect to production via fly.io
flyctl ssh console

# downgrade one revision
uv run alembic downgrade -1

# exit and deploy previous version
exit
flyctl deploy --image <previous-image>
```

**proper fix**:
1. create new migration that reverses the change
2. test locally
3. deploy normally (migrations run automatically)

### manual migration needed

**symptom**: autogenerate doesn't detect schema change

**fix**:
```bash
# create empty migration
uv run alembic revision -m "manual migration"

# edit alembic/versions/<hash>_manual_migration.py
def upgrade() -> None:
    op.execute("your SQL here")

def downgrade() -> None:
    op.execute("reverse SQL here")
```

## migration best practices

1. **always review autogenerated migrations** - they're not perfect
2. **test migrations locally first** - catch errors before production
3. **keep migrations small and focused** - one logical change per migration
4. **write reversible migrations** - implement downgrade() properly
5. **don't edit deployed migrations** - create new migration to fix
6. **use meaningful descriptions** - future you will thank you
7. **handle data migrations carefully** - consider large datasets

## monitoring

### check migration status

```bash
# local
uv run alembic current

# production
flyctl ssh console -a relay-api
>>> uv run alembic current
```

### verify schema matches models

```bash
# generate migration without applying
uv run alembic revision --autogenerate -m "check schema"

# if file is empty, schema matches models
# if file has changes, schema is out of sync

# clean up
rm alembic/versions/<hash>_check_schema.py
```

## references

- alembic documentation: https://alembic.sqlalchemy.org/
- fly.io release commands: https://fly.io/docs/reference/configuration/#release_command
- relay migration script: `scripts/migrate.sh`
- relay fly config: `fly.toml`
