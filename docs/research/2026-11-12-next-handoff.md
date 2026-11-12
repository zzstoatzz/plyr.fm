# Next handoff

November 12, 2026. Start from current remote `main`. Everything described here
is merged and deployed to next.plyr.fm and its services; there is no open
branch, pending deploy or half-finished change from this cycle. Production
(plyr.fm) was not promoted or touched.

This supersedes the [November 7 handoff](2026-11-07-rewrite-handoff.md) for the
client, the player and account state. That document is still right about the
catalog appview, Jams and the performance investigation.

## What Next is and what we hold to

Next is the rewrite of plyr.fm that runs beside the legacy app until it can
replace it: one Expo / React Native client for web, iOS and Android, a Zig
appview for the catalog, and a small coordinator for live playback state.

The appview is modelled on [Bobbin](https://til.desertthunder.dev/notes/2026/08/01/bobbin/),
Tangled's read-only appview, and most of what we hold to follows from it.

- The user's records are theirs. Tracks, lists, likes and profiles are written
  by the client straight to the account's PDS and read back through an appview
  that never writes them. A client that has just written waits for the appview
  to project that exact version, the way Bobbin's `awaitRecord` works. Next and
  production share those records.
- Everything derived from records is disposable. The catalog index is rebuilt
  from the network, so a missed event or a bad deploy is repaired by replaying,
  not by hand-editing rows or writing a one-off migration. Keeping that true
  is why the rebuild and repair work in the inventory matters before cutover.
- State that cannot be rebuilt is kept small, named and separate: sign-in
  sessions, the queue and its position, settings, metrics and moderation. Each
  needs an owner and a recovery rule, because replay will not bring it back.
- Small and domain-specific. The appview serves `fm.plyr.*` and nothing else,
  in one binary with a modest memory budget. Reach for a new service, store or
  dependency only when the existing ones provably cannot do the job.
- Account state that is not a record belongs on our server, tied to the
  account, for every account. A capability only some PDSes offer must not
  decide whether a basic feature works.
- Next should feel like production where production is good. The look, the
  lowercase voice, toasts, server-owned resume and media controls are the
  reference; the rewrite is a chance to make the same behaviour faster, not to
  redesign it.
- Phone first. A change is judged on a phone-sized screen with a finger:
  vertical space, one-handed reach, motion that follows the touch.
- One client, native in view. Use cross-platform primitives so the same
  component can ship in the native apps; keep web-only code behind a small,
  named seam.
- Evidence over assertion. A change is done when a check that fails without it
  passes with it, and the rendered result has been looked at.
- Ship in small steps through the normal path: branch, PR, CI, squash merge,
  deploy, verify live.

## Where things stand

The catalog (home, search, track, album, playlist, artist, library, likes),
playback, the queue, Jams, radio, settings, sign-in and the creator portal's
published catalog work on next.plyr.fm. The
[rewrite inventory](2026-11-04-rewrite-progress-and-scope.md) lists what is
still missing before cutover, and none of that list moved this cycle:
publishing parity, full album and playlist management, For You and semantic
discovery, private listening history, moderation preferences, and native
lifecycle.

This cycle (#2459 to #2484) was about making the web client good on a phone
and putting account state in the right place.

Look and layout. Production's palette, glass and card surfaces, button shapes
and lowercase copy are ported (#2459, #2462). Home's top tracks and artists you
know are single swipeable rows of compact cards (#2460, #2468). Tag filters are
one horizontal strip that never wraps or moves the page (#2463, #2465, #2467,
#2469). The phone dock and tab bar are slim (#2464).

Player. A restored track shows paused at its saved position and loads audio
only on play (#2466). On phone widths the dock and Now Playing are one surface:
drag up or tap to open, pull down to close, artwork and title travel between
the two, and a spring settles the release (#2470, #2471, #2473). The sheet
stays mounted so opening starts within about 40ms. Transport controls use
production's solid glyphs and a wave loader (#2473). Below the transport, Now
Playing shows the artist and track details, not the queue (#2475, #2476).
Links out of the sheet change the page before it leaves (#2477). The web
client publishes to the Media Session API (#2474). Toasts and an animated like
follow production and the Bluesky app (#2483, #2484).

Account state. The coordinator admits a personal queue on the account's
service-auth identity alone (#2478, #2479). The queue is recorded in Postgres
within about a second of each change and restored from there when Redis no
longer holds it; Redis is a 24 hour live cache (#2480). Settings are a merged
JSON row behind the same permission (#2481, #2482). Every sign-in except an
explicit device-only one requests that single permission. No Space is created
for either. Jams still use Spaces.

## Missteps worth keeping

- We treated a missing PDS capability as "this account syncs on-device". The
  queue and settings were gated on Spaces although neither stored anything
  there. The principle above about account state is the correction.
- Checks measured the wrong thing more than once: a URL change in place of
  what was drawn, a fixed wait in place of the event, an element's absence
  when it had become hidden. Assert the thing the user sees.
- Several UI passes shipped before anyone looked at the rendered result on a
  phone: wrapped tag rows, a queue list under Now Playing, sparse boxed cards,
  a pinned header that duplicated the title. Render, look, then ship; show a
  mockup when the direction is a choice.
- During a GitHub Actions outage two changes were merged without CI and
  deployed by hand. Both were later covered by CI on main. Wait for CI; a
  manual deploy is only for an outage and only with the owner's say-so.
- An open tab keeps running the build it loaded. After a deploy, reload
  before judging whether a fix worked.

## Working here

Client commands, the backend's commands and the deploy workflows are in the
READMEs under `next/`. What is not obvious from them:

- Browser checks live beside the client and are not in CI. Build the web
  export first, then run a check with Node. Most serve that build under the
  real origin. Run the ones for the area you touched and the player set after
  any player change.
- The queue fixture generates identities, serves their DID documents locally
  and runs locally built coordinators against the compose Redis and Postgres.
  It makes signed-in behaviour testable with no PDS account. The coordinator
  check, the two-device sync check and the feedback check use it or the same
  stubbed-agent approach.
- To see a change in real iOS Safari, build the client with its API URL
  pointed at a loopback proxy that forwards to the Next API, serve that build,
  and open it in the simulator. The API only allows the production origin, so
  a plain local build cannot load data.
- Ship backend before client when both change. The coordinator deploy is
  slower than the Pages deploy and the client must not call a route that is
  not there yet.
- The backend deploy applies migrations, grants the coordinator's database
  login access to the account tables, stages that login on the coordinator
  app and refuses to start the coordinator without it.

## Next work, in order

1. Verify with a real account. No real sign-in has exercised the new
   permission, queue sync, settings sync, a like, or the lock screen. Existing
   sessions predate the permission and need one fresh sign-in.
2. Run the native apps. They share this code and are only bundled in CI. The
   morph, the toasts and the like animation use cross-platform primitives; the
   always-mounted sheet, the body portal and Media Session are web-only, and
   native still has no next/previous on the lock screen.
3. Finish the player: fly the play button with the artwork, animate browser
   Back, and give Now Playing's details more to show (more from the artist,
   who liked it) since most tracks have little metadata.
4. Repair the three browser checks that fail on main for reasons older than
   this cycle: keyboard shortcuts, the playback retry case, and font settings.
5. Tidy account sync: the permission is still named for joining a Jam, the
   coordinator's startup sweep that gave old Redis keys an expiry can be
   deleted, and sensitive artwork is not filtered from Media Session.
6. Then pick the next cutover journey from the inventory.

Follow-up issues: #2485, #2486, #2487.
