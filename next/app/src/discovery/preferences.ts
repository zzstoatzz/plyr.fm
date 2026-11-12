export const DEFAULT_HIDDEN_TAGS = ['ai', 'ai-slop', 'suno'];

export function hiddenTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return;
  const encoder = new TextEncoder();
  const tags = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.includes('\0') || encoder.encode(item).length > 200) return;
    const tag = item.replace(/[A-Z]/g, char => char.toLowerCase())
      .replace(/[\t\n\r\v\f ]+/g, ' ').replace(/^[ -]+|[ -]+$/g, '');
    if (!tag) return;
    tags.add(tag);
    if (tags.size > 10) return;
  }
  return [...tags].sort((a, b) => {
    const left = encoder.encode(a), right = encoder.encode(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  });
}

export function discoveryFilter(value: unknown): string[] | undefined {
  const tags = hiddenTags(value) ?? DEFAULT_HIDDEN_TAGS;
  return JSON.stringify(tags) === JSON.stringify(DEFAULT_HIDDEN_TAGS) ? undefined : tags.length ? tags : [''];
}
