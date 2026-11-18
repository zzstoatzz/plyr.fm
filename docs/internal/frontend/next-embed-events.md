# Next embed events experiment

Issue [#2744](https://github.com/zzstoatzz/plyr.fm/issues/2744). This is an
experimental, general-purpose interface on **next.plyr.fm**. It has no particle,
physics, palette or visualization-preset semantics. Consumers own their
presentation and mappings. Production plyr.fm is unchanged.

## real-track measurements (opt-in)

Append `analysis=live` to a normal Next track, collection or radio embed URL,
then use the same subscription protocol below. For example:

```html
<iframe src="https://next.plyr.fm/embed/track/TRACK_ID?analysis=live"
  title="audio player" allow="autoplay"></iframe>
```

Choose the setting when constructing the iframe; changing it requires a reload.
To stop visualizations during playback, unsubscribe without recreating the frame.
The parameter only requests measurements. It does not start playback or grant
access to a track. Existing access checks and the iframe's play controls apply.
There are no particle-specific parameters or per-site configuration.

The first supported scope is **desktop Chromium without touch input**, with
`captureStream` and Web Audio available. iOS/iPadOS, Android, Safari, Firefox,
touch-enabled desktops and missing APIs report `unsupported-browser` and keep
ordinary playback. This deliberately excludes unverified mobile/background
behavior rather than detecting an API and promising platform support.

`ready.capabilities.live` means the opted-in browser supports attempting capture;
it does not promise that this source is measurable. Every normal-embed snapshot
now includes `analysisStatus`:

| status | meaning |
| --- | --- |
| `disabled` | iframe did not request `analysis=live` |
| `unsupported-browser` | outside the supported scope above |
| `unsubscribed` | no active observation subscription |
| `awaiting-playback` | no measurable media loaded yet |
| `gesture-required` | analysis context has not resumed; interact with the iframe's player |
| `cors-unavailable` | CORS media loading failed or exceeded its three-second budget; ordinary playback is used |
| `background` | document hidden; capture is disconnected and context suspended |
| `paused` | media paused or ended |
| `buffering` | media seeking or insufficiently buffered |
| `capture-unavailable` | stream capture failed, has no audio track, or its track is muted/ended |
| `available` | a live capture can provide measurements |

Treat `analysis: null` as unavailable regardless of capability. A non-null
measurement contains `source: 'live'`, linear full-scale `rms`, three FFT band
powers in order (60–250, 250–2000, 2000–7500 Hz), `sampleRate` in Hz and
`windowSamples: 2048`. Band values are unnormalized sums of squared FFT
amplitudes; consumers own gain, smoothing and visual mapping. Measurements are
sampled at the negotiated 1–10 Hz observation rate, not a sample-accurate beat
clock. Use snapshot track/revision/instance and discontinuity fields to discard
old values on a seek or source change. The delivered content hash remains
unknown (`audioContent: null`); do not bind precomputed artifacts to it.

### keeping native playback independent

The real-track implementation uses the **existing media element's captured
stream** as an analysis input. It never calls `createMediaElementSource` and
never connects the analysis graph to the audio destination. The media element
continues to own audible playback. Unsubscribe, hidden-document handling and
source replacement disconnect captured tracks; they never pause the media
element. The context is reused and closed on embed teardown. A trusted
interaction in the iframe is required before creating/resuming it; an autoplayed
track may therefore play normally while analysis reports `gesture-required`.

Only opted-in, supported frames request anonymous CORS media. If metadata cannot
load under CORS, the same element retries ordinary playback once without CORS
and reports `cors-unavailable`. There is no second analysis download, separate
player, proxy or change to media-server permissions. A failed/slow source may
incur this bounded initial retry; normal non-opted-in and unsupported frames
retain their existing loading path. Later playback errors remain playback
errors, rather than being replaced with invented measurements.

The [DOM media capture specification](https://www.w3.org/TR/mediacapture-fromelement/)
describes capture tracks and origin restrictions. Unlike routing the media
element through an AudioContext, suspending this analysis graph does not take
ownership of the native output. Capture may still be unavailable and is
reported explicitly. Mobile and OS screen-lock acceptance remain unverified;
this does not enable live analysis there.

## subscribe from any site

Embed a normal Next track or collection URL. Keep its visible playback controls.
After the frame loads, send this message to its **exact origin**:

```js
const protocol = 'fm.plyr.embed.experimental.v1';
const origin = 'https://next.plyr.fm';
const subscription = crypto.randomUUID();
const frame = document.querySelector('iframe');
const subscribe = () => frame.contentWindow.postMessage({
  protocol, type: 'subscribe', subscription, hz: 4
}, origin);
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== origin) return;
  const message = event.data;
  if (message?.protocol !== protocol || message.subscription !== subscription) return;
  if (message.type === 'ready') console.log(message.capabilities);
  if (message.type === 'snapshot') console.log(message.state, message.position);
});
frame.addEventListener('load', subscribe);
subscribe();
// Retry at 500 ms until ready, with a finite timeout: hydration may follow load.
// On teardown:
// frame.contentWindow.postMessage({ protocol, type: 'unsubscribe', subscription }, origin);
```

For a typed consumer, `next/core/src/embed-events.ts` supplies the wire types,
`parseEmbedEvent` and bounded `embedPosition` interpolation. The snippet only
logs data; renderers should validate the complete payload before using it.

There is one subscriber per frame, bound to its immediate parent window and
that parent's origin. An explicit new subscription replaces the old one.
Opaque (`null`) origins and sibling windows are rejected. Replies never use
`*`. Unsubscribe requires both the matching origin and subscription ID. The
protocol carries observations, not commands to play, seek, sign in or fetch
protected audio. There is no site allowlist.

`ready` reports capabilities. Non-opted-in embeds advertise playback only:
`precomputed: false`, `live: false`. `analysis: null` means unavailable, never
silence. A subscription creates one timer, clamped to 1–10 Hz (default 4);
without one there is no telemetry timer or connected analysis capture. Handshakes are also
limited to 10 per second. Teardown removes the timer and listeners without
changing the audio.

## timing and identity

Snapshots contain:

- `track`: record URI and CID, or null while no catalog track is loaded. A CID
  identifies a record revision, **not necessarily the delivered audio bytes**.
- `audioContent`: the fixture’s SHA-256 identity, or null when exact bytes are
  unknown (normal embeds). Consumers must match it to the manifest before
  applying precomputed features; an old parent cannot apply stale analysis to a
  newly loaded fixture.
- `instance`: a new identifier when the player replaces its loaded media.
- `discontinuity`: increases on source replacement and seeking. Discard
  interpolation and discrete-event cursors when it changes.
- `state`: idle, playing, paused, buffering, seeking, ended or error.
- `position` and `duration`: seconds; unknown/infinite duration is null.
- `rate`: media playback rate; `visible`: document visibility.
- `sequence`: increases within a subscription.
- `clock.epochMs`: `performance.timeOrigin + performance.now()`;
  `clock.monotonicMs`: the sending document's monotonic clock.

Use the epoch anchor across documents; raw `performance.now()` values belong
to different time origins. This is a media-position observation, not an
output-device sample clock. Rendering, message delivery and device latency
remain. Interpolate only playing, visible snapshots, for at most 500 ms, and
never beyond known duration. Freeze through pause, seeking and buffering.
Snapshots are bounded observations, not a lossless event log: short states may
occur between updates. Reset on instance, revision or discontinuity changes;
do not replay missed events after tab suspension. `analysisOnsets` demonstrates
once-per-forward-crossing delivery, rejecting gaps over 500 ms and discontinuities.

## comparison fixture

Open [/experiments/embed](https://next.plyr.fm/experiments/embed). Its waveform
and level displays independently consume the same player observations. They
are examples, not meanings imposed by the protocol. The synthetic mono WAV is
16 seconds at 16 kHz, generated by `next/web/scripts/generate-embed-fixture.mjs`.
The script has no network calls or dependencies. Its SHA-256 appears in its
filename and analysis manifest; changing audio produces a different asset URL.

The analysis manifest names the exact WAV hash and byte length, schema version,
sample rate, window/hop size, timebase, channel policy and normalization. It
contains min/max PCM peaks, RMS and three band-energy envelopes (60–250,
250–2000, 2000–7500 Hz), at 25 ms resolution. PCM amplitude is unnormalized
full-scale linear amplitude; band energy is squared amplitude from a rectangular
DFT window. Onsets are the synthetic stimulus's known half-second pulse times,
not a general music onset detector. The fixed fixture is public; this adds no
analysis endpoint or access path for private/gated tracks.

The fixture's **enable live comparison** button creates one media-element source
and one analyser on its actual playing element, with no second player or
analysis download. It uses 2048-sample Web Audio windows, no temporal smoothing,
and the same band boundaries. Live RMS is linear amplitude; live bands sum FFT
bin powers. Browser FFT windowing differs from the fixture DFT, so the numbers
are not interchangeable. Measurements include source, sample rate and window
size; paused, buffering, ended or suspended-context readings are null.

The live tap exists only in this fixture, behind a user gesture. Reload to
restore plain media-element playback. Normal embeds never route their native output through Web Audio; opted-in
supported embeds analyse a captured stream as described above.
The [Web Audio specification](https://www.w3.org/TR/webaudio/#AnalyserNode)
defines analyser windowing and CORS restrictions; a production live tap would
need CORS-authorized media on the existing audio owner. The
[HTML messaging specification](https://html.spec.whatwg.org/multipage/web-messaging.html#crossDocumentMessages)
is the source for sender/origin checks and bounded request handling.

## verification

`bun run check:embed` in `next/web` runs against the local build. Set
`EMBED_SITE_ORIGIN=https://plyr-fm-next-svelte.pages.dev` (or the live Next
origin) to exercise deployed JavaScript. Catalog/audio requests in the embed
case use synthetic browser fixtures; no account or catalog writes are made.
The experiment case loads the deployed public fixture directly.

`bun run check:embed-live` exercises real track embeds with a browser-local audio
server: opt-in/disabled/unsupported cases, actual CORS denial and fallback,
measurements, pause, seek, rate, context suspension, unsubscribe/resubscribe and
12 generated transitions (LCG seed 2744), delayed CORS timeout, source replacement
during a pending CORS load, and controlled hidden/visible document events. `EMBED_BENCH=1` alternates three plain
and three live starts against the same fixture; this is a local startup check,
not an internet or production performance claim. On Chromium 149.0.7827.55,
three alternating starts measured 205/105/109 ms plain and 111/106/111 ms live.
A disposable controller mutation that paused the native element during capture
disconnect failed the continuity check; the original continued. A real public
catalog track produced nonzero captured RMS and continued advancing after the
analysis context closed. These observations establish media-time continuity,
not a physical-device audible-output or OS screen-lock test. The live check also accepts
`EMBED_SITE_ORIGIN` for deployed assets.

## acceptance boundary

This ships an experiment, not a stable analysis API or upload-time pipeline.
Physical iOS/Android foreground → screen lock/background → foreground playback
continuity, Safari/Firefox support, very long tracks, and an independent external
consumer remain acceptance gates before expanding the supported scope or
stabilizing the contract. Normal embeds may offer the explicit desktop-only
experiment described above now. Browser automation is not evidence of those
physical-device behaviors. There is no production rollout or TestFlight change.

For long recordings, a production artifact format needs time-addressable chunks,
separate waveform/feature resolutions, content-hash invalidation and bounded
loads. Do not turn this fixed 16-second manifest into an unbounded whole-track
JSON download. Missing analysis stays explicit until a verified artifact for
the actual audio revision exists. Protected analysis must inherit the audio's
authorization, including cache lifetime and revocation; this experiment creates
no such artifacts.
