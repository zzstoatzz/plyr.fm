import assert from 'node:assert/strict';
import test from 'node:test';
import { sniffAudioExtension } from '../src/audio-sniff.ts';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap(part => typeof part === 'string' ? [...part].map(char => char.charCodeAt(0)) : part));

test('audio containers are recognised from their first bytes', () => {
  assert.equal(sniffAudioExtension(bytes('ID3', [4, 0])), 'mp3');
  assert.equal(sniffAudioExtension(bytes([0xff, 0xfb, 0x90])), 'mp3');
  assert.equal(sniffAudioExtension(bytes([0xff, 0xf1, 0x50])), 'aac');
  assert.equal(sniffAudioExtension(bytes([0, 0, 0, 0x20], 'ftypM4A ')), 'm4a');
  assert.equal(sniffAudioExtension(bytes('RIFF', [1, 2, 3, 4], 'WAVE')), 'wav');
  assert.equal(sniffAudioExtension(bytes('fLaC')), 'flac');
  assert.equal(sniffAudioExtension(bytes('FORM', [1, 2, 3, 4], 'AIFF')), 'aiff');
  assert.equal(sniffAudioExtension(bytes('OggS')), 'ogg');
  assert.equal(sniffAudioExtension(bytes([0x1a, 0x45, 0xdf, 0xa3])), 'webm');
  assert.equal(sniffAudioExtension(bytes('ID3', [4, 0, 0, 0, 0, 0, 2], [0, 0], [0xff, 0xf1, 0x50])), 'aac');
  assert.equal(sniffAudioExtension(bytes('ID3', [4, 0, 0, 0, 0, 0, 2], [0, 0], [0xff, 0xfb, 0x90])), 'mp3');
  assert.equal(sniffAudioExtension(bytes('<html>')), undefined);
});

test('private audio accepts the video/mp4 label a sniffing PDS gives iPhone m4a files', async () => {
  const { playableBlobType } = await import('../src/gated-audio.ts');
  assert.equal(playableBlobType('audio/x-m4a'), true);
  assert.equal(playableBlobType('video/mp4'), true);
  assert.equal(playableBlobType('video/webm'), false);
  assert.equal(playableBlobType('application/octet-stream'), false);
});

test('a WAV named .m4a is labelled as the WAV it is', async () => {
  const { sniffAudioFormat } = await import('../src/audio-sniff.ts');
  assert.deepEqual(sniffAudioFormat(bytes('RIFF', [1, 2, 3, 4], 'WAVEJUNK')), { fileType: 'wav', contentType: 'audio/wav' });
  assert.deepEqual(sniffAudioFormat(bytes([0, 0, 0, 0x20], 'ftypM4A ')), { fileType: 'm4a', contentType: 'audio/mp4' });
  assert.equal(sniffAudioFormat(bytes('<html>')), undefined);
  const { replacedTrackAudio } = await import('../src/publishing/track-audio.ts');
  const file = { name: 'merch shop.m4a', type: 'audio/x-m4a', size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  assert.equal(replacedTrackAudio({ fileType: 'mp3' }, file, {}, undefined, 'wav').fileType, 'wav');
  assert.equal(replacedTrackAudio({ fileType: 'mp3' }, file, {}).fileType, 'm4a');
});
