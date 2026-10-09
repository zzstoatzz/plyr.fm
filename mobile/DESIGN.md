# plyr.fm for iOS: design rules

Native structure, distinctive content: the same principle as Agents, Simmer and
tuner. Navigation, tabs, sheets, search, sliders and the lock screen are system
components. The app's identity comes from the artwork and from the web app's
tokens and voice.

## one product, rendered twice

A phone user and a web user are looking at the same plyr.fm.

- **Copy is the web's.** Lowercase, as the web writes it ("top tracks",
  "tracks", "past month", "supporters only"). Wording the web also shows comes
  from `shared/` when it is a rule, or matches the web string when it is a label.
- **Behavior is the web's.** Previous restarts the track after 1 s; a play
  counts after 30 s or half the track; a broken track skips ahead; the top-tracks
  period toggle skips empty periods. These live in `shared/` and are tested
  against the web's modules.
- **Where the platform has a convention, the platform wins**: the player is a
  sheet, the mini player is the tab bar's bottom accessory, the tab bar
  minimizes on scroll as in Music, and search sits in the navigation bar.

## color

Paired roles in `src/palette.ts`, seeded from the web tokens in
`frontend/src/routes/+layout.svelte`, with light, dark and increased-contrast
variants applied through `DynamicColorIOS`. `src/palette.test.ts` checks every
text role at 4.5:1 (7:1 in increased contrast) on every ground.

| role | means |
|---|---|
| canvas, surface, raised, fill | the ground |
| ink, muted | text |
| accent (blue) | you can act on this, or it is playing |
| danger | failed |

The accent is the web's default `#6a9fff` in dark mode. The web lets listeners
pick their own accent; the app will follow that preference once it can sign in.

## type

Comic Neue, regular and bold, bundled through the `expo-font` config plugin and
applied by every style in `src/type.ts`. The web offers comic sans as a font
choice; Comic Neue is the same voice drawn to stay readable at small sizes, and
iOS ships no Comic Sans. Sizes run a point above the system defaults because its
letters are narrower and lighter than San Francisco's.

- Bold is the real bold file, named by its PostScript name, never a synthesized one.
- Text scales with Dynamic Type.
- Times and durations use the system face with tabular figures: Comic Neue has
  none, and a scrubber whose digits change width jitters.
- Navigation titles and tab labels take the family too; the search field stays
  the system's.

## structure

- **Rows**: 48 pt artwork at the 20 pt inset, a 12 pt gap, then title (17 pt
  bold) and artist (14 pt muted). Text starts at `column` in `theme.ts`.
- **Playing** is the accent title plus a waveform glyph, never color alone.
- **Locked** (gated) rows stay readable at reduced opacity, say who can listen,
  and carry a lock glyph; VoiceOver hears the same words.
- **Artwork** is always requested at its slot's size through the image CDN
  (`plyr-shared/images`), as the web does.

## queue

The rules are the web queue's, as pure functions in `shared/queue.ts`: what you
queued by hand is "up next"; the rest of the album, playlist or list a track was
tapped in follows as "next from: …". The queue lives on the device (expo-sqlite
key-value store) and comes back on launch, paused, at the saved position.

- Holding a track anywhere offers play next, add to queue, go to artist and go
  to album, through the router's native link menu.
- The queue is a sheet over the player: a system list, so reordering is a drag,
  removing is a swipe, and VoiceOver gets the list's own move and delete actions.
- Queue rows carry no menu of their own. Wrapping a row (a context menu, swipe
  actions) makes `@expo/ui`'s `List.ForEach` report every row as index 0.
- Shuffle is an action over up next, as on the web; repeat is one track or off.
- Up next and "next from: …" are one list with a divider row, so a drag can
  cross it: a tail track dropped above the divider becomes a pick; a pick
  dropped below it stays the last pick. With nothing in up next, dropping a
  track at the top of the list makes it the first pick: the system list will
  not open a slot above a divider that is its first row.

## lock screen and Dynamic Island

While audio plays, the island, the lock screen and Control Center are the
system's Now Playing surface. The app feeds it through
`MPNowPlayingInfoCenter` (react-native-audio-api's
`PlaybackNotificationManager`); `src/player/nowPlayingInfo.ts` decides what is
sent.

- Every field is sent on every update. The system keeps whatever an update
  leaves out, so a track with no album would otherwise show the last one's.
- The clock runs only while audio moves: buffering reports rate 0.
- A queue restored at launch is not announced until it is played.
- The iOS Simulator renders none of these surfaces. They are checked on a phone.
- Known gap in the library: artwork loads in the background with no check that
  the track is still current, so a slow image can land on the next track.

A Live Activity of our own is not built. An ongoing one during playback would
sit beside the system's and split the island in two. The fit is a transient
activity (`ActivityStyle.transient`): a brief expanded island confirming "playing
next" or "added to queue" with an undo, and "next from: …" when a context
starts. It needs a widget extension target, `NSSupportsLiveActivities`, and an
App Group shared with the app for artwork (the extension has no network; static
plus dynamic data must stay under 4 KB), which changes signing for every build.
Later candidates once they exist: upload progress after sign-in, jams as a
push-updated activity, a sleep timer.

## accessibility

- Every control has a label; rows read "title, by artist" with a hint.
- Body text never capped, tabular figures for times.
- Targets are at least 44 pt (or a hit slop out to 44 pt).
- No decorative motion.
