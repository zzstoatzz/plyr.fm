# contributing to plyr.fm

thanks for considering it. plyr.fm is a small project maintained in spare time, so a few notes up front will save us both effort.

development is canonical on [github](https://github.com/zzstoatzz/plyr.fm); the [tangled mirror](https://tangled.org/zzstoatzz.io/plyr.fm) is read-only for code — issues and PRs land on github.

setup, prerequisites, and `just` commands live in the **[public contributing guide](https://docs.plyr.fm/contributing/)** — this file is just the social/process side.

## i want to...

### ...fix a bug or make a small change

open a PR. small, focused PRs are the easiest thing to merge.

### ...add a feature or make a larger change

[open an issue](https://github.com/zzstoatzz/plyr.fm/issues) first to scope it. unsolicited large PRs tend to stall while we figure out whether the change fits the project's direction. [`STATUS.md`](STATUS.md) lists current priorities and known issues — start there.

### ...report a bug

[file an issue](https://github.com/zzstoatzz/plyr.fm/issues/new) with steps to reproduce, what you expected, what happened, and your environment. screenshots, console errors, and network logs help. search closed issues first — it might already be fixed.

### ...ask a question

open an issue or comment on a related one.

## pull request rules

- branch from `main`; the main branch is protected, so PRs are the only way changes land
- one logical change per PR — split unrelated work
- include a regression test when fixing a bug
- run `just backend lint` and `just frontend check` before opening
- explain *why* in the description, not just *what* — the diff already shows the what
- mark drafts as drafts; only flip to ready when you've tested it

## ai-assisted contributions

generated code is welcome, but you have to be able to explain what your change does and why it works. specifically:

- don't ask maintainers to review what you don't understand
- test it manually — for UI work, attach a screenshot or recording
- note in the PR description that the change was AI-assisted and which tool you used (the auto-attribution is fine)

if you're using claude code, cursor, codex, or similar, the [`contribute` skill](.claude/skills/contribute/SKILL.md) gets your agent oriented quickly.

## code conventions

- **type hints** required (python and typescript)
- **async everywhere** in the backend — never block the event loop
- **lowercase aesthetic** in naming, docs, and commits — match the existing voice
- **svelte 5 runes** (`$state`, `$derived`, `$effect`), not legacy stores
- `uv` for python, `bun` for the frontend, `just` as the task runner

when in doubt, the existing code is the source of truth. [`CLAUDE.md`](CLAUDE.md) at the repo root spells out the full set of project rules.
