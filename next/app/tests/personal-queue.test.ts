import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalQueue } from '../src/personal-queue.ts';
import type { Track } from '../src/api.ts';
import type { JamSocket, JamState } from '../src/jam-connection.ts';
import { mergeQueueMutations, type QueueMutation } from '../src/queue-mutation.ts';
import type { QueueStorage } from '../src/queue-checkpoint.ts';

const uri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/a';
const track: Track = { object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'), record: { uri, cid: 'cid', revision: null, collection: 'fm.plyr.track', rkey: 'a' },
  metadata: { title: 'A', description: null, album: null, duration_seconds: 60, created_at: '' },
  artist: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', profile: { handle: 'artist.test', display_name: 'Artist', avatar_url: null } },
  media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 } };
const ref = { id: track.id, uri, cid: 'cid', durationMs: 60_000, key: 'first' };
const base: JamState = { epoch: 'personal', revision: 1, occurrence: 1, queue: [ref], index: 0, playing: false, positionMs: 1234, updatedAtMs: 10_000,
  personal: { explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: false, cursor: null, output: null, disconnected: false } };
class Socket implements JamSocket {
  readyState = 1;
  onopen: JamSocket['onopen'] = null;
  onmessage: JamSocket['onmessage'] = null;
  onclose: JamSocket['onclose'] = null;
  onerror: JamSocket['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  receive(value: object) { this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data: JSON.stringify(value) })); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(journal: QueueMutation[] = []) {
  const socket = new Socket();
  let stored = structuredClone(journal);
  const calls: string[][] = [];
  const changes: unknown[] = [];
  const errors: string[] = [];
  const storage: QueueStorage = { load: async () => null, loadMutations: async () => structuredClone(stored),
    saveMutations: async (_, entries, remove) => { stored = structuredClone(mergeQueueMutations(stored, entries, remove)); return stored; }, save: async () => {}, progress: async () => {} };
  const queue = new PersonalQueue({ owner: 'account', storage, id: () => 'edit',
    resolve: async ids => { calls.push(ids); return { data: ids.map(id => ({ ...track, id, record: { ...track.record, uri: Buffer.from(id.slice(4), 'base64url').toString() } })).reverse(), missing: [] }; },
    changed: state => changes.push(state), remote: () => {}, error: message => errors.push(message),
    connect: { admit: async () => ({ ticket: 'test', websocketUrl: 'wss://test' }), socket: () => socket } });
  return { queue, socket, calls, changes, errors, stored: () => stored };
}

test('queue hydration batches distinct tracks and progress does not rehydrate or republish metadata', async () => {
  const { queue, socket, calls, changes } = setup();
  try {
    await queue.start();
    socket.receive({ type: 'state', state: { ...base, queue: [ref, { ...ref, key: 'second' }], personal: { ...base.personal, explicitEnd: 2 } } });
    await tick();
    assert.deepEqual(calls, [[track.id]]);
    assert.equal(queue.state.entries.length, 2);
    assert.equal(queue.state.entries[0].track, queue.state.entries[1].track);
    const count = changes.length;
    socket.receive({ type: 'state', state: { ...base, revision: 2, queue: [ref, { ...ref, key: 'second' }], personal: { ...base.personal, explicitEnd: 2 }, positionMs: 5000 } });
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(changes.length, count);
  } finally { queue.close(); }
});

test('an edit is journaled before sending and a refresh replays the identical prepared command after a lost acknowledgement', async () => {
  const first = setup();
  let prepared: Record<string, unknown>;
  let saved: QueueMutation[];
  try {
    await first.queue.start(); first.socket.receive({ type: 'state', state: base }); await tick();
    first.queue.remember([track]);
    await first.queue.edit({ action: 'enqueue', entry: { ...ref, key: 'second' } });
    prepared = first.socket.sent.find(value => value.action === 'enqueue')!;
    assert.ok(prepared);
    saved = first.stored();
    assert.equal(saved[0].id, prepared.id);
    assert.equal(saved[0].base?.expectedRevision, prepared.expectedRevision);
  } finally { first.queue.close(); }
  const refreshed = setup(saved!);
  try {
    await refreshed.queue.start();
    const accepted = { ...base, revision: 5, occurrence: 2, queue: [ref, { ...ref, key: 'second' }], personal: { ...base.personal, explicitEnd: 2 } };
    refreshed.socket.receive({ type: 'state', state: accepted }); await tick(); await tick();
    const replay = refreshed.socket.sent.find(value => value.action === 'enqueue');
    assert.deepEqual(replay, prepared!);
    assert.equal(refreshed.queue.state.entries.length, 2);
    refreshed.socket.receive({ type: 'result', id: prepared!.id, outcome: 'duplicate', state: accepted });
    await tick();
    assert.deepEqual(refreshed.stored(), []);
    assert.equal(refreshed.socket.sent.some(value => value.action === 'play' || value.action === 'seek'), false);
  } finally { refreshed.queue.close(); }
});

test('closed account sessions cannot publish delayed hydration', async () => {
  const { queue, socket, changes } = setup();
  await queue.start(); socket.receive({ type: 'state', state: base });
  queue.close(); const count = changes.length;
  await tick(); assert.equal(changes.length, count);
});

test('two tabs cannot overwrite each other’s pending edits or prepare different retry fingerprints', () => {
  const a: QueueMutation = { id: 'a', intent: { action: 'enqueue', entry: { ...ref, key: 'a' } } };
  const b: QueueMutation = { id: 'b', intent: { action: 'clearPicks' } };
  const initial = mergeQueueMutations([a], [b]);
  assert.deepEqual(initial.map(entry => entry.id), ['a', 'b']);
  const prepared = { epoch: 'epoch', expectedRevision: 5, occurrence: 1, expectedOutput: null };
  const first = mergeQueueMutations(initial, [{ ...a, base: prepared }]);
  const second = mergeQueueMutations(first, [{ ...a, base: { ...prepared, expectedRevision: 6 } }]);
  assert.equal(second[0].base?.expectedRevision, 5);
  assert.deepEqual(mergeQueueMutations(second, [], ['b']).map(entry => entry.id), ['a']);
});

test('restoring 200 distinct occurrences performs two bounded metadata reads and maps by record identity', async () => {
  const { queue, socket, calls } = setup();
  try {
    const refs = Array.from({ length: 200 }, (_, at) => {
      const uri = `at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/queue-${at}`;
      return { ...ref, key: `entry-${at}`, uri, id: 'trk_' + Buffer.from(uri).toString('base64url') };
    });
    await queue.start();
    socket.receive({ type: 'state', state: { ...base, queue: refs, personal: { ...base.personal, explicitEnd: 200 } } });
    await tick();
    assert.equal(calls.length, 2);
    assert.ok(calls.every(ids => ids.length <= 100));
    assert.deepEqual(queue.state.entries.map(entry => entry.track.id), refs.map(ref => ref.id));
    assert.ok(queue.state.entries.every(entry => entry.track.metadata.title === 'A'));
  } finally { queue.close(); }
});

test('late checkpoint reads cannot replace a fresh local selection or its metadata', async () => {
  let release: (value: unknown) => void = () => {};
  const storage: QueueStorage = { load: () => new Promise(resolve => { release = resolve; }), loadMutations: async () => [],
    saveMutations: async (_, entries) => entries, save: async () => {}, progress: async () => {} };
  const queue = new PersonalQueue({ owner: 'anonymous', storage, id: () => 'test', resolve: async () => ({ data: [], missing: [] }),
    changed: () => {}, remote: () => {}, error: () => {} });
  try {
    const starting = queue.start();
    const fresh = { ...track, metadata: { ...track.metadata, title: 'Fresh selection' } };
    queue.local({ entries: [{ key: 'fresh', track: fresh }], index: 0 });
    release({ version: 1, owner: 'anonymous', updatedAt: 100, position: 20, repeat: 'off', keepPlaying: false,
      state: { entries: [{ key: 'old', track }], index: 0 } });
    await starting;
    assert.equal(queue.state.entries[0].key, 'fresh');
    assert.equal(queue.cache.get(track.id)?.metadata.title, 'Fresh selection');
  } finally { queue.close(); }
});
