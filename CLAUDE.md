# relay

decentralized music streaming platform on ATProto.

## critical reminders

- **pull requests**: always create a PR for review before merging to main - we will have users soon
- **testing**: empirical first - run code and prove it works before writing tests
- **auth**: OAuth 2.1 implementation from fork (`git+https://github.com/zzstoatzz/atproto@main`)
- **storage**: Cloudflare R2 for audio files
- **database**: Neon PostgreSQL (serverless)
- **frontend**: SvelteKit with **bun** (not npm/pnpm)
- **backend**: FastAPI deployed on Fly.io
- **deployment**: `flyctl deploy` (runs in background per user prefs)
- **logs**: `flyctl logs` is BLOCKING - must run in background with `run_in_background=true` then check output with BashOutput
