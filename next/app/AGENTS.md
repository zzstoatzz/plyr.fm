# next client

## boundaries

- Keep route files in `app/` focused on route parameters, navigation and screen
  composition. Put reusable UI and feature behavior in `src/`; do not add PDS,
  socket or persistence protocols to route components.
- Keep queue transitions, retry rules and reconciliation outside rendering
  components. Extend the existing feature model and hook rather than creating
  a second state owner in a screen. Playback stays above the route stack in
  `PlaybackProvider`; screens issue commands through `usePlayback`.
- Keep HTTP/PDS serialization and response validation in transport modules
  such as `api.ts` and `pds.ts`. Components consume typed results and feature
  actions; they do not invent alternate endpoint, auth or retry behavior.
- Reuse shared controls, text, artwork and appearance helpers. When a feature
  needs several collaborating modules, keep them together under its name;
  do not grow a general-purpose helper or split files solely to meet a limit.
- Put browser/native differences behind matching platform modules, as in
  `auth.web.ts` / `auth.ts` and `queue-storage.web.ts` / `queue-storage.ts`.
  Shared feature code must not import DOM or native storage implementations.
  Keep both implementations' behavior and exported contracts aligned.

## checks

From `next/app`, run `npm run check`, `npm test` and `npm run build:web`.
Exercise model behavior in `tests/` and rendered interactions through the
relevant browser checks in `scripts/`, following the parent instructions.
Platform changes also need the affected native build and device behavior;
an Expo bundle export does not verify native lifecycle or audio.

See the [client readme](README.md) for local/native commands and player
navigation. Keep detailed feature contracts there or in the owning design
document rather than expanding these instructions.
