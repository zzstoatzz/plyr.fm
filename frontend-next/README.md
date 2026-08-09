# plyr.fm next frontend

This is the deliberately small frontend for `next.plyr.fm`. It consumes the
source-authoritative Zig `/v1` API directly and does not import the legacy
frontend's Python-shaped models.

The anonymous client currently exposes:

- `GET /v1/tracks` drives the paginated catalog;
- `GET /v1/artists/{identifier}` resolves an artist selection;
- `GET /v1/tracks/{id}/playback` grants a playback capability before audio is
  attached to the player;
- `GET /v1/playlists` and `GET /v1/playlists/{id}` expose verified lists while
  preserving every source position, including unavailable track references.

The browser never guesses a delivery URL from catalog metadata. A track can be
visible while playback is unavailable, and the UI represents those states
separately.

Albums intentionally remain absent from the client while their collection read
depends on the legacy album projection. A frontend feature is not considered
part of the canary merely because a detached backend route exists.

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
