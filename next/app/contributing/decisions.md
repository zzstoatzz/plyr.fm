# decisions

What is settled for the next client, and what is known and open. A review
never re-raises a **settled** item as a finding; to change one, propose it to
nate first. Add an entry when a PR settles something.

## settled

- **Production is the reference for look.** Palette, glass and card surfaces,
  button shapes, lowercase voice, toasts, resume and media controls match
  plyr.fm. Improve within that; don't redesign it.
- **Phone first.** A change is judged at phone width with a finger, rendered.
- **SvelteKit owns web and Expo owns iOS and Android.** Both use
  `@plyr/next-core` for shared logic. Platform adapters stay in their client.
- **The client writes records and the appview is read-only.** Credentials
  stay inside the OAuth adapters.
- **Playback lives above the route stack** in `PlaybackProvider`; screens
  issue commands through `usePlayback`.
- **On iOS 26 the system owns the tab bar and mini-player material.**
  Shared detail routes stay in the tab that opened them, so the content can
  scroll behind the same bar. OAuth completion is outside the tab stacks.
- **Now Playing uses a native Modal.** It stays above the route stack and handles hardware Back.
- **Queue and settings live with the coordinator** behind one service-auth
  permission, not in a Space.
- **Shared controls first.** `Action`, `Field`, `Page`, `Copy` in
  `controls.tsx`, `Text`, `ActionRow`, `Sheet` and `useAppearance` before a
  new styled element.
- **Reusable native accessibility behavior lives in `src/behaviors/`.** Exercise it with platform accessibility controls.
- **Uploads run in the app-level queue** (`src/publishing/upload-queue.ts`),
  mounted above the route stack like playback. The upload page only queues a
  track and resets; on iOS the upload island (a pill drawn over the Dynamic Island, after noti's refresh island) carries each upload's progress; a toast marks the finish with a link.
  WAV, FLAC, AIFF and WebM go through plyr storage with the server's MP3
  playback copy (the original stays downloadable), as production does; small
  MP3/M4A/AAC/OGG go straight to the account's PDS. Storage consent is asked
  once per account on a device.
- Discoverability goes through one-time hints, never through content peeking
  in from an edge. Add a hint to the registry in `src/hints.ts` (priority
  order; `after` chains them into a tour) and draw it with `<Coachmark>` beside
  its target. One shows at a time, and seen state is kept per account on each
  device. Mark it seen when the person does the thing it teaches.
- **Web navigation (nate, 2026-11-18, #2785).** Desktop: a sidebar with
  search as a field first, then home, library and upload, an "explore" group
  (radio, atlas, stats), and an account card at the bottom whose menu holds
  portal, settings, keyboard shortcuts and sign out. Settings and shortcuts
  are not nav items; `?` opens shortcuts. Phones: a floating glass tab bar
  (home, search, library, upload, you) like the iOS app, with the player
  floating above it. Nav icons are Phosphor (regular, fill when current) and
  the current item gets an accent tint.

- Selling (2026-11-19, nate picked mockup A): an artist's support link and
  per-release buy links live in account settings (`supportUrl`, `buyLinks`),
  not a lexicon, and the artist read publishes them as `support_url` and
  `offers`. Buy is an outlined pill beside play (its own row on phones, web and
  iOS); a track falls back to its album's link. A link never unlocks closed
  audio and always says so. `Offer.provider` (`'link'` today) is where a
  provider plyr can verify, such as Atmosphere Money, plugs in, together with
  the access decider. atprotofans is not supported.

- Atlas rendering (2026-11-23, nate picked constellations, #2910): each track
  is joined to its nearest few same-cluster neighbours by near-transparent
  lines (alpha ≤ 0.12) that fade out when neighbours are far apart on screen.
  Artist faces are opaque with no ring or border. Labels use the app font, sit
  above their neighbourhood instead of on its dots, and step around faces.
  Light mode draws solid dots instead of glowing stars. `/atlas` unfurls with
  a committed still (`static/previews/atlas.jpg`, from `bun run
  atlas:preview`) that shows real faces, so regenerate it after removing an
  artist.
- The atlas on iOS (2026-11-23) draws the same map from `@plyr/next-core/atlas`
  (palette, neighbourhoods, fitting, loading), so a look change lands in core
  for both clients. During a pinch or drag the drawn map moves as one native
  transform and is drawn again at rest; a tap picks a track into a card that
  plays it or opens its page.

## known and open

- The account picker's combobox (the only one, and it passes the APG combobox
  check) is still hand-rolled and listed in `scripts/lint-exemptions.json`.
  Tabs, open overlays and the queue's reorder handle live in `src/behaviors/`.
- The reorder handle is `adjustable` (a slider on web) with the queue position
  as its value, so ArrowUp lowers the value, the reverse of an APG slider. It
  is checked by `check-queue-drag`, not `checkPattern`'s slider rules.
- The permission for queue and settings is still named for joining a Jam.
- Sensitive artwork is not filtered from Media Session.
- Native has no next/previous on the lock screen beyond the iOS patch.
