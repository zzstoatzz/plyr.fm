# plan: client-side writes — the browser authors records, plyr becomes the appview

**date**: 2026-08-31
**context**: the direction settled after #1947 — the backend should not be writing
records on users' behalf. the file an artist uploads goes in their PDS as-is;
plyr indexes, mirrors for delivery, and serves app state. this plan makes that
migration incremental: one write type at a time, staging-proven, measured, with
the server path as the standing fallback.

## goal

records in `fm.plyr.*` are written by the signed-in user's own browser session
(`@atproto/oauth-client-browser` → `Agent` → `com.atproto.repo.createRecord` /
`uploadBlob`), and the backend's role for those writes shrinks to what an
appview does: verify, index, mirror, serve.

## current state

- the backend is a confidential OAuth client and authors every record. the
  browser holds only an opaque session cookie.
- the appview half already runs: jetstream ingests `fm.plyr.*` from any repo;
  `ingest_track_create` / `ingest_like_create` / `ingest_like_delete` exist;
  `mirror_pds_blob` copies PDS audio into R2; reserve-then-publish handles the
  backend's own record echoes.
- plyr serves a `did:web` document (`api/meta.py`), so it can verify
  service-auth JWTs when identity migrates.
- #1947's resumable upload is the GA upload path and remains so until the
  upload phase here replaces it.

## resolved decisions (evidence in the 2026-08-30/31 session)

- **no feature flag / opt-in.** the fallback that must exist anyway — no
  browser session ⇒ use the server endpoint — is the degradation mechanism.
  merge → staging (e2e) → prod, per phase. revert is a frontend deploy.
- **scopes grow progressively.** the authserver requires consent only for
  scopes not previously granted to this client
  (`oauth-provider.ts:checkConsentRequired`); re-auth with granted scopes is a
  silent redirect. each phase adds its `repo:`/`blob:` scopes via the existing
  scope-upgrade redirect pattern. phase 1 requests exactly
  `atproto repo:fm.plyr.like?action=create&action=delete`.
- **the browser client is a public client** with its own permanent identity:
  `client_id` = `https://plyr.fm/oauth-client-metadata.json` (served by the
  frontend, derived from the request origin so staging gets
  `https://stg.plyr.fm/...`). choose once; grants are keyed to it.
