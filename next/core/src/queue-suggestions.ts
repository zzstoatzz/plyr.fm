import type { createApi, Track } from './api.ts';

type Api = Pick<ReturnType<typeof createApi>, 'suggestions' | 'actorLikes' | 'chart' | 'tracks' | 'playlists' | 'playlist'>;

export const maxSeeds = 20;
export const maxExclude = 60;

/** What the queue's suggestions should go with (the playing track and what follows it) and what they must not repeat. */
export function suggestionRequest(queue: readonly Track[], index: number, shown: readonly string[] = []): { seeds: string[]; exclude: string[] } | undefined {
  const from = Math.max(0, index);
  const seeds = unique(queue.slice(from).map(track => track.record.uri)).slice(0, maxSeeds);
  if (!seeds.length) return undefined;
  const nearby = [...queue.slice(from), ...queue.slice(0, from).reverse()].map(track => track.record.uri);
  const exclude = unique([...shown, ...nearby]).filter(uri => !seeds.includes(uri)).slice(0, maxExclude);
  return { seeds, exclude };
}

export type StarterKey = 'for-you' | 'likes' | 'top' | 'latest' | 'playlist';

export interface Starter { key: StarterKey; title: string; subtitle: string }

/** The stacks an empty queue offers: personal ones when signed in, what everyone is playing when not. */
export function starters(signedIn: boolean): Starter[] {
  return signedIn
    ? [
      { key: 'for-you', title: 'for you', subtitle: 'new to you, close to what you like' },
      { key: 'likes', title: 'your likes', subtitle: 'shuffled' },
      { key: 'playlist', title: 'a random playlist', subtitle: 'from someone on plyr' }
    ]
    : [
      { key: 'top', title: 'top tracks this week', subtitle: 'what people are playing' },
      { key: 'latest', title: 'just uploaded', subtitle: 'fresh from artists' },
      { key: 'playlist', title: 'a random playlist', subtitle: 'from someone on plyr' }
    ];
}

/** Loads a starter stack's tracks. An empty result means there is nothing to offer yet, not an error. */
export async function loadStarter(api: Api, key: StarterKey, did: string | undefined, random = Math.random, signal?: AbortSignal): Promise<{ tracks: Track[]; label: string }> {
  switch (key) {
    case 'for-you': {
      const likes = did ? (await api.actorLikes(did, { limit: 50 })).data : [];
      const seeds = likes.map(track => track.record.uri).slice(0, maxSeeds);
      const found = seeds.length ? (await api.suggestions(seeds, { exclude: likes.map(track => track.record.uri).slice(0, maxExclude), limit: 24, signal })).data : [];
      if (found.length >= 5) return { tracks: found, label: 'for you' };
      const top = (await api.chart('week', 30, signal)).data.map(entry => entry.track);
      const liked = new Set(likes.map(track => track.id));
      return { tracks: unique([...found, ...top.filter(track => !liked.has(track.id))], track => track.id), label: 'for you' };
    }
    case 'likes':
      return { tracks: shuffle(did ? (await api.actorLikes(did, { limit: 50 })).data : [], random), label: 'your likes' };
    case 'top':
      return { tracks: (await api.chart('week', 30, signal)).data.map(entry => entry.track), label: 'top tracks this week' };
    case 'latest':
      return { tracks: (await api.tracks({ limit: 30 }, signal)).data, label: 'just uploaded' };
    case 'playlist': {
      const lists = (await api.playlists({ limit: 50 })).data.filter(list => list.metrics.available_count > 0);
      if (!lists.length) return { tracks: [], label: 'a random playlist' };
      const pick = lists[Math.floor(random() * lists.length)];
      const detail = await api.playlist(pick.id);
      const tracks = detail.members.flatMap(member => member.availability === 'available' && member.track ? [member.track] : []);
      return { tracks, label: pick.metadata.name || 'a playlist' };
    }
  }
}

function unique<T>(values: readonly T[], key: (value: T) => unknown = value => value): T[] {
  const seen = new Set<unknown>();
  return values.filter(value => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; });
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
