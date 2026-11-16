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
  compiles. Check lifecycle, gestures and audio on a simulator or device.
- **Merging without CI** during an Actions outage meant deploying by hand.
  Wait for CI; a manual deploy needs the owner's say-so.

## platform

- **An app-level bottom inset stops content above Liquid Glass.** On iOS 26
  put the tabs and player accessory in the native tab controller and let it
  own the insets. The fallback tab bar still owns its own bottom inset.
- **A full-size avatar can displace the iOS tab bar.** Give the native
  image source explicit point dimensions so UIKit gets a tab-sized icon.
- **A hidden native tab cannot receive a deep link.** Keep /upload reachable
  from the other stacks so incoming audio still opens the sign-in flow.

- **Browser globals can crash native startup.** Keep browser integrations in `next/web`.
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

- **Refetching a list on focus with `reload()` drops the pages someone already
  loaded.** Use `revalidate()` from `usePages`, which refetches the loaded
  pages and swaps them in.
- **A queue started from a list keeps your picks above the collection.** A
  pick can't be moved below the "from …" line, so a drag or key that would
  cross it does nothing. Exercise long drags with collection tracks.
