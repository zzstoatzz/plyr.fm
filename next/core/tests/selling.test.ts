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
  assert.equal(offerLabel({ url: 'https://dawn.bandcamp.com/x', amount: 800, currency: 'USD' }).endsWith('on Bandcamp'), true);
  assert.match(offerLabel({ url: 'https://dawn.bandcamp.com/x', amount: 800, currency: 'USD' }), /8/);
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
