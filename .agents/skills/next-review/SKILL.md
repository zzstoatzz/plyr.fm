---
name: next-review
description: Review a change to the next client (next/app) as an independent reviewer — does it do the ask, does it hold on a phone and on native, does it follow next's settled decisions and lint rules, do the checks prove it. Use after opening a next/app PR or when asked to review one. For legacy frontend/ or backend/ PRs use self-review instead.
metadata:
  author: zzstoatzz
---

# next-review

Read the whole diff cold: `gh pr diff NNN` or `git diff origin/main...HEAD`, plus the PR body. Read `next/app/contributing/decisions.md` first. **Never raise a settled decision as a finding**; if the change contradicts one, say that once and stop.

Check, in order:

1. **The ask.** The user's words against the diff. Scope quietly narrowed or widened is a finding.
2. **Isolation.** Nothing under `frontend/`, `backend/`, `services/transcoder` or their workflows changed. Published lexicon shapes are untouched and unknown record fields are preserved.
3. **Phone and native.** Would it hold at 390px with a long title, at large text scale, in light and dark? Does shared code now touch a browser API, or a web-only surface assume native has it? Did anyone look at a render, and say which?
4. **Ownership.** Route files compose; transport stays in `api.ts` / `pds.ts`; playback and queue state stay with their owners; credentials stay in the auth adapters.
5. **Interaction.** Every control has a unique spoken name. Keyboard works where a person expects it (Escape closes, focus returns, arrows move within tabs or lists). A role from `hand-rolled-roles` belongs in `src/behaviors/`, not inline.
6. **Proof.** `npm run lint`, `check`, `test`, `build:web` pass. The browser checks `npm run checks:affected` lists were run, or the PR says why not. A new check fails without the change and asserts what the user sees.
7. **Exemptions.** A new entry in `scripts/lint-exemptions.json` has a real reason; a fixed file had its entry removed.
8. **Docs.** A pitfall found while doing the work is in `pitfalls.md`; a decision this PR settles is in `decisions.md`.

Report findings ranked most severe first, each with the file and line, what breaks, and the fix. Say plainly when there are none.
