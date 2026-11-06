# Private audio streaming and seek baseline

**Date:** November 5, 2026
**Scope:** Browser delivery changes and measured baselines for the real-time playback MVP. These measurements do not establish Jam coordination latency or a production SLO.

## Findings

Public delivery already supports useful native seeking. A read-only run against the actual 88,737,797-byte “Sounds of the Drone Mix” rendition returned HTTP 206 for native byte ranges:

| Browser | Click to playing (>0.1s clock) | Four distant seeks | Rapid alternating seeks to final settled target |
|---|---:|---|---:|
| Chrome | 1,165 ms | 148 / 4 / 263 / 133 ms | 183 ms |
| WebKit | 703 ms | 231 / 267 / 233 / 233 ms | 567 ms |

Chrome's CDP network events counted approximately 6.78 MB received during that sequence, rather than the whole 88.74 MB rendition. WebKit does not expose the equivalent measurement through this harness, so its byte count is deliberately null. This is a small set of observations on this connection, not a percentile benchmark. It argues for measuring the UI/Jam state path before replacing the public media stack.

Protected browser playback previously awaited `response.blob()` before handing anything to the audio element. On a 9.6 MB, ten-minute WAV fixture throttled at 32 KiB every 20 ms:

| Browser | Whole-Blob startup | Streaming startup | Bytes sent before streaming playback | Distant seek samples |
|---|---:|---:|---:|---|
| Chrome | 7,739 ms | 630 ms | 884,736 | 83 / 6 / 13 / 31 ms |
| WebKit | 6,955 ms | 889 ms | 1,244,206 | 243 / 119 / 142 / 92 ms |

A later Chrome run during other development work measured 34.8 seconds buffered versus 523 ms streaming. The host was not performance-isolated; the durable result is that playback begins before the full file arrives, not a universal speedup factor. Native prefetch and overlapping seek requests still delivered about 10 MB over the seek sequence. This does not claim optimal bandwidth usage.

## Implemented delivery boundary

- `resolveGatedAudio` resolves the fixed record/blob reference before playback. It now encapsulates against the author's KEM key, verifies the record MAC and CID, and decodes Lex JSON links before CBOR verification. A mismatched MAC or changed record is rejected before any blob read.
- A narrowly scoped Service Worker intercepts only `/__plyr_private_audio/<random-id>`. The opaque ID maps to an active source in the owning window, not a URL that grants access in another tab.
- For each range request, the worker asks that exact window for the fixed PDS blob URL and signed headers. Credential minting/renewal remains in the client with the existing OAuth agent; credentials do not enter URLs, localStorage or a shared cache.
- The worker streams the upstream body, propagates cancellation, and caps in-flight work. It uses `no-store`, forwards byte ranges and restores the original MIME, length and range semantics. Released sources reject future requests and abort active ones.
- Current ZDS sends `Content-Range` without exposing it through CORS. The bridge derives that header from the MAC-verified blob size and requested single range, and checks visible upstream length/range headers for disagreement. The fixture deliberately hides `Content-Range` to exercise this path, including WebKit's initial `bytes=0-1` probe.
- HEAD and unsatisfiable ranges use verified metadata without downloading a body. A PDS refusing access still refuses playback; the bridge does not bypass it.
- Browsers that cannot install/control a Service Worker retain a bounded buffered fallback. Native delivery retains its current file-backed download path; both now share record verification. Full native streaming and physical-device background behavior are not established here.

This builds on the browser's native audio buffering and seeking; it does not add a custom decoder, public private-media proxy or persistent private cache. Service-worker lifecycle uses [clients.claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim), and request routing uses the requesting client identity and [client messaging](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/message_event).

## Reproduction and coverage

```sh
PLAYWRIGHT_MODULE=/tmp/next-web-check/node_modules/playwright node next/app/scripts/check-audio-seeking.cjs
AUDIO_SEEK_WEBKIT=1 WEBKIT_EXECUTABLE="$HOME/Library/Caches/ms-playwright/webkit-2359/pw_run.sh" PLAYWRIGHT_MODULE=/tmp/next-web-check/node_modules/playwright node next/app/scripts/check-audio-seeking.cjs
PLAYWRIGHT_MODULE=/tmp/next-web-check/node_modules/playwright node next/app/scripts/check-private-audio.cjs
PRIVATE_AUDIO_WEBKIT=1 WEBKIT_EXECUTABLE="$HOME/Library/Caches/ms-playwright/webkit-2359/pw_run.sh" PLAYWRIGHT_MODULE=/tmp/next-web-check/node_modules/playwright node next/app/scripts/check-private-audio.cjs
node --experimental-strip-types --test next/app/tests/gated-audio.test.ts next/app/tests/private-audio-worker.test.ts
```

The public baseline uses real delivery and anonymous playback, without posting receipts. The protected browser fixture uses two real HTTP servers, actual native browser audio, a real Service Worker, CORS and throttled range bodies. Its headers are synthetic fixture credentials; separate managed-Space/OAuth acceptance must prove the deployment's actual grants and record shapes.

Browser assertions cover playback before full download, far seeking, cross-tab copied-URL denial, HEAD, 416 and release. A same-origin iframe can create/play its own source while a copied parent source is denied. Cross-site embed registration may be blocked by browser policy; that is why buffered fallback remains.

Ten Node regressions cover cryptographic record rejection, credential renewal, first-chunk streaming, reconstructed range metadata, ownership, release races, cancellation, concurrency bounds and inconsistent partial lengths. They exercise the crypto SDK or the actual worker handler with only network/client boundaries replaced.
