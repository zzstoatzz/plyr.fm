const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:fixture';
const pageOf = (data, next) => ({ object: 'list', data, has_more: !!next, next_cursor: next });
const recording = index => ({ ...track, id: track.id + index, record: { ...track.record, uri: track.record.uri + index }, metadata: { ...track.metadata, title: `recording ${index}` } });
const album = index => ({ object: 'album', id: `alb_${index}`, owner: { did, profile: track.artist.profile }, record: { uri: `at://${did}/fm.plyr.list/${index}` }, metadata: { name: `a collection ${index}` }, metrics: { member_count: 12 }, media: { artwork: null } });

async function run(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme, track, Number(process.env.PORTAL_SCALE || 1));
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
      }
    }
    assert.ok(authModule);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__sharedProfile = text; } } });
    });
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { id: did, alsoKnownAs: route.request().url().includes('otherfixture') ? [] : ['at://fixture.test'], service: [] } }));
    await page.route('https://api.next.plyr.fm/v1/artists/**', route => route.fulfill({ json: route.request().url().endsWith('/metrics') ? { totals: { plays: 1, tracks: 25, duration_seconds: 180 }, top_track: null } : { object: 'artist', did, handle: 'fixture.test', display_name: 'a musician with a long display name', avatar_url: null, bio: null, support_url: null } }));
    let fail = true, failMore = true, empty = false;
    let albumRequests = 0, trackRequests = 0;
    await page.route('https://api.next.plyr.fm/v1/tracks?**', route => {
      trackRequests++;
      const url = new URL(route.request().url());
      if (fail || url.searchParams.has('cursor') && failMore) {
        if (fail) fail = false; else failMore = false;
        return route.fulfill({ status: 503, json: { error: { message: 'fixture catalog unavailable' } } });
      }
      const more = url.searchParams.has('cursor');
      return route.fulfill({ json: pageOf(empty ? [] : more ? [recording(25)] : Array.from({ length: 25 }, (_, index) => recording(index)), !empty && !more ? 'next-page' : undefined) });
    });
    await page.route('https://api.next.plyr.fm/v1/tracks/' + recording(25).id, route => route.fulfill({ json: recording(25) }));
    await page.route('https://api.next.plyr.fm/v1/albums?**', route => {
      albumRequests++;
      const more = new URL(route.request().url()).searchParams.has('cursor');
      return route.fulfill({ json: pageOf([album(more ? 2 : 1)], more ? undefined : 'album-next') });
    });
    const signIn = owner => page.evaluate(([id, account]) => globalThis.__r(id).setAuth(account, {
      handle: async () => new Response(JSON.stringify({ records: [] }), { headers: { 'content-type': 'application/json' } }),
    }, 'atproto repo:fm.plyr.list'), [authModule, owner]);
    await page.goto(new URL('/portal', page.url()).href);
    await page.getByText('sign in to manage your music.', { exact: true }).waitFor();
    await signIn(did);
    await page.getByRole('heading', { name: 'your music', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'portal', exact: true }).count(), 0);
    const retry = page.getByRole('button', { name: 'retry', exact: true });
    await retry.click();
    await page.getByRole('link', { name: 'edit recording 24', exact: true }).waitFor();
    assert.equal(albumRequests, 0, 'Inactive albums are not fetched');
    const publicProfile = page.getByRole('link', { name: 'a musician with a long display name, view your public profile', exact: true });
    assert.equal(await publicProfile.getAttribute('href'), '/u/fixture.test');
    assert.equal(await page.getByRole('link', { name: 'upload', exact: true }).getAttribute('href'), '/upload');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.waitForFunction(() => window.__sharedProfile?.endsWith('/u/fixture.test'));
    const tabs = page.getByRole('tablist', { name: 'Your catalog', exact: true });
    await tabs.waitFor();
    assert.equal(await page.getByRole('button', { name: 'refresh catalog', exact: true }).count(), 0, 'the catalog revalidates on its own, no refresh button');
    const actions = await Promise.all([page.getByRole('link', { name: 'upload', exact: true }), page.getByRole('link', { name: 'edit profile', exact: true }), page.getByRole('button', { name: 'Share', exact: true })]
      .map(control => control.evaluate(node => [Math.round(node.getBoundingClientRect().height), getComputedStyle(node).borderRadius].join())));
    assert.equal(new Set(actions).size, 1, `profile actions share one shape (${actions})`);
    assert.equal(await page.getByRole('link', { name: 'private music', exact: true }).count(), 0, 'no separate private music entry');
    assert.equal(await page.getByText('your published tracks', { exact: true }).count(), 0);
    await screenshot(page, `portal-${width}-${theme}`);
    await page.getByRole('button', { name: 'more tracks', exact: true }).click();
    await retry.click();
    const last = page.getByRole('link', { name: 'edit recording 25', exact: true });
    await last.scrollIntoViewIfNeeded();
    const scrollPosition = () => last.evaluate(node => {
      while (node && !(node.clientHeight > 100 && node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
      return node?.scrollTop ?? -1;
    });
    const position = await scrollPosition(), beforeBack = trackRequests;
    await page.getByRole('link').filter({ hasText: 'recording 25' }).first().click();
    await page.waitForURL('**/track/' + recording(25).id);
    await page.goBack(); await last.waitFor();
    assert.ok(Math.abs(await scrollPosition() - position) < 2, 'Back preserves later page and scroll');
    assert.equal(trackRequests, beforeBack, 'Back does not refetch');
    const tracksTab = page.getByRole('tab', { name: 'tracks', exact: true });
    await tracksTab.scrollIntoViewIfNeeded(); await tracksTab.focus(); await tracksTab.press('ArrowRight');
    const albumsTab = page.getByRole('tab', { name: 'albums', exact: true });
    await page.getByRole('link', { name: /a collection 1/ }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'albums');
    await page.getByRole('button', { name: 'more albums', exact: true }).click();
    await page.getByRole('link', { name: /a collection 2/ }).waitFor();
    await screenshot(page, `portal-albums-${width}-${theme}`);
    await albumsTab.press('Home');
    await last.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'tracks');
    assert.equal(trackRequests, beforeBack);
    empty = true;
    await signIn('did:plc:otherfixture');
    await page.getByText(/^nothing here yet\./).waitFor();
    assert.equal(await last.count(), 0, 'Account switch removes previous account catalog');
    await screenshot(page, `portal-empty-${width}-${theme}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.waitForFunction(() => window.__sharedProfile?.endsWith('/u/did:plc:otherfixture'));
    await page.goto(new URL('/u/did:plc:otherfixture', page.url()).href);
    await page.getByRole('heading', { name: 'a musician with a long display name', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: profile link, one shape of action, no refresh or private-music entry, retained pagination/Back, tab focus and account switch passed`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  console.log('Auth-state fixture; all external writes blocked; OAuth is not exercised');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
