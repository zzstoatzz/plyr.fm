import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as edge from '../edge/link-preview.js';

// the worker is plain JS for Cloudflare; its inferred types are too narrow to assert against
const { default: worker, cardImage, headTags, injectCard, oembed, ogImage, preview, route, slugify, wantsPreview } = edge as any;

const uri = 'at://did:plc:artist/fm.plyr.track/3abc';
const trackId = 'trk_' + btoa(uri).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const albumUri = 'at://did:plc:artist/fm.plyr.list/3alb';
const albumId = 'alb_' + btoa(albumUri).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const track = (overrides: Record<string, unknown> = {}) => ({
  object: 'track',
  id: trackId,
  legacy_id: 1667,
  record: { uri },
  metadata: { title: 'bolloré <est> ton "ennemi"', artist_name: 'Warklo', album: 'edits', duration_seconds: 109 },
  artist: { did: 'did:plc:artist', profile: { handle: 'warklo.test', display_name: 'Nick', avatar_url: 'https://cdn.bsky.app/img/avatar/plain/did:plc:artist/x' } },
  media: { artwork: { url: 'https://images.plyr.fm/images/9029ce64709a5717.png' }, origins: [{ url: 'https://audio.plyr.fm/audio/d49.flac', media_type: 'flac' }] },
  access: { visibility: 'public' },
  moderation: { self_labels: [], operator_labels: [] },
  ...overrides
});

const album = {
  object: 'album',
  id: albumId,
  record: { uri: albumUri },
  metadata: { name: 'Études pour DAC' },
  owner: { did: 'did:plc:artist', profile: { handle: 'warklo.test', display_name: 'Nick' } },
  media: { artwork: { url: 'https://images.plyr.fm/images/cover.jpg' } },
  metrics: { member_count: 3, available_count: 2 },
  members: [{ track: { metadata: { duration_seconds: 100 } } }, { track: { metadata: { duration_seconds: 80 } } }, { track: null }]
};

const api = (over: Record<string, unknown> = {}) => ({
  track: async (id: string) => (id === '1667' || id === trackId ? track() : null),
  artist: async (actor: string) => (actor === 'warklo.test' ? { did: 'did:plc:artist', handle: 'warklo.test', display_name: 'Nick', avatar_url: 'https://cdn.bsky.app/a.jpg' } : null),
  artistMetrics: async () => ({ totals: { tracks: 12 } }),
  albums: async () => ({ data: [album] }),
  album: async (id: string) => (id === albumId ? album : null),
  playlist: async () => null,
  ...over
});

test('routes cover the shareable pages and production album links', () => {
  assert.deepEqual(route('/track/1667'), { kind: 'track', id: '1667' });
  assert.deepEqual(route('/track/1667/'), { kind: 'track', id: '1667' });
  assert.deepEqual(route('/u/warklo.test'), { kind: 'artist', actor: 'warklo.test' });
  assert.deepEqual(route('/u/warklo.test/album/etudes-pour-dac'), { kind: 'legacy-album', actor: 'warklo.test', slug: 'etudes-pour-dac' });
  assert.deepEqual(route('/tag/lo%20fi'), { kind: 'tag', name: 'lo fi' });
  assert.deepEqual(route('/'), { kind: 'home' });
  assert.deepEqual(route('/atlas'), { kind: 'atlas' });
  assert.deepEqual(route('/radio'), { kind: 'radio', station: null });
  assert.deepEqual(route('/radio/deep-cuts'), { kind: 'radio', station: 'deep-cuts' });
  assert.equal(route('/radio/loved/listen'), null);
  assert.equal(route('/track/1/edit'), null);
  assert.equal(route('/settings'), null);
});

test('slugify matches production', () => {
  assert.equal(slugify('Études pour DAC'), 'etudes-pour-dac');
  assert.equal(slugify('Album (Deluxe Edition)'), 'album-deluxe-edition');
  assert.equal(slugify('tūnņg'), 'tunng');
  assert.equal(slugify('  Test   Multiple   Spaces '), 'test-multiple-spaces');
});

