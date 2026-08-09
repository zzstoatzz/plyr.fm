# tests

pytest with async support.

critical rules:
- NEVER use `@pytest.mark.asyncio` - pytest is configured with `asyncio_mode = "auto"`
- all fixtures and test parameters MUST be type hinted
- `just test` runs `-n auto` against the compose postgres, the same way CI does.
  it pins `DATABASE_URL` itself — your `backend/.env` is deliberately ignored,
  and conftest refuses outright to run against a non-local database host
- `just test-serial` is one process, for pdb or a single test. it is NOT what
  CI runs: no template database, no advisory lock, no per-worker redis db.
  always confirm with `just test` before pushing
- a second checkout runs its own stack via `TEST_DB_PORT` / `TEST_REDIS_PORT`
  (the compose project is already keyed per checkout, but host ports are not)

structure:
- `api/` - endpoint tests using TestClient
- `utilities/` - unit tests for hashing, config, etc
- `conftest.py` - shared fixtures (db session, test client, mock auth)

adding tests:
- always add regression test when fixing bugs
- use `mock_auth_session` fixture for authenticated endpoints
- check existing tests for patterns before writing new ones