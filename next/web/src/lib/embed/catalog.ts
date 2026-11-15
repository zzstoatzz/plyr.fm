import { ApiError, trackIdFromUri, type Track } from '@plyr/next-core/api';
import { collectionArtwork, trackArtwork } from '@plyr/next-core/artwork';
import { api } from '$lib/api';

const legacyOrigin = 'https://api.plyr.fm';

export function canEmbed(track: Track) {
  return track.access.visibility === 'public'
    && !track.access.space_uri && !track.access.gate
    && ![track.moderation?.self_labels, track.moderation?.operator_labels]
      .some(labels => labels?.some(label => label === 'sexual' || label === 'porn'));
}

async function legacy<T>(path: string, fetcher: typeof fetch) {
  const response = await fetcher(legacyOrigin + path);
  if (!response.ok) throw new ApiError(response.status, 'embed not found');
  return await response.json() as T;
}

async function legacyTracks(entries: { atproto_record_uri?: string }[]) {
  const ids = entries.flatMap(entry => entry.atproto_record_uri ? [trackIdFromUri(entry.atproto_record_uri)] : []);
  const tracks = new Map<string, Track>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data } = await api.resolveTracks(ids.slice(offset, offset + 100));
    for (const track of data) tracks.set(track.id, track);
  }
  return ids.flatMap(id => {
    const track = tracks.get(id);
    return track ? [track] : [];
  });
}

export async function trackEmbed(id: string, fetcher: typeof fetch) {
  if (/^\d+$/.test(id)) {
    const record = await legacy<{ atproto_record_uri?: string }>(`/tracks/${id}`, fetcher);
    if (!record.atproto_record_uri) throw new ApiError(404, 'track not found');
    id = trackIdFromUri(record.atproto_record_uri);
  }
  return api.track(id);
}

interface EmbedCatalog {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  tracks: Track[];
}

export async function catalogEmbed(kind: 'album' | 'playlist' | 'artist', id: string, fetcher: typeof fetch, slug?: string): Promise<EmbedCatalog> {
  if (kind === 'artist') {
    const artist = await api.artist(id);
    const page = await api.tracks({ artist_did: artist.did, limit: 10 });
    return { title: artist.display_name || artist.handle, artwork: artist.avatar_url, tracks: page.data };
  }
  if (kind === 'album' && slug) {
    const album = await legacy<{ metadata: { title: string; artist_handle: string; image_url?: string }; tracks: { atproto_record_uri?: string }[] }>(
      `/albums/${encodeURIComponent(id)}/${encodeURIComponent(slug)}`, fetcher
    );
    return { title: album.metadata.title, subtitle: album.metadata.artist_handle, artwork: album.metadata.image_url, tracks: await legacyTracks(album.tracks) };
  }
  if (kind === 'playlist' && !id.startsWith('pls_')) {
    const playlist = await legacy<{ name: string; owner_handle: string; image_url?: string; tracks: { atproto_record_uri?: string }[] }>(
      `/lists/playlists/${encodeURIComponent(id)}`, fetcher
    );
    return { title: playlist.name, subtitle: playlist.owner_handle, artwork: playlist.image_url, tracks: await legacyTracks(playlist.tracks) };
  }
  const list = await (kind === 'album' ? api.album(id) : api.playlist(id));
  return {
    title: list.metadata.name || kind,
    subtitle: list.owner.profile?.display_name,
    artwork: collectionArtwork(list),
    tracks: list.members.flatMap(member => member.track ? [member.track] : [])
  };
}

export function embedArtwork(track: Track) {
  return canEmbed(track) ? trackArtwork(track) : undefined;
}
