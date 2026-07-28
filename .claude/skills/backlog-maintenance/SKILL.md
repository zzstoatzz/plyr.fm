---
description: Triage open issues — merge duplicate clusters, sharpen partly-shipped issues, move open-ended exploration to discussions, propose stale closes and `good first issue` labels
---

# backlog maintenance

a triage pass over open issues. you propose, the user decides. you never apply labels or close anything without explicit approval — these are public-facing actions on a public repo.

**a backlog gets big in four different ways, and each needs a different move:**

| symptom | move |
|---|---|
| N issues describing one decision | **merge** into a survivor |
| issue is mostly shipped already | **sharpen** to what's left |
| open-ended "explore X", no acceptance criteria | **move to a discussion** |
| genuinely stale or superseded | **close** with a reason |

most of the size is usually the first three, not the fourth. reaching only for "close" makes the list shorter without making it truer.

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

4. **verify against the code before claiming anything shipped or duplicated.** this is the step that is easiest to skip and most expensive to get wrong. titles and bodies describe the repo *as it was when filed*. grep the actual call site:

   ```bash
   # the issue says the album page discards the rest of the album — is that still true?
   grep -n "playNow\|playCollectionFrom" "frontend/src/routes/u/[handle]/album/[slug]/+page.svelte"
   ```

   in a single recent pass this turned up two issues already fixed by later work
   (#1344 and #1446, both resolved by #1626 months after filing) and one pair that
   looked like a clean duplicate from the titles and was not. **an issue's age is not
   evidence it is stale, and an issue's title is not evidence it is live.**

5. **categorize and present a triage list** — see categories below.

6. **wait for approval** on each bucket. don't bundle "label these AND close these" into one ask. let the user veto per-item.

7. **execute approved actions**:
   ```bash
   # add label
   gh issue edit NNN --repo zzstoatzz/plyr.fm --add-label "good first issue"

   # close with comment + reason
   gh issue close NNN --repo zzstoatzz/plyr.fm \
     --comment "closing — [reason]" --reason completed

   # merge: fold the loser's body into the survivor FIRST, then close
   gh issue view LOSER --json body --jq .body > /tmp/loser.md
   gh issue view SURVIVOR --json body --jq .body > /tmp/survivor.md
   # assemble /tmp/merged.md = survivor + "## <second failure mode> (was #LOSER)" + loser
   gh issue edit SURVIVOR --title "..." --body-file /tmp/merged.md
   gh issue close LOSER --reason "not planned" --comment "Merging into #SURVIVOR. [why they are one thing]. Full body preserved in #SURVIVOR."
   ```

## merging duplicate clusters

**spotting a cluster.** the signals, roughly in order of reliability:

- explicit parent/child (`child of #N` in the body)
- filed the same day, by the same person, in the same area — one thinking session split across several issues
- the bodies name the same root cause even though the titles name different symptoms
- they already cross-reference each other

**choosing the survivor.** prefer the lower number (it holds the earliest discussion
and any inbound links), unless a higher one has substantially more context or comments.
retitle the survivor so it covers the merged scope — leaving the old narrow title makes
the merged content look like scope creep.

**a merge must not lose a single sentence.** copy the closed issue's body into the
survivor under a heading that names what it adds, *before* closing it. the closing
comment then says where the content went. an issue closed as "duplicate" with its
content nowhere is a deletion, and the person who wrote it will notice.

**always write down why they are one issue.** if you can't articulate a shared root
cause in a sentence, they are siblings, not duplicates — leave them alone.

### when NOT to merge

**different cost is a reason to keep issues separate, even for one feature.** the
canonical trap: #620 (iOS share extension — a native app, App Store, weeks) and #1520
(Android share target — a manifest entry and a route handler, ships in a day). Same
user-facing feature, two platforms, already cross-referencing each other. merging them
buries a one-day win inside a native-app epic, and it will not come back out.

also don't merge:

- when the fixes live in different subsystems and would be different PRs
- when one is a settled bug and the other needs an unmade product decision
- when one is already fixed — that's a **close**, not a merge (verify first, per step 4)

**split a proposed merge when the root causes differ.** four issues that all say "R2"
were really two pairs: two about `PUT /tracks/{id}/audio` not being transactional
(#1314, #1315) and two about nothing owning "the object this row points at exists and
is current" (#1367, #1368). merging all four into one would have produced an issue
nobody could act on. two merges, two actionable issues.

## sharpening a partly-shipped issue

the most common wrong state in an old backlog: an issue where 70% shipped and nobody
updated it, so it still reads as entirely undone.

closing it is wrong (the remainder is real). leaving it is wrong (it overstates the
work and hides a small task inside a big-sounding one). instead **append a status
section and retitle to the remainder**:

- list what shipped, with PR numbers and the file/symbol that proves it
- state what is left, in one line
- if the remainder was *deliberately* deferred, say why — that reasoning is usually the
  hardest part to reconstruct later

e.g. "Feature Request: Loop and Shuffle" became "playback: repeat-all mode (loop and
shuffle shipped)" once verified that shuffle exists in `queue.svelte.ts` and
`RepeatMode` is `'none' | 'one'`. the remaining work isn't the state change, it's the
undecided product question about what repeat-all loops over when the queue can extend
itself.

## moving exploration to discussions

**issues are for work; discussions are for questions.** an "explore X" issue with no
acceptance criteria will never be closed by doing it, so it accumulates forever and
makes the backlog look like a workload.

good candidates: a link dump with no proposal; "should we adopt X?"; anything blocked
on ecosystem convergence rather than on us; anything where the honest answer to "what
would make this decidable?" is "someone else doing something."

**group by theme, not one-per-issue.** several thin discussions are worse than the
issues were. check the existing discussions first — repos develop a house style, and
this one favours a few substantive threads.

check the category IDs before creating:

```bash
gh api graphql -f query='{repository(owner:"zzstoatzz",name:"plyr.fm"){
  id hasDiscussionsEnabled
  discussionCategories(first:20){nodes{id name}}
  discussions(first:10){totalCount nodes{number title}}}}'
```

each discussion should: summarize each issue faithfully (read the bodies — do not
summarize from titles), say plainly what the open question is, and end with **"what
would make this decidable"**. that last section is the point; without it you have moved
the vagueness rather than named it.

**keep the issues open unless the user says otherwise**, and comment on each with a
link to the discussion so the pairing is navigable from both sides.

## the `good first issue` bar is STRICT

small scope and a good spec are NOT enough — a new contributor (no prior context on the codebase, no creds) has to be able to pick it up and finish it without async help. **disqualifiers** (any one is fatal):

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
- anything filed by someone outside the project, unless it verifiably shipped — an outside issue closed as stale reads as "we don't want your input", and that cost is much higher than one extra row in the list

## output format

present three buckets clearly separated. for each item: number, title, one-line rationale.

```
## propose merge (N clusters, −M issues)
- #SURVIVOR ← #A, #B — [the one root cause, in a sentence]

## propose sharpen (N)
- #NNNN [title] → [new title] — [what shipped, what remains]

## propose move to discussion (N issues → M threads)
- "[thread title]" ← #A, #B — [the open question]

## propose close (N)
- #NNNN [title] — [already fixed by #M, verified at file:line | link dump | superseded by #M]

## proposed `good first issue` labels (N)
- #NNNN [title] — [why it passes the bar, what existing pattern to follow]

## leave open, no change (N)
- bucketed by reason: epics / architectural / labeled backlog / recent / etc.
```

put a count on each bucket and a net issue delta at the top. the user is doing this
because the number is too big; show them what the number becomes.

then explicitly ask which of the three buckets the user wants to act on. don't lead with "should I do all of these?" — let them pick per-item.

## anti-patterns

- proposing good-first labels because the diff would be small (a one-line fix in the player state machine is NOT good-first)
- closing issues without a comment explaining why (closes look unfriendly without context)
- inventing new labels — use what exists
- batching too many actions into one approval ("label these 6 and close these 4 and comment on these 3" gives the user no fine-grained veto)
- applying any label or close before the user signs off
- **merging on title similarity without reading both bodies** — the titles are the least reliable thing on an issue
- closing something as shipped without having looked at the code that supposedly ships it
- merging a cheap issue into an expensive one (see "when NOT to merge")
- letting a merge drop content — if the survivor doesn't contain it, the merge deleted it
- summarizing an issue into a discussion from its title; read the body, or the discussion misrepresents someone's idea
- treating an outside contributor's issue like internal cleanup. if a community member filed it and it shipped, close it with a thank-you and name the PR — they gave you a bug report for free
