# local development setup

## prerequisites

- **python**: 3.11+ (managed via `uv`)
- **node/bun**: for frontend development
- **postgres**: local database (optional - can use neon dev instance)
- **ffmpeg**: for transcoder development (optional)

## quick start

```bash
# clone repository
gh repo clone zzstoatzz/plyr.fm
cd plyr.fm

# install python dependencies
uv sync

# install frontend dependencies
cd frontend && bun install && cd ..

# copy environment template
cp .env.example .env
# edit .env with your credentials

# run backend
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001

# run frontend (separate terminal)
cd frontend && bun run dev
```

visit http://localhost:5173 to see the app.

## environment configuration

### required environment variables

create a `.env` file in the project root:

```bash
# database (use neon dev instance or local postgres)
DATABASE_URL=postgresql+asyncpg://localhost/plyr  # local
# DATABASE_URL=<neon-dev-connection-string>        # neon dev

# oauth (uses client metadata discovery - no registration required)
ATPROTO_CLIENT_ID=http://localhost:8001/client-metadata.json
ATPROTO_CLIENT_SECRET=<your-client-secret>
ATPROTO_REDIRECT_URI=http://localhost:5173/auth/callback
OAUTH_ENCRYPTION_KEY=<base64-encoded-32-byte-key>

# storage (r2 or filesystem)
STORAGE_BACKEND=filesystem  # or "r2" for cloudflare r2
R2_BUCKET=audio-dev
R2_IMAGE_BUCKET=images-dev
R2_ENDPOINT_URL=<your-r2-endpoint>
R2_PUBLIC_BUCKET_URL=<your-r2-public-url>
R2_PUBLIC_IMAGE_BUCKET_URL=<your-r2-image-public-url>
AWS_ACCESS_KEY_ID=<your-r2-access-key>
AWS_SECRET_ACCESS_KEY=<your-r2-secret>

# optional: observability
LOGFIRE_ENABLED=false  # set to true to enable
LOGFIRE_WRITE_TOKEN=<your-token>
LOGFIRE_ENVIRONMENT=development

# optional: notifications
NOTIFY_ENABLED=false
```

### generating oauth encryption key

```bash
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
```

## database setup

### option 1: use neon dev instance (recommended)

1. get dev database URL from neon console or `.env.example`
2. set `DATABASE_URL` in `.env`
3. run migrations: `uv run alembic upgrade head`

### option 2: local postgres

```bash
# install postgres
brew install postgresql@15  # macos
# or use docker

# create database
createdb plyr

# run migrations
DATABASE_URL=postgresql+asyncpg://localhost/plyr uv run alembic upgrade head
```

## running services

### backend

```bash
# standard run
uv run uvicorn backend.main:app --reload

# with custom port
uv run uvicorn backend.main:app --reload --port 8001

# with host binding (for mobile testing)
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

backend api docs: http://localhost:8001/docs

### frontend

```bash
cd frontend

# development server
bun run dev

# custom port
PORT=5174 bun run dev

# expose to network (for mobile testing)
bun run dev -- --host
```

frontend: http://localhost:5173

### transcoder (optional)

```bash
cd transcoder

# install rust toolchain if needed
rustup update

# install ffmpeg
brew install ffmpeg  # macos

# run transcoder
cargo run

# with custom port
TRANSCODER_PORT=9000 cargo run

# with debug logging
RUST_LOG=debug cargo run
```

transcoder: http://localhost:8080

## development workflow

### making backend changes

1. edit code in `src/backend/`
2. uvicorn auto-reloads on file changes
3. test endpoints at http://localhost:8001/docs
4. check logs in terminal

### making frontend changes

1. edit code in `frontend/src/`
2. vite auto-reloads on file changes
3. view changes at http://localhost:5173
4. check console for errors

### creating database migrations

```bash
# make model changes in src/backend/models/

# generate migration
uv run alembic revision --autogenerate -m "description"

# review generated migration in alembic/versions/

# apply migration
uv run alembic upgrade head

# test downgrade
uv run alembic downgrade -1
uv run alembic upgrade head
```

see [database-migrations.md](../deployment/database-migrations.md) for details.

### running tests

```bash
# all tests
uv run pytest

# specific test file
uv run pytest tests/api/test_tracks.py

# with verbose output
uv run pytest -v

# with coverage
uv run pytest --cov=backend

# watch mode (re-run on changes)
uv run pytest-watch
```

## mobile testing

to test on mobile devices on your local network:

### 1. find your local ip

```bash
# macos/linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# windows
ipconfig
```

### 2. run backend with host binding

```bash
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

### 3. run frontend with network exposure

```bash
cd frontend && bun run dev -- --host
```

### 4. access from mobile

- backend: http://<your-ip>:8001
- frontend: http://<your-ip>:5173

## troubleshooting

### backend won't start

**symptoms**: `ModuleNotFoundError` or import errors

**solutions**:
```bash
# reinstall dependencies
uv sync

# check python version
uv run python --version  # should be 3.11+

# verify environment
uv run python -c "from backend.main import app; print('ok')"
```

### database connection errors

**symptoms**: `could not connect to server` or SSL errors

**solutions**:
```bash
# verify DATABASE_URL is set
echo $DATABASE_URL

# test connection
uv run python -c "from backend.config import settings; print(settings.database.url)"

# check postgres is running (if local)
pg_isready

# verify neon credentials (if remote)
# check neon console for connection string
```

### frontend build errors

**symptoms**: `module not found` or dependency errors

**solutions**:
```bash
# reinstall dependencies
cd frontend && rm -rf node_modules && bun install

# clear cache
rm -rf frontend/.svelte-kit

# check node version
node --version  # should be 18+
bun --version
```

### oauth redirect errors

**symptoms**: `invalid redirect_uri` or callback errors

**solutions**:
```bash
# verify ATPROTO_REDIRECT_URI matches frontend URL
# should be: http://localhost:5173/auth/callback

# check ATPROTO_CLIENT_ID is accessible (should return client metadata JSON)
curl http://localhost:8001/client-metadata.json
```

### r2 upload failures

**symptoms**: `failed to upload to R2` or storage errors

**solutions**:
```bash
# verify credentials
echo $AWS_ACCESS_KEY_ID
echo $AWS_SECRET_ACCESS_KEY
echo $R2_BUCKET

# test r2 connectivity
uv run python -c "
from backend.storage import get_storage_backend
storage = get_storage_backend()
print(storage.bucket_name)
"

# or use filesystem backend for local development
STORAGE_BACKEND=filesystem uv run uvicorn backend.main:app --reload
```

## useful commands

```bash
# backend
uv run uvicorn backend.main:app --reload  # start backend
uv run pytest                             # run tests
uv run alembic upgrade head               # run migrations
uv run python -m backend.utilities.cli    # admin cli

# frontend
cd frontend && bun run dev                # start frontend
cd frontend && bun run build              # build for production
cd frontend && bun run preview            # preview production build
cd frontend && bun run check              # type check

# transcoder
cd transcoder && cargo run                # start transcoder
cd transcoder && cargo test               # run tests
cd transcoder && cargo build --release    # build for production
```

## next steps

- read [backend/configuration.md](../backend/configuration.md) for config details
- read [frontend/state-management.md](../frontend/state-management.md) for frontend patterns
- read [tools/](../tools/) for development tools (logfire, neon, pdsx)
- check [deployment/](../deployment/) when ready to deploy
