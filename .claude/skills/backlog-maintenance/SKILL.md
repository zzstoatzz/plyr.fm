---
description: Triage open issues — propose closes for stale link-dumps, propose `good first issue` labels under a strict bar
---

# backlog maintenance

a triage pass over open issues. you propose, the user decides. you never apply labels or close anything without explicit approval — these are public-facing actions on a public repo.

## process

1. **check what labels already exist** before suggesting any:
   ```bash
   gh label list --repo zzstoatzz/plyr.fm --limit 50
   ```
   use existing labels, don't invent new ones.

2. **pull the open issues** with metadata only (no comment bodies — they explode the output):
   ```bash
   gh issue list --repo zzstoatzz/plyr.fm --state open --limit 200 \
     --json number,title,createdAt,updatedAt,labels \
     --jq '.[] | "\(.number)\t\(.createdAt[:10])\t\(.updatedAt[:10])\t[\(.labels | map(.name) | join(","))]\t\(.title)"' \
     | sort -t$'\t' -k2 > /tmp/plyr-issues.txt
   ```

3. **batch-read bodies** of candidate issues. don't read all 50 — pick from titles first, then read:
   ```bash
   for n in 1352 1351 334; do
     echo "=== #$n ==="
     gh issue view $n --repo zzstoatzz/plyr.fm \
       --json title,body,comments \
       --jq '"TITLE: \(.title)\nCOMMENTS: \(.comments | length)\nBODY:\n\(.body[:600])\n"'
   done
   ```

4. **categorize and present a triage list** — see categories below.

5. **wait for approval** on each bucket. don't bundle "label these AND close these" into one ask. let the user veto per-item.

6. **execute approved actions**:
   ```bash
   # add label
   gh issue edit NNN --repo zzstoatzz/plyr.fm --add-label "good first issue"

   # close with comment + reason
   gh issue close NNN --repo zzstoatzz/plyr.fm \
     --comment "closing — [reason]" --reason completed
   ```

## the `good first issue` bar is STRICT

see `feedback_good_first_issue_criteria.md` in memory. small scope and a good spec are NOT enough. **disqualifiers** (any one is fatal):

- touches deep stateful subsystems — player, queue, BroadcastChannel, auth, OAuth, PDS sync
- requires credentials a stranger doesn't have — prod DB, R2, CF API, Modal, Logfire write tokens
- requires product / UX judgment that isn't settled — "should it auto-queue?", "should you be able to like a collection?"
- blocked on an upstream PR or external decision
- is "an annoying state issue" — those need codebase fluency to debug
- requires understanding how multiple subsystems interact

**qualifiers** (need at least one, plus zero disqualifiers):

- doc fixes, typos, copy changes where the new text is given
- isolated visual polish where the design is given
- follows an existing pattern with one clear acceptance test ("do X for Y the same way #N did it for Z")
- additive helpers in a leaf module with no callers to worry about
- a refactor where the contract is "same look, same behavior, one component" and a reference implementation already exists in the repo

**when an issue has phases or multiple call sites:** label it good-first AND post a comment scoping the first PR. without the scoping, the issue is a trap, not a ramp. for example, "extract `BottomSheet.svelte` and migrate ONE sheet (`AudioRevisionsSheet`); the other four can land in follow-ups."

**if zero candidates exist, say so.** don't stretch the bar to manufacture a list. better to tell the user "no candidates right now" than to mislabel and have strangers get stuck.

## the stale-close bar

close candidates are issues that:

- are a link dump with no concrete proposal or acceptance criteria
- describe an exploration that has since concluded (check git history / merged PRs / owner comments for resolution signal)
- are superseded by another issue or shipped work — link the supersession
- depend on a tool / library that since shipped — the user's own comments are a strong signal here

**don't close** issues that are:

- valid product backlog with a concrete plan, even if dormant for months
- epics tracking long-arc work (#1384, #907, etc.)
- labeled `backlog` — that's the explicit "deferred, on purpose" state

**before closing, check for a "done" signal**:

- did the owner leave a comment indicating the underlying tool / decision is settled?
- is there a merged PR that addressed it?
- has it been superseded by a more recent issue?

## what to leave alone

- recent issues (< 30 days) with no obvious stale signal — they're load-bearing context
- anything labeled `backlog` — the user deliberately deferred those
- epics, security tickets, architectural discussions — these stay open until they ship or are explicitly killed
- moderation / legal items (e.g. anything `liability` flagged) — never close without the user's call

## output format

present three buckets clearly separated. for each item: number, title, one-line rationale.

```
## proposed `good first issue` labels (N)
- #NNNN [title] — [why it passes the bar, what existing pattern to follow]

## propose close as stale / superseded (N)
- #NNNN [title] — [link dump | superseded by #M | resolved by shipped tool X]

## leave open, no change (N)
- bucketed by reason: epics / architectural / labeled backlog / recent / etc.
```

then explicitly ask which of the three buckets the user wants to act on. don't lead with "should I do all of these?" — let them pick per-item.

## anti-patterns

- proposing good-first labels because the diff would be small (a one-line fix in the player state machine is NOT good-first)
- closing issues without a comment explaining why (closes look unfriendly without context)
- inventing new labels — use what exists
- batching too many actions into one approval ("label these 6 and close these 4 and comment on these 3" gives the user no fine-grained veto)
- applying any label or close before the user signs off
