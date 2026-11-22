import assert from 'node:assert/strict';
import test from 'node:test';
import { barStep, newAtTop, pullMove, refreshMessage, restingPull, waveTarget, WAVE_REST } from '../src/behaviors/pull-refresh.ts';

test('a slow pull ticks once per bar, arms once at the line, and only disarms well under it', () => {
  let state = restingPull;
  const events: string[] = [];
  for (let pull = 0; pull <= 120; pull += 2) {
    const next = pullMove(state, pull, 100);
    state = next.state;
    if (next.event !== 'none') events.push(next.event);
  }
  assert.deepEqual(events, ['tick', 'tick', 'tick', 'tick', 'arm']);
  for (const pull of [99, 95, 85, 81]) assert.equal(pullMove(state, pull, 100).event, 'none', `jitter at ${pull} keeps it armed`);
  const back = pullMove(state, 70, 100);
  assert.equal(back.event, 'disarm');
  assert.equal(back.state.armed, false);
  assert.equal(pullMove(back.state, 100, 100).event, 'arm');
});

test('pulling back in does not tick', () => {
  let state = pullMove(restingPull, 75, 100).state;
  assert.equal(pullMove(state, 30, 100).event, 'none');
  state = pullMove(state, 30, 100).state;
  assert.equal(pullMove(state, 45, 100).event, 'tick');
});

test('the wave fills in bar by bar and rests in its loading shape when armed', () => {
  assert.ok(waveTarget(0, 'idle', 0.2, false, 0) > waveTarget(1, 'idle', 0.2, false, 0));
  assert.equal(waveTarget(4, 'idle', 0, false, 0), waveTarget(4, 'idle', 0.5, false, 0));
  assert.ok(Math.abs(waveTarget(2, 'idle', 1, true, 0) - WAVE_REST[2] * 1.12) < 1e-9);
});

test('a long frame cannot blow up a bar', () => {
  let bar = { height: 0.1, velocity: 400 };
  for (let i = 0; i < 20; i++) bar = barStep(bar, 0.5, 0.25);
  assert.ok(bar.height >= 0.08 && bar.height <= 1.35);
  assert.ok(Number.isFinite(bar.velocity));
});

test('new tracks are counted above the first one the feed already had', () => {
  const ids = (...list: string[]) => list.map(id => ({ id }));
  assert.equal(newAtTop(ids('a', 'b', 'c'), ids('x', 'y', 'a', 'b')), 2);
  assert.equal(newAtTop(ids('a', 'b'), ids('a', 'b')), 0);
  assert.equal(newAtTop([], ids('a')), 0);
  assert.equal(refreshMessage({ ok: true, fresh: 0 }), 'up to date');
  assert.equal(refreshMessage({ ok: true, fresh: 1 }), '1 new track');
  assert.equal(refreshMessage({ ok: true, fresh: 3 }), '3 new tracks');
  assert.equal(refreshMessage({ ok: false }), 'could not refresh');
});
