# copyright worklist — snapshot 2026-07-25

State captured immediately **before** retracting the pre-#703 public labels, so
the worklist survives the retraction. Negating a label causes
`sync_copyright_resolutions` to clear `is_flagged` for that URI (`tasks/copyright.py`,
#1615), so the review queue itself cannot be trusted to remember these after the
retraction lands. `copyright_scans.matches` is untouched either way — this file
preserves queue *membership*, not evidence.

## why these labels are being retracted

The 2026-01-02 legal review concluded that public "potential violation" labels
we have not acted on create knowledge without action, which is the wrong side of
safe harbor. `df0c0dae` (#703) stopped *emitting* new ones but never retracted
the existing ones, so ten signed labels stayed publicly queryable via
`com.atproto.label.queryLabels` — no auth required — for roughly seven months.

Retraction is the interim step. Re-application happens through the enforcement
pipeline once a label actually does something.

## tracks with active public `copyright-violation` labels (retracted)

| track | title | visibility | matches | first labeled |
|---|---|---|---|---|
| 55 | Up The Mountain | public | 23 | 2025-12 |
| 58 | not a rickroll | public | 36 | 2025-12 |
| 94 | acoustic guitar cover of vodka cranberry (one take) | public | 20 | 2025-12 |
| 103 | mid 123 | public | 22 | 2025-12 |
| 117 | KMC - I Feel So Fine (infyplay Remix) V3 | public | 42 | 2025-12 |
| 120 | Exostate - Without Warning (infyplay remix) v2 | public | 53 | 2025-12 |
| 155 | 03 Hangover | public | 3 | 2025-12 |
| 157 | 05 Las Vegas Dealer | public | 3 | 2025-12 |
| 239 | 09 Green Bud On The Flower | public | 15 | 2025-12 |
| 260 | 06 Southern Flavor | public | 23 | 2025-12 |

## flagged internally, never labeled

These carry `copyright_scans.is_flagged` with no label, so the retraction does
not touch them. They remain in the review queue.

| track | title | visibility | matches | scanned |
|---|---|---|---|---|
| 64 | Free everyone, fuck the state, life finds a way. | public | 249 | 2026-07-23 |
| 1098 | The Ballad of Hollis Brown | public | 165 | 2026-07-03 |
| 1173 | Here | public | 1 | 2026-07-12 |

Track 64 is the subject of user report #5 (@vicwalker.dev.br, 2026-07-23) — the
first genuine user report on the platform. `highest_score = 0` with 249 matches
is #1689's mix detection working correctly: no single song dominates a mix, so
the per-song score stays 0 while the sustained-song count trips the flag.

## triage note

Several entries read like covers, remixes, or jokes rather than infringement
("acoustic guitar cover of…", "not a rickroll", two tracks self-labeled
"(infyplay remix)"). Re-application must not treat a fingerprint match as a
finding — a cover the uploader performed is a match and not a violation.

## explicitly not done here

No uploader was notified. Notifying people about flags from December because a
pipeline was built in July would be a bug, not a feature. Any future
notification must fire on new events only, never on backfill.
