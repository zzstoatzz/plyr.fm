/** Deterministic hue (0–360) for a tag name, as TagFilter.svelte colors its chips. */
export function tagHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ((hash % 360) + 360) % 360;
}

/** How many tags the home filter offers (TagFilter.svelte). */
export const TAG_FILTER_LIMIT = 15;

/** Popular first, selected tags pinned ahead even when they fell out of the top list. */
export function orderTags<T extends { name: string; total_plays: number }>(
  tags: readonly T[],
  selected: readonly string[],
  hidden: readonly string[] = DEFAULT_HIDDEN_TAGS,
): (T | { name: string })[] {
  const pinned = selected.map((name) => tags.find((t) => t.name === name) ?? { name });
  const rest = tags.filter((t) => !selected.includes(t.name) && !hidden.includes(t.name)).sort((a, b) => b.total_plays - a.total_plays);
  return [...pinned, ...rest];
}

/** Tags hidden for anyone who has not chosen otherwise (backend utilities/tags.py). */
export const DEFAULT_HIDDEN_TAGS: readonly string[] = ["ai", "ai-slop", "suno"];
