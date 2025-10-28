# relay

decentralized music streaming platform on ATProto.

## critical reminders

- **testing**: empirical first - run code and prove it works before writing tests
- **atproto client**: always pass PDS URL at initialization to avoid JWT issues
- **auth**: using app password authentication for MVP (OAuth support being added upstream)
- **storage**: filesystem for MVP, will migrate to R2 later
- **database**: delete `data/relay.db` when Track model changes (no migrations yet)
- **frontend**: SvelteKit - reference project in `sandbox/huggingchat-ui` for patterns
- **justfile**: use `just` for all dev workflows (see `just --list`)
