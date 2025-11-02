# database migrations

## current state (broken - needs automation)

relay currently has **broken/manual database migrations** that require SSH access to production.

### what's wrong

the current process is:
1. developer creates migration locally
2. developer commits and pushes
3. deployment happens (no migrations run automatically)
4. **developer manually SSHs to production and runs migration**

this is unacceptable because:
- human error prone (forget to run migration, run wrong command, etc.)
- requires manual intervention for every schema change
- no verification that migration succeeded before app starts serving traffic
- can cause race conditions if multiple instances start with old schema
- blocks on SSH access (what if SSH is down?)
- doesn't scale (what about rollbacks? what about multiple environments?)

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

## proposed solution for relay

given our simpler architecture (single database, fly.io deployment), we need a lighter-weight version of reference project N's approach.

### option 1: github actions migration job (recommended)

run migrations from github actions before fly deployment completes:

```yaml
# .github/workflows/deploy-backend.yaml
name: deploy backend to fly.io

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: setup flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      # deploy in background (don't wait)
      - name: deploy to fly.io
        run: flyctl deploy --remote-only --detach
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      # wait for deployment to finish
      - name: wait for deployment
        run: |
          flyctl status --app relay-api
          # poll until new version is running
          # (implement proper polling logic)

      # run migrations after deployment completes
      - name: run database migrations
        run: |
          flyctl ssh console -a relay-api -C "uv run alembic upgrade head"
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      # verify migration succeeded
      - name: verify migration
        run: |
          REVISION=$(flyctl ssh console -a relay-api -C "uv run alembic current")
          echo "current revision: $REVISION"
```

**pros**:
- automated, no manual SSH
- runs after deployment (docker image includes migration files)
- github actions logs show migration output
- can add retries, notifications, etc.

**cons**:
- migrations run after app starts (brief window where app has wrong schema)
- need to implement deployment polling
- SSH from CI (security consideration)

### option 2: fly.io release command (original plan, currently broken)

use fly.io's built-in release command (currently disabled due to VM timeout issues):

```toml
# fly.toml
[deploy]
  release_command = "uv run alembic upgrade head"
```

**pros**:
- simplest configuration
- migrations run before app starts serving traffic
- built-in rollback if migration fails

**cons**:
- **currently broken** due to fly.io VM startup timeouts
- less control over migration process
- harder to debug failures

**status**: disabled as of commit e7d4f5e, needs investigation

### option 3: migration init container (future)

if we move to kubernetes/docker compose:

```yaml
# docker-compose.yaml
services:
  migrate:
    image: relay-api:latest
    command: uv run alembic upgrade head
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  api:
    image: relay-api:latest
    depends_on:
      migrate:
        condition: service_completed_successfully
```

**pros**:
- proper ordering (migrate → app)
- works with any orchestrator
- matches reference project N's pattern

**cons**:
- requires different deployment architecture
- not applicable to fly.io currently

### option 4: neon branch-based migrations (advanced)

use neon's branch features for zero-downtime migrations:

```bash
# 1. create branch from main
neon branches create --name migration-test

# 2. run migration on branch
DATABASE_URL=<branch-url> uv run alembic upgrade head

# 3. verify migration
# test app against branch database

# 4. promote branch to main (instant swap)
neon branches promote migration-test
```

**pros**:
- zero downtime
- can test migration before applying to production
- instant rollback (switch back to old branch)

**cons**:
- requires neon-specific tooling
- more complex workflow
- need to manage branch lifecycle

## recommended implementation plan

### phase 1: automate current manual process (immediate)

1. **update github actions workflow**
   - add migration step after deployment
   - use `flyctl ssh console -C` to run migrations
   - add verification step

2. **add migration detection**
   - use `dorny/paths-filter@v3` to detect `alembic/versions/**` changes
   - only run migration step if migrations changed
   - skip if no migrations (faster deployments)

3. **improve error handling**
   - add retries for transient failures
   - post to slack on failure
   - clear error messages

### phase 2: fix fly.io release command (short-term)

1. **investigate VM timeout issue**
   - contact fly.io support
   - check if timeout can be increased
   - test with minimal release command

2. **optimize migration container**
   - pre-build image with all dependencies
   - minimize startup time
   - consider using fly machines instead of VMs

3. **re-enable release command**
   - test in dev environment first
   - monitor for timeouts
   - rollback to github actions if unstable

### phase 3: proper migration infrastructure (long-term)

when we have multiple environments (dev, staging, prod):

1. **separate migration jobs**
   - dedicated fly apps for migrations
   - triggered via CI/CD
   - proper logging and monitoring

2. **pre-deployment testing**
   - run migrations on dev first
   - verify schema matches models
   - test app against new schema

3. **zero-downtime migrations**
   - use neon branches for complex changes
   - multi-step migrations for breaking changes
   - feature flags for new columns

## immediate action items

**required before next migration**:

- [ ] implement github actions migration job (option 1)
- [ ] add paths-filter for migration detection
- [ ] test automated migration on dev branch
- [ ] document new process in this file
- [ ] update CLAUDE.md with new workflow

**nice to have**:

- [ ] investigate fly.io timeout issue
- [ ] add migration verification step
- [ ] add slack notifications
- [ ] create migration runbook

## current workaround (temporary)

until automation is implemented, manual process is:

```bash
# 1. ensure dockerfile includes migration files (PR #14 fixed this)
# verify these lines exist in Dockerfile:
#   COPY alembic.ini ./
#   COPY alembic ./alembic

# 2. create and test migration locally
uv run alembic revision --autogenerate -m "description"
uv run alembic upgrade head

# 3. commit and push
git add alembic/versions/
git commit -m "add migration"
git push

# 4. wait for deployment to complete
gh run watch

# 5. run migration on production
flyctl ssh console -a relay-api -C "uv run alembic upgrade head"

# 6. verify migration
flyctl ssh console -a relay-api -C "uv run alembic current"
```

**known issues with manual process**:

- if alembic version tracking is out of sync, may need to stamp first:
  ```bash
  flyctl ssh console -a relay-api -C "uv run alembic stamp <revision>"
  ```
- if migration files weren't in docker image, need to rebuild and redeploy
- if multiple migrations exist, may hit "relation already exists" errors

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
**status**: manual process, automation in progress
**owner**: @zzstoatzz
