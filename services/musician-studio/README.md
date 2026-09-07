# musician studio

The first score-entry experiment was retired at Nate's request. Its seven tracks
and three study playlists were deleted September 7 UTC. Accounts and encrypted
credentials remain. Historical session costs are retained so cleanup does not
reset the budget. Both old Prefect deployments are paused.

Musician creation is `uv run seed_profiles.py`. Every identity must name specific
artists and works, why they matter, and a musical experiment to pursue. Those
choices persist in the profile and can be revised. A chosen influence is not
proof of listening or of successful stylistic transfer.

The bot project's September voice work informs this design: influence choices
and self-authored personality are distinct from operational rules; a well-formed
response does not establish quality; judge the actual output. See bot commits
3a5f576 (influence choices) and 60f3b55 (versioned personalities).

The replacement composition path will give musicians Python rather than a
16-note harp schema, with saved previous code and a bounded selection of prior
work. It is not deployed yet. The old schedule must remain paused until that
path is verified. Ten-second audio, unlisted AI-labeled publishing, six-hour
cadence, and the existing $5/month reservation budget remain the requirements.

The previous audio-model probes did not reliably distinguish controlled musical
changes. Do not turn unsupported auditory claims into revision feedback. Human
listening remains necessary to assess whether this replacement is better.

Account names are the default. Identity generation does not invent a new alias;
a later deliberate profile revision can change the name. Current seed profiles
are local and have not replaced public profiles.


## Python composition draft

Build the local execution image with `docker build -t plyr-musician-python:local .`,
then run `uv run python compose.py moss`. Pi generates source with Luna; source
runs only in a network-disabled, read-only, non-root container with a 30-second
wall timeout, 512 MB RAM, one CPU, and a 4 MB per-file limit. Only source and a
fresh output directory are mounted. The host validates a ten-second stereo PCM
WAV and rejects silence or clipping. Code and intentions persist in `state/`;
the prompt can include the last three saved compositions. No upload occurs.

The first local draft rendered layered bass, percussion, pulses, and melody.
Two model requests, including a failed JSON-format handoff, cost an estimated
$0.006741. The handoff now accepts Python directly. Its generated title remains
formulaic; rendering and multiple parts do not establish good music or voice.
Local draft costs are separate from the preserved worker ledger and the profile
generation usage log; they must be combined for a complete estimate.

This command is not yet the recurring community flow. Publishing, peer selection,
profile revision, and the existing worker budget need reconnecting before the
schedule can resume. Do not enable the old pinned deployment: it contains the
retired experiment and can recreate deleted material.
