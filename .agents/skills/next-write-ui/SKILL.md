---
name: next-write-ui
description: Write or change UI in the next client (next/app, the native Expo app) the way the project expects — start from the code that already does the job, keep platform code behind seams, render and look on a phone, run the checks the change reaches. Use for any next/app screen, control, interaction or style change.
metadata:
  author: zzstoatzz
---

# next-write-ui

For `next/app` only. Never touch `frontend/`, `backend/` or `services/transcoder` from here; production is not this app.

## before you write

1. Read `next/app/contributing/pitfalls.md`, `decisions.md` and `design.md`. A settled decision is not yours to change in passing: production is the reference for look, phone first, Expo for iOS and Android. A visible change starts with rendered mockups nate picks from, per `design.md`.
2. Find the file that already does the same job and copy its shape: a screen in `app/` composes; behavior and UI live in `src/`. Search `src/` for the control before writing one. `controls.tsx` (`Action`, `Field`, `Page`, `Copy`, `InlineLink`), `Text`, `ActionRow`, `Sheet`, `CatalogPieces`, `useAppearance` and `onAccent` cover most needs.
3. Share accessibility behavior in src/behaviors/ and test the platform interaction.

## while you write

- Styles come from `useAppearance()`: colors, `fontFamily`, `scale` (multiply every font size and line height), `reduceMotion`. No literal colors except where the file you copied uses them.
- Copy is lowercase, like production. Toasts follow the `toast-copy` skill.
- Every control has a name a person would say, unique where it sits, led by its verb when a row has several (`like A long title`, not a bare heart). Screen readers and agents both find controls by name.
- Touch targets are at least 44px. Long titles and names wrap or truncate without pushing the page sideways at 390px.
- Keep browser integrations in next/web and shared models in @plyr/next-core.
- Comments are rare: one or two lines for a platform quirk or a trade-off, never what the code does.

## when you're done

1. From next/app, run bun run lint, bun run check and bun run test.
2. Run the affected native build and launch a simulator or device.
3. A behavior change gets a check or test that fails without the change.
4. Check the changed interaction at phone width in light and dark.
5. Run `next-unslop` on the diff, then `next-review`.
6. Report each command with its exit code, what you could not check (native, a real account), and anything in `contributing/` that turned out wrong; fix that doc in the same PR.
