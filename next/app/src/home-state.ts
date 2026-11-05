export const periods = ['all_time', 'month', 'week', 'day'] as const;
export type ChartPeriod = typeof periods[number];
export const periodLabels: Record<ChartPeriod, string> = {
  all_time: 'all time', month: 'past month', week: 'past week', day: 'past day',
};

export async function nextPopulatedChart<T>(current: ChartPeriod, load: (period: ChartPeriod) => Promise<T[]>): Promise<{ period: ChartPeriod; tracks: T[] }> {
  let index = periods.indexOf(current);
  let result: { period: ChartPeriod; tracks: T[] } = { period: current, tracks: [] };
  for (let attempt = 0; attempt < periods.length; attempt += 1) {
    index = (index + 1) % periods.length;
    const period = periods[index];
    result = { period, tracks: await load(period) };
    if (result.tracks.length) return result;
  }
  return result;
}

export function selectedTagsKey(did: string | null): string {
  return `plyr-next:home-tags:${did ?? 'anonymous'}`;
}

export function parseSelectedTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && new TextEncoder().encode(tag).length <= 200))].slice(0, 10) : [];
  } catch { return []; }
}
