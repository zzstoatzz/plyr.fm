# Next client

The Expo / React Native app is the Next client for iOS, Android, and web.
The web export runs on `next.plyr.fm`. All targets use the Zig AppView for
catalog reads and the account's PDS for authenticated writes.

```sh
npm ci
npm run check
npm run web -- --localhost --port 5174
npm run ios
npm run android
npm run build:web
```

Run these commands from `next/app` with Node 22 or newer. The native commands
require a native development build and the corresponding simulator or emulator. Open the local web app at `http://127.0.0.1:5174` to use the Next API’s development CORS origin. The web build writes a
static export and OAuth metadata to `dist/`. Cloudflare Pages serves the
export with a fallback to `index.html` for routes such as `/oauth/callback`.
Both OAuth client IDs use `EXPO_PUBLIC_SITE_URL`, which defaults to
`https://next.plyr.fm`. The native OAuth redirect uses the
`fm.plyr.next:/oauth/callback` scheme, so it requires a native build that
registers the scheme. The API URL defaults to `https://api.next.plyr.fm`.

## Private preferences

The client can request a grant for the user's own `self` preferences Space on
PDSes that advertise Spaces. The published
[Space declaration](lexicons/preferences.json) and
[record schema](lexicons/preference.json) use the staging namespace.
Set `EXPO_PUBLIC_PREFERENCE_SYNC=false` to disable the optional grant.

Preferences use the owner-only `com.atproto.personalspace.policy`. The client
checks the policy before reading or writing. The record uses integer
percentages for text scale. The alpha `putRecord` has no compare-and-swap
field. A client can merge the latest record before writing a patch, but
simultaneous writes can still race across devices.

The Spaces-based Jams prototype and browser acceptance cases are tracked in
[#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Player navigation

Playback stays above the route stack. Web expanded Now Playing is owned by
`/now-playing`, so browser Back dismisses it before navigating the page below.
Close and Escape pop that route; links replace it with their destination,
while a link to the page already underneath simply dismisses it. The shell
retains the underlying header and tab context. React Native Web Modal remains
the single full-viewport dialog and focus owner.

Native currently keeps its existing local React Native Modal and hardware-Back
handling. It never pushes the web-only player route. Moving native presentation
to the route stack requires separating the shell into a route group so a root
modal can cover the header, mini player, and tabs without nesting UIKit modals.
That layout refactor is deferred; native detail navigation retains Expo's
standard back gestures. Native exports validate bundles, not physical gestures.

Browser regressions use `scripts/check-player-navigation.cjs` and
`scripts/check-player-history.cjs` after `npm run build:web`. Set
`PLAYER_URL=https://next.plyr.fm` to check published assets, `PLAYER_WEBKIT=1`
for WebKit, and `WEBKIT_EXECUTABLE` if using a separately installed browser.
The harness uses real fixture audio and blocks all real API/PDS mutations.
