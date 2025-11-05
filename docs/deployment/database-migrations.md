# database migrations

## current state (automated ✓)

relay uses **automated database migrations** via fly.io's `release_command`.

### how it works

```
1. developer creates migration locally
   ↓
2. commit and push to main
   ↓
3. github actions triggers deployment
   ↓
4. fly.io builds docker image
   ↓
5. fly.io runs release_command BEFORE deploying
   - temporary machine spins up
   - runs: uv run alembic upgrade head
   - if succeeds → proceed to deployment
   - if fails → abort, keep old version running
   ↓
6. new app version deploys with updated schema
```

### configuration

**fly.toml:**
```toml
[deploy]
  release_command = "uv run alembic upgrade head"
```

**benefits:**
- zero manual intervention required
- migrations run before new code serves traffic (no inconsistent state)
- automatic rollback if migration fails
- clear deployment logs showing migration output

### how dev/prod database separation works

relay uses **environment-based database configuration** to ensure migrations always target the correct database.

**the key mechanism: `DATABASE_URL` environment variable**

```
┌─────────────────────────────────────────────────────────────┐
│ alembic/env.py (migration runtime)                          │
│                                                              │
│ 1. imports relay.config.settings                            │
│ 2. reads settings.database_url                              │
│ 3. sets alembic connection string                           │
│                                                              │
│ config.set_main_option("sqlalchemy.url", settings.database_url)
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ src/relay/config.py (pydantic-settings)                     │
│                                                              │
│ class Settings(BaseSettings):                               │
│     database_url: str = Field(                              │
│         default="postgresql+asyncpg://localhost/relay"      │
│     )                                                        │
│                                                              │
│ reads from DATABASE_URL environment variable                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│ local development        │    │ production (fly.io)      │
│                          │    │                          │
│ .env file:               │    │ fly secrets:             │
│ DATABASE_URL=            │    │ DATABASE_URL=            │
│   postgresql+asyncpg://  │    │   postgresql://          │
│   localhost:5432/relay   │    │   [neon connection]      │
│                          │    │                          │
│ when you run:            │    │ when fly.io runs:        │
│ uv run alembic upgrade   │    │ release_command:         │
│                          │    │ uv run alembic upgrade   │
│ → migrates LOCAL db      │    │ → migrates PROD db       │
└──────────────────────────┘    └──────────────────────────┘
```

**why this is safe:**

1. **no shared configuration**: local and production environments have completely separate `DATABASE_URL` values
2. **environment-specific secrets**: production database URL is stored in fly.io secrets, never in code
3. **explicit context**: you cannot accidentally run a production migration locally because your local `DATABASE_URL` points to localhost
4. **explicit context**: fly.io cannot run migrations against your local database because it only knows about the production `DATABASE_URL`

**concrete example:**

```bash
# local development
$ cat .env
DATABASE_URL=postgresql+asyncpg://localhost:5432/relay

$ uv run alembic upgrade head
# connects to localhost:5432/relay
# migrates your local dev database

# production (inside fly.io release machine)
$ echo $DATABASE_URL
postgresql://neon_user:***@ep-cool-moon-123.us-east-2.aws.neon.tech/relay

$ uv run alembic upgrade head
# connects to neon production database
# migrates your production database
```

**migration flow for each environment:**

local development:
```
1. developer edits model in src/relay/models/
2. runs: uv run alembic revision --autogenerate -m "description"
3. alembic reads DATABASE_URL from .env (localhost)
4. generates migration by comparing:
   - current model state (code)
   - current database state (local postgres)
5. runs: uv run alembic upgrade head
6. migration applies to local database
```

production deployment:
```
1. developer commits migration file to git
2. pushes to main branch
3. github actions triggers deployment
4. fly.io builds docker image (includes migration files)
5. fly.io starts temporary release machine
6. release machine has DATABASE_URL from fly secrets (production neon)
7. release machine runs: uv run alembic upgrade head
8. alembic reads DATABASE_URL (production neon)
9. migration applies to production database
10. if successful, deployment proceeds
11. if failed, deployment aborts (old version keeps running)
```

**test database (separate again):**

