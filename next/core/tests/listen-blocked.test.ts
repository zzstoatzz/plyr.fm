import assert from 'node:assert/strict';
import test from 'node:test';
import { delegationRefusal, ListenBlocked, listenBlock, signInLabel } from '../src/listen-blocked.ts';

const answer = (status: number, error?: string) => new Response(error ? JSON.stringify({ error, message: 'x' }) : 'nope', { status });

test('a host without private-track support is told apart from a hiccup', async () => {
  for (const response of [answer(501, 'MethodNotImplemented'), answer(501), answer(400, 'XRPCNotSupported'), answer(404, 'UnknownMethod')]) {
    const refusal = await delegationRefusal(response);
    assert.ok(refusal instanceof ListenBlocked);
    assert.equal(refusal.block, 'unsupported-host');
    assert.equal(listenBlock(refusal.message), 'unsupported-host');
    assert.doesNotMatch(refusal.message, /PDS|try again|space|music/i);
  }
  for (const response of [answer(502), answer(500, 'InternalServerError'), answer(429, 'RateLimitExceeded')]) {
    const refusal = await delegationRefusal(response);
    assert.equal(listenBlock(refusal.message), undefined);
    assert.match(refusal.message, /try again/);
  }
});

test('an expired session asks for a new sign-in, with a link label', async () => {
  const refusal = await delegationRefusal(answer(401, 'InvalidToken'));
  assert.equal(listenBlock(refusal.message), 'reconnect');
  assert.equal(signInLabel('reconnect'), 'sign in again');
  assert.equal(signInLabel(listenBlock(new ListenBlocked('sign-in').message)), 'sign in');
  assert.equal(signInLabel('unsupported-host'), undefined);
  assert.equal(listenBlock('could not load this audio'), undefined);
});
