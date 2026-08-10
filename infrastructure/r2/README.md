# R2 bucket CORS

`cors.json` is the CORS policy for the **public** media buckets. Without it,
browser JS on another origin can play a track through `<audio src>` but cannot
read the bytes — so `fetch()` → `arrayBuffer()` → `decodeAudioData()` and
`crossorigin="anonymous"` + `createMediaElementSource()` both fail. That rules
out third-party decks, waveforms, and analysers.

Apply it with:

```sh
export CLOUDFLARE_ACCOUNT_ID=...   # personal account; see docs/internal/tools/agent-access.md
bunx wrangler r2 bucket cors set audio-staging  --file infrastructure/r2/cors.json
bunx wrangler r2 bucket cors set images-staging --file infrastructure/r2/cors.json
bunx wrangler r2 bucket cors set audio-prod     --file infrastructure/r2/cors.json
bunx wrangler r2 bucket cors set images-prod    --file infrastructure/r2/cors.json
```

## which buckets

Only the four buckets above — the ones already public via a custom domain and
an enabled `r2.dev` URL. `*` there grants reads to origins that could already
read the object with `curl`; CORS is a browser policy, not authentication.

**Never apply this to `audio-private-{staging,prod}`.** Those hold gated audio,
have no custom domain, have `r2.dev` public access disabled, and are reachable
only by presigned URL. `*` there would be an actual access-control change.

## after applying

Two things lag:

- the policy takes up to a minute to reach every colo, so the first curl after
  `cors set` can still show no `access-control-allow-origin`
- the media domains carry a 1yr edge TTL ("Cache R2 media assets"). Objects
  already cached keep serving their header-less variant, and `Vary: Origin`
  does not rescue them — those keys need an explicit cache purge

Verify against a *cached* object, not a cache-busted one, since the cached path
is what listeners and third-party apps actually hit:

```sh
curl -sI -H 'Origin: https://example.com' https://audio.plyr.fm/audio/<key>
# want: access-control-allow-origin: *   alongside cf-cache-status: HIT
```
