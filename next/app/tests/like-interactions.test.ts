import assert from 'node:assert/strict';
import test from 'node:test';
import { wantLike } from '../src/like-interactions.ts';

const deferred = () => { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('taps during a write only move the target, and the writer catches up to the last one', async () => {
  const rpc = {} as never;
  const writes: boolean[] = [];
  const gates: ReturnType<typeof deferred>[] = [];
  const write = (liked: boolean) => { writes.push(liked); const gate = deferred(); gates.push(gate); return gate.promise; };
  const first = wantLike(rpc, 'at://a/track/1', false, true, write);
  assert.equal(await wantLike(rpc, 'at://a/track/1', true, false, write), undefined);
  assert.equal(await wantLike(rpc, 'at://a/track/1', false, true, write), undefined);
  assert.equal(await wantLike(rpc, 'at://a/track/1', true, false, write), undefined);
  gates[0].resolve();
  await new Promise(resolve => setImmediate(resolve));
  gates[1].resolve();
  assert.deepEqual(await first, { liked: false, changed: false, failed: false });
  assert.deepEqual(writes, [true, false], 'one write per direction, not one per tap');
});

test('a failed write settles on what was last written', async () => {
  const rpc = {} as never;
  const outcome = await wantLike(rpc, 'at://a/track/2', false, true, () => Promise.reject(new Error('pds down')));
  assert.deepEqual(outcome, { liked: false, changed: false, failed: true });
});

test('a single tap writes once', async () => {
  const rpc = {} as never;
  const writes: boolean[] = [];
  const outcome = await wantLike(rpc, 'at://a/track/3', false, true, async liked => { writes.push(liked); });
  assert.deepEqual(outcome, { liked: true, changed: true, failed: false });
  assert.deepEqual(writes, [true]);
});
