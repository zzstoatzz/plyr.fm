export function tabForKey<T>(values: readonly T[], current: T, key: string): T | null {
  if (values.length === 0) return null;
  if (key === 'Home') return values[0];
  if (key === 'End') return values[values.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const index = Math.max(0, values.indexOf(current));
  const step = key === 'ArrowRight' ? 1 : values.length - 1;
  return values[(index + step) % values.length];
}
