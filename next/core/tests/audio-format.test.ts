import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AUDIO_CONTAINERS, audioRoute, containerFromContentType, containerFromFileType, sniffAudio, sniffAudioSource, type ByteSource } from '../src/audio-format.ts';

const corpus = new URL('./fixtures/audio/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', corpus), 'utf8')) as { files: { file: string; container: string | null; codec: string | null }[] };
const bytes = (file: string) => new Uint8Array(readFileSync(new URL(file, corpus)));

/** reads like a picked file, counting how much it was asked for */
function source(data: Uint8Array) {
  const reads: number[] = [];
  const reader: ByteSource = { size: data.length, async read(offset, length) { reads.push(length); return data.slice(offset, offset + length); } };
  return { reader, reads };
}

test('every corpus file is named by its bytes, whatever its name says (the zig sniffer reads the same manifest)', async () => {
  assert.ok(manifest.files.length > 0);
  for (const entry of manifest.files) {
    const expected = entry.container ? { container: entry.container, codec: entry.codec } : undefined;
    assert.deepEqual(sniffAudio(bytes(entry.file)), expected, entry.file);
    assert.deepEqual(await sniffAudioSource(source(bytes(entry.file)).reader), expected, `${entry.file} as a source`);
  }
});

test('an M4A whose moov comes after its audio is still read for its codec, without reading the audio', async () => {
  const alac = bytes('alac.m4a');
  assert.deepEqual(sniffAudio(alac.subarray(0, 64)), { container: 'mp4', codec: 'unknown' });
  // ftyp, then 200 KiB of free space standing in for long audio, then the rest with its moov last
  const ftyp = alac.subarray(0, 28), padding = new Uint8Array(200 * 1024);
  new DataView(padding.buffer).setUint32(0, padding.length);
  padding.set([0x66, 0x72, 0x65, 0x65], 4);
  const file = new Uint8Array([...ftyp, ...padding, ...alac.subarray(28)]);
  const { reader, reads } = source(file);
  assert.deepEqual(await sniffAudioSource(reader), { container: 'mp4', codec: 'alac' });
  // the head, then box headers, then the moov: well under the whole file
  assert.ok(reads.reduce((sum, length) => sum + length, 0) < file.length / 2, String(reads));
});

test('routes: ALAC, WAV, AIFF and FLAC get the MP3 copy; MP3, AAC and AAC in M4A play as they are', () => {
  const route = (file: string) => audioRoute(sniffAudio(bytes(file))!);
  assert.equal(route('mp3-id3.mp3'), 'as_is');
  assert.equal(route('aac.aac'), 'as_is');
  assert.equal(route('aac-faststart.m4a'), 'as_is');
  assert.equal(route('alac.m4a'), 'process');
  assert.equal(route('alac-named.mp3'), 'process');
  assert.equal(route('wav-named.m4a'), 'process');
  assert.equal(route('aiff-named.wav'), 'process');
  assert.equal(audioRoute({ container: 'mp4', codec: 'unknown' }), 'process');
});

test('claims parse into the same containers, aliases included, and every alias has one owner', () => {
  assert.equal(containerFromFileType('aif'), 'aiff');
  assert.equal(containerFromFileType('.M4A'), 'mp4');
  assert.equal(containerFromFileType('opus'), 'ogg');
  assert.equal(containerFromFileType('txt'), undefined);
  assert.equal(containerFromContentType(' Audio/X-WAV ; codecs=1'), 'wav');
  assert.equal(containerFromContentType('video/webm'), 'webm');
  assert.equal(containerFromContentType('application/octet-stream'), undefined);
  for (const [container, info] of Object.entries(AUDIO_CONTAINERS)) {
    for (const name of [info.fileType, ...info.fileTypeAliases]) assert.equal(containerFromFileType(name), container);
    for (const type of [info.contentType, ...info.contentTypeAliases]) assert.equal(containerFromContentType(type), container);
  }
});

test('private audio accepts the video/mp4 label a sniffing PDS gives iPhone m4a files', async () => {
  const { playableBlobType } = await import('../src/gated-audio.ts');
  assert.equal(playableBlobType('audio/x-m4a'), true);
  assert.equal(playableBlobType('video/mp4'), true);
  assert.equal(playableBlobType('video/webm'), false);
  assert.equal(playableBlobType('application/octet-stream'), false);
});

test('replaced audio is labelled as what its bytes are, not its name', async () => {
  const { replacedTrackAudio } = await import('../src/publishing/track-audio.ts');
  const file = { name: 'merch shop.m4a', type: 'audio/x-m4a', size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  assert.equal(replacedTrackAudio({ fileType: 'mp3' }, file, {}, undefined, 'wav').fileType, 'wav');
  assert.equal(replacedTrackAudio({ fileType: 'mp3' }, file, {}).fileType, 'm4a');
});

test('uploads route by their bytes: a WAV named .m4a and an ALAC m4a get the mp3 copy, an AAC m4a goes as is', async () => {
  const { uploadRoute } = await import('../src/publishing/upload-queue-model.ts');
  const route = (file: string) => uploadRoute({ size: 5_000_000 }, sniffAudio(bytes(file)), 30);
  assert.equal(route('wav-named.m4a').kind, 'service');
  assert.ok((route('wav-named.m4a') as { processing?: unknown }).processing);
  assert.ok((route('alac.m4a') as { processing?: unknown }).processing);
  assert.ok((route('flac-named.mp3') as { processing?: unknown }).processing);
  assert.deepEqual(route('aac-faststart.m4a'), { kind: 'pds' });
  assert.deepEqual(route('mp3-id3.mp3'), { kind: 'pds' });
  assert.throws(() => route('text-named.wav'), /isn't audio/);
});
