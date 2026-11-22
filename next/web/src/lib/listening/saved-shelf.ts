import type { Track } from '@plyr/next-core/api';

export type SavedShelf = { did: string; at: number; tracks: Track[] };

const savedKey = 'plyr-next:following-latest';

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<Track>;
  return typeof track.id === 'string' && typeof track.metadata?.title === 'string' && typeof track.metadata.created_at === 'string'
    && typeof track.artist?.did === 'string' && !!track.artist.profile && !!track.record && !!track.media;
}

/** The shelf this browser last showed, so a return visit draws it while sign-in restores and the graph reloads. */
export function savedShelf(): SavedShelf | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { did, at, tracks } = value as Partial<SavedShelf>;
    if (typeof did !== 'string' || typeof at !== 'number' || Date.now() - at > 7 * 86_400_000) return null;
    if (!Array.isArray(tracks) || !tracks.every(isTrack)) return null;
    return { did, at, tracks };
  } catch {
    return null;
  }
}

export function saveShelf(shelf: SavedShelf) {
  try { localStorage.setItem(savedKey, JSON.stringify(shelf)); } catch {}
}

/** Signed out: nothing of that account's should draw before the next sign-in. */
export function forgetShelf() {
  try { localStorage.removeItem(savedKey); } catch {}
}
