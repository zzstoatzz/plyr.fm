import assert from 'node:assert/strict';
import test from 'node:test';
import { linkName, readArtistPage, readBackdrop, readLinks, sameLinks } from '../src/artist-page.ts';

test('links keep https urls and short labels, at most six', () => {
  const links = readLinks([
    { url: 'https://dawn.bandcamp.com/', label: ' bandcamp ' },
    { url: 'https://dawn.example' },
    { url: 'javascript:alert(1)', label: 'x' },
    { url: 'http://dawn.example' },
    'nope',
    ...Array.from({ length: 8 }, (_, i) => ({ url: `https://dawn.example/${i}` })),
  ]);
  assert.equal(links.length, 6);
  assert.deepEqual(links[0], { url: 'https://dawn.bandcamp.com/', label: 'bandcamp' });
  assert.deepEqual(links[1], { url: 'https://dawn.example' });
});

test('a link reads as its label, else the store or host', () => {
  assert.equal(linkName({ url: 'https://dawn.bandcamp.com/album/x' }), 'Bandcamp');
  assert.equal(linkName({ url: 'https://www.dawn.example/shows' }), 'dawn.example');
  assert.equal(linkName({ url: 'https://dawn.example', label: 'tour dates' }), 'tour dates');
});

test('a backdrop falls back to the photo unless it is well formed', () => {
  assert.deepEqual(readBackdrop(undefined), { kind: 'photo' });
  assert.deepEqual(readBackdrop({ kind: 'plain' }), { kind: 'plain' });
  assert.deepEqual(readBackdrop({ kind: 'color', color: '#1F7A55' }), { kind: 'color', color: '#1f7a55' });
  assert.deepEqual(readBackdrop({ kind: 'color', color: 'green' }), { kind: 'photo' });
  assert.deepEqual(readBackdrop({ kind: 'image', image: 'https://images.plyr.fm/images/a.png' }), { kind: 'image', image: 'https://images.plyr.fm/images/a.png' });
  assert.deepEqual(readBackdrop({ kind: 'image', image: 'https://tracker.example/a.png' }), { kind: 'photo' });
});

test('settings read with defaults and compare by value', () => {
  assert.deepEqual(readArtistPage({ theme: 'dark' }), { links: [], backdrop: { kind: 'photo' } });
  assert.ok(sameLinks([{ url: 'https://a.example' }], [{ url: 'https://a.example', label: '' }]));
  assert.ok(!sameLinks([{ url: 'https://a.example' }], [{ url: 'https://b.example' }]));
});
