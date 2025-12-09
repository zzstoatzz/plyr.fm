# plyr.fm documentation

organized knowledge base for plyr.fm development.

## quick navigation

### operations
- **[runbooks/](./runbooks/)** - production incident procedures
  - [connection-pool-exhaustion](./runbooks/connection-pool-exhaustion.md) - 500s, stuck connections

### backend
- **[background-tasks.md](./backend/background-tasks.md)** - docket-based task system (copyright scan, export, scrobble)
- **[configuration.md](./backend/configuration.md)** - environment setup and settings
- **[database/](./backend/database/)** - connection pooling, neon-specific patterns
- **[streaming-uploads.md](./backend/streaming-uploads.md)** - SSE progress tracking
- **[transcoder.md](./backend/transcoder.md)** - rust audio conversion service

### frontend
- **[state-management.md](./frontend/state-management.md)** - svelte 5 runes patterns
- **[keyboard-shortcuts.md](./frontend/keyboard-shortcuts.md)** - global shortcuts
- **[navigation.md](./frontend/navigation.md)** - SvelteKit routing patterns
- **[search.md](./frontend/search.md)** - unified search with Cmd+K

### deployment
- **[environments.md](./deployment/environments.md)** - staging vs production
- **[database-migrations.md](./deployment/database-migrations.md)** - alembic workflow

### tools
- **[logfire.md](./tools/logfire.md)** - SQL query patterns for observability
- **[neon.md](./tools/neon.md)** - postgres database management
- **[pdsx.md](./tools/pdsx.md)** - ATProto PDS explorer

### atproto
- **[lexicons/](./lexicons/)** - record schemas (track, like, comment, list, profile)
- **[authentication.md](./authentication.md)** - OAuth 2.1 flow

### moderation
- **[moderation/](./moderation/)** - copyright detection, sensitive content, labeler

### testing
- **[testing/](./testing/)** - pytest patterns, parallel execution

### local development
- **[local-development/setup.md](./local-development/setup.md)** - getting started

## architecture overview

plyr.fm uses a hybrid storage model:
- **audio files**: cloudflare R2 (CDN-backed, zero egress)
- **metadata**: ATProto records on user's PDS (decentralized, user-owned)
- **indexes**: neon postgres for fast queries

key namespaces:
- `fm.plyr.track` - track metadata
- `fm.plyr.like` - user likes
- `fm.plyr.comment` - timed comments
- `fm.plyr.list` - playlists and albums
- `fm.plyr.actor.profile` - artist profiles

## quick start

```bash
# backend
just backend run

# frontend
just frontend dev

# run tests
just backend test
```

see [local-development/setup.md](./local-development/setup.md) for complete setup.

## contributing

1. check docs before researching externally
2. document decisions as you make them
3. keep it simple - MVP over perfection
4. use lowercase aesthetic
