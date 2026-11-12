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

Jams use creator-owned Spaces; their prototype and browser acceptance cases are
tracked in [#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Player navigation

Playback stays above the route stack. On phone-width web the dock and Now
Playing are one surface that stays mounted: tapping or dragging the dock opens
it, the URL moves to `/now-playing` once it has settled, and Back, Close,
Escape or a pull down closes it. A link inside it changes the page first and
the sheet then leaves. On wide web `/now-playing` is a full-screen modal route
with large artwork beside the controls.

Native keeps a local React Native Modal and hardware-Back handling and never
pushes the web-only route. Native exports validate bundles, not gestures.
The iOS player requires the [pinned native audio patch](patches/README.md);
changing it requires rebuilding the native app.

Browser regressions for the player are the `check-player-*` scripts, run after
`npm run build:web`. They use real fixture audio and block real API and PDS
mutations.

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

Track uploads and edits accept creator tags, one per line. Intentional changes
follow the published track lexicon: up to 20 tags, each at most 50 UTF-8 bytes
(not the legacy Python validator's code-point count). Tags are lowercased,
whitespace collapsed, and edge spaces/hyphens removed; null characters are
rejected. See the [Lexicon string specification](https://atproto.com/specs/lexicon#string).
An untouched tag field preserves the original record, including absent tags;
clearing edited tags writes an explicit empty array. Operator account labels
never populate creator tags.

Track and playlist creates retain a device-local recovery entry, scoped to the
account, before sending the exact record and client-generated TID to the PDS.
Reloading checks that same address; an explicit retry reuses its key and record.
An accepted create remains accessible until dismissed. A different existing
record is never overwritten and can be explicitly kept. Recovery stores record
metadata and blob references, never credentials or media bytes. Clearing local
app data removes these entries; recovery does not transfer between devices.
Known limitation: a permanently rejected record retains its immutable attempt
and blocks new creates of that kind on this device. A later rejection plus a
missing read cannot prove that an earlier request will not still commit. An
explicit archive-and-reconcile flow is still needed; there is no automatic
discard on validation or authorization errors.
