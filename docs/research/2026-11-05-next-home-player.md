# Next Home and desktop player

## Changes

- #2413: selected accent colors primary playback icons and active navigation labels, without restoring circular play/pause backgrounds.
- #2414: replace the unexplained reauthentication/sync CTA with an explanation of saving appearance/playback settings across devices. Existing device-only fallback and optional permission remain.
- #2415: virtualized Home tracks, automatic cursor pagination, deduplication, bounded retries and filter-generation protection; tighter section spacing and production-derived tag hues with contrast correction.
- #2417: capture Escape before focused React Native inputs swallow it, while retaining dialog ownership.
- #2416: nonmodal desktop Now Playing at 800px and wider. Artwork, seeking, controls and upcoming tracks share the viewport with browsing. Mobile full-screen presentation and protected swipe dismissal remain.

## Storage and fetching

This changes presentation and pagination, not storage. Home reads existing cursor endpoints. One request can run per pagination generation; changing filters ignores late older responses. Loaded rows remain visible after a page failure. An unchanged or missing next cursor is rejected. A focusable more/retry fallback remains alongside automatic loading; a polite count announces loaded records.

The list uses [React Native FlatList](https://reactnative.dev/docs/flatlist). A measured viewport check also fills short initial lists when the end callback fired before the first request finished. Error state blocks that automatic path. Tag colors retain the production string-to-hue mapping and adjust text against the actual light/dark fill.

The root remains the sole audio owner. Desktop panel visibility lives in the shell, independently of route history; opening, browsing and closing the panel must not replace its media element. Mobile keeps its route-based expanded player. Preference UI does not start reauthentication until the explicit continuation action.

## Controlled verification

- 38 Node tests, TypeScript check and web export passed. PR CI exported iOS and Android; these are bundle checks, not physical-device gesture acceptance.
- Home browser tests: Chrome and WebKit at 390/1280px, both themes. Automatic paging, overlapping records, failed-page retry, repeated cursors, stale responses after tag selection and short initial pages passed. WebKit exposed a short-list fill problem; the measured viewport path fixes it.
- Preferences explanation: real OAuth through disposable local ZDS/PLC accounts without the optional preferences grant, then open the explanatory sheet. No real user account was modified.
- Desktop player: Chrome at 800/1280px in both themes and WebKit at both desktop widths. Search/artist/queue navigation, seeking, pause/resume, live accent change, Escape focus restoration and continuity of the exact media element passed using real browser media playback of a controlled WAV.
- Mobile player: light/dark, long title, missing artwork, 1.4x scale and short viewport; body swipe dismissal, protected interactive controls, scrolling/cancellation and continuous media passed. Browser Back/Forward and cold expanded-player route checks passed.
- Every documented keyboard shortcut passed at 390/1280px, including radio handoff and editor guards.

These tests intercept the network boundary and block real mutations. They do not establish live media delivery; the separate live check below does.

## Review corrections

The first list implementation relied only on `onEndReached`; WebKit's short-first-page test failed because the callback could run before a cursor existed. The measured viewport fill path and stable pagination callback fixed that failure. Refresh now scrolls to the top. Desktop review also caught artwork using the window width after the main column narrowed; it now clamps to its measured container.

The previous desktop player tests assumed a modal route and were updated to assert a nonmodal complementary region and uninterrupted audio instead. Mobile still exercises its original Back/Forward route semantics. Selecting a search result is an explicit play action; its history test establishes a new media baseline there, then checks that subsequent navigation does not restart playback.

Live testing found the focused-input Escape case was missing from the first panel regression. That regression now types into Search and immediately dismisses the panel before reopening it for the remaining controls/navigation checks. It fails against the prior exported bundle; the capture listener is the corrective change.

## Live verification

The [Next deployment of #2416](https://github.com/zzstoatzz/plyr.fm/actions/runs/42114713550) published `a19df6cc705ced65abcc6f62c083334a42012452` to [next.plyr.fm](https://next.plyr.fm).

Actual catalog cursor reads and actual “Sounds of the Drone Mix” media playback passed in Chrome at 390/800/1280px in light/dark, and WebKit at 390/1280px in dark. Desktop search remained usable alongside the player; its media element stayed identical and playing across expansion, navigation and dismissal. No horizontal page overflow was detected. Live images were visually inspected. Real mutations were blocked; no likes, preferences, PDS records or play receipts were written for this check.

Observed fresh-context Home rendering was roughly 1.2–1.9 seconds. Most click-to-playing checks took 2.4–3.1 seconds including waiting for the playback clock to reach 0.5 seconds; one mobile WebKit run took 9.7 seconds. These are browser observations on this connection, not a latency guarantee or evidence that media-start latency is finished work.

A test that forcibly replaced the whole document during pagination reported a cross-origin request error while navigation interrupted pagination. The same cursor returned HTTP 200 with the correct allowed origin on three independent reads. The user flow was then driven through the actual Home track link and SPA navigation, rather than replacing the document; no such errors occurred. A separate live check exposed #2417's real focused-input Escape bug and was added to the regression suite.

Normal production was not promoted. `production-fe` remained `99334ecb0830fcd8eef411dad35f857361f48d43`; production web/API health returned 200. Only the `plyr-fm-next` Pages workflow deployed these UI changes. Owned local ZDS/PLC fixtures were stopped and removed after testing.
