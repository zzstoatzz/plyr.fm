# status maintenance workflow

automated workflow that archives old STATUS.md content and generates audio updates.

## what it does

1. **archives old content**: moves previous month's sections from STATUS.md to `.status_history/YYYY-MM.md`
2. **generates audio**: creates a podcast-style audio update covering recent work
3. **opens PR**: commits changes and opens a PR for review
4. **uploads audio**: after PR merge, uploads the audio to plyr.fm

## workflow file

`.github/workflows/status-maintenance.yml`

## triggers

- **manual**: `workflow_dispatch` (run from Actions tab)
- **on PR merge**: uploads audio after status-maintenance PR is merged

schedule is currently disabled but can be enabled for weekly runs.

## how it determines the time window

the workflow finds the most recently merged PR with a branch starting with `status-maintenance-`:

```bash
gh pr list --state merged --search "status-maintenance" --limit 20 \
  --json number,title,mergedAt,headRefName | \
  jq '[.[] | select(.headRefName | startswith("status-maintenance-"))] | sort_by(.mergedAt) | reverse | .[0]'
```

everything merged since that date is considered "new work" for the audio script.

### handling reverted PRs

if a status-maintenance PR is merged then reverted, it still appears as "merged" in GitHub's API. this can cause the workflow to think there's no new content.

**workaround**: temporarily add an exclusion to the jq filter:

```bash
| select(.number != 724)  # exclude reverted PR
```

remove the exclusion after the next successful run.

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
- say "ATProto identities" or "identities"
- never "Bluesky accounts"

Bluesky is one application on ATProto, like plyr.fm is another.

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

## secrets required

| secret | purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | claude code |
| `GOOGLE_API_KEY` | gemini TTS |
| `PLYR_BOT_TOKEN` | plyr.fm upload |

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
- "Bluesky accounts" should be "ATProto identities"
- "plyr" should be "player FM" (phonetic)

### STATUS.md over 500 lines

the archival step should handle this, but verify:
- december content should be in `.status_history/2025-12.md`
- only current month content stays in STATUS.md
