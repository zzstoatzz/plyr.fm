---
name: next-unslop
description: Remove generated-looking code from a next/app diff without changing behavior — comments that restate code, defensive checks the types rule out, one-caller helpers, vague names, duplicated controls. Use as the last step before review of any next client change, or when asked to clean up a diff.
metadata:
  author: zzstoatzz
---

# next-unslop

Scope is `git diff origin/main...HEAD -- next/app` unless you're given files. Behavior never changes: the same checks pass before and after.

## what goes

- **A comment that says what the next line does, or what a value holds.** Delete it; if the line isn't clear without it, rename something. Keep only a platform quirk, a protocol rule or a trade-off, in one or two lines.
- **Defensive checks the types already rule out.** A `?.` on a value typed non-null, a `typeof x === 'function'` on a declared function, a try/catch around code that can't throw. Keep guards at real boundaries: network, PDS, storage, platform APIs.
- **A helper with one caller** that doesn't name a real idea. Inline it.
- **Vague names**: `data`, `item`, `handle`, `temp`, `result2`. Say what it is.
- **A new styled element that duplicates a shared control** (a `Pressable` button that is `Action`, a labeled `TextInput` that is `Field`). Use the shared one.
- **Literal colors or font sizes** where `useAppearance()` has the value.
- **Dead code**: unused exports, leftover `console.log`, commented-out code, unused imports.
- **State duplicated outside its owner**: a screen keeping its own copy of queue or playback state that `usePlayback` or the feature hook already owns.

## what stays

- Comments that cite an issue, a browser or platform bug, or a lexicon rule.
- Explicit handling of partial failure in PDS writes and uploads, even when it looks verbose.
- Platform seams, even when the two files look alike.

Finish with `npm run lint && npm run check && npm test` from `next/app` and report the exit codes.
