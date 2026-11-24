import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('playing bars stop writing native props while inactive and resume in the foreground', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const fake = specifier === 'react' ? 'react' : specifier === 'react-native' ? 'native' : specifier === './api-client' ? 'api' : undefined;
      return fake ? { url: `mock:${fake}`, shortCircuit: true } : next(specifier, context);
    },
    load(url, context, next) {
      const source = {
        'mock:react': 'export const useEffect = globalThis.watchdogFixture.effect; export const useSyncExternalStore = (_, get) => get();',
        'mock:native': 'export const AppState = globalThis.watchdogFixture.appState; export const Animated = globalThis.watchdogFixture.animated;',
        'mock:api': 'export const api = globalThis.watchdogFixture.api;',
      }[url];
      return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
    },
  });
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Set<(state: string) => void>();
  let nextFrame = 0;
  let writes = 0;
  let cleanup: (() => void) | undefined;
  const appState = {
    currentState: 'active',
    addEventListener(_: 'change', listener: (state: string) => void) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const changeState = (state: string) => {
    appState.currentState = state;
    listeners.forEach(listener => listener(state));
  };
  const renderFrame = () => {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback(performance.now());
    return callback;
  };
  const uri = 'at://did:plc:artist/fm.plyr.track/song';
  Object.assign(globalThis, {
    requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
    watchdogFixture: {
      effect: (setup: () => (() => void) | undefined) => { cleanup = setup(); },
      appState,
      animated: { Value: class { setValue() { writes++; } } },
      api: { async trackWaveform() { return { uri, cid: 'fixture', fps: 1, bands: 4, levels: Uint8Array.of(255, 64, 32, 0) }; } },
    },
  });
  try {
    const { feedPlayingLevels, usePlayingLevels } = await import('../src/playing-levels.ts');
    usePlayingLevels(true);
    feedPlayingLevels(uri, 0, true);
    await new Promise<void>(resolve => setImmediate(resolve));
    renderFrame();
    assert.equal(writes, 4);
    const pendingFrame = frames.values().next().value!;
    changeState('inactive');
    assert.equal(frames.size, 0);
    pendingFrame(performance.now());
    assert.equal(writes, 4);
    changeState('background');
    feedPlayingLevels(uri, 20, true);
    assert.equal(frames.size, 0);
    changeState('active');
    assert.equal(frames.size, 1);
    renderFrame();
    assert.equal(writes, 8);
    cleanup?.();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    hooks.deregister();
  }
});
