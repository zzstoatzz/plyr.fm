const assert = require('node:assert/strict');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');

const pageOf = (data, cursor) => ({ object: 'list', data, has_more: !!cursor, next_cursor: cursor });
const second = { ...track, id: track.id + '2', metadata: { ...track.metadata, title: 'another recording' } };
const album = {
  object: 'album', id: 'alb_catalog', record: { uri: 'at://did:plc:fixture/fm.plyr.list/catalog', cid: 'fixture', collection: 'fm.plyr.list', rkey: 'catalog' },
  metadata: { name: 'a collection to come back to', created_at: '2026-11-12T00:00:00Z', updated_at: null },
  owner: { did: track.artist.did, profile: track.artist.profile }, media: { artwork: null },
  metrics: { member_count: 2, available_count: 1, total_plays: 12 },
  members: [{ position: 0, subject: track.record, availability: 'available', track }, { position: 1, subject: second.record, availability: 'unavailable', track: null }],
};

async function run(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme, track, Number(process.env.CATALOG_SCALE || 1));
  let albumFailure = true;
  let albumRequests = 0;
  let trackRequests = 0;
  try {
    await page.route('https://api.next.plyr.fm/v1/artists/fixture.test', route => route.fulfill({ json: {
      object: 'artist', did: track.artist.did, handle: 'fixture.test', display_name: 'jack and the rather long artist name',
      bio: 'Recordings from an afternoon at home, with enough words to wrap across more than one line.', avatar_url: null, support_url: 'https://example.com/support',
    } }));
    await page.route('https://api.next.plyr.fm/v1/tracks?**', route => {
      trackRequests++;
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      return route.fulfill({ json: cursor ? pageOf([second]) : pageOf([track], 'tracks-next') });
    });
    await page.route('https://api.next.plyr.fm/v1/albums?**', route => {
      albumRequests++;
      if (albumFailure) return route.fulfill({ status: 503, json: { error: { message: 'album catalog unavailable' } } });
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      return route.fulfill({ json: cursor ? pageOf([{ ...album, id: 'alb_second', metadata: { ...album.metadata, name: 'second album' } }]) : pageOf([album], 'albums-next') });
    });
    await page.route('https://api.next.plyr.fm/v1/albums/alb_catalog', route => route.fulfill({ json: album }));
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.evaluate(() => { window.__catalogMedia = window.__playerPresentationMedia; });
    const continuity = async () => {
      const before = await page.evaluate(() => window.__catalogMedia.currentTime);
      await page.waitForFunction(before => window.__catalogMedia === window.__playerPresentationMedia && !window.__catalogMedia.paused && window.__catalogMedia.currentTime > before, before);
    };
    await page.getByRole('link', { name: 'jack', exact: true }).first().click();
    await page.getByRole('tab', { name: 'tracks', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'support artist', exact: true }).getAttribute('href'), 'https://example.com/support');
    assert.equal(await page.getByRole('link', { name: 'Edit profile', exact: true }).count(), 0, 'anonymous viewer cannot edit artist');
    await page.getByRole('tabpanel', { name: 'tracks', exact: true }).getByRole('link').filter({ hasText: track.metadata.title }).waitFor();
    await page.getByRole('button', { name: 'More tracks', exact: true }).click();
    await page.getByRole('tabpanel').getByText(second.metadata.title, { exact: true }).waitFor();
    await continuity();
    await page.getByRole('tab', { name: 'albums', exact: true }).click();
    await page.getByText('album catalog unavailable', { exact: true }).waitFor();
    albumFailure = false;
    await page.getByRole('tabpanel').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('tabpanel').getByText(album.metadata.name, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'More albums', exact: true }).click();
    await page.getByRole('tabpanel').getByText('second album', { exact: true }).waitFor();
    const loaded = { trackRequests, albumRequests };
    await page.getByRole('tab', { name: 'playlists', exact: true }).click();
    await page.getByText('no playlists yet.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'likes', exact: true }).click();
    await page.getByText('no likes yet.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'likes', exact: true }).focus();
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab', { name: 'tracks', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tabpanel').getByText(second.metadata.title, { exact: true }).waitFor();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'albums', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tabpanel').getByText('second album', { exact: true }).waitFor();
    assert.deepEqual({ trackRequests, albumRequests }, loaded, 'switching sections retains loaded pages');
    await continuity();
    await screenshot(page, `artist-catalog-${width}-${theme}`);
    await page.getByRole('tabpanel').getByRole('link').filter({ hasText: album.metadata.name }).click();
    await page.getByText('2 tracks · 1 unavailable', { exact: true }).waitFor();
    await continuity();
    await screenshot(page, `artist-collection-${width}-${theme}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('tab', { name: 'albums', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'albums', exact: true }).getAttribute('aria-selected'), 'true', 'Back restores artist section');
    await page.getByRole('tabpanel').getByText('second album', { exact: true }).waitFor();
    await continuity();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: section switching, pagination, retry, empty states, keyboard, Back, and exact audio continuity passed`);
  } catch (error) { await screenshot(page, `artist-catalog-${width}-${theme}-failure`); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
