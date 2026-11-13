import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyStream } from './upload-fixture-source.mjs';

export async function awaitRendition(transport, initial, signal, wait = delay) {
  let status = initial;
  while (status.state === 'processing') {
    signal.throwIfAborted();
    if (status.recoveryRequired || status.processingFailure) throw new Error(`processing requires recovery: ${status.processingFailure ?? 'unknown'}`);
    await wait(2000, undefined, { signal });
    status = await transport.status();
  }
  assert.equal(status.state, 'complete', 'rendition did not complete');
  assert.ok(status.rendition && status.audioUrl, 'missing completed rendition');
  return status;
}

export function validateManifest(value, audioUrl, source, rendition) {
  assert.equal(value.processed, true, 'manifest does not identify a processed upload');
  assert.deepEqual(value.original, { url: `${audioUrl}/original`, contentType: 'audio/wav', fileType: 'wav', sizeBytes: source.size });
  assert.deepEqual(value.playback, { url: audioUrl, contentType: 'audio/mpeg', sizeBytes: rendition.sizeBytes, duration: rendition.duration });
}

export async function saveRendition(response, path, expectedSize) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('content-length'), String(expectedSize));
  assert.ok(response.body, 'missing rendition body');
  const file = await open(path, 'wx');
  const reader = response.body.getReader(), hash = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      assert.ok(bytes <= expectedSize, 'rendition exceeds declared size');
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const written = await file.write(chunk.value, offset, chunk.value.byteLength - offset);
        assert.ok(written.bytesWritten > 0, 'rendition disk write stopped');
        offset += written.bytesWritten;
      }
    }
    assert.equal(bytes, expectedSize, 'incomplete rendition');
    return { sizeBytes: bytes, sha256: hash.digest('hex') };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
}

export async function verifyProcessedMedia(audioUrl, source, rendition, directory, fetcher = fetch) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const remaining = maximum => { const value = Math.min(maximum, deadline - Date.now()); assert.ok(value > 0, 'processing media verification deadline exceeded'); return value; };
  const get = (url, init = {}, body = false) => fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(remaining(body ? 300000 : 20000)) });
  const manifestResponse = await get(`${audioUrl}/manifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  validateManifest(manifest, audioUrl, source, rendition);
  const original = await get(`${audioUrl}/original`, {}, true);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get('content-disposition'), 'attachment; filename="original.wav"');
  const originalReceipt = await verifyStream(original, source);
  const originalHead = await get(`${audioUrl}/original`, { method: 'HEAD', headers: { origin: 'https://next.plyr.fm' } });
  assert.equal(originalHead.status, 200);
  assert.equal(originalHead.headers.get('content-length'), String(source.size));
  assert.equal(originalHead.headers.get('content-disposition'), 'attachment; filename="original.wav"');
  assert.equal(originalHead.headers.get('access-control-allow-origin'), '*');
  assert.ok(originalHead.headers.get('access-control-expose-headers')?.split(',').map(value => value.trim().toLowerCase()).includes('content-disposition'));
  const originalRange = await get(`${audioUrl}/original`, { headers: { range: 'bytes=0-43' } });
  assert.equal(originalRange.status, 206);
  assert.equal(originalRange.headers.get('content-range'), `bytes 0-43/${source.size}`);
  assert.equal(originalRange.headers.get('content-disposition'), 'attachment; filename="original.wav"');
  assert.deepEqual(Buffer.from(await originalRange.arrayBuffer()), source.read(0, 44));
  const path = `${directory}/rendition.mp3`;
  try {
  const playback = await get(audioUrl, {}, true);
  assert.equal(playback.headers.get('content-disposition'), null);
  assert.equal(playback.headers.get('x-content-type-options'), 'nosniff');
  const renditionReceipt = await saveRendition(playback, path, rendition.sizeBytes);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3', '-show_entries', 'stream=codec_name,sample_rate,bit_rate:format=duration', '-of', 'json', path], { timeout: remaining(30000), maxBuffer: 65536, encoding: 'utf8' }));
  assert.equal(probe.streams.length, 1);
  assert.equal(probe.streams[0].codec_name, 'mp3');
  assert.equal(probe.streams[0].sample_rate, '44100');
  assert.equal(probe.streams[0].bit_rate, '320000');
  const seconds = Number(probe.format.duration);
  assert.ok(Number.isFinite(seconds) && Math.abs(seconds - (source.size - 44) / 768000) < 1, 'rendition duration differs from source');
  assert.equal(Math.round(seconds), rendition.duration);
  execFileSync('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3', '-i', path, '-f', 'null', '-'], { timeout: remaining(300000), maxBuffer: 65536, stdio: ['ignore', 'ignore', 'pipe'] });
  const attachment = await get(`${audioUrl}?download=1`, { method: 'HEAD', headers: { origin: 'https://next.plyr.fm' } });
  assert.equal(attachment.status, 200);
  assert.equal(attachment.headers.get('content-disposition'), 'attachment; filename="audio.mp3"');
  assert.equal(attachment.headers.get('access-control-allow-origin'), '*');
  assert.ok(attachment.headers.get('access-control-expose-headers')?.split(',').map(value => value.trim().toLowerCase()).includes('content-disposition'));
  const prefix = Buffer.alloc(Math.min(64, rendition.sizeBytes)), local = await open(path);
  try { assert.equal((await local.read(prefix, 0, prefix.length, 0)).bytesRead, prefix.length); }
  finally { await local.close(); }
  const range = await get(`${audioUrl}?download=1`, { headers: { range: `bytes=0-${prefix.length - 1}` } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-${prefix.length - 1}/${rendition.sizeBytes}`);
  assert.equal(range.headers.get('content-disposition'), 'attachment; filename="audio.mp3"');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), prefix);
  return { original: originalReceipt, rendition: { ...renditionReceipt, duration: seconds, decoded: true }, manifest };
  } finally { await rm(path, { force: true }); }
}
