---
title: "status maintenance workflow"
---

automated workflow that archives old STATUS.md content and generates audio updates.

## what it does

1. **archives old content**: moves previous month's sections from STATUS.md to `.status_history/YYYY-MM.md`
2. **generates audio**: creates a podcast-style audio update covering recent work
3. **opens PR**: commits changes and opens a PR for review, with the window
   report (what landed where, what was posted) and the podcast transcript in
   the PR body under collapsible sections so both can be read before deciding
   to merge
4. **uploads audio**: after PR merge, uploads the audio to plyr.fm (the
   transcript becomes the track description)

## workflow file

`.github/workflows/status-maintenance.yml`

## triggers

- **weekly**: `schedule` — mondays 14:00 UTC (9am central). the run opens the
  PR; a human merges it, and the merge triggers the audio upload
- **manual**: `workflow_dispatch` (run from Actions tab, or
  `gh workflow run "status maintenance" --ref main`)
- **on PR merge**: uploads audio after status-maintenance PR is merged

github pauses scheduled workflows in repositories with no activity for 60
days; a push re-enables them.

## the window report

a plain workflow step generates `window_report.md` with `scripts/status_window.py`
before Claude starts, and prints it to the job log (also runnable locally: `uv run scripts/status_window.py`, or with
`--since <iso time>`). the report is the run's ground truth:

- **window**: from the merge time of the most recently merged PR whose branch
  starts with `status-maintenance-` until now
- **backend releases**: GitHub releases (timestamp tags) published in the
  window, each with the PRs it carried to production (from the squash subjects
  between consecutive tags)
- **frontend promotes**: Cloudflare Pages production deployments of
  `production-fe` in the window — a `just release-frontend-only` is a bare
  branch push that triggers no GitHub workflow, so Pages is its only record.
  needs `CLOUDFLARE_API_TOKEN` (or `SCRIPT_CF_API_TOKEN` with Pages read)
  and `CLOUDFLARE_ACCOUNT_ID`; without them the section says so and the
  frontend rows below fall back to "promote unknown"
- **PRs merged in the window** with a `landed` column: `prod via release
  <tag>`, `prod via frontend promote <time>`, `staging only`, or `docs only`.
  a PR is classified by its files (`backend/`, `scripts/`, `services/` →
  needs a release; `frontend/` only → a promote or a release, whichever came
  first); landing is decided by `git tag --contains` and
  `git merge-base --is-ancestor` against the promoted commits
- **public posts** in the window from the plyr.fm account, and from
  zzstoatzz.io where the post mentions plyr, read from the public AppView
  without auth
- **project scope**: first commit, release count, STATUS.md line count, the
  months still carrying detail, and the arcs archived in `.status_history/`
  (titles for the newest three months, counts for the rest)

the report goes into the maintenance PR body above the transcript, so a
reviewer can check every "shipped" against where it actually landed.

## ecosystem context

changes in plyr.fm are usually precipitated by changes in the atmosphere that
appear first as long-form writing. a **research step** — its own
claude-code-action invocation, run before the writer so it always finishes
first — has the `pub-search` MCP server (`.github/mcp/status-maintenance.json`,
public endpoint, no auth). it seeds 3–6 topics from the window report and
STATUS.md's current focus, searches each with `since` = the window start
(keyword) and without it for background (hybrid), one call at a time with a
retry on 502 (the index is a small shared service and a parallel burst made
it 502 on a quarter of calls), reads the top hits with `get_document`, and
writes `ecosystem_context.md`: only the documents that bear on a specific
change in the window or an item in current focus, grouped by that change,
with title, publication, date, URL and two sentences on the relation, at most
~12 in all, citing only what it read. the file holds findings and nothing
else — no seed list, no method notes, nothing about discarded hits or empty
topics — because telling the writer what to ignore plants it. the writer uses it like the posts: one
clause where a change responds to something written, never a segment. the
file is posted into the PR body so the reviewer can judge what was found.

it was first built as a Task subagent inside the writer's run; the agent ran
in the background, the writer ended its turn "waiting" for it, and the
session closed with nothing written (run 33936254221). the separate step is
the fix.

## run outputs