tests use a third database entirely:

```python
# tests/conftest.py
def test_database_url(worker_id: str) -> str:
    return "postgresql+asyncpg://relay_test:relay_test@localhost:5433/relay_test"
```

this ensures:
- tests never touch dev or prod databases
- tests can run in parallel (separate databases per worker)
- test data is isolated and can be cleared between tests

**the complete picture:**

```
┌──────────────────────────────────────────────────────────────┐
│ three completely separate databases:                         │
│                                                               │
│ 1. dev (localhost:5432/relay)                                │
│    - for local development                                   │
│    - set via .env: DATABASE_URL=postgresql+asyncpg://...     │
│    - migrations run manually: uv run alembic upgrade head    │
│                                                               │
│ 2. test (localhost:5433/relay_test)                          │
│    - for automated tests                                     │
│    - set via conftest.py fixture                             │
│    - schema created by tests/conftest.py                     │
│    - no migrations (schema created from models directly)     │
│                                                               │
│ 3. prod (neon.tech cloud)                                    │
│    - for production traffic                                  │
│    - set via fly secrets: DATABASE_URL=postgresql://...      │
│    - migrations run automatically via release_command        │
│                                                               │
│ these databases never interact or share configuration        │
└──────────────────────────────────────────────────────────────┘
```

### recent pain points (2025-11-02)

when deploying timezone support migration `31e69ba0c570`:

1. **dockerfile didn't include migration files** - had to create PR #14 to add `COPY alembic.ini` and `COPY alembic ./alembic`
2. **alembic version tracking out of sync** - production database had `user_preferences` table but alembic thought version was older, causing "relation already exists" errors
3. **manual stamp needed** - had to run `flyctl ssh console -a relay-api -C "uv run alembic stamp 9e8c7aa5b945"` to fix version tracking
4. **manual migration execution** - had to run `flyctl ssh console -a relay-api -C "uv run alembic upgrade head"` after deployment
5. **blocked deployment** - couldn't deploy until all manual steps completed

this took ~30 minutes of manual intervention for what should be automatic.

## how reference project N does it (the right way)

reference project N has a sophisticated automated migration system:

### architecture overview

```
merge to main
    ↓
detect changed migration files (paths-filter)
    ↓
build docker image with migrations included
    ↓
run migrations via google cloud run jobs
    ├─ separate job per database (orion, nebula, events)
    ├─ jobs execute before app deployment
    ├─ jobs block until migration completes
    └─ deployment fails if migration fails
    ↓
update deployment manifests
    ↓
kubernetes/flux picks up new image
    ↓
app starts serving traffic with new schema
```

### key components

**1. migration detection**
```yaml
# .github/paths-filter-pg-migrations.yml
service_a:
  - 'src/project/service_a/migrations/**'
service_b:
  - 'src/project/service_b/migrations/**'
  - 'src/project/utilities/database.py'
```

uses `dorny/paths-filter@v3` to detect which migrations changed in a PR.

**2. cloud run migration jobs**

separate jobs for running migrations:
- `service-a-db-migration-dev`
- `service-a-db-migration-stg`
- `service-b-events-migration-dev`
- etc.

jobs are updated with new image tag and executed with `--wait` flag.

**3. python migration utilities**

```python
# from reference project N's database.py
def alembic_upgrade(database: str, revision: str = "head"):
    """Run alembic upgrades on database"""
    import alembic.command
    alembic.command.upgrade(alembic_config(database), revision)
```

clean python API for running migrations programmatically.

**4. cli commands**

```bash
# reference project N provides CLI for manual operations
project-cli database upgrade
project-cli database downgrade -r <revision>
project-cli database reset
```

**5. safety mechanisms**

- migrations run in dedicated jobs (not in app containers)
- `ALEMBIC_LOCK` prevents concurrent execution
- global roles updated after migrations complete
- separate environments (dev, stg, prod) test migrations before production
- deployment fails if migration fails

### why this works

**isolation**: migrations run in separate containers, not in the app
- prevents race conditions between multiple app instances
- allows long-running migrations without blocking app startup
- easier to debug when migrations fail

