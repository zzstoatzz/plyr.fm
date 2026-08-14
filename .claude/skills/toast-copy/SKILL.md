---
name: toast-copy
description: writing toast/notification copy for plyr.fm — length, tone, progress flows, and the repo's toast API conventions. use whenever adding or editing a toast.
---

# toast copy

a toast is read in a glance while the user is doing something else. every
word competes with the thing they actually care about.

## the rules

1. **state the outcome, not the mechanics.** `album ready`, never
   `the job completed successfully`. `queued bold`, never
   `track was added to the queue`.
2. **≤ 10 words, one clause.** research puts glanceable comprehension at
   ~10 words / ~4 seconds. if it needs a second clause, the second clause
   is usually the UI's job, not the toast's.
3. **specific beats generic.** `gathering tracks (2/12)…` beats
   `processing…`. counts and names are free comprehension.
4. **say a reassurance once, then stop.** for long operations, the first
   toast may carry one calming fact (`safe to leave`). progress updates
   after that carry state only — repeating the reassurance on every update
   reads as nagging (the album-download toast, 2026-08-14).
5. **never repeat a word between message and action.** if the action link
   says `sign in`, the message must not also say sign in — often the whole
   message can *be* the action (the like-nudge toast, 2026-08-14).
6. **errors: what happened + the one next step.** `upload failed — retry`
   style. diagnose honestly: never blame the user's connection for a
   server-side stall ("stopped at 100%" means *we* went quiet).
7. **nothing critical lives in a toast.** toasts vanish. anything the user
   must see or act on belongs in the page (banner, inline state) — toasts
   only echo what already happened.
8. **one toast per flow.** long operations keep a single persistent toast
   (`duration=0`) and `toast.update()` it in place; N toasts for one
   action is a blizzard (the 8-track album upload).
9. **lowercase, no trailing period, `…` for ongoing work** — house style.

## the repo's API (frontend/src/lib/toast.svelte.ts)

- `toast.add(msg, type, duration, action)` → id; `duration=0` = persistent
- `toast.update(id, msg, type?)` — mutate in place for progress
- `toast.dismiss(id)` — always dismiss the persistent one before the
  terminal success/error toast
- `action: { label, href }` renders a link — see rule 5

## worked example (album download, the before/after)

- ~~`packaging... — you can keep browsing, it stays ready once built`~~
- first toast: `preparing album — takes a minute, safe to leave`
- updates: `gathering tracks (2/12)…` → `packaging…`
- done: `album ready`
- SSE dropped: `still working — try again in a minute`

## sources

- LogRocket, "What is a toast notification? Best practices for UX"
- StudyAround, "Toast Notification Design: 7 Best Practices"
- benrajalu.net, "The UX of notification toasts"
- LogRocket, "UI patterns for async workflows, background jobs, and data
  pipelines" (outcome-focused microcopy; `Email sent to 3 people` beats
  `Operation completed successfully`)
- Fluent 2 design system, Toast usage guidance
