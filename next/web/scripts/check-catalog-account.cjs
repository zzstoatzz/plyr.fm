const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const { tracks } = require('./fixture-catalog.cjs');

const origin = 'https://next.plyr.fm';
const first = 'svelteswitchone.test';
const second = 'svelteswitchtwo.test';

(async () => {
  const accounts = await fixtureAccounts(['svelteswitchone', 'svelteswitchtwo']);
  const browser = await chromium.launch();
  try {
    const { page, context } = await fixturePage(browser, accounts, {
      dist: path.resolve(__dirname, '../build'),
      context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    });
    await context.route('https://jams.next.plyr.fm/**', route => route.abort());
    await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
    await page.route('https://api.next.plyr.fm/**', route => {
      const url = new URL(route.request().url());
      const owner = url.searchParams.get('artist_did');
      if (url.pathname === '/v1/tracks' && owner === accounts[first].did) return route.fulfill({
        json: { data: [tracks[0], tracks[1]].map((track, i) => ({ ...track,
          metadata: { ...track.metadata, title: i === 0 ? 'After midnight' : 'Blue sky' },
          metrics: { ...track.metrics, play_count: i === 0 ? 1 : 21 }
        })) }
      });
      if (url.pathname.startsWith('/v1/artists/')) return route.fulfill({ json: { display_name: 'A musician' } });
      if (route.request().method() !== 'GET') return route.abort();
      return route.fulfill({ json: { data: [], has_more: false } });
    });
    const you = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'you', exact: true });
    const menu = page.getByRole('dialog', { name: 'account', exact: true });
    await page.goto(origin + '/login?deviceOnly=true&return_to=%2Fportal');
    await authorizeFixture(page, accounts, first);
    await page.waitForURL(origin + '/portal');
    const catalog = page.getByRole('list', { name: 'Your tracks' });
    await catalog.getByRole('link', { name: 'After midnight', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Sort tracks' }).selectOption('plays');
    assert.match(await catalog.getByRole('listitem').first().innerText(), /Blue sky/);
    const search = page.getByRole('searchbox', { name: 'Filter your tracks' });
    await search.fill('midnight');
    assert.equal(await catalog.getByRole('listitem').count(), 1);
    assert.match(await catalog.getByRole('listitem').first().innerText(), /After midnight/);
    if (process.env.SCREENS_OUTPUT) await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, 'creator-filter-phone.png') });
    await you.click();
    await menu.getByRole('link', { name: 'add account' }).click();
    await authorizeFixture(page, accounts, second);
    await page.waitForURL(origin + '/settings');
    await page.locator('main').getByText('@' + second, { exact: true }).waitFor();
    await you.click();
    await menu.getByRole('button', { name: 'switch to @' + first }).click();
    await page.locator('main').getByText('@' + first, { exact: true }).waitFor();
    await page.reload();
    await page.locator('main').getByText('@' + first, { exact: true }).waitFor();
    console.log('Portal filtering, sorting, add account and switch account passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
