# plyr.fm for iOS: design rules

Native structure, distinctive content: the same principle as Agents, Simmer and
tuner. Navigation, tabs, sheets, search, lists and the lock screen are system
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

- **Home has no navigation bar.** A large-title bar keeps an empty row above
  the title; home draws "plyr.fm" (34 pt bold) as the first thing in its list,
  directly under the status bar, and the list is clipped at the status bar.
  Search keeps the system bar because it hosts the search field; pushed screens
  keep theirs for the back button.
- **Rows**: 48 pt artwork at the 20 pt inset, a 12 pt gap, then title (17 pt
  bold) and artist (14 pt muted). Text starts at `column` in `theme.ts`.
- **Playing** is the accent title plus a waveform glyph, never color alone.
- **Locked** (gated) rows stay readable at reduced opacity, say who can listen,
  and carry a lock glyph; VoiceOver hears the same words.
- **Artwork** is always requested at its slot's size through the image CDN
  (`plyr-shared/images`), as the web does.

## scrubber

The system slider, so the thumb is the system's glass and lifts under the
finger. `modules/scrubber` wraps `UISlider` in a 56 pt strip: a touch anywhere
on the strip brings the thumb to the finger, so there is nothing to aim at, and
because the touch lands on a control, a drag that drifts up or down never pulls
the sheet. VoiceOver gets the slider's adjustable, stepping 15 s.

## the player sheet

- A drag that starts on the controls (scrubber, transport, the action row) does
  not move the sheet: `modules/sheet-guard` takes the pan there. The sheet is
  dismissed from the artwork, the title or the grabber.
- **The action row** under the transport is evenly spaced and grows by adding
  to it: repeat, output, queue, and the info button when the track has a
  description. Actions that need an account (like, add to playlist) join this
  row once the app can sign in.
- **The description** is not shown inline. The info button opens it in its own
  sheet (`app/about.tsx`), and is absent when there is nothing to read.

## the top edge line

The web player's top bar (`shared/topBar.ts` holds its numbers, with a parity
test against `Player.svelte`), drawn by `TopEdge` as part of the edge of what it
sits on: round the capsule of the mini player, and round the top corners of the
player sheet, fading out down the sides. It never runs past the shape.

- An accent hairline, 1 pt, bright and glowing in the accent while a track
  plays. Paused there is no line: the web keeps a dim one at rest, and the app
  shows it only for playback.
- The change is a 150 ms fade and nothing moves, so Reduce Motion has nothing
  to still.
- The rainbow is the web's jam variant of the same line (`TopEdge`'s `jam`).
  Nothing sets it until the app has jams.

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

While audio plays, the island, the lock screen and Control Center carry the
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

### up next, in the island

While something plays and something follows it, the app runs one Live Activity
of its own (`expo-widgets`; `src/player/upNextActivity.tsx` draws it,
`useUpNextActivity.ts` drives it, `upNext.ts` decides what is in it).

- **Expanded island and lock screen**: the next three playable tracks (artwork,
  title, artist) and "+N more". A row is a button: tapping it jumps to that
  track without opening the app. Tapping anywhere else opens the queue.
- **Compact and minimal**: the next track's artwork, and "+N" for how many are
  ahead.
- It updates on every queue and track change, and ends when nothing playable is
  left ahead, when a track fails, or ten minutes into a pause. A single track
  never starts it, and neither does a queue restored at launch. Swiped away, it
  stays away until the queue next runs out.
- iOS only lets a foreground app start a Live Activity. That is why it is kept
  through track changes and pauses instead of being ended and restarted: both
  usually happen with the phone locked. One that timed out during a pause comes
  back the next time the queue changes with the app open.
- Nothing pops up when a track is queued: the island already lists it.
- The widget extension has no network. Thumbnails are downloaded into the App
  Group (`group.fm.plyr`) and passed by file path; only hosts known to serve a
  small rendition are used, because an activity cannot draw an image larger
  than itself. The props stay well under ActivityKit's 4 KB.
- Text is the system face: the extension does not carry Comic Neue.
- **To judge on a real phone**: during playback the island holds two pills, the
  system's Now Playing and ours. The simulator draws only ours. Whether the
  pair reads as one thing or as clutter is not something the simulator can
  answer.
- Later candidates: upload progress after sign-in, jams as a push-updated
  activity, a sleep timer.

## AirPlay and other outputs

The audio session is `playback`, so the system can already send it to AirPlay,
Bluetooth and CarPlay from Control Center. The player also carries the system's
own route button between repeat and queue (`modules/route-picker`, a local Expo
module around `AVRoutePickerView`): tapping it opens the system output sheet,
and the glyph turns accent while audio is going somewhere other than the phone.

- The button and its sheet are the system's; nothing about them is drawn here.
- The simulator has no AirPlay receivers. Routing to a speaker or TV is checked
  on a phone.

## accessibility

- Every control has a label; rows read "title, by artist" with a hint.
- Body text never capped, tabular figures for times.
- Targets are at least 44 pt (or a hit slop out to 44 pt).
- No decorative motion.
