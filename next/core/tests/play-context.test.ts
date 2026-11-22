import assert from 'node:assert/strict';
import test from 'node:test';
import { artistContext, holdsCurrent, playState, pressPlay, showsPause, stationContext, tracksContext, type PlayerNow } from '../src/play-context.ts';

const ref = (rkey: string, cid: string | null = 'c1', did = 'did:plc:a') => ({ record: { uri: `at://${did}/fm.plyr.track/${rkey}`, cid }, artist: { did } });
const now = (over: Partial<PlayerNow> = {}): PlayerNow => ({ current: ref('one'), playing: true, ...over });

test('a context holds the player when the current track belongs to it', () => {
  assert.equal(holdsCurrent(tracksContext([ref('zero'), ref('one')]), now()), true);
  assert.equal(holdsCurrent(tracksContext([ref('two')]), now()), false);
  assert.equal(holdsCurrent(artistContext('did:plc:a'), now()), true);
  assert.equal(holdsCurrent(artistContext('did:plc:b'), now()), false);
});

test('a newer revision of the same track is a different track, except in a jam', () => {
  assert.equal(holdsCurrent(tracksContext([ref('one', 'c2')]), now()), false);
  assert.equal(holdsCurrent(tracksContext([ref('one', 'c2')]), now({ inJam: true })), true);
});

test('radio on air belongs to its station, not to the tracks or artist it plays', () => {
  const radio = now({ station: 'fresh' });
  assert.equal(holdsCurrent(stationContext('fresh'), radio), true);
  assert.equal(holdsCurrent(stationContext('loved'), radio), false);
  assert.equal(holdsCurrent(tracksContext([ref('one')]), radio), false);
  assert.equal(holdsCurrent(artistContext('did:plc:a'), radio), false);
});

test('state reads playing, starting, paused or idle', () => {
  const context = artistContext('did:plc:a');
  assert.equal(playState(context, now()), 'playing');
  assert.equal(playState(context, now({ playing: false, starting: true })), 'starting');
  assert.equal(playState(context, now({ playing: false })), 'paused');
  assert.equal(playState(context, now({ current: null })), 'idle');
  assert.equal(playState(artistContext('did:plc:b'), now()), 'idle');
  assert.deepEqual(['idle', 'paused', 'starting', 'playing'].map(state => showsPause(state as never)), [false, false, true, true]);
});

test('a press toggles the context that holds the player and starts any other', () => {
  const calls: string[] = [];
  const actions = { toggle: () => calls.push('toggle'), start: () => calls.push('start') };
  for (const state of ['idle', 'paused', 'starting', 'playing'] as const) pressPlay(state, actions);
  assert.deepEqual(calls, ['start', 'toggle', 'toggle', 'toggle']);
});
