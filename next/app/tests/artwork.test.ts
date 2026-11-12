import assert from 'node:assert/strict';
import test from 'node:test';
import { thumbnailUrl } from '../src/artwork.ts';

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
