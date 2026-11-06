import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const id = '12345678-1234-1234-1234-123456789abc';
const url = `https://next.fixture.test/__plyr_private_audio/${id}`;
const source = { url: 'https://pds.fixture.test/xrpc/com.atproto.space.getBlob?space=private&repo=owner&cid=blob', size: 100, mimeType: 'audio/wav', headers: { authorization: 'fixture-credential' } };
const worker = await readFile(new URL('../public/private-audio-worker.js', import.meta.url), 'utf8');

type FetchEvent = { clientId: string; request: Request; respondWith(response: Promise<Response>): void };
type MessageEvent = { source: { id: string }; data: { type: string; id: string } };

function fixture(upstream: (url: string, init: RequestInit) => Promise<Response>) {
  let fetchEvent: ((event: FetchEvent) => void) | undefined;
  let messageEvent: ((event: MessageEvent) => void) | undefined;
  let admitted = true;
  const calls: RequestInit[] = [];
  const self = { location: { origin: 'https://next.fixture.test' },
    addEventListener(type: string, listener: never) { if (type === 'fetch') fetchEvent = listener; if (type === 'message') messageEvent = listener; },
    clients: { async get(clientId: string) { return { type: 'window', postMessage(_message: object, ports: MessagePort[]) { ports[0].postMessage(clientId === 'owner' && admitted ? source : { error: 'unavailable' }); } }; } } };
  vm.runInNewContext(worker, { self, URL, Request, Response, Headers, ReadableStream, AbortController, MessageChannel, setTimeout, clearTimeout,
    fetch: async (target: string, init: RequestInit) => { calls.push(init); return upstream(target, init); } });
  return {
    calls,
    request(range?: string, method = 'GET', clientId = 'owner') {
      return new Promise<Response>(resolve => fetchEvent?.({ clientId, request: new Request(url, { method, headers: range ? { range } : {} }), respondWith: response => resolve(response) }));
    },
    release() { admitted = false; messageEvent?.({ source: { id: 'owner' }, data: { type: 'plyr-private-audio-release', id } }); }
  };
}

test('native ranges stream immediately, retaining range semantics even when CORS hides Content-Range', async () => {
  let finish: (() => void) | undefined;
  const f = fixture(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([1, 2]));
    finish = () => { controller.enqueue(new Uint8Array([3, 4])); controller.close(); };
  } }), { status: 206, headers: { 'content-length': '4' } }));
  const response = await f.request('bytes=20-23');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 20-23/100');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body!.getReader();
  assert.deepEqual([...((await reader.read()).value ?? [])], [1, 2]);
  finish?.();
  assert.deepEqual([...((await reader.read()).value ?? [])], [3, 4]);
  assert.equal((await reader.read()).done, true);
  assert.equal(new Headers(f.calls[0].headers).get('range'), 'bytes=20-23');
  assert.equal(f.calls[0].credentials, 'omit');
});

test('HEAD and invalid ranges use verified metadata without downloading audio', async () => {
  const f = fixture(async () => { throw new Error('unexpected body read'); });
  const head = await f.request(undefined, 'HEAD');
  assert.equal(head.headers.get('content-length'), '100');
  const invalid = await f.request('bytes=100-');
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */100');
  assert.equal(f.calls.length, 0);
});

test('a copied URL in another tab has no admission and released URLs stop working', async () => {
  const f = fixture(async () => new Response(new Uint8Array(100)));
  assert.equal((await f.request(undefined, 'GET', 'stranger')).status, 410);
  f.release();
  assert.equal((await f.request()).status, 410);
  assert.equal(f.calls.length, 0);
});

test('release aborts an active upstream fetch and cancels its body', async () => {
  let aborted = false;
  const f = fixture(async (_url, init) => {
    init.signal?.addEventListener('abort', () => { aborted = true; });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }));
  });
  const response = await f.request();
  const reader = response.body!.getReader();
  await reader.read();
  f.release();
  assert.equal(aborted, true);
  await reader.cancel();
});

test('partial responses with inconsistent length are rejected before playback', async () => {
  const f = fixture(async () => new Response(new Uint8Array(20), { status: 206, headers: { 'content-length': '20' } }));
  assert.equal((await f.request('bytes=0-1')).status, 502);
});


test('release racing admission prevents a later upstream audio request', async () => {
  const f = fixture(async () => { throw new Error('released admission reached upstream'); });
  const pending = f.request();
  f.release();
  assert.equal((await pending).status, 410);
  assert.equal(f.calls.length, 0);
});

test('in-flight range requests are bounded and cancellation releases capacity', async () => {
  const f = fixture(async () => new Response(new ReadableStream()));
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request()));
  assert.equal((await f.request()).status, 503);
  for (const response of responses) await response.body?.cancel();
  const next = await f.request();
  assert.equal(next.status, 200);
  await next.body?.cancel();
});
