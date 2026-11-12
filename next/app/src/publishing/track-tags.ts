export function normalizeTrackTags(tags: readonly string[]): string[] {
  const normalized = [...new Set(tags.map(tag => tag.toLowerCase().replace(/\s+/gu, ' ').replace(/^[ -]+|[ -]+$/gu, '')).filter(Boolean))];
  if (normalized.length > 20) throw new Error('use up to 20 tags.');
  if (normalized.some(tag => tag.includes('\0'))) throw new Error('tags cannot contain null characters.');
  if (normalized.some(tag => new TextEncoder().encode(tag).length > 50)) throw new Error('a tag is too long. use up to 50 UTF-8 bytes per tag.');
  return normalized;
}

export function recordTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((tag): tag is string => typeof tag === 'string')) throw new Error('could not read track tags.');
  return value;
}
