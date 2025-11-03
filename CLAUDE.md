# relay

music streaming platform on ATProto.

## critical reminders

- **issues**: tracked in GitHub, not Linear
- **pull requests**: always create a PR for review before merging to main - we will have users soon
- **testing**: empirical first - run code and prove it works before writing tests
- **testing async**: NEVER use `@pytest.mark.asyncio` - pytest is configured with `asyncio_mode = "auto"` in pyproject.toml
- **auth**: OAuth 2.1 implementation from fork (`git+https://github.com/zzstoatzz/atproto@main`)
- **storage**: Cloudflare R2 for audio files
- **database**: Neon PostgreSQL (serverless)
- **frontend**: SvelteKit with **bun** (not npm/pnpm)
- **backend**: FastAPI deployed on Fly.io
- **deployment**: `flyctl deploy` (runs in background per user prefs)
- **logs**: `flyctl logs` is BLOCKING - must run in background with `run_in_background=true` then check output with BashOutput
- **observability**: Logfire for traces/spans - see [docs/logfire-querying.md](docs/logfire-querying.md) for query patterns

## testing

run tests locally with:
```bash
just test
```

this will:
1. spin up a PostgreSQL test database via docker-compose
2. run pytest against it
3. tear down the database

tests use PostgreSQL only (no SQLite), similar to Nebula's approach. each pytest worker gets its own isolated database.
