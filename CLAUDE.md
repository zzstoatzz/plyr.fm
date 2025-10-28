# relay

decentralized music streaming platform on ATProto.

## critical reminders

- **testing**: empirical first - run code and prove it works before writing tests
- **auth**: OAuth 2.1 implementation from fork (`git+https://github.com/zzstoatzz/atproto@main`)
- **storage**: filesystem for MVP, will migrate to R2 later
- **database**: delete `data/relay.db` when Track model changes (no migrations yet)
- **frontend**: SvelteKit with **bun** (not npm/pnpm) - reference project in `sandbox/huggingchat-ui` for patterns
- **justfile**: use `just` for dev workflows when needed
