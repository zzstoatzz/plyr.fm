/** Ask before closing or reloading the tab while an upload still needs it. */
export function guardLeave(active: () => boolean) {
  const warn = (event: BeforeUnloadEvent) => { if (active()) event.preventDefault(); };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}
