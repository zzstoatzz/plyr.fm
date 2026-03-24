---
description: Review PR feedback and address comments
argument-hint: [PR number, optional]
---

# consider review

check PR feedback and address it.

## process

1. **find the PR**
   - if number provided: use it
   - otherwise: `gh pr view --json number,title,url`

2. **gather all feedback** in parallel:
   ```bash
   # top-level review comments
   gh pr view NNN --comments

   # inline code review comments
   gh api repos/zzstoatzz/plyr.fm/pulls/NNN/comments --jq '.[] | {path: .path, line: .line, body: .body, author: .user.login}'

   # review status
   gh pr view NNN --json reviews --jq '.reviews[] | {author: .author.login, state: .state, body: .body}'
   ```

3. **summarize feedback**:
   - blocking issues (changes requested)
   - suggestions (nice to have)
   - questions needing response

4. **for each item**:
   - if code change needed: make the fix
   - if clarification needed: draft a response
   - if disagreement: explain your reasoning

5. **report** what you addressed and what needs discussion
