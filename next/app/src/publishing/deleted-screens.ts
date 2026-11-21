type Stack = { routes: readonly { name: string; params?: object }[] };

/** The screens at the top of a stack that show a deleted track: its editor, and the track page under it. */
export function deletedScreens(stack: Stack, id: string) {
  let count = 0;
  for (const route of [...stack.routes].reverse()) {
    const params = route.params as { id?: unknown } | undefined;
    if (!/(^|\/)(edit-track|track)\/\[id\]$/.test(route.name) || params?.id !== id) break;
    count += 1;
  }
  return count;
}
