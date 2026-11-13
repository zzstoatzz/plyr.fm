const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const defaults = ['ai', 'ai-slop', 'suno'];
async function capture(page, name) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  await screenshot(page, name);
}
const tracks = ['human recording', 'account-labeled recording', 'suno-tagged recording'].map((title, i) => ({
  ...track, id: `discovery-${i}`, record: { ...track.record, uri: `${track.record.uri}-${i}` },
  metadata: { ...track.metadata, title }, moderation: { self_labels: [], operator_labels: [], account_labels: i === 1 ? ['ai'] : [] },
}));

async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track, 1.3);
  try {
    const queries = [];
    await page.route('https://api.next.plyr.fm/v1/tags?**', route => route.fulfill({ json: { object: 'list', data: ['ai', 'suno', 'acoustic'].map(name => ({ name, track_count: 1, total_plays: 1 })), has_more: false } }));
    await page.route('https://api.next.plyr.fm/v1/tracks?**', route => {
      const url = new URL(route.request().url());
      const tags = url.searchParams.has('hidden_tag') ? url.searchParams.getAll('hidden_tag').filter(Boolean) : defaults;
      queries.push({ tags, cursor: url.searchParams.get('cursor') });
      const data = tracks.filter((_, i) => i === 0 || !(tags.includes(i === 1 ? 'ai' : 'suno')));
      return route.fulfill({ json: { object: 'list', data, has_more: false } });
    });
    const go = route => page.getByRole('link', { name: route === '/' ? /^home$/i : /^settings$/i }).first().click();
    const edit = () => page.getByRole('button', { name: /^hidden tags:/i }).click();
    const feed = page.getByTestId('home-feed').last();
    const field = page.getByRole('textbox', { name: 'Tags, separated by commas', exact: true });
    await go('/');
    await feed.getByText('human recording', { exact: true }).waitFor();
    await feed.getByRole('button', { name: 'Filter by acoustic', exact: true }).waitFor();
    assert.equal(await feed.getByRole('button', { name: 'Filter by ai', exact: true }).count(), 0);
    assert.equal(await feed.getByText('account-labeled recording', { exact: true }).count(), 0);
    await go('/settings');
    await edit();
    assert.equal(await field.inputValue(), defaults.join(', '));
    await capture(page, `hidden-defaults-${width}-${theme}`);
    await page.getByRole('button', { name: 'Show all tags', exact: true }).click();
    await page.getByRole('button', { name: 'hidden tags: none', exact: true }).waitFor();
    await go('/');
    await feed.getByText('human recording', { exact: true }).waitFor();
    await feed.getByText('account-labeled recording', { exact: true }).waitFor();
    await feed.getByRole('button', { name: 'Filter by ai', exact: true }).waitFor();
    await feed.getByText('suno-tagged recording', { exact: true }).waitFor();
    assert.deepEqual(queries.at(-1), { tags: [], cursor: null });
    await go('/settings');
    await edit();
    await field.fill(Array.from({ length: 11 }, (_, i) => `tag${i}`).join(', '));
    await page.getByRole('button', { name: 'Save hidden tags', exact: true }).click();
    await page.getByText('use up to 10 tags, each no longer than 200 bytes.', { exact: true }).waitFor();
    await field.fill(' -- AI, ai, field   recording');
    await page.getByRole('button', { name: 'Save hidden tags', exact: true }).click();
    await page.getByRole('button', { name: 'hidden tags: ai, field recording', exact: true }).waitFor();
    await capture(page, `hidden-custom-${width}-${theme}`);
    await go('/');
    await feed.getByText('suno-tagged recording', { exact: true }).waitFor();
    assert.equal(await feed.getByText('account-labeled recording', { exact: true }).count(), 0);
    assert.deepEqual(queries.at(-1), { tags: ['ai', 'field recording'], cursor: null });
    await go('/settings');
    await edit();
    await page.getByRole('button', { name: 'Restore defaults', exact: true }).click();
    await page.getByRole('button', { name: 'hidden tags: ai, ai-slop, suno', exact: true }).waitFor();
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = await fs.readFile(path.join(dist, new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
      }
    }
    assert.ok(authModule);
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    const signIn = (did, synced = false) => page.evaluate(([id, did, synced]) => globalThis.__r(id).setAuth(did, {
      handle: async url => new Response(JSON.stringify(String(url).includes('getServiceAuth') ? { token: 'fixture' } : { records: [] }), { headers: { 'content-type': 'application/json' } }),
    }, synced ? 'atproto rpc:fm.plyr.next.jam.join?aud=did:web:plyr-jams-next.fly.dev#jams' : 'atproto'), [authModule, did, synced]);
    await signIn('did:plc:discoveryone');
    await edit();
    await page.getByRole('button', { name: 'Show all tags', exact: true }).click();
    await page.getByRole('button', { name: 'hidden tags: none', exact: true }).waitFor();
    await signIn('did:plc:discoverytwo');
    await page.getByRole('button', { name: 'hidden tags: ai, ai-slop, suno', exact: true }).waitFor();
    await edit();
    await field.fill('unfinished draft');
    await signIn('did:plc:discoveryone');
    await page.getByRole('button', { name: 'hidden tags: none', exact: true }).waitFor();
    assert.equal(await field.count(), 0, 'editor draft does not cross accounts');
    let preferenceReads = 0;
    await page.route('https://plyr-jams-next.fly.dev/v1/preferences', route => {
      preferenceReads++;
      return route.fulfill({ json: { preferences: { hiddenTags: defaults } } });
    });
    await page.route('https://plyr-jams-next.fly.dev/v1/playback/join', route => route.fulfill({ status: 503, json: { error: 'fixture unavailable' } }));
    await page.route('https://public.api.bsky.app/**', route => route.fulfill({ json: { follows: [] } }));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.exposeFunction('__preferenceReads', () => preferenceReads);
    await signIn('did:plc:discoverysync', true);
    await page.waitForFunction(async () => await window.__preferenceReads() >= 1);
    await go('/');
    await feed.getByText('human recording', { exact: true }).waitFor();
    const render = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await render();
    const beforeSync = queries.length;
    const beforeReads = preferenceReads;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(async count => await window.__preferenceReads() > count, beforeReads);
    await render();
    assert.equal(queries.length, beforeSync, 'same-value account sync retains the loaded feed and cursor');
    await feed.getByText('human recording', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: defaults, show-all, normalized custom tags, validation, persistence and account isolation passed`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  console.log('Fixture-filtered responses verify client requests/rendering; backend label enforcement has separate integration tests');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
