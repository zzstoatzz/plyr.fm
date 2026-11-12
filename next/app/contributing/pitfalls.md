# pitfalls

Things that cost real time on the next client. One line each, with what to do
instead. Add one when something bites.

## judging a change

- **An open tab keeps the build it loaded.** Reload after a deploy before
  deciding whether a fix worked.
- **A green check can measure the wrong thing.** A URL change instead of what
  was drawn, a fixed wait instead of the event, an element's absence when it
  had only become hidden. Assert what the user sees.
- **UI shipped before anyone looked at it on a phone** has come back as
  wrapped tag rows, a queue under Now Playing and a duplicated pinned header.
  Render at 390px with a finger in mind, look, then ship; show a mockup when
  the direction is a choice.
- **An Expo bundle export doesn't verify native.** It proves the bundle
  compiles, not lifecycle, gestures or audio. The always-mounted player sheet,
  the body portal and Media Session are web-only.
- **Merging without CI** during an Actions outage meant deploying by hand.
  Wait for CI; a manual deploy needs the owner's say-so.

## platform

- **A browser global in shared code ships to native too.** One missing guard
  crashes native startup (#2496 was a `pagehide` listener). Use a `.web.ts`
  seam rather than a `Platform.OS` check; `npm run lint` catches new ones.
- **React Native `Modal` behaves differently on web.** `Sheet.tsx` sets
  `accessibilityViewIsModal` only off web, and `KeyboardShortcuts.web.tsx`
  finds open overlays by querying `[role="dialog"]`. An overlay without that
  role doesn't stop shortcuts from firing under it.
- **The iOS player depends on a pinned `expo-audio` patch.** Changing it needs
  a native rebuild; see [patches/README.md](../patches/README.md).

## network and data

- **The Next API allows only the configured origins and
  `http://127.0.0.1:5174`.** Use that port locally, and a proxy for a phone on
  the LAN, instead of widening CORS.
- **The API returns full-size artwork only.** Thumbnails are at
  `images.plyr.fm/images/<id>_thumb.webp`.
- **A missing PDS capability is not "this account syncs on-device".** No basic
  feature may depend on a capability only some PDSes offer.
- **Records are shared with production.** Keep published lexicon shapes and
  preserve fields Next doesn't know.

## checks

- **Browser checks load Playwright from `frontend/`** unless
  `PLAYWRIGHT_MODULE` points elsewhere, so `frontend/` needs its own
  `bun install` first.
- **Checks that need a local PDS or the compose Redis and Postgres** fail at
  setup without them; `node scripts/checks.mjs` lists what each one needs.
- **Three checks failed on main before November 12** for older reasons:
  keyboard shortcuts, the playback retry case and font settings. Don't read
  their failure as yours without running them on main first.
