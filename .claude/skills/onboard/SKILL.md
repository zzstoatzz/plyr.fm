---
description: get up to speed on the project quickly
---

# onboard

get up to speed on the project quickly.

## read, in this order

1. **CLAUDE.md** — rules, stack, structure (auto-loaded, but honor it)
2. **STATUS.md** — vision, recent work, current focus, known issues. deep history lives in `.status_history/`
3. **memory** — the session memory index is auto-loaded; it holds what the repo doesn't (people, credentials-adjacent facts, recurring failure modes)
4. `git log --oneline -15` and `git status` — what's moving and any work in progress
5. `gh issue list` — open priorities
6. `docs/internal/` — the organized knowledge base, when a subsystem comes up

## how work happens here

- features and fixes follow the `change` skill: branch → build with tests → real-browser verify (`ui-check` for UI) → PR → `self-review` → merge (= staging) → nate reviews → promote via `deploy`
- merging to `main` deploys **staging**; production is a separate, nate-approved promote. "shipped" means production
- the queue of other skills (`check-spans`, `status-update`, `toast-copy`, …) is listed per-session; reach for them before improvising

## then

propose the next best step from current focus, known issues, or in-progress work. present the recommendation and confirm before proceeding.

## tone

- action-oriented and specific
- concisely curious about existing decisions and trade-offs (don't assume, ask)
