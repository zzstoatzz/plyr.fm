---
title: "local development setup"
---

use the [public contributing guide](https://docs.plyr.fm/contributing/) for the
canonical clone, install, environment-file, database, and run commands. This page
covers the local configuration details that do not fit in that quickstart.

## backend environment

Copy `backend/.env.example` to `backend/.env`. The backend loads that file from
the backend project directory. Set `DATABASE_URL` to a local PostgreSQL
database or the development Neon branch. For a fresh local database, initialize
the schema once, then apply later migrations with the root-level commands:

```bash
just backend db-init
just backend migrate-up
```

the backend listens on port 8001 by default. For local OAuth, use the API
metadata URL and callback below; the callback is handled by the backend:

```dotenv
ATPROTO_CLIENT_ID=http://localhost:8001/oauth-client-metadata.json
ATPROTO_REDIRECT_URI=http://localhost:8001/auth/callback
```

real PDSes need to reach the OAuth client metadata and callback over public
HTTPS. To sign in against one, expose the backend with a tunnel and set both
values to the corresponding public URLs. Generate an encryption key with:

```bash
python3 -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
```

set the result as `OAUTH_ENCRYPTION_KEY`. R2 credentials are needed for uploads
and cover-image changes; anonymous browsing and playback of existing public
tracks work without them. See the comments in `backend/.env.example` for the
available storage and optional observability settings.

## optional services

Redis is only needed when you want the separate background worker. Start it
from the repository root with `just dev-services`, then run the worker from the
backend directory:

```bash
cd backend
DOCKET_URL=redis://localhost:6379 uv run python -m backend.worker
```

the worker consumes queued tasks; ordinary local development can use the
in-process fallback when `DOCKET_URL` is unset. See
[background tasks](../backend/background-tasks.md) for details.

for transcoder development, install Rust and `cargo-watch`, then run
`just transcoder run` from the repository root. Install FFmpeg as well when
working with audio conversion. See
[deployment environments](../deployment/environments.md) for the service ports
and environment overview.

## tests

run backend tests from the repository root with `just backend test`. This starts
the isolated PostgreSQL and Redis services used by CI. Use
`just backend test-serial tests/path/to_test.py` when debugging one test file;
it is not the CI test path. See [testing](../testing/README.md) for fixture and
test-writing guidance.
