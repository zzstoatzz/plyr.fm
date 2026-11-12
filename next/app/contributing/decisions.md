# decisions

What is settled for the next client, and what is known and open. A review
never re-raises a **settled** item as a finding; to change one, propose it to
nate first. Add an entry when a PR settles something.

## settled

- **Production is the reference for look.** Palette, glass and card surfaces,
  button shapes, lowercase voice, toasts, resume and media controls match
  plyr.fm. Improve within that; don't redesign it.
- **Phone first.** A change is judged at phone width with a finger, rendered.
- **One codebase for web, iOS and Android.** Web-only code sits behind a
  `.web.ts(x)` seam with the same exports as its sibling. No DOM-only UI
  library renders our screens, which is why
  [ui-sdk](https://github.com/vercel-labs/ui) informs our method but isn't a
  dependency.
- **The client writes records; the appview is read-only** and holds no
  credentials. Credentials stay inside the OAuth adapters (`auth.ts`,
  `auth.web.ts`), never in app storage.
- **Playback lives above the route stack** in `PlaybackProvider`; screens
  issue commands through `usePlayback`.
- **On phone-width web the dock and Now Playing are one always-mounted
  surface.** The URL moves to `/now-playing` once it settles. Wide web uses a
  full-screen modal route; native uses its own `Modal`.
- **Queue and settings live with the coordinator** behind one service-auth
  permission, not in a Space.
- **Shared controls first.** `Action`, `Field`, `Page`, `Copy` in
  `controls.tsx`, `Text`, `ActionRow`, `Sheet` and `useAppearance` before a
  new styled element.
- **Keyboard and ARIA behavior that more than one screen needs is written
  once** under `src/behaviors/`, as pure decisions with tests, and screens
  compose it.

## known and open

- Tabs are hand-rolled twice (`Portal.tsx`, `ArtistProfile.tsx`), the account
  picker's combobox once, and the queue's reorder handle once. Each is listed
  in `scripts/lint-exemptions.json` until it moves to a behavior.
- The permission for queue and settings is still named for joining a Jam.
- Sensitive artwork is not filtered from Media Session.
- Native has no next/previous on the lock screen beyond the iOS patch.
