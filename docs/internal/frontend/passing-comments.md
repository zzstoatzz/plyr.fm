---
title: "passing comments"
---

a timestamped comment surfaces on the track page as playback crosses its
moment — the soundcloud move. it is a small bubble that grows out of the
comments trigger, lives a few seconds, and opens the comments panel when
tapped. `TrackComments.svelte` owns the behavior; `lib/comment-emission.ts`
owns the placement arithmetic, which is pure and tested.

## the stack

every comment whose `timestamp_ms` falls between the previous playback tick
and the current one is surfaced (a jump or the first tick after play/seek is
skipped, so seeking never sprays missed comments). bubbles form an ephemeral
stack:

- newest nearest the trigger; each bubble lives `EMISSION_TTL_MS` (4 s) on
  its own timer; a comment already showing has its timer refreshed rather
  than being duplicated
- capped at `EMISSION_STACK_MAX` (3), or fewer if the band it sits in holds
  fewer — the oldest leaves early when a burst exceeds the cap
- bubbles enter with `emerge` (a short fade over a few px from the trigger's
  side, `cubicOut`, no overshoot) and leave with a fade; the rest reflow with
  `animate:flip`
- tapping any bubble clears the stack and opens the panel

## placement is measured, not named

the trigger sits in a row of page content, and what surrounds that row
differs by page and viewport: on phones the row is often the last thing
above the fixed player; on desktop it sits 16 px under the listen count and
against the player. a rule that names a region ("below the trigger", "above
the row") is blind to that, and every version that used one covered
something. so the component measures four free bands from the DOM at
emission time (`freeBands()`):

- **below**: from the row's bottom to the next sibling's top or the player's
  top, whichever is nearer
- **above**: from the previous sibling's bottom (or the header clearance) to
  the row's top
- **right** / **left**: along the row, from the trigger to its neighbour or
  the viewport margin, less anything fixed drawn over that stretch (the queue
  toggle), and zero if the trigger itself is under the player

`emissionLayout(bands)` then picks: the roomier vertical band, capped to the
whole bubbles that fit (`emissionCapacity`: the first needs the 6 px row
offset plus its 36 px height, each further one 4 px more — the same numbers
the css uses); else the roomier side, one bubble sized to that room; else
docked at the player's edge, one bubble, the only case where covering
something is accepted because nothing else is visible.

horizontally the stack is centered on the trigger, kept inside the viewport,
and moved off anything fixed drawn over its ends. the probe is
`document.elementsFromPoint` at the ends of where the stack will sit *after*
the viewport clamp (an end past the viewport edge sees nothing), 8 and 24 px
in and 8 px past each end, and the obstacle is the nearest `button`/`a`
ancestor of the hit, not the icon inside it. the tail is counter-shifted so
it still points at the trigger.

## the icon is the source

when a comment passes, the trigger takes one breath: its colour eases to the
accent and the icon pulses once to 1.08 and back over 520 ms; the bubble
emerges 140 ms after that begins. one gesture, not four — an earlier version
had an expanding ring, a count bump, a glow and an overshoot, and read as
"corny and heavy handed". `prefers-reduced-motion` gets a plain fade with no
pulse.

## verifying a change

placement can only be judged in the real page. the pattern that caught every
regression in the #1962–#1980 arc: post a burst of timestamped comments on a
staging track as the test account, play from just before them at 390×640 and
390×844 and at a desktop size with the row scrolled into view, and read the
stack's rect against the row, the player and the queue toggle every ~300 ms.
a screenshot at one size is not a check; the failures were always at the
other size.

## sources

- PRs #1962, #1968–#1980 (September 1–2, 2026); `STATUS.md` "passing
  comments became a stack that reads the page"
