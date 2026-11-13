import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreWithin } from '../src/auth-restore.ts';

const expired = (reason: unknown) => reason === 'revoked';

test('a prompt restore resolves with the session', async () => {
  assert.deepEqual(await restoreWithin(Promise.resolve('session'), 50, expired), { kind: 'restored', value: 'session' });
});

test('a revoked session is expired, any other failure is unreachable', async () => {
  assert.deepEqual(await restoreWithin(Promise.reject('revoked'), 50, expired), { kind: 'expired', reason: 'revoked' });
  assert.deepEqual(await restoreWithin(Promise.reject('offline'), 50, expired), { kind: 'unreachable', reason: 'offline' });
});

test('a stalled refresh stops blocking after the deadline', async () => {
  const started = Date.now();
  const result = await restoreWithin(new Promise<string>(() => undefined), 30, expired);
  assert.equal(result.kind, 'slow');
  assert.ok(Date.now() - started < 1000);
});

test('a slow restore still reports its eventual outcome', async () => {
  let finish!: (value: string) => void;
  const result = await restoreWithin(new Promise<string>(resolve => { finish = resolve; }), 10, expired);
  assert.equal(result.kind, 'slow');
  if (result.kind !== 'slow') return;
  finish('session');
  assert.deepEqual(await result.late, { kind: 'restored', value: 'session' });
});
