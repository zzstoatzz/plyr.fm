import type { Track } from './api';
import type { QueueMutation } from './queue-mutation';
import type { QueueState } from './queue-state';

export interface QueueCheckpoint {
  version: 1;
  owner: string;
  updatedAt: number;
  state: QueueState<Track>;
  position: number;
  repeat: 'off' | 'all' | 'one';
  keepPlaying: boolean;
}
export interface QueueProgress { key: string; position: number; updatedAt: number }
export interface QueueStorage {
  load(owner: string): Promise<unknown>;
  loadMutations(owner: string): Promise<QueueMutation[]>;
  saveMutations(owner: string, entries: QueueMutation[], remove?: string[]): Promise<QueueMutation[]>;
  save(owner: string, snapshot: QueueCheckpoint): Promise<void>;
  progress(owner: string, progress: QueueProgress): Promise<void>;
  /** Records progress synchronously, so a page that is unloading still keeps it. */
  latest?(owner: string, progress: QueueProgress): void;
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value: unknown): value is string { return typeof value === 'string' && value.length <= 8192; }
function nullable(value: unknown): value is string | null { return value === null || string(value); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function seconds(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400; }

function track(value: unknown): value is Track {
  if (!object(value) || value.object !== 'track' || !string(value.id) || !/^trk_[A-Za-z0-9_-]+$/.test(value.id)
    || !object(value.record) || !object(value.metadata) || !object(value.artist) || !object(value.artist.profile)
    || !object(value.media) || !object(value.access) || !object(value.metrics)) return false;
  const { record, metadata, artist, media, access, metrics } = value;
  if (!object(artist.profile) || !string(artist.did) || !string(artist.profile.handle) || !string(artist.profile.display_name) || !nullable(artist.profile.avatar_url)) return false;
  if (artist.profile.bio !== undefined && !nullable(artist.profile.bio)) return false;
  if (!string(record.uri) || record.uri.includes('/space/') || !nullable(record.cid) || !nullable(record.revision) || !string(record.collection) || !string(record.rkey)) return false;
  if (!string(metadata.title) || !nullable(metadata.description) || !nullable(metadata.album) || !string(metadata.created_at)
    || metadata.duration_seconds !== null && !seconds(metadata.duration_seconds) || metadata.artist_name !== undefined && !nullable(metadata.artist_name)) return false;
  if (media.artwork !== undefined && media.artwork !== null && (!object(media.artwork) || !string(media.artwork.url))) return false;
  if (value.moderation !== undefined && (!object(value.moderation) || !Array.isArray(value.moderation.self_labels) || !value.moderation.self_labels.every(string)
    || !Array.isArray(value.moderation.operator_labels) || !value.moderation.operator_labels.every(string))) return false;
  return (access.visibility === 'public' || access.visibility === 'unlisted' || access.visibility === 'supporters') && count(metrics.play_count) && count(metrics.like_count);
}

function cachedTrack(value: Track): Track {
  return {
    object: 'track', id: value.id,
    record: { uri: value.record.uri, cid: value.record.cid, revision: value.record.revision, collection: value.record.collection, rkey: value.record.rkey },
    metadata: { title: value.metadata.title, description: value.metadata.description, album: value.metadata.album,
      duration_seconds: value.metadata.duration_seconds, created_at: value.metadata.created_at,
      ...(value.metadata.artist_name === undefined ? {} : { artist_name: value.metadata.artist_name }) },
    artist: { did: value.artist.did, profile: { handle: value.artist.profile.handle, display_name: value.artist.profile.display_name,
      avatar_url: value.artist.profile.avatar_url, ...(value.artist.profile.bio === undefined ? {} : { bio: value.artist.profile.bio }) } },
    media: { artwork: value.media.artwork ? { url: value.media.artwork.url } : null },
    access: { visibility: value.access.visibility }, metrics: { play_count: value.metrics.play_count, like_count: value.metrics.like_count },
    ...(value.moderation ? { moderation: { self_labels: value.moderation.self_labels.slice(), operator_labels: value.moderation.operator_labels.slice() } } : {}),
  };
}

export function queueCheckpoint(value: unknown, owner: string): QueueCheckpoint | null {
  if (!object(value) || value.version !== 1 || value.owner !== owner || !count(value.updatedAt) || !seconds(value.position)
    || value.repeat !== 'off' && value.repeat !== 'all' && value.repeat !== 'one' || typeof value.keepPlaying !== 'boolean'
    || !object(value.state) || !Array.isArray(value.state.entries) || value.state.entries.length > 200
    || typeof value.state.index !== 'number' || !Number.isSafeInteger(value.state.index)) return null;
  const entries = value.state.entries;
  const index = value.state.index;
  if (entries.length === 0 ? index !== -1 || value.position !== 0 : index < 0 || index >= entries.length) return null;
  const parsed: QueueCheckpoint['state']['entries'] = [];
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!object(entry) || typeof entry.key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.key) || keys.has(entry.key) || !track(entry.track)) return null;
    keys.add(entry.key);
    parsed.push({ key: entry.key, track: cachedTrack(entry.track) });
  }
  let tail: QueueCheckpoint['state']['tail'];
  if (value.state.tail !== undefined) {
    const candidate = value.state.tail;
    if (!object(candidate) || !count(candidate.from) || candidate.from > entries.length || candidate.kind !== 'collection' && candidate.kind !== 'generated' || !string(candidate.label)) return null;
    tail = { from: candidate.from, kind: candidate.kind, label: candidate.label };
  }
  return { version: 1, owner, updatedAt: value.updatedAt, state: { entries: parsed, index, ...(tail ? { tail } : {}) }, position: value.position, repeat: value.repeat, keepPlaying: value.keepPlaying };
}

export function newerProgress(a: unknown, b: unknown): unknown {
  const at = (value: unknown) => object(value) && count(value.updatedAt) ? value.updatedAt : -1;
  return at(b) > at(a) ? b : a;
}

export function applyQueueProgress(snapshot: unknown, progress: unknown, owner: string): QueueCheckpoint | null {
  const checkpoint = queueCheckpoint(snapshot, owner);
  if (!checkpoint) return null;
  if (object(progress) && progress.key === checkpoint.state.entries[checkpoint.state.index]?.key && seconds(progress.position)
    && count(progress.updatedAt) && progress.updatedAt >= checkpoint.updatedAt) return { ...checkpoint, position: progress.position };
  return checkpoint;
}
