export function placePopover(panel: HTMLElement, trigger: HTMLElement) {
  const anchor = trigger.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
  panel.style.top = `${Math.max(8, anchor.bottom + bounds.height + 8 <= innerHeight ? anchor.bottom + 6 : anchor.top - bounds.height - 6)}px`;
}

export function placePopoverAt(panel: HTMLElement, x: number, y: number) {
  const bounds = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
  panel.style.top = `${Math.max(8, y + bounds.height + 8 <= innerHeight ? y + 4 : y - bounds.height - 4)}px`;
}
