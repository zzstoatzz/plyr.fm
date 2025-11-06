# plyr

music streaming platform on ATProto.

## critical reminders

- **issues**: GitHub, not Linear
- **PRs**: always create for review before merging to main
- **deployment**: automated via GitHub Actions on merge - NEVER deploy locally
- **migrations**: automated via fly.io release_command
- **logs**: `flyctl logs` is BLOCKING - use `run_in_background=true`
- **type hints**: required everywhere

## structure

```
plyr/
├── src/backend/
│   ├── api/          # public endpoints (see api/CLAUDE.md)
│   ├── _internal/    # internal services (see _internal/CLAUDE.md)
│   ├── models/       # database schemas
│   ├── atproto/      # protocol integration
│   └── storage/      # R2 and filesystem
├── frontend/         # SvelteKit (see frontend/CLAUDE.md)
└── tests/            # test suite (see tests/CLAUDE.md)
```

## development

backend: `uv run uvicorn backend.main:app --reload`
frontend: `cd frontend && bun run dev`
tests: `just test`
