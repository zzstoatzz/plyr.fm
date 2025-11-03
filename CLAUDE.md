# relay

music streaming platform on ATProto.

## critical reminders

- **issues**: tracked in GitHub, not Linear
- **pull requests**: always create a PR for review before merging to main - we will have users soon
- **PR review comments**: to get inline review comments, use `gh api repos/{owner}/{repo}/pulls/{pr}/reviews/{review_id}/comments` (get review_id first with `gh api repos/{owner}/{repo}/pulls/{pr}/reviews -q '.[0].id'`)
- **testing**: empirical first - run code and prove it works before writing tests
- **testing async**: NEVER use `@pytest.mark.asyncio` - pytest is configured with `asyncio_mode = "auto"` in pyproject.toml
- **auth**: OAuth 2.1 implementation from fork (`git+https://github.com/zzstoatzz/atproto@main`)
- **storage**: Cloudflare R2 for audio files
- **database**: Neon PostgreSQL (serverless)
- **frontend**: SvelteKit with **bun** (not npm/pnpm)
- **backend**: FastAPI deployed on Fly.io
- **deployment**: automated via GitHub Actions on merge to main - NEVER deploy locally
- **migrations**: fully automated via fly.io `release_command` - see [docs/deployment/database-migrations.md](docs/deployment/database-migrations.md)
  - migrations run automatically BEFORE deployment when you merge to main
  - fly.io runs `uv run alembic upgrade head` via release_command
  - deployment aborts if migration fails (safe rollback)
  - no manual intervention required
- **logs**: `flyctl logs` is BLOCKING - must run in background with `run_in_background=true` then check output with BashOutput
- **observability**: Logfire for traces/spans - see [docs/logfire-querying.md](docs/logfire-querying.md) for query patterns
- **type hints**: complete type coverage required - all functions, fixtures, and test parameters must be type hinted

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
