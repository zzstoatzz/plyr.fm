# tests

pytest with async support.

critical rules:
- NEVER use `@pytest.mark.asyncio` - pytest is configured with `asyncio_mode = "auto"`
- all fixtures and test parameters MUST be type hinted
- `just test` runs with isolated postgres per worker (xdist)

structure:
- `api/` - endpoint tests using TestClient
- `utilities/` - unit tests for hashing, config, etc
- `conftest.py` - shared fixtures (db session, test client, mock auth)

adding tests:
- always add regression test when fixing bugs
- use `mock_auth_session` fixture for authenticated endpoints
- check existing tests for patterns before writing new ones