import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import type { JamSocket, JamState } from '../src/jam-connection.ts';
import { createJamPlayback, jamTrack, type ActiveJam, type JamPlaybackTarget } from '../src/jam-playback.ts';

const host = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const track: Track = {
  object: 'track', id: 'trk_test', record: { uri: 'at://' + host + '/fm.plyr.track/test', cid: 'cid',
    collection: 'fm.plyr.track', rkey: 'test', revision: null },
  metadata: { title: 'test track', duration_seconds: 70, created_at: '', description: null, album: null },
  artist: { did: host, profile: { handle: 'host.test', display_name: 'Host', avatar_url: null } },
  media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 },
};

class Socket implements JamSocket {
  readyState = 1;
  onopen: JamSocket['onopen'] = null;
  onmessage: JamSocket['onmessage'] = null;
  onclose: JamSocket['onclose'] = null;
  onerror: JamSocket['onerror'] = null;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; }
  state(state: JamState) {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data: JSON.stringify({ type: 'state', state }) }));
  }
}

test('a guest follows the room position and returns to solo playback on leave', async () => {
  const socket = new Socket();
  const seeks: number[] = [];
  let snapshot: ActiveJam | undefined;
  const target: JamPlaybackTarget = {
    queue: [track], index: 0, current: track, ready: true, buffering: false, position: () => 5, playing: () => false,
    load: async () => true, loaded: async () => {},
    seek: async position => { seeks.push(position); }, play: () => {}, pause: () => {}, setQueue: () => {}, clear: () => {},
  };
  const controller = createJamPlayback({
    target: () => target, did: 'did:plc:guest', socket: () => socket,
    track: async () => track, changed: value => { snapshot = value; },
  });
  const ref = jamTrack(track);
  assert.ok(ref);
  controller.join({ host, key: 'room', admit: async () => ({ ticket: 'ticket', websocketUrl: 'wss://fixture.test' }) });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    socket.state({ epoch: 'room', revision: 1, occurrence: 1, queue: [ref],
      index: 0, playing: false, positionMs: 23000, updatedAtMs: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seeks, [23]);
    assert.equal(controller.command({ action: 'seek', positionMs: 32000 }), true);
    assert.equal(snapshot?.error, 'only the host can seek in this jam');
    assert.deepEqual(socket.sent, []);
    controller.leave();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seeks, [23, 5]);
    assert.equal(snapshot, undefined);
  } finally { controller.close(); }
});