- **verified echo, not trust and not waiting.** after a client write, the
  client calls the appview with the `at://` URI; the appview fetches the
  record from the PDS itself and indexes it through the same ingest functions
  jetstream uses. this preserves read-your-own-write and makes jetstream loss
  (#1796) non-fatal for our own users. the claim is never trusted — the PDS
  read is the source. this is the plan's one new API route.

## not doing (until the pattern is proven)

- private media / spaces writes (permissioned scope in a browser session is
  its own design)
- teal scrobbles, SDK/dev-token surface, Subsonic
- retiring the cookie session or the confidential client (that is the final
  identity phase, and only after every write has migrated)
- transcoded renditions in the PDS: from the upload phase onward the PDS blob
  is the uploaded file, and plyr-side mp3s never overwrite it

## phases

### phase 0: the browser session exists

**changes**:
- `frontend/src/routes/oauth-client-metadata.json/+server.ts` — public-client
  metadata derived from origin (`token_endpoint_auth_method: "none"`,
  `dpop_bound_access_tokens: true`, phase-1 scope). loopback client for
  127.0.0.1 dev (rally's `src/data/oauth.ts` is the model).
- `frontend/src/lib/atproto/client.ts` — `BrowserOAuthClient` setup,
  `client.init()` on boot, `restore(did)`, session store; exposes
  `agentFor(did): Agent | null`.
- sign-in chaining: after the existing cookie callback completes
  (`/auth/callback` bounce), if no browser session exists for the signed-in
  DID, run `client.signIn(handle)` once. subsequent sign-ins are silent
  (consent already granted).
- `backend/src/backend/api/ingest.py` (new router, the one new surface):
  `POST /ingest/record {uri}` — authenticated (cookie), owner-checked
  (URI repo == session DID), fetches the record from the user's PDS
  (`is_safe_url`-validated endpoint, same stance as ingest), dispatches to the
  existing `ingest_*` function for the collection; 404s for collections we
  don't index. rate-limited.
- logfire baselines: jetstream ingest lag for `fm.plyr.like`, like-endpoint
  latency/error rates.

**success criteria**:
- [ ] `just backend test` + `bun run check && bun run lint && bun run test`
- [ ] staging: sign in fresh → exactly one extra consent screen, then a
      browser session exists (`client.restore(did)` returns an agent); second
      sign-in shows no consent screen
- [ ] e2e sign-in flow (`frontend/e2e/lib.mjs signIn`) updated for the chained
      authorize and green
- [ ] `POST /ingest/record` with a hand-written like record (pdsx) indexes it;
      with a forged URI for another repo it 403s

### phase 1: likes

**changes**:
- `frontend/src/lib/likes` call sites (LikeButton flows): with a browser
  session — `createRecord`/`deleteRecord` on `fm.plyr.like` (record shape
  mirrors `_internal/atproto/records/fm_plyr/like.py`; rkey/subject semantics
  copied exactly), optimistic UI, then `POST /ingest/record`; without one —
  the existing `POST /tracks/{id}/like` endpoint, unchanged.
- backend: nothing removed. `ingest_like_create`/`ingest_like_delete` handle
  the echo and the jetstream copy idempotently (verify + regression test).
- logfire: tag client-written likes (the echo route) so the two paths are
  comparable.

**success criteria**:
- [ ] regression test: echo then jetstream replay of the same like does not
      double-count; delete echo then replay does not resurrect
- [ ] staging e2e: like a track with a browser session → liked list contains
      it in the same page load; unlike → gone (the #1812 assertion, now on the
      client path)
- [ ] parity gate before prod promote: client-path like p95
      time-to-indexed ≤ server-path p95 + jetstream lag baseline unchanged,
      error rate not worse, over ≥ a week of staging + own-use on prod
- [ ] pull the plug drill: with the echo route 500ing (staged fault), likes
      still land via jetstream and the UI's optimistic state survives

### phase 2: comments, then lists (albums/playlists), then profile

same pattern per collection: scope upgrade adds `repo:fm.plyr.comment` (etc.),
client writes + echo, server endpoint kept as fallback, ingest idempotency
regression tests, parity gate. lists carry an extra check: ordered-membership
semantics under interleaved client/jetstream delivery (#1736's unordered-update
caveat applies to lists — the version guard work may become a prerequisite
here; decide when phase 1 data is in).

### phase 3: track upload

**changes**:
- scope upgrade adds `repo:fm.plyr.track` + `blob:audio/*`.
- `frontend/src/lib/uploader.svelte.ts`: with a browser session —
  `uploadBlob` (the file as chosen, one XHR with progress) then
  `createRecord` with the `BlobRef`, then echo; the SSE job UI is replaced by
  ingest-driven state for this path. without a session — the #1947 resumable
  path, unchanged.
- `ingest_track_create` hardening for first-party volume: it becomes the
  publish path, not the exception path (mirror scheduling, duplicate checks,
  gating fields authored client-side).
- `audio_optimize` stops writing mp3s to the PDS — renditions are plyr-side
  delivery copies only.

**success criteria**:
- [ ] e2e upload through the browser session lands: record in the repo with
      the original file's blob, R2 mirror exists, track plays
- [ ] AIFF upload: PDS keeps the AIFF; plyr serves the mp3 rendition
- [ ] parity gates on upload success rate and time-to-playable vs #1947 path

### phase 4: identity

backend endpoints accept a service-auth JWT (`aud` = plyr's `did:web`,
`lxm` check — `packages/bsky/src/auth-verifier.ts` is the model) alongside the
cookie; the browser calls plyr through the PDS (`Agent.withProxy` /
`atproto-proxy`) or directly with the JWT. once client writes are GA, sign-in
becomes the browser client alone; the confidential client and cookie shrink to
the SDK/dev-token surface. detailed separately when reached — this plan only
commits to not blocking it.

## testing

- ingest idempotency (echo + jetstream replay) is the load-bearing invariant;
  every phase adds its regression tests there
- staging e2e extends per phase (sign-in chain, client-side like, later
  client-side upload)
- parity gates are logfire queries, written down with the phase, run before
  each prod promote
- fault drills: echo route down; jetstream blind window (#1796) — client
  writes must survive both
