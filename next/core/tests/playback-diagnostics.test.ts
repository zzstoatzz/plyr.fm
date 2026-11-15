import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPlaybackEvents, formatPlaybackEvents, playbackEvents, recordPlayback, urlHost } from '../src/playback-diagnostics.ts';

test('keeps only the most recent playback events', () => {
  clearPlaybackEvents();
  for (let index = 0; index < 100; index++) recordPlayback('load', { request: index }, index);
  assert.equal(playbackEvents().length, 80);
  assert.equal(playbackEvents()[0].fields.request, 20);
  clearPlaybackEvents();
});

test('reports a host, never the full URL with its signature', () => {
  assert.equal(urlHost('https://bucket.r2.cloudflarestorage.com/audio/a.mp3?X-Amz-Signature=secret'), 'bucket.r2.cloudflarestorage.com');
  assert.equal(urlHost('not a url'), null);
  assert.equal(urlHost(undefined), null);
});

test('formats a header line and one line per event, leaving out unset fields', () => {
  const text = formatPlaybackEvents([
    { at: Date.UTC(2026, 10, 13, 4, 0, 0), event: 'load', fields: { request: 1, signedIn: true, media: undefined } },
    { at: Date.UTC(2026, 10, 13, 4, 0, 6), event: 'early play expired', fields: {} },
  ], { platform: 'ios', authReady: false });
  assert.equal(text, [
    'platform=ios authReady=false',
    '2026-11-13T04:00:00.000Z load request=1 signedIn=true',
    '2026-11-13T04:00:06.000Z early play expired',
  ].join('\n'));
});
