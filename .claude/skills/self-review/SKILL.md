---
name: self-review
description: Review a plyr.fm pull request the way an independent reviewer would — correctness, the project's norms, and its recurring failure modes — before asking a human to look. Use after opening any PR, or when asked to review one (by number or the current branch).
metadata:
  author: zzstoatzz
---

# self-review

Read the whole diff as someone who didn't write it: `gh pr diff NNN` (or `git diff main...HEAD`), plus the PR body. Then check, in this order.

## 1. does it do what was asked — no more, no less
- the user's ask, verbatim, against what the diff delivers. scope quietly narrowed or widened is a finding.
- every behavior the PR body claims exists in the diff; every non-behavior it claims is true.

## 2. correctness
- trace the main path and the failure paths by hand. an error that becomes a 500 where a 4xx was meant, a refusal swallowed, a partial write with no rollback.
- concurrency and ordering: anything that runs after a redirect, a deploy, an await on a slow network — what happens if the world changed meanwhile?
- data: a write to a user's PDS or a row rewrite on their behalf needs explicit user consent, not a stored token. flag it.

## 3. the tests actually test it
- a regression test must exercise the **real path** (drive the endpoint / mount the real component, mock only the network boundary) and must **fail on the pre-fix code** — stash the fix and run it once to prove that.
- no tests of what the type system already enforces.
- frontend tests exist for pure logic and mounted components; e2e (`frontend/e2e/*.mjs`) for anything needing a real PDS.

## 4. the repo's rules (the ones that get missed)
- no paragraph comments; one short line only when genuinely non-obvious. rationale goes in the PR body / STATUS.md / docs.
- no deferred imports except for circular-import breaks.
- `loq` limits: `just loq-relax <file>`, never hand-edit `loq.toml` or golf lines.
- never revert formatter output.
- copy: lowercase voice, outcome not mechanism, no protocol vocabulary in user-facing strings, no promises the system doesn't keep (times, guarantees). toasts ≤10 words (`toast-copy` skill).
- frontend: no `localStorage` for auth; per-user prefs from the account-scoped store; `redirectToLogin()` helpers, never `goto('/login')`; `$effect` that reads and writes the same state needs `untrack`.
- new routes/routers are a product-surface decision — confirm they were asked for.

## 5. verification claims
- "verified on staging" means the user-facing surface was rendered and measured, not that an API returned 200.
- anything slow or failing in CI was diagnosed (telemetry, logs) — not labeled flaky and retried.
- the PR body follows the repo shape: one-or-two-sentence punchline, minutiae under `<details>`, intentional non-behaviors listed.

## output
Findings most severe first, each with `file:line`, what breaks, and the fix. Fix everything you found yourself in the same PR, then say what you changed. If nothing survives, say so plainly and what you checked.
