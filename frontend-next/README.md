# plyr.fm next frontend

This is the deliberately small frontend for `next.plyr.fm`. It consumes the
source-authoritative Zig `/v1` API directly and does not import the legacy
frontend's Python-shaped models.

The first slice is an anonymous catalog and player:

- `GET /v1/tracks` drives the paginated catalog;
- `GET /v1/artists/{identifier}` resolves an artist selection;
- `GET /v1/tracks/{id}/playback` grants a playback capability before audio is
  attached to the player.

The browser never guesses a delivery URL from catalog metadata. A track can be
visible while playback is unavailable, and the UI represents those states
separately.

The frontend is static HTML, CSS, and JavaScript. A narrow Pages Function maps
same-origin `/api/v1/*` reads to the fixed Fly canary origin. It is a transport
boundary, not a response adapter: status, body, request ID, and the Zig v1 JSON
contract pass through unchanged. This makes Pages previews testable and keeps
the eventual auth boundary same-site without weakening backend CORS.

```sh
just check
just run
```

Deployment is manual and checkpointed. It uses a dedicated Pages project; the
existing production and staging Pages projects are not deployment targets.
