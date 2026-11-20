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
  assert.equal(sniffAudioExtension(bytes('<html>')), undefined);
});

test('private audio accepts the video/mp4 label a sniffing PDS gives iPhone m4a files', async () => {
  const { playableBlobType } = await import('../src/gated-audio.ts');
  assert.equal(playableBlobType('audio/x-m4a'), true);
  assert.equal(playableBlobType('video/mp4'), true);
  assert.equal(playableBlobType('video/webm'), false);
  assert.equal(playableBlobType('application/octet-stream'), false);
});
