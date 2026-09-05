---
name: change
description: Deliver a feature or bug fix to plyr.fm end to end — branch, implement with tests, PR, self-review, merge to main (which deploys staging), and hand off for the production promote. Use whenever the user asks for a feature, a fix, a UX change, or says "open a PR for this".
metadata:
  author: zzstoatzz
---

# change

The path every change takes. Staging is `main`; production is a separate, user-approved promote.

1. **orient** — `AGENTS.md`, `STATUS.md`, and the code you'll touch (`onboard` if fresh). note: `contribute` is the external-contributor fork guide, not this flow. If the ask is ambiguous in a way that changes the work, ask once, with a recommendation. Otherwise decide and say what you assumed.
2. **branch** — `feat/…`, `fix/…`, `docs/…` from `main`.
3. **build** — smallest change that does the whole ask. Bug fixes get a regression test that fails pre-fix. UX changes get verified in a real browser on the sizes that matter, not by a green API call — load the `ui-check` skill for the matrix (widths × themes × states) and the standard of looking. toasts follow `toast-copy`.
4. **validate** — `just backend lint && just backend test` / `bun run check && bun run lint && bun run test` in `frontend/`. The whole suite passes, no flags, no skips.
5. **PR** — punchline first, `<details>` for the rest, intentional non-behaviors named. Bodies are read by reviewers and agents; be thorough, not long.
6. **self-review** — run the `self-review` skill on the PR and fix what it finds in the same PR. (An automated reviewer will take this step over eventually.)
7. **merge** — when checks are green, squash-merge. That deploys **staging** (`stg.plyr.fm`). Don't merge a backend PR while a sibling PR's staging e2e is mid-run — the deploy restarts staging under it.
8. **hand off** — tell the user what to look at on staging. Production is their call: when they say so, run the `deploy` skill. Never `just release` on your own.

Visual changes always pause at step 8 for the user's eyes. Non-visual bug fixes may be promoted when the user has said that's fine for this kind of change.
