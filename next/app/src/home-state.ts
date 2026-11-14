export const HOME_PAGE_SIZE = 24;
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

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function localDay(time: number): number {
  const date = new Date(time);
  return Math.floor((time - date.getTimezoneOffset() * MINUTE) / DAY);
}

/** Short age for a list column: `now`, `12m`, `5h`, `3d`, then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const age = Math.max(0, now - time);
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`;
  const date = new Date(time);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${date.getFullYear() === new Date(now).getFullYear() ? '' : `, ${date.getFullYear()}`}`;
}

/** The heading a track sits under in a chronological list, by the viewer's calendar day. */
export function dayGroup(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'earlier';
  const days = localDay(now) - localDay(time);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'this week';
  if (days < 14) return 'last week';
  const date = new Date(time);
  return date.getFullYear() === new Date(now).getFullYear() ? ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][date.getMonth()] : String(date.getFullYear());
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return '';
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor(whole % 3600 / 60), s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Weeks since the epoch, Monday-aligned, so a pick holds from Monday to Sunday everywhere. */
export function weekNumber(now = Date.now()): number {
  return Math.floor((now + 3 * DAY) / (7 * DAY));
}

type LikedTrack = { artist: { did: string }; metrics: { like_count: number } };

/** Artists by the likes their tracks drew, most first; the artist of the week walks this list one week at a time. */
export function rankedArtists(liked: LikedTrack[]): string[] {
  const score = new Map<string, number>();
  for (const track of liked) score.set(track.artist.did, (score.get(track.artist.did) ?? 0) + Math.max(1, track.metrics.like_count));
  return [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([did]) => did);
}
