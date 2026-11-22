import type { Action } from 'svelte/action';

const fields = 'input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select';

/**
 * Keeps the focused field of a form clear of the page's sticky save bar, the phone tab bar and the keyboard.
 * Browsers skip the focus scroll for a field already inside the viewport, even when an overlay covers it.
 */
export const focusClear: Action<HTMLElement> = node => {
  node.dataset.focusClear = '';
  let field: HTMLElement | undefined;
  const reveal = () => requestAnimationFrame(() => { if (field && document.activeElement === field) field.scrollIntoView({ block: 'nearest' }); });
  const focusin = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(fields)) return;
    field = event.target;
    reveal();
  };
  const focusout = () => { field = undefined; };
  node.addEventListener('focusin', focusin);
  node.addEventListener('focusout', focusout);
  window.visualViewport?.addEventListener('resize', reveal);
  return { destroy() {
    node.removeEventListener('focusin', focusin);
    node.removeEventListener('focusout', focusout);
    window.visualViewport?.removeEventListener('resize', reveal);
  } };
};
