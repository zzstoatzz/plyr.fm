# tests

- NEVER use `@pytest.mark.asyncio` - pytest is configured with `asyncio_mode = "auto"`
- all fixtures and test parameters must be type hinted
- `just test` runs tests with isolated PostgreSQL databases per worker
