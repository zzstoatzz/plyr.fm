import assert from 'node:assert/strict';
import test from 'node:test';
import { displayUrl, thumbnailUrl } from '../src/artwork.ts';

test('plyr artwork uses the stored 96px thumbnail', () => {
  assert.equal(thumbnailUrl('https://images.plyr.fm/images/46848fb2bcc66ae1.jpeg'), 'https://images.plyr.fm/images/46848fb2bcc66ae1_thumb.webp');
  assert.equal(thumbnailUrl('https://images.plyr.fm/images/a106de797085e832.PNG'), 'https://images.plyr.fm/images/a106de797085e832_thumb.webp');
});

test('bluesky avatars use the avatar thumbnail', () => {
  assert.equal(thumbnailUrl('https://cdn.bsky.app/img/avatar/plain/did:plc:abc/bafkrei'), 'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abc/bafkrei');
});

test('other artwork is unchanged', () => {
  for (const uri of [
    'https://images.plyr.fm/images/46848fb2bcc66ae1_thumb.webp',
    'https://images.plyr.fm/other/46848fb2bcc66ae1.jpeg',
    'https://example.com/cover.jpg',
    'https://images.plyr.fm/images/abc.jpeg?x=1',
  ]) assert.equal(thumbnailUrl(uri), uri);
});

test('large plyr artwork is resized at the CDN in shared widths', () => {
  const original = 'https://images.plyr.fm/images/46848fb2bcc66ae1.jpeg';
  assert.equal(displayUrl(original, 372, 3), 'https://images.plyr.fm/cdn-cgi/image/width=1280,quality=82,format=auto/images/46848fb2bcc66ae1.jpeg');
  assert.equal(displayUrl(original, 160, 2), 'https://images.plyr.fm/cdn-cgi/image/width=320,quality=82,format=auto/images/46848fb2bcc66ae1.jpeg');
  assert.equal(displayUrl(original, 40, 3), 'https://images.plyr.fm/images/46848fb2bcc66ae1_thumb.webp');
});

test('legacy r2.dev artwork loads through images.plyr.fm', () => {
  assert.equal(displayUrl('https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/398147982ab1d2b0.png', 48, 3),
    'https://images.plyr.fm/images/398147982ab1d2b0_thumb.webp');
  assert.equal(displayUrl('https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/398147982ab1d2b0.png', 300, 2),
    'https://images.plyr.fm/cdn-cgi/image/width=640,quality=82,format=auto/images/398147982ab1d2b0.png');
});

test('other hosts and transformed urls are unchanged', () => {
  for (const uri of ['https://cdn.bsky.app/img/avatar/plain/did:plc:abc/bafkrei', 'https://images.plyr.fm/cdn-cgi/image/width=320/images/a.jpg', 'https://example.com/cover.jpg'])
    assert.equal(displayUrl(uri, 300, 3), uri);
});
