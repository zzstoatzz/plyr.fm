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

## Account sync

Every sign-in except an explicit device-only one requests one service-auth
permission for the Jam coordinator. With it, the coordinator verifies the
account's identity and keeps two things for it in PostgreSQL: the personal
queue with its playback position, and appearance and playback settings. Neither
depends on the account's PDS supporting Spaces. Text scale is stored as an
integer percentage. A settings write merges a patch on the server.

The Spaces-based Jams prototype and browser acceptance cases are tracked in
[#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Player navigation

Playback stays above the route stack. The desktop dock spans the viewport below
navigation and content, with track info on the left, transport/seek in the center,
and queue/volume on the right. Mobile keeps its compact dock above navigation.

On web, `/now-playing` owns the full-screen presentation at every width. Desktop
uses large artwork beside the familiar controls; mobile retains body swipe
dismissal outside interactive controls. Browser Back, Close and Escape dismiss
the player before navigating the page below. Links replace it with their
destination. React Native Web Modal owns focus while open; the dock underneath
is covered, not duplicated in the expanded player.

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

## Creator portal catalog state

The portal reads published tracks and albums for the signed-in owner. Visited
tabs retain their loaded cursor pages and scroll context; ordinary Back does
not refetch them. Confirmed track, list, or profile writes in this client mark
only that owner's corresponding catalog scope dirty. Returning to an active
dirty panel revalidates its loaded cursor chain without clearing visible rows;
a failed refresh keeps those rows available for retry.

Changes made elsewhere, and writes still waiting for indexing, use the explicit
refresh control. This is published-catalog management, not a private catalog
or a client-side substitute for server search, filtering, or sorting.
