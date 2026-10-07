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

## structure

- **Rows**: 48 pt artwork at the 20 pt inset, a 12 pt gap, then title (16 pt
  semibold) and artist (13 pt muted). Text starts at `column` in `theme.ts`.
- **Playing** is the accent title plus a waveform glyph, never color alone.
- **Locked** (gated) rows stay readable at reduced opacity, say who can listen,
  and carry a lock glyph; VoiceOver hears the same words.
- **Artwork** is always requested at its slot's size through the image CDN
  (`plyr-shared/images`), as the web does.

## accessibility

- Every control has a label; rows read "title, by artist" with a hint.
- System font only, body text never capped, tabular figures for times.
- Targets are at least 44 pt (or a hit slop out to 44 pt).
- No decorative motion.
