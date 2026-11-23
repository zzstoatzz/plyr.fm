import type { Track } from '@plyr/next-core/api';
import { collectionArtwork, trackArtwork } from '@plyr/next-core/artwork';
import { api } from '$lib/api';

export function canEmbed(track: Track) {
  return track.access.visibility === 'public'
    && !track.access.space_uri && !track.access.gate
    && ![track.moderation?.self_labels, track.moderation?.operator_labels]
      .some(labels => labels?.some(label => label === 'sexual' || label === 'porn'));
}

interface EmbedCatalog {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  tracks: Track[];
}

export async function catalogEmbed(kind: 'album' | 'playlist' | 'artist', id: string): Promise<EmbedCatalog> {
  if (kind === 'artist') {
    const artist = await api.artist(id);
    const page = await api.tracks({ artist_did: artist.did, limit: 10 });
    return { title: artist.display_name || artist.handle, artwork: artist.avatar_url, tracks: page.data };
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
