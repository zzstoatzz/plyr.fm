import { api, type Track } from '../api';
import { radioTrackId } from '../radio-track';
import type { AtlasData } from './types';

// production rebuilds the map daily from the shared catalog; next has no atlas of its own yet
const ATLAS_URL = 'https://api.plyr.fm/stats/atlas';

let cached: { at: number; load: Promise<AtlasData> } | undefined;

function isAtlas(value: unknown): value is AtlasData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AtlasData>;
  return Array.isArray(data.points) && Array.isArray(data.artists) && !!data.clusters
    && Array.isArray(data.clusters.coarse) && Array.isArray(data.clusters.fine) && typeof data.meta?.nTracks === 'number';
}

async function fetchAtlas(): Promise<AtlasData> {
  const response = await fetch(ATLAS_URL);
  if (!response.ok) throw new Error("couldn't load the atlas, try again in a moment");
  const body: unknown = await response.json();
  if (!isAtlas(body)) throw new Error("couldn't read the atlas");
  return body;
}

/** One fetch shared by the home tile and the atlas page, refreshed after an hour; a failure is not kept. */
export function loadAtlas(): Promise<AtlasData> {
  if (cached && Date.now() - cached.at < 3_600_000) return cached.load;
  const load = fetchAtlas();
  cached = { at: Date.now(), load };
  load.catch(() => { if (cached?.load === load) cached = undefined; });
  return load;
}

/** The atlas names tracks by production id; playback needs the next track. */
export async function atlasTrack(id: number, signal: AbortSignal): Promise<Track> {
  return api.track(await radioTrackId(String(id), signal));
}

export function atlasSummary(data: AtlasData) {
  return `${data.meta.nTracks.toLocaleString()} tracks · ${data.clusters.coarse.length} regions · ${data.clusters.fine.length} clusters`;
}
