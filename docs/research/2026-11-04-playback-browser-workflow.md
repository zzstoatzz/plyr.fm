# Repeatable Next playback inspection

Date: November 4, 2026. Baseline against the live Next frontend before Cycle 1
accounting deployment. This is browser automation timing, not a human usability
study or a claim of physical-device coverage.

## Run the actual interface

Use [check-playback.cjs](../../next/app/scripts/check-playback.cjs). It reuses
Playwright from the production frontend's existing development dependencies.
Install those dependencies with the frontend's normal Bun workflow, or supply
PLAYWRIGHT_MODULE pointing to another installed Playwright package.

```sh
node next/app/scripts/check-playback.cjs
PLAYBACK_QUICK=1 node next/app/scripts/check-playback.cjs
```

Default coverage is Chrome at 390×844 and 1280×900, each in light/dark. Defaults
are next.plyr.fm and the short public Alphabet track. Override PLAYBACK_URL,
PLAYBACK_TRACK and PLAYBACK_OUTPUT for a preview, fixture or another track.
PLAYBACK_BROWSER=webkit and PLAYBACK_EXECUTABLE can select an installed WebKit
binary. PLAYBACK_EXPECT_RECEIPT=1 waits for an actual successful plays response
after resumed listening; it does not force media position or fabricate a receipt.

The default output directory is /tmp/plyr-next-playback-<timestamp>. report.json contains
phase timings, request method/host/path/status/response timing, request failures,
uncaught JavaScript errors, playback logs and real media observations. Screenshots
cover Home, track detail, Now Playing, resumed state and an injected playback
failure. Outputs stay outside the repository.

The flow is Home → track → play → Now Playing → pause → pointer seek → resume.
A second load rejects the first playback-resolution request with 503, then uses
the actual Play control to recover against the live API. This is fault injection
at the network boundary, not a claim the live API returned that failure.

Expo Audio's web media elements are detached from the DOM. The script observes
HTMLMediaElement.play and retains references to the real elements; it does not
replace playback or advance media clocks. This makes actual media progress the
readiness condition, rather than a button label or an intercepted successful API
response. A 400ms screenshot settle sits outside interaction timings to avoid
mistaking the React Native modal fade for layout overlap.

## Baseline measurements

The first complete matrix passed all four Chrome cases. One phone case completed
with browser startup in 527ms and the full flow in 5.85 seconds before
screenshot-settle waits were added. With settling, a separate WebKit phone/dark
flow took 8.63 seconds including browser startup, screenshots and injected retry.
These are individual runs, not percentile estimates.

| Phase | Chrome first matrix, four cases | WebKit phone/dark repeat |
|---|---|---|
| Home ready with sample link | 0.86–1.53s | 1.25s |
| Home → track controls | 1.11–1.17s | 1.02s |
| Play tap → actual media progress | 0.85–1.27s | 1.42s |
| Open Now Playing controls | 73–77ms | 112ms |
| Pause confirmed in media | 42–336ms | 45ms |
| Pointer seek confirmed in media | 37–78ms | 67ms |
| Resume confirmed in media | 28–45ms | 69ms |
| Reload + injected503 + successful retry | 1.34–1.83s | 2.25s |

Each successful baseline captured ten fetch responses, including the intentional
503 and its successful playback-resolution retry. Home makes separate Latest and
weekly-chart requests; track navigation fetches detail, then playback resolution
on the tap. Receipt integration should patch the local metric view rather than
adding a complete Home/detail refetch to each qualification.

An earlier WebKit run completed playback controls but failed the strict uncaught
error assertion with a chart-fetch access-control message while navigating
quickly. A repeat passed; that does not establish the first failure as harmless.
The harness retains strict failure and records request cancellations for diagnosis.
Asset and analytics cancellation during navigation is recorded separately from
uncaught application errors.

## Scope and next testing layer

Keep this full-route smoke separate from component stories. Production Storybook
is useful for isolated visual states but cannot establish media-source lifetime,
real asynchronous fetching, cookies, route transitions or accounting retries.
The Next harness should remain a short role-locator-driven path through the
actual built application, with optional API boundary fixtures for repeatability.

For accounting, extend this with real qualification duration, response-loss
retry, reload with a persisted pending occurrence, duplicate delivery and visible
count reconciliation. Do not use seek or a synthetic clock as evidence of heard
time. Radio and Jam output ownership need their own real-player flows; this
initial solo flow does not verify them. Bundled WebKit also does not establish
physical iPhone background behavior or audibility through a device speaker.

## Accounting integration mode

```sh
PLAYBACK_DIST=next/app/dist ACCOUNTING=1 PLAYBACK_QUICK=1 node next/app/scripts/check-playback.cjs
```

Build the Next web application first. PLAYBACK_DIST serves those local files
through browser routing at PLAYBACK_URL, retaining the normal origin and real
API/audio reads. ACCOUNTING=1 additionally intercepts only play POSTs with an
explicit receipt fixture. No real accounting service or production metrics are
written in this mode.

The integration flow uses natural playback of the real eleven-second track.
Seeking immediately near the end produces no submission. Another playback
qualifies, receives an injected503, retries with the same occurrence and updates
the detail count without another track GET. A further occurrence receives a
simulated committed-but-lost response; the script reads the actual IndexedDB
pending row, reloads the app and checks that the same ID is resent and the count
reconciles. The fixture admits two unique occurrences across four deliveries.
This proves the built client, media qualification, persisted outbox and UI
integration against an HTTP boundary; backend atomicity is a separate real
Postgres test, and live receipt verification must run without the fixture.

