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
- Keep native persistence, auth, audio and system integrations in this workspace.
  Import shared models and contracts from `@plyr/next-core`.

## how to work here

Use `next-write-ui` for native UI and `next-unslop` for the author pass.
Get an independent `next-review` before merging.

## checks

From `next/app`, run `bun run lint`, `bun run check` and `bun run test`.
Platform changes also need the affected simulator or device check. See
[contributing/checks.md](contributing/checks.md).

See the [client readme](README.md) for local/native commands and player
navigation. Keep detailed feature contracts there or in the owning design
document rather than expanding these instructions.
