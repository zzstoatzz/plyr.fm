import test from 'node:test';
import assert from 'node:assert/strict';
import { joinJam } from '../src/jam-space.ts';
import { JamConnection, type JamSocket } from '../src/jam-connection.ts';
import type { Agent, Auth } from '../src/auth-state.ts';

test('a jam admission sends the caller’s Origin, so a native socket can present the same one', async t => {
  const agent: Agent = { async handle() { return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 }); } };
  const sent: Headers[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers));
    return new Response(JSON.stringify({ ticket: 'abc' }), { status: 200 });
  });
  const auth = { agent, did: 'did:plc:listener' } as unknown as Auth;
  const native = await joinJam(auth, 'did:plc:host', 'party', undefined, { Origin: 'https://next.plyr.fm' });
  assert.equal(sent[0].get('origin'), 'https://next.plyr.fm');
  assert.equal(sent[0].get('content-type'), 'application/json');
  assert.match(native.websocketUrl, /^wss:\/\/.+\/v1\/jams\/socket\?ticket=abc$/);
  await joinJam(auth, 'did:plc:host', 'party');
  assert.equal(sent[1].get('origin'), null, 'browsers send their own Origin');
});

test('a socket the coordinator refuses reports its close code before reconnecting', async () => {
  const closes: unknown[] = [];
  let socket!: JamSocket;
  const connection = new JamConnection({ room: 'personal', admit: async () => ({ ticket: 't', websocketUrl: 'wss://test' }),
    socket: () => (socket = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} }),
    onState: () => {}, onPhase: () => {}, onError: () => {}, onClose: (code, reason, opened) => closes.push({ code, reason, opened }) } as never);
  await connection.connect();
  socket.onclose?.call(socket as unknown as WebSocket, { code: 1006, reason: '' } as CloseEvent);
  connection.close();
  assert.deepEqual(closes, [{ code: 1006, reason: '', opened: false }]);
});
