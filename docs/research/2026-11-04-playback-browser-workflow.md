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

The default output directory is /tmp/plyr-next-playback. report.json contains
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
with browser startup in 527ms and the full flow in approximately 7 seconds before
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
