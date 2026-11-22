import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestWriter } from '../src/latest-write.ts';

test('the writer settles on the last wanted value and only the first tap gets the outcome', async () => {
  const writer = createLatestWriter();
  const writes: boolean[] = [];
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  const first = writer.want('t', false, true, async value => { writes.push(value); if (writes.length === 1) await held; });
  assert.equal(writer.busy('t'), true);
  assert.equal(await writer.want('t', true, false, async () => {}), undefined);
  assert.equal(await writer.want('t', false, true, async () => {}), undefined);
  assert.equal(await writer.want('t', true, false, async () => {}), undefined);
  release();
  assert.deepEqual(await first, { value: false, changed: false, failed: false, error: undefined });
  assert.deepEqual(writes, [true, false]);
  assert.equal(writer.busy('t'), false);
});

test('a failure stops at the last value that was written', async () => {
  const writer = createLatestWriter();
  const outcome = await writer.want('t', false, true, async () => { throw new Error('offline'); });
  assert.equal(outcome?.value, false);
  assert.equal(outcome?.failed, true);
  assert.equal((outcome?.error as Error).message, 'offline');
});
