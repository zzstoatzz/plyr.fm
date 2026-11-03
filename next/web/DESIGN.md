# next/web design

how the next client looks and is laid out, and how far it is from prod
(`frontend/`). keep it simple: one neutral scale, one accent, system fonts,
hairline dividers. layout does the work, decoration doesn't.

## references

- **bluesky social-app** (`bluesky-social/social-app`). two people in particular:
  - **Samuel Newman (mozzius)**: the shell. bottom tab bar on phones, left rail
    from 800px, one 600px center column, sheets that come up from the bottom
    on phones and become centered dialogs on wider screens, lots of care for
    tablets and safe areas.
  - **Eric Bailey (esb.lol)**: ALF, the Application Layout Framework
    (`src/alf`, published as `@bsky.app/alf`). t-shirt tokens, a `contrast_0`
    to `contrast_1000` neutral scale, `primary`/`positive`/`negative` scales,
    pill buttons in solid/outline/ghost × primary/secondary/negative, and
    `Layout.Header` (back button, title + subtitle, a balancing slot).
- the native app later follows the same approach (expo / react native), so
  screens here are named and shaped the way they'll be there.

## tokens (`src/app.css`)

| token | values |
|---|---|
| space | `--s-2xs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20, `2xl` 24, `3xl` 28, `4xl` 32, `5xl` 40 (px) |
| type | `--t-xs` 11.3, `sm` 13.1, `md` 15, `lg` 16.9, `xl` 18.8, `2xl` 20.6, `3xl` 24.3, `4xl` 30 |
| radius | `--r-xs` 4, `sm` 8, `md` 12, `lg` 16, `full` |
| color | `--c-0 … --c-1000` neutral contrast scale (flips in dark), `--accent` (user pick), `--like`, `--negative` |
| breakpoints | phone < 500, mobile < 800 (bottom bar), desktop ≥ 800 (left rail), wide ≥ 1300 |

themes: system / light / dark (`data-theme` on `<html>`). accent is one of a
few presets or any hex; `--accent-fg` is picked for contrast.

## shell

- **phone (< 800px)**: screen header on top (back + title), content, then a
  mini player and a bottom tab bar: home, search, library, you.
- **desktop (≥ 800px)**: left rail with the same destinations plus upload and
  settings, a 600px center column, and a player bar across the bottom.
- **now playing**: tap the mini player → full-screen sheet on phones (artwork,
  scrubber, transport, like, queue); a dialog on desktop.
- sheets (`Sheet.svelte`) are native `<dialog>`s: bottom sheet on phones,
  centered on wider screens. escape and backdrop close them.

## inventory: prod affordances → next

status: ✅ in next · 🟡 partial · ⬜ not yet · 🚫 needs an API/lexicon change first

### browse & listen
| prod | next |
|---|---|
| home feed: latest tracks, top tracks, tag filter, "artists you know" | 🟡 latest + top this week; tags and network artists ⬜ |
| for-you (personalized) | ⬜ needs an API |
| search (⌘K modal: tracks, artists, albums, playlists, tags) | ✅ search screen; ⌘K ⬜ |
| track page: artwork, stats, like, add to playlist/queue, share, download, comments, likers, waveform | 🟡 artwork, stats, like, playlist, queue, share; comments ⬜ (fm.plyr.comment), likers ⬜, download ⬜ |
| artist page: header, tracks, albums, collections, liked, analytics | 🟡 header, tracks, albums, playlists, likes; analytics ⬜ |
| album + playlist pages, embeds | ✅ pages; embeds ⬜ |
| tag pages, activity feed, atlas, costs, radio, jam, record | ⬜ (later, each needs its own API) |

### player
| prod | next |
|---|---|
| play/pause, prev/next, seek, volume | ✅ |
| queue (view, reorder, clear, add next / add to queue) | 🟡 view, jump, clear, add to queue; drag reorder ⬜ |
| shuffle, repeat | ✅ |
| media session (lock screen / headset keys) | ✅ |
| keyboard (space, arrows, Q for queue) | ✅ space, ←/→ seek |
| EQ, timed comments on the scrubber, now-playing artwork as background | ⬜ |
| gated (supporter) audio via spaces | ✅ (from the stripped build) |

### library & playlists
| prod | next |
|---|---|
| library: liked + playlists, create playlist | ✅ |
| playlist: rename, delete, remove track, add track | ✅ |
| playlist reorder, playlist cover art | ⬜ / 🚫 (artwork) |

### upload & portal (artist tools)
| prod | next |
|---|---|
| upload track: audio, title, album, description | ✅ (audio on your PDS) |
| upload: artwork | 🚫 `imageBlob` on fm.plyr.track/list (both apps) |
| upload: tags, featured artists, album mode, supporter gate | ⬜ / 🟡 (gate works on staging namespaces only) |
| portal: profile (bio, avatar), your tracks (edit, delete), albums, playlists | ✅ |
| portal: private tracks, share links, copyright flags, export, delete account | ⬜ |

### settings
| prod | next |
|---|---|
| theme, accent color, font | ✅ (stored on this device) |
| play through collections, keep playing | ✅ |
| sensitive artwork / audio | ⬜ needs labels in the API |
| background image, artwork as background | ⬜ |
| teal.fm scrobbling, developer tokens, auto-download liked, EQ, timed comments, show liked on profile, open links in | ⬜ |

prod keeps preferences in its database. next is a read-only appview, so for
now they live on the device; syncing them later means a private record (a
space) the client writes, not an appview endpoint.
