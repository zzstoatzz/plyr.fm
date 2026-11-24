# flip day: plyr.fm → next

the step list for the day plyr.fm starts serving next. the reasoning for each step is in
[plan.md](plan.md) sections 3 and 4. steps marked **nate** need prod, DNS or account
access. everything else a thread can run.

## before the day (all next-only unless marked)

- [x] next accepts `https://plyr.fm` as a browser origin: api, jams, audio worker (#2977)
- [x] OTA from CI (#2978, EXPO_TOKEN set; first CI OTA b660394a)
- [x] osprey on AuDD directly (#2984), next no longer pulls prod's labels (#2987). next calls nothing on prod at runtime
- [x] D2: gated legacy tracks stay unplayable on next (no next → prod bucket access)
- [ ] **nate:** N1, move next's neon branch out of the `plyr-stg` project. connection strings change together: fly secrets on `plyr-api-zig-canary` / `plyr-next-processing` / `plyr-jams-next`, and the GitHub secrets `ZIG_NEXT_WRITER_DATABASE_URL` and friends used by osprey, atlas, catalog diff and import-plays
- [ ] **nate:** N2, iOS release build with `EXPO_PUBLIC_SITE_URL=https://plyr.fm` (`next/app/eas.json` `base.env`) and scheme `fm.plyr`, submitted to review before the web flip
- [ ] **nate:** N4, prepare the PLC op that puts next's label key and endpoint on `moderation.plyr.fm`'s DID
- [ ] **nate:** lower TTLs on `plyr.fm`, `www.plyr.fm` and `api.plyr.fm`
- [ ] **nate:** `fly certs add api.plyr.fm -a plyr-api-zig-canary`, so the cert is ready before DNS moves
- [ ] dress rehearsal on next.plyr.fm: `next catalog diff` clean (today: 1368/1389, remainder explained), plus the route × phone/desktop × light/dark × signed in/out matrix, an upload, a jam, radio, a third-party embed, `/track/1667` and a gated legacy track
- [ ] announcement drafted ("sign in once more"; the consent screen lists next's scopes)

## the flip (nate, in order)

1. **freeze prod writes.** put up the maintenance banner on prod, then stop the `relay-api` worker so no new prod-only uploads or plays land.
2. **final imports into next** (threads can run these once prod is frozen):
   - `next import legacy plays` (idempotent; only adds new legacy plays)
   - `next catalog diff`, to confirm nothing new went missing
   - re-snapshot `legacy_track_links`, unlisted tracks and legacy playlists
   - labels and takedowns from prod's labeler
3. **web on plyr.fm.** one PR, merged on the day:
   - `check-svelte-next.yml` deploy: `PUBLIC_SITE_URL` becomes `https://plyr.fm`, and the "select Next Pages deployment" guard currently refuses a project whose domains include `plyr.fm`. flip it to require them.
   - `next/core/src/auth-config.ts` default `SITE_URL` becomes `https://plyr.fm`.
   - keep next.plyr.fm serving `oauth-native-client-metadata.json`, so installed TestFlight builds keep signing in until they update, and redirect its pages to plyr.fm.
   - **nate:** attach `plyr.fm` and `www.plyr.fm` to the `plyr-fm-next` pages project. keep prod's pages project intact for rollback.
4. **api on api.plyr.fm.** **nate:** point DNS at `plyr-api-zig-canary`. it already answers `/audio/{id}`, `/tracks/{id}`, `/oembed` and `/radio/*`. keep `api.next.plyr.fm` as an alias. `SPACE_SERVICE_DID` stays `did:web:api.next.plyr.fm`, because space uris are baked into records.
5. **radio.** **nate:** deploy `plyr-radio` at the #2848 pin with `PLYR_PRESENCE=off`.
6. **labeler.** **nate:** apply the PLC op so `moderation.plyr.fm` names next's labeler (next already stopped reading prod's, #2987).
7. **smoke**, in a real browser and on the phone: sign in on web, playback, radio, an embed, `plyr.fm/track/1667`, a bluesky link card, an upload. the first sign-ins are the canary for PDSes caching the old oauth metadata.
8. **announce.**

## rollback window

- prod machines are scaled to zero but not destroyed, prod neon is frozen but alive, and the old pages project is kept.
- to roll back: point DNS for `plyr.fm` and `api.plyr.fm` back, then `fly scale count` relay-api back up.
- rollback can't undo two things. records users wrote through next stay theirs, and prod's jetstream ingests them on restart. uploads that only exist in `plyr-next-audio` would look broken on prod. keep the window short.
- watch logfire for 404s on legacy routes and failed sign-ins. the next alerts (ingester silent, api 5xx, worker errors) already go to discord and phi.

## teardown (after the window)

destroy `relay-api`, `relay-api-staging`, `plyr-transcoder`(+staging), `plyr-redis`, `plyr-redis-stg` and `plyr-moderation`. delete the staging/dev neon projects and the `audio-private-staging` / `audio-staging` buckets. freeze `plyr-prd` as an archive. cancel the turbopuffer, modal and replicate keys. keep `audio-prod` and `images-prod` forever, and keep `audio-private-prod` until D2 is settled.
