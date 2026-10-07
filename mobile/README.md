# plyr.fm, on a phone

A native iOS client for plyr.fm, from the same repository as the web app. The
first milestone is a thin player on the existing public API: top tracks and the
latest feed, track search, a player sheet, background audio, and lock screen
controls. No sign-in yet, so supporter-gated tracks show who can listen and
stay locked.

Nothing here reaches the web app or the backend. Deploys are unaffected by
anything in `mobile/` or `shared/`.

## run it

```sh
just mobile install   # bun install at the repo root (shared/ + mobile/ are one workspace)
just mobile ios       # development build in the simulator; needs Xcode
just mobile device    # same, on a plugged-in iPhone
just mobile check     # shared tests, palette contrast, types, lint
```

Expo Go will not work: the audio engine is a native module, so the app has to be
compiled. Xcode is not the same as the Command Line Tools; check with
`xcodebuild -version`. `ios/` is generated (continuous native generation) and
ignored, as in Agents and birds.place.

`EXPO_PUBLIC_PLYR_ENV=staging just mobile ios` points the app at
`api-stg.plyr.fm`; `EXPO_PUBLIC_API_ORIGIN` overrides the origin outright (an
ngrok tunnel to a local backend, say).

## the stack

The same as Nate's other Expo apps (Agents, birds.place, Simmer, tuner): Expo 57,
React Native 0.86.3, expo-router with native tabs, TanStack Query, TypeScript,
the React compiler, and EAS for builds.

Audio is `react-native-audio-api` 0.13.5, the version tuner pins. Its `<Audio>`
tag streams over HTTP ranges through FFmpeg, its playback notification manager
drives the lock screen with next and previous track (expo-audio has neither),
and it is a Web Audio graph: the EQ the web app is getting can be the same
BiquadFilter chain here, fed through `createMediaElementSource`. Playback lives
in `src/player/` behind `usePlayer()`, so swapping engines is one file if
streaming misbehaves on a device.

## what is shared with the web app

`shared/` is a workspace package, `plyr-shared`, imported here by name. It holds
decisions, not rendering: the API contract (zod schemas, checked against
`docs/internal/contracts/client-api.json`), the queue, the playback rules (play
count threshold, previous-restarts, skip step, what can play), artwork
fallbacks and CDN resizing, and the top-tracks periods. It is plain TypeScript
with no DOM or React Native APIs, so the web app and an Android build can import
it as-is.

The web app does not import it yet. Until it does, each rule in `shared/` that
the web also has is tested against the web's own module (`*.test.ts` import
`frontend/src/lib/...` directly), so the two cannot drift silently. Moving the
web onto `plyr-shared` is a module-at-a-time change: point the import at the
package and delete the frontend copy.

## not yet

- **sign-in**: the backend already accepts `Authorization: Bearer <session>`.
  The missing piece is a native start: `/auth/start?platform=app&challenge=…`
  returning a single-use exchange code (bound to that PKCE challenge) to
  `fm.plyr://auth`, then `POST /auth/exchange` with the verifier. That mirrors
  Agents' `/app/login` → `/app/session`, and avoids putting a session in the
  callback URL. Likes, the For You feed, gated tracks and scrobbling follow.
- universal links (`applinks:plyr.fm`) need an `apple-app-site-association`
  file on the web origin.
- an EAS project and App Store Connect record: `bunx eas-cli init` from
  `mobile/` writes the project id into `app.json`.
- Android: the config plugin already asks for a media-playback foreground
  service; nothing has been built or run there.
