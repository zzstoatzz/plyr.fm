# working on the next client

How to change `next/app` so the next person, or agent, can build on it. The
rules of the system are in [next/AGENTS.md](../../AGENTS.md) and the client's
boundaries in [next/app/AGENTS.md](../AGENTS.md); this folder holds what those
link to.

- [pitfalls.md](pitfalls.md): things that cost real debugging time. Read it
  before a change; add a line when something bites.
- [decisions.md](decisions.md): what is settled for the client. Reviews never
  re-raise a settled item.
- [checks.md](checks.md): every kind of check, what it needs, and how to run
  only the ones a change reaches.

## the loop

Write with the `next-write-ui` skill, finish with `next-unslop`, review with
`next-review` before asking a person to look. They live in
[.agents/skills](../../../.agents/skills/) and are plain Markdown, so any
harness can follow them.

```sh
npm run lint                    # the conventions below
npm run check                   # tsc
npm test                        # model tests in tests/
npm run build:web               # the web export the browser checks load
npm run checks:affected         # the browser checks this branch reaches
```

## lint

`npm run lint` runs [scripts/check-code.mjs](../scripts/check-code.mjs). Every
new convention lands with its rule. A file that breaks a rule for a reason
goes in [scripts/lint-exemptions.json](../scripts/lint-exemptions.json) with
that reason; delete the entry once the file is fixed, and lint fails on an
entry whose file is gone.

| rule | what it keeps true | fix |
| --- | --- | --- |
| `route-boundaries` | files in `app/` don't import `pds`, `jam-connection` or a storage module | move the call into a feature module or hook in `src/` |
| `platform-seams` | shared code doesn't touch `document`, `window`, `navigator` or web storage, and never imports a `.web`/`.ios`/`.native` path | put it in `name.web.ts` beside `name.ts` and import `./name` |
| `seam-exports` | `name.web.ts(x)` and its sibling export the same names | keep both contracts aligned |
| `hand-rolled-roles` | tab, combobox, listbox, slider, dialog, menu and similar roles come from one shared control | reuse it, or add the behavior under `src/behaviors/` with its tests |
| `comment-length` | comment blocks stay at three lines or fewer | the rationale goes in the PR or a doc |
| `browser-checks` | every `scripts/check-*.cjs` is listed in `scripts/checks.mjs` with what it covers | add its entry |
