import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLink, offerFor, offerLabel, readSelling, sellingLink, storeName, withBuyLink } from '../src/selling.ts';

const album = 'at://did:plc:a/fm.plyr.list/3abc';
const track = 'at://did:plc:a/fm.plyr.track/3def';

test('links are plain https with a host', () => {
  assert.equal(sellingLink('https://ko-fi.com/dawn'), 'https://ko-fi.com/dawn');
  assert.equal(sellingLink('http://ko-fi.com/dawn'), undefined);
  assert.equal(sellingLink('javascript:alert(1)'), undefined);
  assert.equal(sellingLink('https://user:pw@ko-fi.com/'), undefined);
  assert.equal(sellingLink('https://localhost/x'), undefined);
  assert.equal(normalizeLink('  dawn.bandcamp.com/album/tide '), 'https://dawn.bandcamp.com/album/tide');
  assert.equal(normalizeLink(''), undefined);
});

test('stores read as the thing itself', () => {
  assert.equal(storeName('https://dawn.bandcamp.com/album/tide'), 'Bandcamp');
  assert.equal(storeName('https://www.ko-fi.com/dawn'), 'ko-fi');
  assert.equal(storeName('https://shop.example.org/x'), 'shop.example.org');
  // a price saved by an older build is never shown: plyr.fm can't check it
  assert.equal(offerLabel({ url: 'https://dawn.bandcamp.com/x', amount: 800, currency: 'USD' } as never), 'on Bandcamp');
  assert.equal(offerLabel({ url: 'https://ko-fi.com/dawn' }), 'on ko-fi');
});

test('the first matching subject wins and bad offers are dropped', () => {
  const artist = { offers: [
    { subject: track, url: 'https://ko-fi.com/a', amount: null, currency: null },
    { subject: album, url: 'https://a.bandcamp.com/album/x', amount: 800, currency: 'USD' },
    { subject: 'at://did:plc:a/fm.plyr.track/bad', url: 'javascript:x' },
  ] };
  assert.equal(offerFor(artist, [album, track])?.amount, 800);
  assert.equal(offerFor(artist, [undefined, track])?.url, 'https://ko-fi.com/a');
  assert.equal(offerFor(artist, ['at://did:plc:a/fm.plyr.track/bad']), undefined);
  assert.equal(offerFor(undefined, [album]), undefined);
});

test('settings round-trip and one link per release', () => {
  const settings = readSelling({ theme: 'dark', supportUrl: 'https://ko-fi.com/a', buyLinks: [{ subject: album, url: 'https://a.bandcamp.com/x', amount: 5, currency: 'usd' }] });
  assert.equal(settings.supportUrl, 'https://ko-fi.com/a');
  assert.deepEqual(settings.buyLinks, [{ subject: album, url: 'https://a.bandcamp.com/x' }]);
  const replaced = withBuyLink(settings.buyLinks, { subject: album, url: 'https://a.bandcamp.com/y', amount: 800, currency: 'USD' });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].url, 'https://a.bandcamp.com/y');
  assert.deepEqual(withBuyLink(replaced, { subject: album }), []);
  assert.deepEqual(readSelling(null), { supportUrl: '', buyLinks: [] });
});

test('a saved price reads back into the editor without grouping', async () => {
  const { priceText, parsePrice } = await import('../src/access/policy.ts');
  for (const [amount, currency] of [[150000, 'USD'], [1500, 'JPY'], [750, 'EUR'], [800, 'USD']] as const) {
    assert.equal(parsePrice(priceText(amount, currency), currency), amount);
  }
  assert.equal(priceText(800, 'USD'), '8');
  assert.equal(priceText(750, 'USD'), '7.50');
});

test('a track finds its album by name', async () => {
  const { albumNamed } = await import('../src/selling.ts');
  const albums = [{ metadata: { name: 'Tide ' }, id: 'a' }, { metadata: { name: null }, id: 'b' }];
  assert.equal(albumNamed('tide', albums)?.id, 'a');
  assert.equal(albumNamed(null, albums), undefined);
});

test('the sell card sees the whole catalog, page by page', async () => {
  const { sellableReleases } = await import('../src/selling.ts');
  const track = (n: number) => ({ record: { uri: `at://did:plc:a/fm.plyr.track/${n}` }, metadata: { title: `t${n}`, album: null }, media: {}, access: { visibility: 'public' } });
  const pages = [[track(1), track(2)], [track(3)]];
  const releases = await sellableReleases({
    albums: async () => ({ object: 'list', data: [], has_more: false }),
    tracks: async cursor => { const index = cursor ? Number(cursor) : 0; return { object: 'list', data: pages[index] as never, has_more: index < 1, next_cursor: String(index + 1) }; },
  });
  assert.deepEqual(releases.map(release => release.title), ['t1', 't2', 't3']);
});

test('the buy-link picker finds unlinked releases by every typed word', async () => {
  const { findReleases, linkedReleases } = await import('../src/selling.ts');
  const releases = [
    { uri: 'a', title: 'Mike Jones Trio - Sept 12', kind: 'album', group: 'album' as const },
    { uri: 'b', title: "mike's interview, part 2", kind: 'single', group: 'track' as const },
    { uri: 'c', title: 'covers', kind: 'album', group: 'album' as const },
  ];
  const links = [{ subject: 'c', url: 'https://x.bandcamp.com' }];
  assert.deepEqual(findReleases(releases, links, '').map(r => r.uri), ['a', 'b']);
  assert.deepEqual(findReleases(releases, links, '  MIKE  trio ').map(r => r.uri), ['a']);
  assert.deepEqual(findReleases(releases, links, 'mike', 'track').map(r => r.uri), ['b']);
  assert.deepEqual(findReleases(releases, links, 'covers'), []);
  assert.deepEqual(linkedReleases(releases, [...links, { subject: 'gone', url: 'https://y.bandcamp.com' }]).map(item => item.release.uri), ['c']);
});