test('browsers skip the preview; unfurlers get it', () => {
  const req = (headers: Record<string, string>) => new Request('https://next.plyr.fm/track/1', { headers });
  assert.equal(wantsPreview(req({ 'sec-fetch-mode': 'navigate', 'user-agent': 'Mozilla/5.0 Safari' })), false);
  assert.equal(wantsPreview(req({ 'user-agent': 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)' })), true);
  assert.equal(wantsPreview(req({ 'user-agent': 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' })), true);
  assert.equal(wantsPreview(req({ 'sec-fetch-mode': 'navigate', 'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' })), true);
});

test('plyr art is resized to a jpeg; other images pass through', () => {
  assert.deepEqual(cardImage('https://images.plyr.fm/images/a.png'), {
    url: 'https://images.plyr.fm/cdn-cgi/image/width=1200,height=1200,fit=scale-down,quality=85,format=jpeg/images/a.png',
    type: 'image/jpeg',
    source: 'https://images.plyr.fm/images/a.png'
  });
  assert.equal(cardImage('https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/b.jpg')?.url.startsWith('https://images.plyr.fm/cdn-cgi/image/'), true);
  assert.deepEqual(cardImage('https://cdn.bsky.app/a.jpg'), { url: 'https://cdn.bsky.app/a.jpg', source: 'https://cdn.bsky.app/a.jpg' });
  assert.equal(cardImage(null), null);
});

test('a track card names the track, artist, album and length, at its canonical link', async () => {
  const card = await preview(new URL(`https://plyr.fm/track/${trackId}`), api());
  assert.equal(card.title, 'bolloré <est> ton "ennemi" - Warklo');
  assert.equal(card.description, 'Warklo • edits • 1:49');
  assert.equal(card.url, 'https://plyr.fm/track/1667');
  assert.equal(card.large, true);
  assert.equal(card.audio.url, 'https://audio.plyr.fm/audio/d49.flac');
  assert.equal(card.audio.type, 'audio/flac');
  assert.equal(card.oembed, 'https://plyr.fm/track/1667');
});

test('labeled and gated tracks show no art, audio or embed', async () => {
  const adult = await preview(new URL('https://plyr.fm/track/1667'), api({ track: async () => track({ moderation: { self_labels: ['sexual'], operator_labels: [] } }) }));
  assert.equal(adult.image, null);
  assert.equal(adult.audio, null);
  assert.equal(adult.oembed, null);
  const gated = await preview(new URL('https://plyr.fm/track/1667'), api({ track: async () => track({ access: { visibility: 'supporters', gate: { type: 'x' } } }) }));
  assert.ok(gated.image);
  assert.equal(gated.audio, null);
  assert.equal(gated.oembed, null);
  const hidden = await preview(new URL('https://plyr.fm/track/1667'), api({ track: async () => track({ access: { visibility: 'private' } }) }));
  assert.equal(hidden, null);
});

test('album, artist and legacy album links', async () => {
  const card = await preview(new URL(`https://plyr.fm/album/${albumId}`), api());
  assert.equal(card.title, 'Études pour DAC by Nick');
  assert.equal(card.description, 'album by Nick • 2 tracks • 3:00');
  const artist = await preview(new URL('https://plyr.fm/u/warklo.test'), api());
  assert.equal(artist.description, '@warklo.test · 12 tracks on plyr.fm');
  assert.equal(artist.large, false);
  const moved = await preview(new URL('https://plyr.fm/u/warklo.test/album/etudes-pour-dac?x=1'), api());
  assert.deepEqual(moved, { redirect: `https://plyr.fm/album/${albumId}?x=1` });
  assert.equal(await preview(new URL('https://plyr.fm/u/warklo.test/album/nope'), api()), null);
});

test('the atlas card is a large picture of the map', async () => {
  const card = await preview(new URL('https://plyr.fm/atlas'), api());
  assert.equal(card?.url, 'https://plyr.fm/atlas');
  assert.equal(card?.large, true);
  assert.deepEqual(card?.image, { url: 'https://plyr.fm/previews/atlas.jpg', type: 'image/jpeg', width: 1200, height: 630 });
  assert.match(headTags(card!, 'https://plyr.fm/icons/icon-512.png'), /twitter:card" content="summary_large_image"/);
});

const lineup = { default_slug: 'loved', stations: [
  { slug: 'loved', name: 'loved', description: 'the most-played tracks on plyr.fm' },
  { slug: 'firehose', name: 'firehose', description: 'the atproto firehose, sonified' }
] };

test('a station link names the station and what it is playing', async () => {
  const asked: string[] = [];
  const radio = api({
    radioStations: async () => lineup,
    radioState: async (station: string) => {
      asked.push(station);
      return station === 'firehose'
        ? { live: { stream_url: 'https://relay.test/live.m3u8', kind: 'hls', artwork_url: 'https://relay.test/cover.png' }, current: null }
        : { live: null, current: { title: 'Kite', artist: 'Madeleine', artwork_url: 'https://images.plyr.fm/images/k.jpg' } };
    }
  });
  const loved = await preview(new URL('https://plyr.fm/radio/loved'), radio);
  assert.equal(loved?.title, 'loved radio on plyr.fm');
  assert.equal(loved?.url, 'https://plyr.fm/radio/loved');
  assert.equal(loved?.description, 'the most-played tracks on plyr.fm · now playing Kite by Madeleine');
  assert.equal(loved?.image?.source, 'https://images.plyr.fm/images/k.jpg');
  const firehose = await preview(new URL('https://plyr.fm/radio/firehose'), radio);
  assert.equal(firehose?.description, 'the atproto firehose, sonified · on air now');
  assert.equal(firehose?.image?.url, 'https://relay.test/cover.png');
  assert.deepEqual(asked, ['loved', 'firehose']);
  assert.equal(await preview(new URL('https://plyr.fm/radio/jazz'), radio), null);
  assert.equal((await preview(new URL('https://plyr.fm/radio'), radio))?.url, 'https://plyr.fm/radio');
});

test('a list without its own cover uses its first member with art', async () => {
  const bare = { ...album, media: { artwork: null }, members: [{ track: null }, { track: { metadata: { duration_seconds: 60 }, media: { artwork: { url: 'https://images.plyr.fm/images/m.png' } } } }] };
  const card = await preview(new URL(`https://plyr.fm/album/${albumId}`), api({ album: async () => bare }));
  assert.equal(card.image.source, 'https://images.plyr.fm/images/m.png');
});

test('the shell gets one title and one set of tags, escaped', async () => {
  const shell = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
  const card = await preview(new URL('https://plyr.fm/track/1667'), api());
  const html = injectCard(shell, card, 'https://plyr.fm/icons/icon-512.png');
  assert.equal(html.match(/<title>/g)?.length, 1);
  assert.equal(html.match(/property="og:title"/g)?.length, 1);
  assert.equal(html.match(/name="twitter:card"/g)?.length, 1);
  assert.match(html, /<title>bolloré &lt;est&gt; ton &quot;ennemi&quot; - Warklo \| plyr\.fm<\/title>/);
  assert.match(html, /property="og:image" content="https:\/\/plyr\.fm\/og\/track\/1667\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="alternate" type="application\/json\+oembed" href="https:\/\/plyr\.fm\/oembed\?url=https%3A%2F%2Fplyr\.fm%2Ftrack%2F1667&amp;format=json"/);
  assert.match(html, /name="at:canonical" content="at:\/\/did:plc:artist\/fm\.plyr\.track\/3abc"/);
  assert.ok(html.includes('id="boot"'), 'the app shell is untouched');
});

test('oembed answers tracks, albums and production album links, never gated tracks', async () => {
  const one = await oembed(new URL('https://plyr.fm/oembed?url=' + encodeURIComponent('https://plyr.fm/track/1667')), api());
  assert.equal(one.status, 200);
  assert.equal(one.body.type, 'rich');
  assert.equal(one.body.author_name, 'Warklo');
  assert.equal(one.body.author_url, 'https://plyr.fm/u/warklo.test');
  assert.equal(one.body.height, 165);
  assert.match(one.body.html, /src="https:\/\/plyr\.fm\/embed\/track\/1667"/);
  const legacy = await oembed(new URL('https://plyr.fm/oembed?maxheight=9999&url=' + encodeURIComponent('https://plyr.fm/u/warklo.test/album/etudes-pour-dac')), api());
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.height, 600);
  assert.match(legacy.body.html, new RegExp(`/embed/album/${albumId}"`));
  const gated = await oembed(new URL('https://plyr.fm/oembed?url=' + encodeURIComponent('https://plyr.fm/track/1667')), api({ track: async () => track({ access: { visibility: 'supporters', gate: { type: 'x' } } }) }));
  assert.equal(gated.status, 404);
  assert.equal((await oembed(new URL('https://plyr.fm/oembed?url=https://plyr.fm/settings'), api())).status, 404);
  assert.equal((await oembed(new URL('https://plyr.fm/oembed?format=xml&url=x'), api())).status, 501);
});

test('the worker serves browsers the static file and unfurlers the card', async () => {
  const shell = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
  const seen: string[] = [];
  const env = { ASSETS: { fetch: async (request: Request) => { seen.push(new URL(request.url).pathname); return new Response(shell, { headers: { 'content-type': 'text/html' } }); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('.getTrack') && url.searchParams.get('legacyId') === '1667') return Response.json(track());
    return new Response('{}', { status: 404 });
  };
  try {
    const browser = await worker.fetch(new Request('https://plyr.fm/track/1667', { headers: { 'sec-fetch-mode': 'navigate', 'user-agent': 'Mozilla/5.0' } }), env);
    assert.equal(browser.headers.get('x-plyr-preview'), null);
    const bot = await worker.fetch(new Request('https://plyr.fm/track/1667', { headers: { 'user-agent': 'Bluesky Cardyb/1.1' } }), env);
    assert.equal(bot.headers.get('x-plyr-preview'), 'track');
    assert.match(await bot.text(), /og:title" content="bolloré/);
    const missing = await worker.fetch(new Request('https://plyr.fm/track/999', { headers: { 'user-agent': 'Bluesky Cardyb/1.1' } }), env);
    assert.equal(missing.headers.get('x-plyr-preview'), null);
    assert.equal(missing.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(seen, ['/track/1667', '/', '/', '/track/999']);
});

const playlistUri = 'at://did:plc:owner/fm.plyr.list/3pls';
const legacy = { '18111b6d-d16d-47a9-ab98-d96f505e2372': playlistUri };

test('production playlist and embed links move to their next records', async () => {
  const uuid = '18111b6d-d16d-47a9-ab98-d96f505e2372';
  const pls = 'pls_' + btoa(playlistUri).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual(route(`/playlist/${uuid}`), { kind: 'legacy-playlist', id: uuid });
  assert.deepEqual(await preview(new URL(`https://plyr.fm/playlist/${uuid}?ref=x`), api(), legacy), { redirect: `https://plyr.fm/playlist/${pls}?ref=x` });
  assert.deepEqual(await preview(new URL(`https://plyr.fm/embed/playlist/${uuid}`), api(), legacy), { redirect: `https://plyr.fm/embed/playlist/${pls}` });
  assert.equal(await preview(new URL('https://plyr.fm/playlist/00000000-0000-4000-8000-000000000000'), api(), legacy), null);
  assert.equal(await preview(new URL('https://plyr.fm/playlist/constructor'), api(), { }), null);
  assert.deepEqual(await preview(new URL('https://plyr.fm/embed/album/warklo.test/etudes-pour-dac'), api()), { redirect: `https://plyr.fm/embed/album/${albumId}` });
  assert.equal(route('/embed/track/1667'), null, 'other embeds stay static');
});

test('the card image is composed by the image service, or falls back to the plain cover', async () => {
  const page = route('/og/track/1667.jpg');
  assert.deepEqual(page, { kind: 'og', of: 'track', id: '1667' });
  let asked: any;
  const composed = await ogImage(page, 'https://plyr.fm', api(), async (input: string, init: any) => {
    asked = { input, init };
    return new Response('jpeg', { headers: { 'content-type': 'image/jpeg', 'cf-resized': 'internal=ok' } });
  });
  assert.equal(composed.status, 200);
  assert.equal(composed.headers.get('x-plyr-og'), 'composed');
  assert.equal(asked.input, 'https://images.plyr.fm/images/9029ce64709a5717.png');
  assert.equal(asked.init.cf.image.width, 1200);
  assert.equal(asked.init.cf.image.height, 630);
  assert.equal(asked.init.cf.image.draw[0].url, asked.input);
  const raw = await ogImage(page, 'https://plyr.fm', api(), async () => new Response('png', { headers: { 'content-type': 'image/png' } }));
  assert.equal(raw.status, 302);
  assert.match(raw.headers.get('location'), /^https:\/\/images\.plyr\.fm\/cdn-cgi\/image\//);
  const failed = await ogImage(page, 'https://plyr.fm', api(), async () => new Response('png', { headers: { 'content-type': 'image/png', 'cf-resized': 'err=9413' } }));
  assert.equal(failed.status, 302, 'a failed transformation is the raw upload, not a card');
  const adult = await ogImage(page, 'https://plyr.fm', api({ track: async () => track({ moderation: { self_labels: ['porn'] } }) }), async () => { throw new Error('not asked'); });
  assert.equal(adult.headers.get('location'), 'https://plyr.fm/icons/icon-512.png');
});

test('old production pages move to the page that does their job now', () => {
	assert.equal(edge.movedPath('/u/zzstoatzz.io/liked'), '/u/zzstoatzz.io');
	assert.equal(edge.movedPath('/liked/zzstoatzz.io/'), '/u/zzstoatzz.io');
	assert.equal(edge.movedPath('/for-you'), '/');
	assert.equal(edge.movedPath('/activity'), '/');
	assert.equal(edge.movedPath('/record'), '/upload');
	assert.equal(edge.movedPath('/costs'), '/stats');
	assert.equal(edge.movedPath('/profile/setup'), '/edit-profile');
	assert.equal(edge.movedPath('/portal/manage'), '/portal');
	assert.equal(edge.movedPath('/portal'), null);
	assert.equal(edge.movedPath('/u/zzstoatzz.io'), null);
	assert.equal(edge.movedPath('/track/12'), null);
});

test('an at-uri link opens the record it names', async () => {
	const did = 'did:plc:abc';
	const api = { album: async (id: string) => (id.startsWith('alb_') && edge.uriFromId(id).endsWith('/album1') ? {} : null) };
	assert.equal(await edge.atUriPath(`/at/${did}/fm.plyr.track/t1`, api), `/track/${edge.idFromUri('trk_', `at://${did}/fm.plyr.track/t1`)}`);
	assert.equal(await edge.atUriPath(`/at/://${did}/fm.plyr.track/t1`, api), `/track/${edge.idFromUri('trk_', `at://${did}/fm.plyr.track/t1`)}`);
	assert.equal(await edge.atUriPath(`/at/${did}/fm.plyr.list/album1`, api), `/album/${edge.idFromUri('alb_', `at://${did}/fm.plyr.list/album1`)}`);
	assert.equal(await edge.atUriPath(`/at/${did}/fm.plyr.list/mix`, api), `/playlist/${edge.idFromUri('pls_', `at://${did}/fm.plyr.list/mix`)}`);
	assert.equal(await edge.atUriPath(`/at/${did}`, api), `/u/${did}`);
	assert.equal(await edge.atUriPath('/at/nonsense', api), '/');
});

test('only plyr.fm itself is open to search engines', () => {
	assert.equal(edge.robots('https://next.plyr.fm'), 'User-agent: *\nDisallow: /\n');
	const live = edge.robots('https://plyr.fm');
	assert.match(live, /User-agent: GPTBot\nDisallow: \//);
	assert.match(live, /Disallow: \/settings/);
	assert.match(live, /Sitemap: https:\/\/plyr\.fm\/sitemap\.xml/);
});

test('llms.txt names this host and its appview', async () => {
	const template = await readFile(new URL('../edge/llms.txt', import.meta.url), 'utf8');
	const text = edge.llmsTxt('https://plyr.fm', 'https://api.plyr.fm', template);
	assert.match(text, /^# plyr\.fm\n/);
	assert.match(text, /https:\/\/api\.plyr\.fm\/xrpc\/fm\.plyr\.unspecced\.search\?q=/);
	assert.match(text, /https:\/\/plyr\.fm\/oembed\?url=/);
	assert.doesNotMatch(text, /\bmusic\b|(?<![.\w])plyr(?!\.fm)/i);
});

test('the sitemap lists public tracks and their artists across pages', async () => {
	const track = (id: string, handle: string, visibility = 'public') => ({ id, access: { visibility }, metadata: { created_at: '2026-11-20T10:00:00Z' }, artist: { did: 'did:plc:x', profile: { handle } } });
	const pages: Record<string, unknown> = {
		'': { data: [track('trk_a', 'a.test'), track('trk_hidden', 'b.test', 'unlisted')], has_more: true, next_cursor: 'c1' },
		c1: { data: [track('trk_b', 'a.test')], has_more: false }
	};
	const xml = await edge.sitemap('https://plyr.fm', { tracks: async (cursor?: string) => pages[cursor ?? ''] });
	assert.match(xml, /<loc>https:\/\/plyr\.fm\/track\/trk_a<\/loc><lastmod>2026-11-20<\/lastmod>/);
	assert.match(xml, /<loc>https:\/\/plyr\.fm\/track\/trk_b<\/loc>/);
	assert.doesNotMatch(xml, /trk_hidden/);
	assert.equal(xml.match(/\/u\/a\.test/g)?.length, 1);
	assert.match(xml, /<loc>https:\/\/plyr\.fm\/terms<\/loc>/);
});

test('an older long track, album or playlist link moves to its short id for everyone', async () => {
  const env = { ASSETS: { fetch: async () => { throw new Error('a long link must not reach the static file'); } } };
  const long = (prefix: string, value: string) => prefix + btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const track = 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/3n2zqt7q3v522';
  const list = 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.list/3n2zqt7q3v522';
  for (const [path, to] of [
    [`/track/${long('trk_', track)}?t=30`, '/track/trk_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522?t=30'],
    [`/album/${long('alb_', list)}`, '/album/alb_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522'],
    [`/playlist/${long('pls_', list)}`, '/playlist/pls_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522']
  ]) {
    const moved = await worker.fetch(new Request('https://plyr.fm' + path, { headers: { 'sec-fetch-mode': 'navigate', 'user-agent': 'Mozilla/5.0' } }), env);
    assert.equal(moved.status, 301, path);
    assert.equal(moved.headers.get('location'), 'https://plyr.fm' + to);
  }
  assert.equal(edge.uriFromId('trk_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522'), track);
});
