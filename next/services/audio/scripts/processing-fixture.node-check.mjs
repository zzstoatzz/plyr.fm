import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { awaitRendition, saveRendition, validateManifest, verifyProcessedMedia } from './processing-fixture.mjs';
import { waveSource } from './upload-fixture-source.mjs';

test('processing waits without another transfer and stops on explicit recovery', async () => {
  const complete = { state: 'complete', audioUrl: 'https://fixture/audio', rendition: { sizeBytes: 100 } };
  let checks = 0, waits = 0;
  const transport = { async status() { checks++; return complete; } };
  assert.equal(await awaitRendition(transport, { state: 'processing' }, new AbortController().signal, async () => { waits++; }), complete);
  assert.equal(checks, 1); assert.equal(waits, 1);
  for (const status of [{ state: 'processing', processingFailure: 'output_budget_exceeded' }, { state: 'processing', recoveryRequired: true }]) await assert.rejects(awaitRendition(transport, status, new AbortController().signal), /requires recovery/);
  assert.equal(checks, 1);
  await assert.rejects(awaitRendition(transport, { state: 'processing' }, AbortSignal.abort()), { name: 'AbortError' });
});

test('manifest binds original and rendition to the same published upload', () => {
  const url = 'https://fixture/media/owner/id', source = { size: 768044 }, rendition = { sizeBytes: 40000, duration: 1 };
  const manifest = { processed: true, original: { url: `${url}/original`, contentType: 'audio/wav', fileType: 'wav', sizeBytes: source.size }, playback: { url, contentType: 'audio/mpeg', sizeBytes: rendition.sizeBytes, duration: rendition.duration } };
  validateManifest(manifest, url, source, rendition);
  for (const patch of [{ processed: false }, { original: { ...manifest.original, url: 'https://other/original' } }, { playback: { ...manifest.playback, sizeBytes: 1 } }]) assert.throws(() => validateManifest({ ...manifest, ...patch }, url, source, rendition));
});

test('rendition verification streams to disk and rejects truncated or oversized bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'processing-rendition-'));
  try {
    const bytes = new Uint8Array(120000).fill(7);
    for (const length of [bytes.length, bytes.length - 1, bytes.length + 1]) {
      const path = join(directory, `rendition-${length}`);
      const response = new Response(bytes.subarray(0, Math.min(length, bytes.length)), { headers: { 'content-type': 'audio/mpeg', 'content-length': String(length) } });
      const result = saveRendition(response, path, length);
      if (length > bytes.length) await assert.rejects(result, /incomplete rendition/);
      else {
        const receipt = await result;
        assert.equal(receipt.sha256, createHash('sha256').update(bytes.subarray(0, length)).digest('hex'));
        assert.ok((await readFile(path)).equals(Buffer.from(bytes.subarray(0, length))));
      }
    }
    await assert.rejects(saveRendition(new Response(bytes, { headers: { 'content-type': 'audio/mpeg', 'content-length': '1' } }), join(directory, 'oversized'), 1), /exceeds declared size/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('processing media proof decodes actual MP3 and checks retained original and ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'processing-proof-'));
  try {
    const source = waveSource(768044), original = source.read(0, source.size), encoded = join(directory, 'encoded.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100', encoded], { input: original, timeout: 30000, stdio: ['pipe', 'ignore', 'pipe'] });
    const bytes = await readFile(encoded), url = 'https://fixture/media/owner/id';
    const rendition = { sizeBytes: bytes.length, duration: 1 };
    const manifest = { processed: true, original: { url: `${url}/original`, contentType: 'audio/wav', fileType: 'wav', sizeBytes: source.size }, playback: { url, contentType: 'audio/mpeg', sizeBytes: bytes.length, duration: 1 } };
    const receipt = await verifyProcessedMedia(url, source, rendition, directory, async (input, init) => {
      const address = new URL(input), isOriginal = address.pathname.endsWith('/original');
      if (address.pathname.endsWith('/manifest')) return Response.json(manifest);
      const content = isOriginal ? original : bytes;
      const attachment = isOriginal ? 'original.wav' : address.search ? 'audio.mp3' : undefined;
      const headers = { 'content-type': isOriginal ? 'audio/wav' : 'audio/mpeg', 'content-length': String(content.length), 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-disposition', ...(attachment ? { 'content-disposition': `attachment; filename="${attachment}"` } : {}) };
      if (init.method === 'HEAD') return new Response(null, { headers });
      if (init.headers?.range) {
        const end = Number(init.headers.range.split('-')[1]);
        return new Response(content.subarray(0, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes 0-${end}/${content.length}`, 'content-length': String(end + 1) } });
      }
      return new Response(content, { headers });
    });
    assert.equal(receipt.original.sha256, source.sha256());
    assert.equal(receipt.rendition.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(receipt.rendition.decoded, true);
    await assert.rejects(readFile(join(directory, 'rendition.mp3')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
