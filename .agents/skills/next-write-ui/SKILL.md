---
name: next-write-ui
description: Write or change UI in the next client (next/app, the Expo / React Native app behind next.plyr.fm) the way the project expects — start from the code that already does the job, keep platform code behind seams, render and look on a phone, run the checks the change reaches. Use for any next/app screen, control, interaction or style change.
metadata:
  author: zzstoatzz
---

# next-write-ui

For `next/app` only. Never touch `frontend/`, `backend/` or `services/transcoder` from here; production is not this app.

## before you write

1. Read `next/app/contributing/pitfalls.md` and `decisions.md`. A settled decision is not yours to change in passing: production is the reference for look, phone first, one codebase for web, iOS and Android.
2. Find the file that already does the same job and copy its shape: a screen in `app/` composes; behavior and UI live in `src/`. Search `src/` for the control before writing one. `controls.tsx` (`Action`, `Field`, `Page`, `Copy`, `InlineLink`), `Text`, `ActionRow`, `Sheet`, `CatalogPieces`, `useAppearance` and `onAccent` cover most needs.
3. If the change needs keyboard or ARIA behavior another screen also needs (tabs, a listbox, a reorder handle, a layer that blocks shortcuts), write it once in `src/behaviors/` as pure decision functions with a hook on top, test the decisions in `tests/`, check the rendered result against its WAI-ARIA pattern with `checkPattern` (see `scripts/check-tab-patterns.cjs`), and have both screens use it. `src/behaviors/use-tabs.ts` is the model.

## while you write

- Styles come from `useAppearance()`: colors, `fontFamily`, `scale` (multiply every font size and line height), `reduceMotion`. No literal colors except where the file you copied uses them.
- Copy is lowercase, like production. Toasts follow the `toast-copy` skill.
- Every control has a name a person would say, unique where it sits, led by its verb when a row has several (`like A long title`, not a bare heart). Screen readers and agents both find controls by name.
- Touch targets are at least 44px. Long titles and names wrap or truncate without pushing the page sideways at 390px.
- Web-only code goes in `name.web.ts(x)` beside `name.ts(x)` with the same exports; shared code never touches `document`, `window`, `navigator` or web storage.
- Comments are rare: one or two lines for a platform quirk or a trade-off, never what the code does.

## when you're done

1. `cd next/app && npm run lint && npm run check && npm test && npm run build:web`. Check each exit code.
2. `npm run checks:affected` and run what it lists (`-- --run`). If it prints a file no check covers, pick the closest check by hand, and add the mapping to `scripts/checks.mjs` when one fits.
3. A behavior change gets a check or test that fails without it and asserts what the user sees, never a URL or a fixed wait.
4. Look at the result: screenshot at 390 and 1280 wide, light and dark (`npm run audit:ui` does all four with axe). Say what you looked at.
5. Run `next-unslop` on the diff, then `next-review`.
6. Report each command with its exit code, what you could not check (native, a real account), and anything in `contributing/` that turned out wrong; fix that doc in the same PR.
