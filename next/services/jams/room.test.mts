import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRoomCommand, initialRoom, positionAt, type RoomState } from './room.mts';

const track = {
  uri: 'at://did:plc:artist/fm.plyr.track/example',
  cid: 'bafyreigljuhgh5mrstq3xxokme2mxkuhw3nzo4yzfyvhdb6ejrzeoc76wu',
};

function command(state: RoomState, value: unknown, nowMs: number, writerDid = 'did:plc:guest') {
  return applyRoomCommand(state, {
    value, nowMs, writerDid, hostDid: 'did:plc:host',
    canWrite: (did) => did === 'did:plc:guest',
    trackCollection: 'fm.plyr.track',
  });
}

function applied(result: ReturnType<typeof command>) {
  assert.equal(result.outcome, 'applied');
  return result.state;
}

test('one accepted command advances a revision and freezes the room at host time', () => {
  const empty = initialRoom(1000);
  const loaded = applied(command(empty, { action: 'replaceQueue', baseRevision: 0, queue: [track], index: 0 }, 1100));
  const playing = applied(command(loaded, { action: 'play', baseRevision: 1 }, 1200));
  const pause = { action: 'pause', baseRevision: 2 };
  const stopped = applied(command(playing, pause, 3700));
  assert.equal(stopped.positionMs, 2500);
  assert.equal(positionAt(stopped, 5000), 2500);
  assert.deepEqual(command(stopped, pause, 3800), { outcome: 'conflict', revision: 3 });
  assert.deepEqual(command(playing, pause, 3800, 'did:plc:removed'), { outcome: 'forbidden', revision: 2 });
});

test('invalid queue changes cannot displace the current room state', () => {
  const room = initialRoom(1000);
  for (const value of [
    { action: 'replaceQueue', baseRevision: 0, queue: [{ ...track, uri: 'https://example.com/audio' }], index: 0 },
    { action: 'replaceQueue', baseRevision: 0, queue: [track], index: 1 },
    { action: 'replaceQueue', baseRevision: 0, queue: Array(201).fill(track), index: 0 },
    { action: 'play', baseRevision: 0 },
    { action: 'seek', baseRevision: 0, positionMs: -1 },
  ]) assert.deepEqual(command(room, value, 1100), { outcome: 'invalid', revision: 0 });
});

test('queue edits preserve a playing strong reference and reset when its CID changes', () => {
  const loaded = applied(command(initialRoom(1000), { action: 'replaceQueue', baseRevision: 0, queue: [track], index: 0 }, 1100));
  const playing = applied(command(loaded, { action: 'play', baseRevision: 1 }, 1200));
  const replacement = { uri: track.uri, cid: 'bafyreic2jfqqibe5uvgwdeoqnvcapvnx27ftzb5qlx5qelga3lbuk6wcny' };
  const queued = applied(command(playing, { action: 'replaceQueue', baseRevision: 2, queue: [replacement, track], index: 1 }, 1700));
  assert.equal(queued.positionMs, 500);
  const changed = applied(command(queued, { action: 'replaceQueue', baseRevision: 3, queue: [replacement], index: 0 }, 1900));
  assert.equal(changed.positionMs, 0);
  assert.equal(changed.playing, true);
  const cleared = applied(command(changed, { action: 'replaceQueue', baseRevision: 4, queue: [], index: 0 }, 2000));
  assert.equal(cleared.playing, false);
});
