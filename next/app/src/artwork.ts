import type { ListSummary, Track } from './api';

export function trackArtwork(track: Track): string | undefined {
  return track.media.artwork?.url || track.artist.profile.avatar_url || undefined;
}

export function collectionArtwork(list: ListSummary): string | undefined {
  return list.media?.artwork?.url || list.owner.profile?.avatar_url || undefined;
}
