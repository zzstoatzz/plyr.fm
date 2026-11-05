import { API_URL } from './config';

export interface HomeTag { name: string; track_count: number; total_plays: number }
export interface NetworkArtist { did: string; handle: string; display_name: string; avatar_url: string | null; track_count: number }

function data(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data)) throw new Error('could not read catalog response');
  return value.data;
}

export async function homeTags(signal: AbortSignal): Promise<HomeTag[]> {
  const response = await fetch(`${API_URL}/v1/tags?limit=15`, { signal });
  if (!response.ok) throw new Error('could not load tags');
  return data(await response.json()).map((value) => {
    if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string'
      || !('track_count' in value) || typeof value.track_count !== 'number'
      || !('total_plays' in value) || typeof value.total_plays !== 'number') throw new Error('could not read tags');
    return { name: value.name, track_count: value.track_count, total_plays: value.total_plays };
  });
}

export async function resolveArtists(dids: string[], signal: AbortSignal): Promise<NetworkArtist[]> {
  const response = await fetch(`${API_URL}/v1/artists/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dids }), signal,
  });
  if (!response.ok) throw new Error('could not load artists you know');
  return data(await response.json()).map((value) => {
    if (!value || typeof value !== 'object' || !('did' in value) || typeof value.did !== 'string'
      || !('handle' in value) || typeof value.handle !== 'string'
      || !('display_name' in value) || typeof value.display_name !== 'string'
      || !('avatar_url' in value) || (value.avatar_url !== null && typeof value.avatar_url !== 'string')
      || !('track_count' in value) || typeof value.track_count !== 'number') throw new Error('could not read artists');
    return { did: value.did, handle: value.handle, display_name: value.display_name, avatar_url: value.avatar_url, track_count: value.track_count };
  });
}
