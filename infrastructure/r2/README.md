# R2 bucket CORS

`cors.json` is the CORS policy for the **public** media buckets. Without it,
browser JS on another origin can play a track through `<audio src>` but cannot
read the bytes — so `fetch()` → `arrayBuffer()` → `decodeAudioData()` and
`crossorigin="anonymous"` + `createMediaElementSource()` both fail. That rules
out third-party decks, waveforms, and analysers — and plyr.fm's own player
equalizer, which loads public audio with `crossorigin="anonymous"` once it is
on. A track whose cached copy lacks the header fails to load with the eq on.

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

## Public audio cache hits

The production EQ smoke on October 16 reproduced missing CORS headers even
after a host-scoped purge. A response-header transform now sets
`Access-Control-Allow-Origin: *` on every response from `audio.plyr.fm`, including
cache hits and requests without an Origin header. This host contains only public
media; private buckets and the authenticated API are outside the rule.

The rule is recorded in `public-audio-response-headers.json`. Production zone
`2bfcb9ffe7847604e9febbb62d9649a3` uses response-header ruleset
`5b01868a48234413a3984f489720e2d1`, rule `a5afef9551124993b4cd42ce1d4e646b`,
ref `public_audio_cors`. Inspect existing rules before changing it; replacing a
phase's entire rules list would remove any rules added later. Roll back by
disabling this exact rule, not by changing the private bucket policy.

Verify a range GET with no Origin, with `Origin: https://plyr.fm`, and with
`Origin: null`: all should return 206, the requested byte count, and exactly one
wildcard ACAO header, including cache HIT responses. Then run the production EQ
browser smoke, which enables EQ during playback and checks gated playback too.

Cloudflare documents this approach in its [CORS cache guidance](https://developers.cloudflare.com/cache/cache-security/cors/)
and [wildcard response-header example](https://developers.cloudflare.com/rules/transform/examples/add-cors-header/).
