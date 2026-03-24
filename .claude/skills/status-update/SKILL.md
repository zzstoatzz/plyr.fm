# status update

update STATUS.md to reflect recent work.

## workflow

### 1. understand current state

read STATUS.md to understand:
- what's already documented in `## recent work`
- the last update date (noted at the bottom)
- current priorities and known issues

### 2. find undocumented work

```bash
# find the last STATUS.md update
git log --oneline -1 -- STATUS.md

# get all commits since then
git log --oneline <last-status-commit>..HEAD
```

for each significant commit or PR:
- read the commit message and changed files
- understand WHY the change was made, not just what changed
- note architectural decisions, trade-offs, or lessons learned

### 3. decide what to document

not everything needs documentation. focus on:
- **features**: new capabilities users or developers can use
- **fixes**: bugs that affected users, especially if they might recur
- **architecture**: changes to how systems connect or data flows
- **decisions**: trade-offs made and why (future readers need context)
- **incidents**: what broke, why, and how it was resolved

skip:
- routine maintenance (dependency bumps, typo fixes)
- work-in-progress that didn't ship
- changes already well-documented in the PR

### 4. write the update

add a new subsection under `## recent work` following existing patterns:

```markdown
#### brief title (PRs #NNN, date)

**why**: the problem or motivation (1-2 sentences)

**what shipped**:
- concrete changes users or developers will notice
- link to relevant docs if applicable

**technical notes** (if architectural):
- decisions made and why
- trade-offs accepted
```

### 5. update other sections if needed

- `## priorities` - if focus has shifted
- `## known issues` - if bugs were fixed or discovered
- `## technical state` - if architecture changed

## tone

write for someone with no prior context who needs to understand:
- what changed
- why it matters
- why this approach was chosen over alternatives

be direct and technical. avoid marketing language.

## after updating

commit the STATUS.md changes and open a PR for review.
