import type { ListSummary, Page, Track } from '../api.ts';

/** Who can listen, grouped for the you page's filter chips. */
export type AccessGroup = 'everyone' | 'link' | 'only you' | 'limited';
export type OwnedSort = 'recent' | 'title' | 'plays';
export interface OwnedFilter { query: string; sort: OwnedSort; access?: AccessGroup; album?: string; tag?: string }

export const accessGroups: { value: AccessGroup; label: string }[] = [
  { value: 'everyone', label: 'everyone' },
  { value: 'link', label: 'with the link' },
  { value: 'only you', label: 'only you' },
  { value: 'limited', label: 'limited' }
];

/** Reads the group from accessLabel's words, so a row and its chip can never disagree. */
export function accessGroup(label: string): AccessGroup {
  if (label === 'everyone') return 'everyone';
  if (label === 'anyone with the link') return 'link';
  if (label === 'only you') return 'only you';
  return 'limited';
}

/** Every page of a cursor list, so search and filters see the whole catalog rather than what has scrolled in. */
export async function loadAll<T>(load: (cursor?: string) => Promise<Page<T>>, maxPages = 40): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await load(cursor);
    items.push(...result.data);
    cursor = result.has_more ? result.next_cursor ?? undefined : undefined;
    if (!cursor) break;
  }
  return items;
}

const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function matches(text: string | null | undefined, query: string): boolean {
  const needle = fold(query.trim());
  return !needle || (!!text && fold(text).includes(needle));
}

export function filterTracks(tracks: Track[], filter: OwnedFilter, label: (track: Track) => string): Track[] {
  const query = filter.query.trim();
  const found = tracks.filter(track =>
    (!query || matches(track.metadata.title, query) || matches(track.metadata.album, query) || (track.metadata.tags ?? []).some(tag => matches(tag, query)))
    && (!filter.access || accessGroup(label(track)) === filter.access)
    && (!filter.album || track.metadata.album === filter.album)
    && (!filter.tag || (track.metadata.tags ?? []).includes(filter.tag)));
  const recent = (a: Track, b: Track) => b.metadata.created_at.localeCompare(a.metadata.created_at);
  return found.sort(filter.sort === 'title' ? (a, b) => a.metadata.title.localeCompare(b.metadata.title) || recent(a, b)
    : filter.sort === 'plays' ? (a, b) => b.metrics.play_count - a.metrics.play_count || recent(a, b)
    : recent);
}

export function filterAlbums(albums: ListSummary[], query: string): ListSummary[] {
  return query.trim() ? albums.filter(album => matches(album.metadata.name, query)) : albums;
}

/** The groups, albums and tags actually present, most used first, so a filter never offers an empty result. */
export function facets(tracks: Track[], label: (track: Track) => string) {
  const count = (values: (string | null | undefined)[]) => {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, total]) => ({ name, count: total }));
  };
  const present = new Set(tracks.map(track => accessGroup(label(track))));
  return {
    access: accessGroups.filter(group => present.has(group.value)),
    albums: count(tracks.map(track => track.metadata.album)),
    tags: count(tracks.flatMap(track => track.metadata.tags ?? []))
  };
}

/** Where a match sits in the text, for highlighting; undefined when it isn't there. */
export function matchRange(text: string, query: string): [number, number] | undefined {
  const needle = fold(query.trim());
  if (!needle) return;
  const folded = fold(text);
  // folding can change length (decomposed accents), so only highlight when it didn't
  if (folded.length !== text.length) return;
  const start = folded.indexOf(needle);
  return start < 0 ? undefined : [start, start + needle.length];
}

/** Total runtime in the largest two units: "1h 52m", "3d 4h", "45s". */
export function catalogDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}
