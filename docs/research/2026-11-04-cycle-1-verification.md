# Cycle 1 verification

The [accounting contract](../internal/architecture/next-play-accounting.md) is
implemented with Neon/Postgres receipts, a bounded client outbox and the actual
player UI. Personal history/scrobbling and full queue continuity remain later
cycles. Queue drag and player-control styling were requested and shipped as a
separate priority change, [#2368](https://github.com/zzstoatzz/plyr.fm/pull/2368).

## Evidence before the public client rollout

- Real least-privilege HTTP/Postgres tests cover concurrent identical UUIDs,
  different listeners, failed transaction recovery, lost response/new cookie,
  suppression and conflicting payloads. No Python table writes.
- Chrome and WebKit drove actual media progress: normal qualification, seek near
  the end earning nothing, 503 retry, lost-response reload with the same UUID,
  explicit-seek versus natural repeat, and delayed Radio identity resolution.
  Receipt-driven count updates caused no track-detail GET.
- A real 0.4-second WAV exposed two bugs: lost final progress and startup remaining
  disabled after natural end. The regression failed before the fixes and passes
  afterward, including visible count and enabled replay. Actual volume remains
  25% after both solo and Radio source replacement.
- Built client against the actual deployed Next API: cross-site iframe playback
  counted in both engines; iframe reload retained anonymous identity and a new
  occurrence was suppressed within the cooldown. Actual Radio playback produced
  a durable receipt after locally heard time, independently of station position.
- Radio now performs one shared poll cadence and attaches only the active audio
  source. Measured requests dropped from 16 state reads in about39 seconds and
  two audio requests to seven/eight state reads in about32/38 seconds and one
  audio request. There are zero audio requests before Listen.
- Two independent browsers used real OAuth and real Spaces on a disposable local
  ZDS, with actual catalog audio and the deployed Next metric endpoint. Sign-in
  returned to the room. Each audible output earned one durable receipt; pause
  and paused seek/catch-up did not add another receipt. This verifies this room
  flow, not the broader Jam parity planned for Cycle4.

The browser [workflow report](2026-11-04-playback-browser-workflow.md) retains
phase timings, run commands, fixture boundaries and coverage. Bundled WebKit and
native exports do not establish physical iPhone/native background behavior.

## Repeat the room check

[check-jam-accounting.cjs](../../next/app/scripts/check-jam-accounting.cjs) uses
the Next URL and requires a disposable Spaces-capable ZDS at localhost:5197,
public fixture issuer https://pds.fixture.test, handle domain .test and a local
PLC at127.0.0.1:5296. Invites must be disabled and crawlers empty. It creates or
reuses local fixture accounts and creates a member-private Jam. It blocks
production API POSTs; real metric submissions go to api.next.plyr.fm.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node next/app/scripts/check-jam-accounting.cjs
```

PLAYBACK_DIST=next/app/dist overlays built frontend files for predeployment
checks. The local-PDS redirect shim changes only the navigation transport so a
built frontend remains intercepted across OAuth; grant, token exchange, Space
credentials, MAC validation and playback are real. It does not fabricate auth
state or rewrite callback state. The published-client run omits the asset overlay.

Do not point this fixture at real accounts or count source-level inspection as
proof of a successful two-browser run. The local PDS is a test dependency; this
script does not start it or manage real PDS credentials.
