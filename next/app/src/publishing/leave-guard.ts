/** Native keeps the app's JS alive while it is open; nothing to guard. */
export function guardLeave(_active: () => boolean) {
  return () => {};
}
