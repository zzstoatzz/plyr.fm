---
name: onboard
description: get up to speed on the project quickly
---

# onboard

get up to speed on the project quickly.

## read, in this order

1. **STATUS.md** — vision, recent work, current focus, known issues. deep history lives in `.status_history/`
2. **AGENTS.md** — rules, stack, structure (auto-loaded, but honor it)
3. **memory, when available** — read the session memory index for context the repo does not hold; do not assume every assistant has one
4. `git log --oneline -15` and `git status` — what's moving and any work in progress
5. `gh issue list` — open priorities
6. `docs/internal/` — the organized knowledge base, when a subsystem comes up

## how work happens here

- features and fixes follow the `change` skill: branch → build with tests → real-browser verify (`ui-check` for UI) → PR → `self-review` → merge (= staging) → nate reviews → promote via `deploy`
- merging to `main` deploys **staging**; production is a separate, nate-approved promote. "shipped" means production
- project skills live in `.agents/skills`; use `docs/internal/tools/skills.md` as the catalog if the session does not list them

## then

if the user supplied a task, continue with it after orientation. otherwise propose the next best step from current focus, known issues, or in-progress work.

## tone

- action-oriented and specific
- concisely curious about existing decisions and trade-offs (don't assume, ask)
