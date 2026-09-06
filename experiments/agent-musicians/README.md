# Short-clip listening experiment

September 5, 2026. Local experiment; no tracks published, identities created,
recurring work scheduled, or repositories moved.

## Result

The tested audio models did not provide reliable musical feedback. Do not use
their prose as the reward signal for an autonomous musician community yet.

| Test | GPT-Audio Mini | GPT-Audio 1.5 | Gemini 3.5 Flash-Lite |
| --- | --- | --- | --- |
| Identical recordings | Said it could not listen | Empty output | Correctly said identical |
| Bass removed | Said it could not listen | Empty output | Incorrectly said identical |
| Beat interval doubled | Missed change; invented 0:20 timestamp | Not tested | Described brightness; missed rhythm change |
| Melody delayed two seconds | Said it could not listen | Empty output | Incorrectly said identical |
| Nonlinear distortion | Missed change; invented 0:32 and 0:55 timestamps | Not tested | Incorrectly said identical |
| Spoken control | Exact transcription | Exact transcription | Exact transcription |
| Digital silence | Not tested | Not tested | Claimed a duck was quacking |

The silence file was verified to contain only zero-valued samples for eight
seconds. All speech controls transcribed “The blue bicycle has seven wheels.”
The successful speech controls establish a working basic audio request path;
they do not establish reliable music perception.

Mini also declined a single-clip description. Combining the base and bass-free
recordings into one file separated by one second of silence did not resolve
Gemini's failure: it claimed a bass pitch change instead of bass removal.
Gemini 3.5 Flash returned HTTP 403, so no larger Gemini quality comparison was
possible. Gemini 2.5 Flash-Lite returned 404 with a message that it is unavailable
to new users, despite appearing in the model listing; the service recommended
3.5 Flash-Lite.

These are single trials on simple synthesized phrases, not a general benchmark
of music understanding. The models received audio bytes and a neutral comparison
prompt, without filenames, composition code, or the expected change. Pair order
was fixed, not randomized. Repeated trials, richer instruments, alternate models,
and human scoring are needed before drawing broader conclusions. Distortion
also changes loudness and harmonics; this is not a loudness-matched timbre test.

## Luna revision baseline

Luna ran through Pi without tools, project context, extensions, or persistent
sessions. It received numerical measurements, not audio or the failed listener
responses. In the first probe it selected bass amplitude 0.10. In the reproducible
revision run it selected 0.08, down from 0.20, while retaining melody and timing.

The rendered revision reduced energy below 150 Hz from 92.7% to 68.1%, and RMS
from -16.7 to -23.0 dBFS. This verifies that Luna can choose a parameter change
with the predicted measurable effect. It does not demonstrate improved musical
quality, reduced perceptual masking, or direct hearing. Playback is deliberately
not loudness-normalized, so perceived preference can be affected by level.

The bounded run cost approximately $0.03 at published standard rates, including
audio diagnostics, one speech synthesis request, and two Pi/Luna calls. These
are usage-based estimates, not an invoice. Raw responses and usage are in
`results/`; `costs.json` records the calculation. Gemini may be covered by the
account's free tier.

## Reproduce

Run from this directory:

```sh
uv run listening.py --diagnostics
uv run gemini_listening.py --diagnostics
uv run revision.py
```

Each invocation makes a bounded number of paid requests and overwrites its
result files. Preserve a copy before rerunning. `listening.py` generates the
eight-second mono PCM fixtures locally with deterministic NumPy synthesis.
It does not modify or depend on digital-audio-claudespace; the simple independent
renderer makes each controlled change explicit. Audio output stays local and
is ignored by Git.

The OpenAI runner uses OPENAI_API_KEY or the existing encrypted
`prefect.blocks.openai-api-key`. Gemini uses GEMINI_API_KEY or
`local.gemini_api_key` in the same sops store. Credentials are decrypted in memory
and sent in request headers, never query strings or result files. The Gemini
key was saved from Nate's clipboard with explicit authorization, verified by
hash, and existing store entries were checked unchanged. No consumer migration
or secret rotation was performed.

## Next experiment

Before running a continuous community, require the listener to pass silence,
instrument-presence, onset-change, and identical-audio controls across repeated,
randomized trials. Measure objective audio features independently and retain
human blind comparisons for musical quality. A failed perception test should
stop the revision loop rather than turn invented criticism into agent memory.

The llms.txt onboarding evaluation remains separate: none of these trials used
plyr.fm's API, MCP, or uploads, so they say nothing yet about the quality of its
agent documentation. Prefect orchestration, three musician identities, and the
monorepo migration remain future work.

Sources: [OpenAI audio API](https://developers.openai.com/api/docs/guides/audio),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Gemini audio API](https://ai.google.dev/gemini-api/docs/audio),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite).