every run (not just one that opens a PR) writes `window_report.md`,
`ecosystem_context.md` and `podcast_script.txt` to the job summary and, with
`claude-execution.json` and `claude-research-execution.json` (the full Claude
transcripts of the writer and the research step: every tool call and result),
to an artifact `status-run-outputs-<run id>`, so a run that judged "no maintenance
needed" can still be read: `gh run download <run id> --name status-run-outputs-<run id>`.

## model

the model is set once, as the workflow-level `STATUS_MODEL` env
(`claude-opus-5` today), resolved with the optional `model` dispatch input
into `MODEL`, passed to `--model` for both Claude steps, and printed into the
PR body ("written by …") so every maintenance PR says which model wrote it.

### what the prompt does with it

the subject of the episode and of the STATUS.md edits is the diff — what
changed in the window. the releases, promotes, posts and archived arcs are
context: "shipped" is reserved for rows landed in production and names the
date; merged-but-not-promoted work is "on staging"; an announcement gets one
clause, an unannounced significant change gets one sentence; the archive
places the window in the project's history in a phrase, not a recap. if
STATUS.md disagrees with the report about what is in production, the run
corrects STATUS.md.

## archival rules

**line count targets**:
- ideal: ~200 lines
- acceptable: 300-450 lines
- maximum: 500 lines (must not exceed)

**what gets archived**:
- content from months BEFORE the current month
- if today is January 2026, December 2025 sections move to `.status_history/2025-12.md`

**how archival works**:
1. CUT the full section from STATUS.md (headers, bullets, everything)
2. APPEND to the appropriate `.status_history/YYYY-MM.md` file
3. REPLACE in STATUS.md with a brief cross-reference

archival means MOVING content, not summarizing. the detailed write-ups are preserved in the archive.

## audio generation

### pronunciation

the project name is pronounced "player FM". in scripts, write:
- "player FM" or "player dot FM"
- never "plyr.fm" or "plyr" (TTS mispronounces it)

### terminology

plyr.fm operates at the ATProto protocol layer:
- say "atmosphere accounts" or just "accounts"
- never "Bluesky accounts"

Bluesky is one application on the Atmosphere, like plyr.fm is another.

### tone

dry, matter-of-fact, slightly sardonic. avoid:
- "exciting", "amazing", "incredible"
- over-congratulating or sensationalizing

### script structure

1. opening (10s): date range, focus
2. main story (60-90s): biggest feature, design decisions
3. secondary feature (30-45s): if applicable
4. rapid fire (20-30s): smaller changes
5. closing (10s): wrap up

## inputs

| input | type | default | description |
|-------|------|---------|-------------|
| `skip_audio` | boolean | false | skip audio generation |
| `report_only` | boolean | false | print the window report to the job log and stop — no Claude run, no PR |
| `window_since` | string | "" | override the window start (ISO time) for reruns and for evaluating the process against a past window; the prompt then covers that window even if STATUS.md already documents it |
| `research_only` | boolean | false | stop after the ecosystem research — no writer, no PR; read `ecosystem_context.md` from the job summary or the run artifact |
| `model` | string | "" | model for this run only; empty means `STATUS_MODEL` from the workflow env |

## secrets required

| secret | purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | claude code |
| `GOOGLE_API_KEY` | gemini TTS |
| `PLYR_BOT_TOKEN` | plyr.fm upload |
| — | pub-search needs no secret; its MCP endpoint is public |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Pages deployment history for the frontend promotes in the window report |

## manual run

```bash
gh workflow run "status maintenance" --ref main
```

with skip_audio:
```bash
gh workflow run "status maintenance" --ref main -f skip_audio=true
```

## troubleshooting

### workflow sees wrong time window

check which PR it's using as the baseline:

```bash
gh pr list --state merged --search "status-maintenance" --limit 5 \
  --json number,title,mergedAt,headRefName
```

if a reverted PR is polluting the results, add a temporary exclusion.

### audio has wrong terminology

check the terminology section in the workflow prompt. common mistakes:
- "Bluesky accounts" should be "atmosphere accounts"
- "plyr" should be "player FM" (phonetic)

### STATUS.md over 500 lines

the archival step should handle this, but verify:
- december content should be in `.status_history/2025-12.md`
- only current month content stays in STATUS.md