**ordering**: migrations complete before app deployment
- ensures schema is ready when app starts
- no "app running on old schema" bugs
- rollback is automatic (deployment doesn't proceed if migration fails)

**observability**: cloud run jobs provide logs and status
- easy to see what migration ran and when
- clear failure messages
- can re-run jobs manually if needed

**automation**: zero manual intervention
- no SSH required
- no human error
- consistent across environments

## implementation history

### what we tried

**initial approach (broken)**: bash wrapper script
```toml
[deploy]
  release_command = './scripts/migrate.sh'
```

**problem**: timed out during VM startup, likely due to script overhead or environment setup issues.

**solution**: direct command execution
```toml
[deploy]
  release_command = "uv run alembic upgrade head"
```

**result**: works perfectly. migrations complete in ~3 seconds, no timeouts.

**key lesson**: fly.io's `release_command` works reliably when you give it a direct command instead of wrapping it in a shell script. the wrapper script was the problem, not VM resources or timeouts.

### current implementation (working ✓)

**fly.toml:**
```toml
[deploy]
  release_command = "uv run alembic upgrade head"
```

**github actions (.github/workflows/deploy-backend.yml):**
```yaml
- name: detect changes
  uses: dorny/paths-filter@v3
  id: changes
  with:
    filters: .github/path-filters.yml

- name: deploy to fly.io
  run: |
    if [ "${{ steps.changes.outputs.migrations }}" == "true" ]; then
      echo "🔄 migrations detected - will run via release_command before deployment"
    fi
    flyctl deploy --remote-only
```

**path filters (.github/path-filters.yml):**
```yaml
migrations:
  - "alembic/versions/**"
  - "alembic/env.py"
  - "alembic.ini"
```

this setup:
1. detects when migrations change
2. logs that migrations will run (for visibility)
3. deploys normally
4. fly.io automatically runs `release_command` before deployment
5. migrations succeed → deployment proceeds
6. migrations fail → deployment aborts, old version keeps running

### alternative approaches considered

**option: post-deployment github actions job**

run migrations via SSH after fly deployment completes:

```yaml
- name: run database migrations
  run: flyctl ssh console -a relay-api -C "uv run alembic upgrade head"
```

**why we didn't use this**:
- migrations run AFTER app starts (brief window where app has wrong schema)
- requires implementing deployment polling logic
- SSH from CI is a security consideration
- fly.io `release_command` is simpler and runs migrations BEFORE deployment

**option: neon branch-based migrations**

use neon's branch features for zero-downtime migrations (test on branch, then promote):

**why we didn't use this**:
- adds complexity for marginal benefit at current scale
- our migrations are simple and fast (~3 seconds)
- can revisit when we have complex, long-running migrations

## future considerations

as relay scales, we may want to explore:

**migration init containers** (if we move to kubernetes/docker compose):
- separate container for migrations before app starts
- matches reference project N's pattern
- better isolation and observability

**neon branch-based migrations** (for complex changes):
- test migrations on database branch first
- promote branch to production (instant swap)
- zero downtime, instant rollback
- useful for high-risk schema changes

**multi-environment pipeline**:
- dev → staging → production progression
- test migrations in lower environments first
- automated smoke tests after migration
- canary deployments for schema changes

## migration best practices

### before creating migration

1. **check current state**
   ```bash
   # local
   uv run alembic current

   # production
   flyctl ssh console -a relay-api -C "uv run alembic current"
   ```

2. **ensure schemas are in sync**
   ```bash
   # generate test migration
   uv run alembic revision --autogenerate -m "test"

   # if file is empty, schemas match
   # if file has changes, schemas are out of sync (fix this first)

   # remove test file
   rm alembic/versions/*_test.py
   ```

### creating migration

1. **make model changes**
   - edit files in `src/relay/models/`
   - keep changes focused (one logical change per migration)

2. **generate migration**
   ```bash
   uv run alembic revision --autogenerate -m "descriptive name"
   ```

3. **review generated migration**
   - alembic autogenerate is not perfect
   - verify the upgrade() function does what you expect
   - check for missing operations (autogenerate doesn't detect everything)
   - ensure downgrade() is correct

4. **test locally**
   ```bash
   # upgrade
   uv run alembic upgrade head

   # verify schema
   uv run python -c "from relay.models import Track; print(Track.__table__.columns)"

   # test downgrade
   uv run alembic downgrade -1
   uv run alembic upgrade head
   ```

5. **test with actual app**
   ```bash
   # start backend with new schema
   uv run uvicorn relay.main:app --reload

   # verify endpoints work
   curl http://localhost:8001/health
   ```

### deploying migration

1. **commit migration file only**
   ```bash
   git add alembic/versions/<hash>_<description>.py
   git commit -m "migration: <description>"
   ```

2. **create PR and review**
   - include migration details in PR description
   - note any backward compatibility concerns
   - tag for review if complex

3. **merge and deploy**
   - merge to main
   - watch deployment
   - run migration (manual for now, automated soon)

4. **verify deployment**
   ```bash
   # check revision
   flyctl ssh console -a relay-api -C "uv run alembic current"

   # check app health
   curl https://relay-api.fly.dev/health

   # check logs
   flyctl logs --app relay-api
   ```

### handling failed migrations

**if migration fails during upgrade**:

1. **check what failed**
   ```bash
   flyctl logs --app relay-api | grep alembic
   ```

2. **check database state**
   ```bash
   flyctl ssh console -a relay-api -C "uv run alembic current"
   ```

3. **fix the issue**
   - if migration was partially applied, may need manual SQL to fix
   - if migration didn't apply, fix and re-run
   - if data is corrupted, may need to restore from backup

4. **options**:

   a. **downgrade and fix**:
   ```bash
   flyctl ssh console -a relay-api -C "uv run alembic downgrade -1"
   # fix migration file locally
   # commit and redeploy
   ```

   b. **create fix migration**:
   ```bash
   # create new migration that fixes the issue
   uv run alembic revision -m "fix previous migration"
   # implement fix in upgrade()
   # commit and deploy
   ```

   c. **manual SQL fix**:
   ```bash
   flyctl ssh console -a relay-api
   # connect to database
   # run manual SQL to fix state
   # stamp to correct revision
   # exit
   ```

### zero-downtime migration patterns

for production systems, some schema changes require special handling:

**adding nullable columns** (safe):
```python
def upgrade():
    op.add_column('tracks', sa.Column('new_field', sa.String(), nullable=True))
```

**adding non-nullable columns** (requires two-step):
```python
# migration 1: add nullable
def upgrade():
    op.add_column('tracks', sa.Column('new_field', sa.String(), nullable=True))

# migration 2: populate and make non-null
def upgrade():
    op.execute("UPDATE tracks SET new_field = 'default' WHERE new_field IS NULL")
    op.alter_column('tracks', 'new_field', nullable=False)
```

**dropping columns** (requires two-step):
```python
# migration 1: stop using column in app code
# deploy app

# migration 2: drop column
def upgrade():
    op.drop_column('tracks', 'old_field')
```

**renaming columns** (requires three-step):
```python
# migration 1: add new column
def upgrade():
    op.add_column('tracks', sa.Column('new_name', sa.String()))
    op.execute("UPDATE tracks SET new_name = old_name")

# migration 2: switch app to use new column
# deploy app

# migration 3: drop old column
def upgrade():
    op.drop_column('tracks', 'old_name')
```

## references

### internal
- relay dockerfile: `Dockerfile`
- relay fly config: `fly.toml`
- alembic config: `alembic.ini`
- alembic env: `alembic/env.py`
- models: `src/relay/models/`

### external
- alembic documentation: https://alembic.sqlalchemy.org/
- fly.io release commands: https://fly.io/docs/reference/configuration/#release_command
- fly.io ssh: https://fly.io/docs/flyctl/ssh/
- neon branching: https://neon.tech/docs/guides/branching

### github actions
- paths-filter action: https://github.com/dorny/paths-filter
- flyctl actions: https://github.com/superfly/flyctl-actions

---

**last updated**: 2025-11-02
**status**: fully automated via fly.io release_command ✓
**owner**: @zzstoatzz
