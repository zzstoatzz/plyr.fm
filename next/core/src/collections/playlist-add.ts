import type { AwaitStatus, ListSummary } from '../api';

/** What adding a track to a playlist came to. 'present' means it was already there. */
export type PlaylistAddStatus = AwaitStatus | 'present';
export type PlaylistAddNotice = { message: string; tone: 'success' | 'info' | 'error' };

export function playlistName(list: Pick<ListSummary, 'metadata'>): string {
  return list.metadata.name?.trim() || 'untitled playlist';
}

export function playlistTrackCount(list: Pick<ListSummary, 'metrics'>): string {
  const count = list.metrics.member_count;
  return `${count.toLocaleString()} ${count === 1 ? 'track' : 'tracks'}`;
}

/** The toast after a tap in the playlist picker, shared so web and native say the same thing. */
export function playlistAddNotice(name: string, status: PlaylistAddStatus, created = false): PlaylistAddNotice {
  if (status === 'present') return { message: `already in ${name}`, tone: 'info' };
  if (status === 'indexed' || status === 'pending') return { message: created ? `created ${name} with this track` : `added to ${name}`, tone: 'success' };
  if (status === 'rejected') return { message: `saved to ${name}, but the catalog could not show it yet`, tone: 'info' };
  return { message: `could not add to ${name}. try again.`, tone: 'error' };
}
