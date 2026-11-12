export interface PlaylistItem {
  subject: { uri: string; cid: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PlaylistRecord {
  listType: 'playlist';
  items: PlaylistItem[];
  [key: string]: unknown;
}

export interface PlaylistRevision {
  uri: string;
  cid: string;
  value: PlaylistRecord;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function playlistRecord(value: unknown): PlaylistRecord {
  if (!object(value) || value.listType !== 'playlist' || !Array.isArray(value.items)
    || value.items.length > 500) throw new Error('this playlist cannot be reordered.');
  const items = value.items.map((item: unknown): PlaylistItem => {
    if (!object(item) || !object(item.subject) || typeof item.subject.uri !== 'string'
      || typeof item.subject.cid !== 'string') throw new Error('this playlist has an invalid track reference.');
    return { ...item, subject: { ...item.subject, uri: item.subject.uri, cid: item.subject.cid } };
  });
  return { ...value, listType: 'playlist', items };
}

export function orderedPlaylist(value: PlaylistRecord, order: readonly number[]): PlaylistRecord {
  if (order.length !== value.items.length || new Set(order).size !== order.length
    || order.some(index => !Number.isInteger(index) || index < 0 || index >= order.length)) {
    throw new Error('every playlist entry must appear exactly once.');
  }
  return { ...value, items: order.map(index => value.items[index]) };
}

export function sameRecord(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, i) => sameRecord(item, right[i]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameRecord(left[key], right[key]));
}

export class PlaylistOrderConflict extends Error {
  constructor() { super('this playlist changed elsewhere. reload the latest order before saving.'); }
}

export class PlaylistOrderUnconfirmed extends Error {
  constructor() { super('could not confirm the saved order. check your PDS before making more changes.'); }
}
