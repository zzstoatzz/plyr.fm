import assert from 'node:assert/strict';
import test from 'node:test';
import { jamSpace } from '../src/jam-space.ts';
import { JAM_SPACE } from '../src/auth-config.ts';
import type { Agent, Did } from '../src/auth-state.ts';
import type { SpaceAudioTransport } from '../src/gated-audio-shared.ts';

const host: Did = 'did:plc:jamhost';
const member: Did = 'did:plc:jammember';
const transport: SpaceAudioTransport = {
  async keypair() { throw new Error('inviting does not mint a credential'); },
  async fetch() { throw new Error('inviting uses the authenticated owner agent'); }
};

function fixture(did: Did, status = 200) {
  const requests: { path: string; init?: RequestInit }[] = [];
  const agent: Agent = {
    async handle(path, init) {
      requests.push({ path, init });
      return new Response(null, { status });
    }
  };
  return { requests, space: jamSpace(agent, did, host, 'party', transport) };
}

test('Jam invitation sends a singleton read-only grant through putMembers', async () => {
  const f = fixture(host);
  await f.space.invite(member);
  assert.equal(f.requests.length, 1);
  const { path, init } = f.requests[0];
  assert.equal(path, '/xrpc/com.atproto.memberspace.putMembers');
  assert.equal(init?.method, 'POST');
  assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
  assert.equal(typeof init?.body, 'string');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    space: `at://${host}/space/${JAM_SPACE.type}/party`,
    members: [{ did: member, read: true, write: false }]
  });
});

test('a non-owner cannot send a Jam invitation', async () => {
  const f = fixture(member);
  await assert.rejects(f.space.invite(member), /only the host can change this jam/);
  assert.equal(f.requests.length, 0);
});

test('a rejected Jam membership write remains a failed invitation', async () => {
  const f = fixture(host, 403);
  await assert.rejects(f.space.invite(member), /jam request failed \(403\)/);
  assert.equal(f.requests.length, 1);
});
