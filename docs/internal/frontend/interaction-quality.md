---
title: "interaction quality"
---

# interaction quality

Track editing is the first focused pass toward more consistent interactions.
An owner should be able to edit the track where they are already viewing it;
the portal and track page should open the same editor. This is a direction for
ongoing work, not a claim that every existing interaction follows these rules.

## principles

- Put the common action close to the object it changes. Keep the user in context
  and update visible track details after a successful save.
- Use the same words for the same action. An owner action is “edit track”; its
  primary action is “save changes”. Order common metadata ahead of less frequent
  visibility, rights, and audio operations.
- Give each interaction one keyboard owner. Suggestions consume their first
  Escape; the dialog handles the next. Playback shortcuts must not intercept
  dialog controls.
- Keep pending work and failures visible where the action happened. Preserve
  edits on failure and explain partial saves. A notification beneath a modal is
  not sufficient feedback.
- Make closing predictable: explicit close, Escape, and backdrop dismissal
  follow the same unsaved-change and pending-operation rules. Restore focus to
  the trigger after closing.
- Use brief movement to show state changes, with a reduced-motion alternative.
  Keep pressed, hover, focus, disabled, and pending states distinguishable.
  Future native haptics should reinforce these semantics.

## existing foundations

`ConfirmDialog.svelte` uses native `dialog.showModal()` for browser-managed
modal behavior and top-layer stacking. `BottomSheet.svelte` provides mobile
safe-area handling, swipe dismissal, a 150ms backdrop fade and a 200ms ease-out
panel transition, plus reduced-motion styling. Shared colors, typography and
radii come from the [design tokens](./design-tokens.md).

Native dialogs are a useful foundation for new editors. Older modal code is not
a uniform accessibility or dismissal contract to copy unchanged.

## track editor

`EditTrackModal.svelte` is shared by the track page and portal. Only the owner
sees the track-page action. The shell owns native modal focus, scroll locking,
dirty dismissal, reduced motion, and propagation of saved metadata to the page,
player, and queue. `TrackEditForm.svelte` owns the draft and save sequence;
artwork, access/rights, and audio/history are separate field components.

Metadata edits invalidate the discovery cache and refresh the current queue's
hydrated metadata through its normal optimistic write path. The mutation epoch
prevents a queue response started before the edit from overwriting it. Queue
order, selected occurrence, and progress are preserved.

Existing copyright records are preserved unless the owner explicitly changes
them. Metadata and copyright use separate endpoints, so partial failures keep
the editor open and explain which operation failed. Audio replacement stays in
the background, with the uploader's typed status callback also feeding inline
progress and errors while the editor is open.

## prioritized follow-ups

1. **Unify modal semantics.** `SearchModal.svelte`, `FeedbackModal.svelte`,
   `LogoutModal.svelte`, and `DownloadAskModal.svelte` use always-mounted dialog
   divs hidden by opacity and pointer-events. Hidden controls can remain in the
   tab order, and focus containment/restoration varies. Preserve SearchModal's
   deliberate mobile keyboard focus behavior when migrating it.
2. **Scope nested dismissal.** `BottomSheet.svelte` listens for Escape and Tab
   on the window. A nested confirmation should own its keyboard events without
   also closing or moving focus in the underlying sheet.
3. **Adopt shared motion tokens.** The edit flow introduces `--motion-feedback`
   (140ms), `--motion-enter` (200ms), `--motion-exit` (140ms), and `--ease-surface`.
   Older components mix durations, broad `transition: all`, and easing curves.
   Migrate touched components to the tokens while preserving useful distinctions.
   Check actual animated properties under reduced motion: `Toast.svelte` uses a
   600ms Svelte fade, which its CSS `transition` override does not control.
4. **Review notification layering.** `Toast.svelte` uses document z-index 9999;
   native modal dialogs render above it. Dialog errors need visible inline
   feedback, and notification placement should have a deliberate app-wide rule.

Keep each follow-up bounded and verify keyboard, pointer, small-screen, and
reduced-motion behavior before extending a pattern across the app.
