import test from 'node:test';
import assert from 'node:assert/strict';
import type { AudioEvents, AudioPlayer } from 'expo-audio';
import { attachRemoteTrackControls } from '../src/remote-track-controls.ts';

function setup() {
  let listener: AudioEvents['remoteTrackCommand'] = () => {};
  let removed = 0;
  let cleared = 0;
  const configured: Parameters<AudioPlayer['setActiveForLockScreen']>[] = [];
  const controls = attachRemoteTrackControls({
    addListener: (_, callback) => { listener = callback; return { remove: () => { removed++; } }; },
    setActiveForLockScreen: (...args) => { configured.push(args); },
    clearLockScreenControls: () => { cleared++; },
  });
  return { controls, configured, removed: () => removed, cleared: () => cleared,
    command: (command: 'next' | 'previous') => listener({ command }) };
}

test('native commands use the current queue callbacks without re-registering on progress renders', () => {
  const { controls, configured, command } = setup();
  const calls: string[] = [];
  controls.update({ metadata: { title: 'first' }, next: () => calls.push('old next'), previous: () => calls.push('old previous') });
  controls.update({ metadata: { title: 'first' }, next: () => calls.push('next'), previous: () => calls.push('previous') });
  command('next');
  command('previous');
  assert.deepEqual(calls, ['next', 'previous']);
  assert.equal(configured.length, 1);
  assert.deepEqual(configured[0][2], { showNextTrack: true, showPreviousTrack: true, showSeekForward: false, showSeekBackward: false });
});

test('tail and permission changes disable commands and ignore already queued native events', () => {
  const { controls, configured, command } = setup();
  let calls = 0;
  controls.update({ metadata: { title: 'last' }, next: () => { calls++; }, previous: () => { calls++; } });
  controls.update({ metadata: { title: 'last' }, previous: () => { calls++; } });
  command('next');
  command('previous');
  assert.equal(calls, 1);
  assert.equal(configured.at(-1)?.[2]?.showNextTrack, false);
  controls.update({ metadata: { title: 'last' } });
  command('previous');
  assert.equal(calls, 1);
  assert.equal(configured.at(-1)?.[2]?.showPreviousTrack, false);
});

test('ownership loss clears controls and cleanup removes the subscription', () => {
  const { controls, cleared, removed, command } = setup();
  let calls = 0;
  controls.update({ metadata: { title: 'first' }, next: () => { calls++; } });
  controls.update(null);
  controls.update(null);
  command('next');
  assert.equal(cleared(), 1);
  assert.equal(calls, 0);
  controls.update({ metadata: { title: 'second' }, next: () => { calls++; } });
  command('next');
  assert.equal(calls, 1);
  controls.dispose();
  command('next');
  assert.equal(calls, 1);
  assert.equal(removed(), 1);
  assert.equal(cleared(), 2);
});
