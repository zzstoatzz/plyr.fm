# plyr.fm frontend

The SvelteKit app for listening, discovering audio, and publishing tracks. Svelte 5 runes manage the persistent player, queue, uploads, and shared state. The app includes artist and album pages, playlists, search, radio, jams, timed comments, and embeddable players.

## develop

Follow the [contributing setup](https://docs.plyr.fm/contributing/) first. From the repository root:

```sh
cd frontend && bun install && cd ..
cp frontend/.env.example frontend/.env
just frontend run
```

The dev server runs on port 5173; the example environment points at the backend on port 8001. Start it separately with `just backend run` when needed.

```sh
just frontend check             # Svelte and TypeScript checks
just frontend test              # component tests
just frontend storybook         # component preview
just frontend test-storybook    # browser accessibility checks
```

## find your way around

- `src/routes/` — pages, layouts, and route data loading.
- `src/lib/components/` — player, track cards, menus, dialogs, and reusable controls.
- `src/lib/*.svelte.ts` — state owners for the player, queue, likes, uploader, and caches.
- `src/stories/` — component stories.

Use the existing [design tokens](../docs/internal/frontend/design-tokens.md) and [state patterns](../docs/internal/frontend/state-management.md). [AGENTS.md](AGENTS.md) documents frontend conventions and gotchas; the [frontend knowledge base](../docs/internal/frontend/) covers individual systems.

Cloudflare Pages builds staging from `main`. Production uses a separate promote; see [deployment environments](../docs/internal/deployment/environments.md).
