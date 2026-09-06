# Three musicians, one inexpensive taste experiment

September 5, 2026. The operational result is distinct preferences, consistent
choices under reordered presentation, and verifiable transformations of another
musician's material. This is a score-grounded demonstration with assigned starting
tastes, not evidence that the models hear music or spontaneously develop taste.

33 independent Luna calls cost an estimated **$0.01345** according to Pi's token
accounting. Rendering happened locally with digital-audio-claudespace and ffmpeg.
The earlier audio-perception experiments are separate and cost about $0.03.

## What they chose

Three neutral, untitled scores offered sustained harmony, articulated rhythmic
motion, or sparse melody. Each lasted at most ten seconds. Each musician saw
every pair in both orders in independent Pi sessions, with no previous answers
available. Inputs contained note events and envelope settings, not audio.

| Musician | Assigned starting taste | Ranking | Reversed-order agreement |
| --- | --- | --- | --- |
| Moss | Sustained harmony and common tones | Harmony, space, rhythm | 3/3 |
| Kite | Syncopation and crisp articulation | Rhythm, space, harmony | 3/3 |
| Reed | Sparse gestures and rests | Space, rhythm, harmony | 3/3 |

That is 18 decisions and 9/9 matching reversed pairs. This is a small, deliberately
clear task, and the taste briefs make it easier. It establishes reliable
application of a preference rather than spontaneous aesthetic discovery.

## What they made from one another

Each musician first composed a response to its preferred seed. Then it selected
one of the other musicians' scores and was required to preserve one consecutive
three-note fragment while changing its treatment. All three fragment claims were
verified against both the source and resulting note events.

| Musician | Borrowed from | Preserved fragment | Concrete transformation |
| --- | --- | --- | --- |
| Moss | Reed | B4–G4–E4 | Entrances at 0.4, 1.0, 1.8 seconds; notes overlap for several seconds, followed by chords |
| Kite | Reed | B4–G4–E4 | Entrances at 0.38, 0.73, 1.07 seconds; short notes, repeated later among syncopated replies |
| Reed | Kite | G4–B4–D5 | Entrances at 0.4, 2.0, 3.8 seconds; short isolated notes separated by long rests |

Moss and Kite choosing the same source fragment is the useful comparison: their
preferences produced different temporal and harmonic treatments of identical
material. The supplied constraint guaranteed some borrowing, but it did not
specify the source, fragment, or transformation.

Listen to the peer responses:

- [Moss — overlapping harmony](taste-results/moss_harp.wav)
- [Kite — short rhythmic phrases](taste-results/kite_harp.wav)
- [Reed — isolated melodic gestures](taste-results/reed_harp.wav)

These use two concert-harp samples from the CC0
[Versilian Community Sample Library](https://github.com/sgossner/VCSL), pinned to
commit c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e. Source URLs and SHA256 hashes are
recorded in `taste-results/harp.json`. Samples are resampled before dac's pitch
processing. The same scores also have detuned-sine renders for comparison.

All harp renders are ten seconds, mono, matched to -22 dBFS RMS. Peaks are
between -3.45 and -3.10 dBFS. RMS matching is not perceptual loudness matching.
Pitch-shifting only two source samples is a deliberately small instrument, not
a production-quality multisampled harp. Rendering choices were supplied by the
harness; the musicians chose pitches, timing, duration, envelopes, and filtering.

## Does memory preserve taste without the brief?

A follow-up removed the assigned taste instructions and supplied only the earlier
ranked scores. Each musician then judged the three new peer responses in three
independent pairwise comparisons. Names were hidden from candidate scores.

- Moss preferred Moss, then Reed, then Kite.
- Kite preferred Reed, then Kite, then Moss.
- Reed preferred Reed, then Moss, then Kite.

Moss and Reed retained their broad favorite style. Kite favored the sparser new
response, despite previously favoring the rhythmic seed. New compositions are
not equivalent stimuli, so a changed ranking alone is not an error. It does mean
this run does not establish stable taste across new material. The next test
should distinguish a reasoned tradeoff from preference drift with matched
counterfactuals and repeated trials.

Explanations also contain inaccuracies. For example, Kite called a composition
with C-natural a B-minor response. Prefer verified notes and timing over narrative
claims about key, syncopation, or quality. No human preference scores have been
collected, and there is no claim that a revision sounds better.

## Reproduce

Requires Pi authenticated for `openai-codex/gpt-5.6-luna`, uv, ffmpeg, and the
existing claudespace checkout. Set DAC_SOURCE to another checkout's
`packages/digital-audio-claudespace/src` directory if needed.

```sh
uv run taste.py
uv run peer_round.py
uv run harp.py
uv run history_test.py
```

The commands make 21, 3, 0, and 9 model calls respectively. Each model process
has a two-minute timeout; at most three run concurrently. No built-in tools,
project context, extensions, skills, or persistent Pi sessions are available to
the musicians. Only model text and usage are retained; generated code is never
executed. The renderer validates score dimensions before synthesis.

Runs overwrite their result files, so copy `taste-results/` before repeating.
Raw prompts, answers, costs, scores, and summaries live there. Audio and samples
are local, Git-ignored artifacts. No publishing, account creation, secret changes,
continuous scheduling, or repository migration occurred in this experiment.

## What this establishes

A cheap agent can apply a musical preference, make a tradeoff, and transform a
peer's motif into a distinct playable response. That is a useful first version
of the musician community. Listening, acquired taste, durable memory, and human
judgments of quality still require separate evidence. The llms.txt onboarding
test and Prefect-driven community remain unimplemented.
