import type { Track } from './api.ts';
import { canToggleTrack } from './track-revision.ts';

type TrackRef = { record: Pick<Track['record'], 'uri' | 'cid'> };

/** What a play button starts: some tracks (one track, an album, a playlist, a shelf), everything by an artist, or a live station. */
export type PlayContext =
  | { kind: 'tracks'; tracks: readonly TrackRef[] }
  | { kind: 'artist'; did: string }
  | { kind: 'station'; slug: string };

export interface PlayerNow {
  current?: (TrackRef & { artist?: { did: string } }) | null;
  /** the live station on air, when radio is the output */
  station?: string | null;
  inJam?: boolean;
  /** audio is coming out of this device */
  playing: boolean;
  /** a start is in flight: loading, buffering, or waiting on the queue */
  starting?: boolean;
}

/** `starting` and `playing` both read as pause: the press already took, so a second one stops it. */
export type PlayState = 'idle' | 'paused' | 'starting' | 'playing';

export function holdsCurrent(context: PlayContext, now: PlayerNow): boolean {
  if (context.kind === 'station') return !!now.station && now.station === context.slug;
  const current = now.current;
  if (!current || now.station) return false;
  if (context.kind === 'artist') return current.artist?.did === context.did;
  return context.tracks.some(track => canToggleTrack(current, track, !!now.inJam));
}

export function playState(context: PlayContext, now: PlayerNow): PlayState {
  if (!holdsCurrent(context, now)) return 'idle';
  if (now.playing) return 'playing';
  return now.starting ? 'starting' : 'paused';
}

export const showsPause = (state: PlayState) => state === 'playing' || state === 'starting';

/** One press: a context that already holds the player toggles it; any other context starts. */
export function pressPlay(state: PlayState, actions: { toggle: () => void; start: () => void }) {
  if (state === 'idle') actions.start();
  else actions.toggle();
}

export const tracksContext = (tracks: readonly TrackRef[]): PlayContext => ({ kind: 'tracks', tracks });
export const artistContext = (did: string): PlayContext => ({ kind: 'artist', did });
export const stationContext = (slug: string): PlayContext => ({ kind: 'station', slug });
