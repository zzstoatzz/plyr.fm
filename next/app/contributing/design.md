# design

Lessons from the desktop redesign (nov 2026), where four rounds shipped on
green tests and still read as sloppy. Tests prove a screen works; they don't
prove it looks considered. Read this before any UI change and check the
result against it.

## before building

- **Mockups first.** Any visible change gets rendered mockups (two or three
  options, real fixture data, at the real width) and nate picks before code
  is written. Shipping and then asking is how the rounds piled up.
- **Study prior art and prod before drawing.** Open the same surface in
  `frontend/src/lib/components/*.svelte` and in one or two well-made apps
  (SoundCloud, Bandcamp, Spotify). Prod has small behaviors people already
  rely on: likers on hover, the heart that shakes when signed out, a sign-in
  toast that finishes the like, menus that open at the click. Losing one is a
  regression even if nothing on screen looks broken.
- **Design for the content people actually post.** Look at real records
  before deciding a shape: many descriptions are timestamped tracklists, many
  artists have no avatar, titles run long, counts run from 0 to millions.

## alignment

- **Numbers live in fixed columns** with `tabular-nums`, right-aligned, under
  a labelled header, so 7 and 132.1k line up. Counts use `compactCount`
  (never more than 6 characters, never rounds up).
- **Icons don't float next to variable-width text.** If a number needs an
  icon to be understood, it needs a column label instead.
- **Edges line up across blocks.** The top of the title meets the top of the
  art; list text starts where the heading above it starts; a hover background
  bleeds past the text with negative margin rather than shifting it.

## hierarchy and density

- **One thing leads.** On a now-playing surface it's the music; on home it's
  what's new. Everything else steps down in size and color (`text`, `muted`,
  `faint`), not in borders and boxes.
- **Don't repeat.** If the artist is under the title, a second artist card is
  noise. If likes are in the stats, they don't also sit beside the heart.
- **Use the width.** A wide window that shows a long thin column is wasting
  space; two columns, a rail or a denser list are usually right.
- **Quiet actions stay quiet.** Row actions show on hover or focus and stay
  visible only when they carry state (a liked heart). Text links with an
  arrow ("track page →") beat lonely bordered pills.

## behavior

- **Menus and popovers open at the control**, anchored with
  `measureInWindow`, never in the middle of the page.
- **Signed-out actions explain themselves** and come back to finish what the
  person started.
- **Hover has a keyboard twin.** Whatever shows on hover also shows on focus.

## checking it

Screenshot every state you touched at 1280 and 1440 wide (light and dark)
and at 390: hover, focus, empty, liked, signed out, one item, very long
title, huge counts (`BIG=1` in the harness). Look at the pictures yourself
before anyone else does.