Chrome and WebKit phone/dark passed this integration mode. Qualification plus the one-second delivery
retry took 8.75 seconds in Chrome and 8.96 seconds in WebKit from the play tap in that run. The screenshot shows the
new count with the player still playing. That inspection also caught the initial
singular copy defect, “1 plays”, for correction alongside the count integration.

Each run now creates a timestamped default output directory so stale fade frames
and reports cannot be confused with a later settled capture. Explicit
PLAYBACK_OUTPUT remains available when a fixed artifact location is desired.

PLAYBACK_REPEAT=1 adds the repeat-one regression: qualify and pause, enable
repeat-one through Queue, explicitly seek from the last second to zero, then
listen naturally for 6.5 seconds. This must retain the original occurrence and
submit nothing new. A subsequent natural loop must qualify a different
occurrence. Run this against the rebuilt bundle containing the seek-lifecycle
fix; it is separate from the baseline acceptance above.

## Live embed and Radio receipt checks

After the accounting backend and client are deployed, PLAYBACK_SURFACES=1 adds
an actual third-party iframe track embed and a Radio listen. These use real
Next receipts without the accounting fixture. The embed hears the short track;
Radio must hear the qualifying duration locally rather than using its existing
station position. The script records tap-to-media and tap-to-receipt times,
checks the durable receipt reports a counted play, and prevents production API
POSTs. PLAYBACK_STATION selects a station (default loved); choose a catalog
rotation with enough time left for the listening threshold. These checks are
implemented for live verification, not included in the baseline passing claim.

RADIO_ACCOUNTING=1 is a separate client regression with a held identity-read
response and a fixture play receipt. It hears Radio naturally for thirty seconds,
requires the canonical identity lookup to start only after qualification, checks
a provisional pending occurrence in IndexedDB, stops playback, releases the
identity response and verifies that delivery preserves the same occurrence ID.
This isolates the contract that slow identity resolution must neither delay
listening accumulation nor discard an already qualified play when audio stops.

SHORT_PLAYBACK=1 adds a real0.4second PCM WAV at the audio delivery boundary,
with a fixture receipt endpoint. This caught an Expo status integration defect:
Chrome and WebKit both reached the actual media end at0.4seconds but submitted
nothing, because the first loaded observation reported playing=false at position
zero and the next progress sample left less than half the duration accumulated.
The acceptance is one qualification after naturally hearing half the short WAV;
there is no synthetic media clock or seek in this case. The source metadata
remains the ordinary eleven-second catalog track so the test also establishes
that actual decoded duration takes precedence.

The short-WAV regression failed before the loaded-position-zero observation fix
in both Chrome and WebKit, then passed in both after the fix, including the
receipt-driven visible count. Repeat-one's explicit-seek and natural-loop
regressions also passed in both. Delayed Radio identity delivery passed in both,
including deletion of the persisted pending item after client receipt acceptance.
The latest four-size/theme Chrome screenshots were inspected again and remained
opaque and unclipped. Very short natural loops below the status sampling interval
are not covered by the eleven-second repeat case.

The accounting fixture now uses the exact durable receipt schema accepted by the
client, including sources.dedup=postgres_durable. Report names identify fixtures;
they do not establish backend durability. An initial run using an intentionally
labeled source string correctly caused the stricter client validator to reject
and retry; those fixtures were corrected rather than weakening validation.

A subsequent WebKit repeat run hit another access-control message on a track GET
while all functional assertions passed. The harness now records API response
status/allow-origin, request failures and error stacks. Playwright's WebKit adapter
promotes JavaScript-source error console messages to pageerror, so that event
alone does not distinguish a caught Fetch failure from an uncaught exception.
The focused recheck passed strict error assertions with this instrumentation;
the earlier intermittent network observation remains recorded rather than hidden.

The live embed surface case also reloads the cross-site iframe after its first
receipt. It requires a different occurrence with the same anonymous listener
inside the cooldown and a suppressed second receipt. Only listener equality is
recorded; the listener value is not included in the report.

## Deployed-backend integration before frontend promotion

After the accounting and anonymous-listener backend deploys, the built local
frontend was exercised against the real Next API without receipt fixtures.
Chrome and WebKit both passed the actual cross-site iframe and Radio checks.

| Surface | Chrome | WebKit |
|---|---|---|
| Embed tap → real media progress | 1.21s | 1.68s |
| Embed tap → durable counted receipt | 8.04s | 8.43s |
| Iframe reload → second receipt interval | 9.15s | 9.87s |
| Anonymous listener retained across iframe reload | yes | yes |
| Second occurrence inside30s cooldown | suppressed, uncounted | suppressed, uncounted |
| Radio tap → real media progress | 728ms | 568ms |
| Radio tap → durable counted receipt | 39.31s | 32.71s |

The two browsers used separate anonymous listeners, so both initial listens
counted. Concurrent total changes do not imply a suppressed replay counted;
the receipt's counted/status fields establish each occurrence's outcome. These
measurements include real audio delivery, listening, canonical Radio identity
resolution and the API transaction. They are not isolated database latency.

Radio's request inventory exposed redundant work: sixteen state GETs over the
Chrome~39second flow and two song/audio requests. The visible Radio page and
persistent player each poll, and the page's silent Expo player also attaches the
audio source. That is concrete fetching debt to remove, rather than assuming
fast Zig execution makes those duplicate network reads harmless.

This run verified deployed backend integration with local built assets at the
Next origin. The final frontend deploy still requires a run without PLAYBACK_DIST.
