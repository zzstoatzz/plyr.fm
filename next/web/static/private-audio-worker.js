const prefix = '/__plyr_private_audio/';
const active = new Map();
let activeCount = 0;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'plyr-private-audio-release' || !event.source?.id) return;
  const requests = active.get(`${event.source.id}:${event.data.id}`);
  if (requests) for (const controller of requests) controller.abort();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return;
  event.respondWith(serve(event, url.pathname.slice(prefix.length)));
});

function denied(status) {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function authorize(client, id, signal) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const clean = () => { clearTimeout(timer); channel.port1.close(); signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); reject(new Error('released')); };
    const timer = setTimeout(() => { clean(); reject(new Error('owner unavailable')); }, 10_000);
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = event => {
      clean();
      if (event.data?.error) reject(new Error('released'));
      else resolve(event.data);
    };
    try { client.postMessage({ type: 'plyr-private-audio-request', id }, [channel.port2]); }
    catch { clean(); reject(new Error('owner unavailable')); }
    if (signal.aborted) abort();
  });
}

function span(range, size) {
  if (!range) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}

async function serve(event, id) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !event.clientId || !['GET', 'HEAD'].includes(event.request.method)) return denied(404);
  if (activeCount >= 64) return denied(503);
  const key = `${event.clientId}:${id}`;
  let requests = active.get(key);
  if (!requests) { requests = new Set(); active.set(key, requests); }
  if (requests.size >= 8) return denied(503);
  const controller = new AbortController();
  requests.add(controller); activeCount++;
  const abort = () => controller.abort();
  event.request.signal.addEventListener('abort', abort, { once: true });
  if (event.request.signal.aborted) abort();
  let cleaned = false;
  const clean = () => {
    if (cleaned) return;
    cleaned = true; activeCount--;
    requests.delete(controller);
    if (!requests.size) active.delete(key);
    event.request.signal.removeEventListener('abort', abort);
  };
  controller.signal.addEventListener('abort', clean, { once: true });
  if (controller.signal.aborted) clean();
  let streaming = false;
  try {
    const client = await self.clients.get(event.clientId);
    if (!client || client.type !== 'window') return denied(403);
    let source;
    try { source = await authorize(client, id, controller.signal); } catch { return denied(410); }
    if (!source || typeof source.url !== 'string' || !Number.isSafeInteger(source.size) || source.size <= 0 || source.size > 104_857_600
        || typeof source.mimeType !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(source.mimeType) || !source.headers || typeof source.headers !== 'object') return denied(502);
    const url = new URL(source.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return denied(502);
    if (url.pathname !== '/xrpc/com.atproto.space.getBlob') return denied(502);
    const range = event.request.headers.get('range');
    const selected = span(range, source.size);
    const headers = new Headers({
      'content-type': source.mimeType, 'accept-ranges': 'bytes', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin'
    });
    if (!selected) {
      headers.set('content-range', `bytes */${source.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (event.request.method === 'HEAD') {
      headers.set('content-length', String(source.size));
      return new Response(null, { headers });
    }
    const timer = setTimeout(abort, 15_000);
    let upstream;
    try {
      const outgoing = new Headers(source.headers);
      if (range) outgoing.set('range', range);
      upstream = await fetch(source.url, { method: 'GET', headers: outgoing, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (![200, 206].includes(upstream.status) || !upstream.body) {
      await upstream.body?.cancel();
      if (upstream.status === 416) headers.set('content-range', `bytes */${source.size}`);
      return new Response(null, { status: upstream.status >= 400 ? upstream.status : 502, headers });
    }
    const length = upstream.status === 206 ? selected.end - selected.start + 1 : source.size;
    const actualLength = upstream.headers.get('content-length');
    const actualRange = upstream.headers.get('content-range');
    const contentRange = `bytes ${selected.start}-${selected.end}/${source.size}`;
    if (actualLength !== null && Number(actualLength) !== length || upstream.status === 206 && actualRange !== null && actualRange !== contentRange) {
      await upstream.body.cancel(); return denied(502);
    }
    headers.set('content-length', String(length));
    if (upstream.status === 206) headers.set('content-range', contentRange);
    const reader = upstream.body.getReader();
    let received = 0;
    const body = new ReadableStream({
      async pull(output) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            clean();
            if (received !== length) output.error(new Error('incomplete audio'));
            else output.close();
          } else {
            received += value.byteLength;
            if (received > length) { await reader.cancel(); clean(); output.error(new Error('invalid audio length')); }
            else output.enqueue(value);
          }
        } catch (error) { clean(); output.error(error); }
      },
      async cancel(reason) { controller.abort(); clean(); await reader.cancel(reason).catch(() => undefined); }
    });
    streaming = true;
    return new Response(body, { status: upstream.status, headers });
  } catch { return denied(502); }
  finally { if (!streaming) clean(); }
}
