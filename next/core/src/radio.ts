import type { Track } from './api.ts';
import { trackIdFromUri } from './record-ids.ts';

export const radioStations = [
  { slug: 'loved', label: 'loved' },
  { slug: 'fresh', label: 'fresh' },
  { slug: 'deep-cuts', label: 'deep cuts' },
  { slug: 'slop', label: 'slop' },
  { slug: 'firehose', label: 'firehose', about: 'the atproto firehose, sonified' },
] as const;

export type RadioStation = typeof radioStations[number];

const STATE_URL = 'https://api.plyr.fm/radio/state';

interface StateTrack {
  id: number;
  title: string;
  artist: string;
  artist_handle: string;
  artist_did: string;
  artist_avatar_url?: string | null;
  stream_url: string;
  duration: number;
  artwork_url: string | null;
  thumbnail_url: string | null;
  atproto_record_uri: string | null;
  atproto_record_cid: string | null;
  created_at: string;
  like_count: number;
  play_count: number;
}

/** An endless broadcast a station airs instead of a rotation, such as the sonified firehose. */
interface LiveBroadcast {
  stream_url: string;
  kind: string;
  started_at: string | null;
  artwork_url?: string | null;
}

interface StateResponse {
  station?: string;
  current: StateTrack | null;
  live?: LiveBroadcast | null;
  current_ends_at: string | null;
  progress_seconds: number;
  up_next: StateTrack[];
}

export interface RadioSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly durationSeconds: number;
  readonly audio: string;
  readonly artwork: string | null;
  readonly thumbnail: string | null;
  /** An endless HLS broadcast rather than a catalog song: no length, no position to join at, nothing to count or like. */
  readonly live: boolean;
  /** The song as a catalog track, so now playing, likes and the artist link treat it like any other. */
  readonly track: Track;
}

export interface RadioSnapshot {
  readonly currentSong: RadioSong | null;
  readonly positionSeconds: number;
  /** Wall-clock ms when the current song ends, when the station said. */
  readonly endsAt: number | null;
  /** Artwork of the next songs, to warm before the station gets there. */
  readonly upNext: readonly string[];
  readonly receivedAt: number;
}

function song(item: StateTrack): RadioSong {
  const uri = item.atproto_record_uri ?? `at://${item.artist_did}/fm.plyr.track/radio-${item.id}`;
  const [, , did, collection, rkey] = uri.split('/');
  const track: Track = {
    object: 'track',
    id: item.atproto_record_uri ? trackIdFromUri(item.atproto_record_uri) : `radio:${item.id}`,
    record: { uri, cid: item.atproto_record_cid, revision: null, collection, rkey },
    metadata: { title: item.title, artist_name: item.artist, description: null, album: null, duration_seconds: item.duration, created_at: item.created_at },
    artist: { did: did || item.artist_did, profile: { handle: item.artist_handle, display_name: item.artist, avatar_url: item.artist_avatar_url ?? null } },
    media: { artwork: item.artwork_url ? { url: item.artwork_url } : null },
    access: { visibility: 'public' },
    metrics: { play_count: item.play_count, like_count: item.like_count },
  };
  return Object.freeze({ id: track.id, title: item.title, artist: item.artist, durationSeconds: item.duration, audio: item.stream_url,
    artwork: item.artwork_url, thumbnail: item.thumbnail_url ?? item.artwork_url, live: false, track: Object.freeze(track) });
}

function broadcast(live: LiveBroadcast, slug: string, label: string, about: string, now: number): RadioSong {
  const track: Track = {
    object: 'track',
    id: `live:${slug}`,
    record: { uri: `at://did:web:plyr.fm/fm.plyr.track/live-${slug}`, cid: null, revision: null, collection: 'fm.plyr.track', rkey: `live-${slug}` },
    metadata: { title: label, artist_name: about, description: null, album: null, duration_seconds: 0, created_at: live.started_at ?? new Date(now).toISOString() },
    artist: { did: 'did:web:plyr.fm', profile: { handle: '', display_name: about, avatar_url: null } },
    media: { artwork: live.artwork_url ? { url: live.artwork_url } : null },
    access: { visibility: 'public' },
    metrics: { play_count: 0, like_count: 0 },
  };
  const artwork = live.artwork_url ?? null;
  return Object.freeze({ id: track.id, title: label, artist: about, durationSeconds: 0, audio: live.stream_url,
    artwork, thumbnail: artwork, live: true, track: Object.freeze(track) });
}

/** A live broadcast preempts the rotation: the station is on the air even with nothing queued behind it. */
export function parseRadio(state: StateResponse, receivedAt: number, now = Date.now(), station?: RadioStation): RadioSnapshot {
  const ends = state.current_ends_at ? Date.parse(state.current_ends_at) : NaN;
  const slug = station?.slug ?? state.station ?? 'live';
  const live = state.live?.stream_url ? broadcast(state.live, slug, station?.label ?? slug,
    station && 'about' in station ? station.about : 'live broadcast', now) : null;
  return Object.freeze({
    currentSong: live ?? (state.current ? song(state.current) : null),
    positionSeconds: live ? 0 : state.progress_seconds,
    endsAt: !live && Number.isFinite(ends) && ends > now - 60_000 ? ends : null,
    upNext: Object.freeze(state.up_next.slice(0, 2).map(item => item.artwork_url).filter((url): url is string => !!url)),
    receivedAt,
  });
}

export async function readRadio(station: RadioStation, signal: AbortSignal): Promise<RadioSnapshot> {
  const response = await fetch(`${STATE_URL}?station=${encodeURIComponent(station.slug)}&catalog_only=true`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('could not reach this station');
  return parseRadio(await response.json(), performance.now(), Date.now(), station);
}

export function radioPosition(snapshot: RadioSnapshot, now = performance.now()) {
  if (snapshot.currentSong?.live) return 0;
  const position = snapshot.positionSeconds + Math.max(0, now - snapshot.receivedAt) / 1000;
  return Math.max(0, Math.min(position, snapshot.currentSong?.durationSeconds ?? 0));
}

/** When to read the station again: just after the song changes, and at least every `ceiling` ms to stay on its clock. */
export function nextRead(snapshot: RadioSnapshot, ceiling: number, now = Date.now()) {
  if (snapshot.endsAt === null) return ceiling;
  return Math.max(500, Math.min(ceiling, snapshot.endsAt - now + 400));
}
