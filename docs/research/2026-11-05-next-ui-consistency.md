# Next UI consistency pass — November 5

This pass covers the existing Expo/RN interface. It does not add pages, API
contracts, publishing capabilities or product features. Production remains on
its separate frontend branch and backend deployment.

## Reference and tooling

Read Bluesky [social-app](https://github.com/bluesky-social/social-app) at
`a32233e73d16c866bcefd973edc0605c60148bef`, particularly
`src/components/Button.tsx`, `forms/TextField.tsx`, `Dialog/index.web.tsx` and
`src/alf/{tokens,themes,typography}.ts*`.

The useful patterns are shared controls with explicit interaction state,
composed field labels, semantic theme tokens, platform-specific accessibility
and reduced-motion handling. Bluesky’s full styling/state/testing stack is not
necessary for this application. Keep the existing Expo, RN, fonts and browser
checks. Add development-only axe-core to those checks rather than another UI
framework or component workbench.

`next/app/scripts/check-ui-consistency.cjs` renders each route and records axe
WCAG 2 A/AA, 2.1 AA and 2.2 AA findings, page errors, horizontal overflow and
screenshots, including scrolled content. It also checks focus visibility,
linked-control geometry, portal tab keys and slider keyboard values.

The audit uses disposable real OAuth/PDS sessions and explicit HTTP fixtures
for catalog data, artwork and audio. It blocks application metric writes.
These are rendered-interface checks, not a claim of real catalog freshness or
new backend verification.

## Shared fixes

- Catalog buttons delegate to `Action`. Linked and ordinary actions retain the
  same geometry, type weight, radius and pressed treatment.
- Expo’s `Link asChild` composition drops callback-based child styles here.
  `Action` and `ActionRow` keep interaction state outside the style prop, as
  Bluesky’s Button does. Before the fix, the linked edit-track action lost its
  horizontal row and portal links lost their button styling. The rendered
  geometry regression fails against that build.
- Forms share visible, associated labels, input boundaries, focus treatment
  and multiline sizing. Existing inline links use an underlined semantic color.
- Page/section headings expose levels. Navigation exposes the current page;
  choices expose selection. Portal tabs support arrows, Home and End.
- Dialogs have accessible names; decorative backdrops leave the focus order.
  Dialog animation and press scaling respect reduced motion. Busy indicators
  have names and catalog loading uses the existing wave loader.
- Sliders retain the community native implementation. A small web adapter adds
  explicit current/min/max ARIA values and arrow/Page/Home/End keys; the pinned
  component’s web implementation does not supply those current values here.
- Playlist editing uses labeled removal icons instead of long removal buttons
  crowding the track rows. Destructive actions share a legible danger color.
- Navigation, mini-player and Radio type honor the interface scale. Player
  transport remains plain; queue dragging and player dismissal stay intact.

## Contrast

The theme retains the existing base colors and stored accent preference.
`colors.ts` derives a readable rendering color against both background and
surface. It does not rewrite preferences. Tests require 4.5:1 for text, danger
and derived accent colors, and 3:1 for field boundaries. They cover both themes,
the preset accents, black/white and low-contrast custom choices.

Those thresholds follow W3C’s [text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
Radio uses a stronger artwork scrim for small white text; switches and sliders
use the same semantic tint colors. Automated scanning cannot prove arbitrary
artwork contrast, so the fixture includes white artwork and the scrim is also
checked visually.

## Coverage

Route inventory: Home, Search, Library, Liked tracks, public playlists, artist,
track, album, playlist, portal and its profile alias, settings, upload, edit
track, edit profile, Jam room, Radio, track/album/playlist/artist/Radio embeds,
and the album slug embed. The OAuth callback is exercised during real sign-in;
Now Playing, queue and volume are exercised with active media. Additional
states include create account, likers, track menu, collection editing, portal
albums, and empty/error/loading catalog responses.

The original 390px light/dark baseline rendered 64 states and found issues in
18. Axe identified dialog/backdrop attributes, slider values and unnamed busy
indicators. Visual review additionally found linked-style loss, which axe did
not detect.

The final source passes 144 signed-in Chrome states at 390/1280 in both themes,
plus 72 at 320px with 130% interface text. No selected-rule axe violations,
page errors or horizontal overflow were reported. The player-presentation
regression separately covers phone/desktop light/dark, long text, absent art,
140% scaling, short viewports, protected controls, scrubbing, broad pull-down,
scroll arbitration, cancellation and continuing media.

WebKit’s disposable OAuth attempt fails with “The object can not be cloned” on
the unchanged public build too. Signed-in coverage is therefore Chrome;
WebKit coverage uses signed-out states. Native iOS/Android bundles are checked
by CI. No physical-device, VoiceOver/TalkBack or complete WCAG certification is
claimed.
