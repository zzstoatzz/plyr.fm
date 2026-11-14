import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalQueue } from '../src/personal-queue.ts';
import { clearPlaybackEvents, playbackEvents } from '../src/playback-diagnostics.ts';
import type { JamSocket, JamState } from '../src/jam-connection.ts';
import type { QueueStorage } from '../src/queue-checkpoint.ts';

const ref = { id: 'trk_a', uri: 'at://did:plc:a/fm.plyr.track/a', cid: 'cid', durationMs: 60_000, key: 'first' };
const base: JamState = { epoch: 'personal', revision: 1, occurrence: 1, queue: [ref], index: 0, playing: false, positionMs: 0, updatedAtMs: 10_000,
  personal: { explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: false, cursor: null, output: { clientId: 'phone', connectionId: 'c1' }, disconnected: false } };
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
const storage: QueueStorage = { load: async () => null, loadMutations: async () => [], saveMutations: async () => [], save: async () => {}, progress: async () => {} };
const events = () => playbackEvents().map(event => event.event + (event.fields.output ? ':' + event.fields.output : '') + (event.fields.outcome ? ':' + event.fields.outcome : ''));

test('the playback log follows the account queue from admission to a dispatched result', async () => {
  clearPlaybackEvents();
  const socket = new Socket();
  const queue = new PersonalQueue({ owner: 'account', storage, id: () => 'cmd', client: 'phone',
    resolve: async () => ({ data: [], missing: [] }), changed: () => {}, remote: () => {}, error: () => {},
    connect: { admit: async () => ({ ticket: 't', websocketUrl: 'wss://test/socket?ticket=secret' }), socket: () => socket } });
  try {
    await queue.start();
    socket.receive({ type: 'state', state: base });
    await tick();
    const result = queue.dispatch({ action: 'pause' });
    socket.receive({ type: 'result', id: 'cmd', outcome: 'applied' });
    assert.equal(await result, true);
    socket.receive({ type: 'state', state: { ...base, revision: 2, personal: { ...base.personal, output: { clientId: 'laptop', connectionId: 'c2' } } } });
    assert.deepEqual(events(), ['queue session started', 'queue connecting', 'queue admitted', 'queue state:this device', 'queue connected',
      'queue dispatch', 'queue result:applied', 'queue state:another device']);
    assert.ok(!JSON.stringify(playbackEvents()).includes('secret'), 'admission URLs and tickets stay out of the log');
  } finally { queue.close(); clearPlaybackEvents(); }
});

test('a failed admission and a dispatch without a connection are both recorded', async () => {
  clearPlaybackEvents();
  const queue = new PersonalQueue({ owner: 'account', storage, id: () => 'cmd', client: 'phone',
    resolve: async () => ({ data: [], missing: [] }), changed: () => {}, remote: () => {}, error: () => {},
    connect: { admit: async () => { throw new Error('service auth refused'); }, socket: () => new Socket() } });
  try {
    await queue.start();
    await tick();
    assert.equal(await queue.dispatch({ action: 'play' }), false);
    const failed = playbackEvents().find(event => event.event === 'queue admission failed');
    assert.equal(failed?.fields.error, 'service auth refused');
    assert.ok(playbackEvents().some(event => event.event === 'queue dispatch skipped'));
  } finally { queue.close(); clearPlaybackEvents(); }
});
