export const radioStations = [
  { slug: 'loved', label: 'Loved', origin: 'https://radio.plyr.fm' },
  { slug: 'fresh', label: 'Fresh', origin: 'https://fresh.radio.plyr.fm' },
  { slug: 'deep-cuts', label: 'Deep cuts', origin: 'https://deep-cuts.radio.plyr.fm' },
  { slug: 'slop', label: 'Slop', origin: 'https://slop.radio.plyr.fm' },
] as const;

export type RadioStation = typeof radioStations[number];

interface RadioSong {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  hasCover: boolean;
}

export interface RadioSnapshot {
  currentSong: RadioSong | null;
  state: {
    status: string;
    startedAt: number | null;
    positionSeconds: number;
  };
}

export async function readRadio(station: RadioStation, signal: AbortSignal): Promise<RadioSnapshot> {
  const response = await fetch(`${station.origin}/api/radio/state`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Could not reach this station');
  return response.json() as Promise<RadioSnapshot>;
}

export function radioMedia(station: RadioStation, song: RadioSong, kind: 'audio' | 'cover') {
  return `${station.origin}/api/songs/${encodeURIComponent(song.id)}/${kind}`;
}

export function radioPosition(snapshot: RadioSnapshot, now = Date.now()) {
  const { state, currentSong } = snapshot;
  const position = state.status === 'playing' && state.startedAt !== null
    ? now / 1000 - state.startedAt
    : state.positionSeconds;
  return Math.max(0, Math.min(position, currentSong?.durationSeconds ?? 0));
}
