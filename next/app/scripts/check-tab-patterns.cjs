const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPlayerHarness, setup, track } = require('./check-player-presentation.cjs');

const uiSdk = path.dirname(require.resolve('@ui-sdk/core/package.json'));
const uiSdkOrigin = 'https://ui-sdk.fixture.test';
const stubs = { '#dev': 'foundation/kernel/dev-stub.js', '#name-check': 'foundation/text/name-check-stub.js' };
const list = data => ({ object: 'list', data, has_more: false });

async function serveUiSdk(page) {
  await page.route(uiSdkOrigin + '/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const depth = '../'.repeat(file.split('/').length - 1) || './';
    const source = fs.readFileSync(path.join(uiSdk, 'dist', file), 'utf8')
      .replace(/from "(#dev|#name-check)"/g, (_, name) => `from "${depth}${stubs[name]}"`);
    return route.fulfill({ body: source, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
}

async function checkTabs(page, name) {
  const problems = await page.evaluate(async ({ origin, name }) => {
    const { checkPattern } = await import(origin + '/testing.js');
    const list = [...document.querySelectorAll('[role="tablist"]')].find(node => node.getAttribute('aria-label') === name);
    if (!list) return `no tablist named ${name}`;
    const panel = document.getElementById(list.querySelector('[aria-selected="true"]')?.getAttribute('aria-controls') ?? '');
    let root = list;
    while (panel && !root.contains(panel)) root = root.parentElement;
    try { await checkPattern(root, 'tabs'); return null; } catch (error) { return error.message; }
  }, { origin: uiSdkOrigin, name });
  assert.equal(problems, null, `${name}: ${problems}`);
}

async function run(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme, track);
  try {
    await serveUiSdk(page);
    await page.route('https://api.next.plyr.fm/v1/artists/fixture.test', route => route.fulfill({ json: {
      object: 'artist', did: track.artist.did, handle: 'fixture.test', display_name: 'jack', bio: null, avatar_url: null, support_url: null,
    } }));
    await page.route('https://api.next.plyr.fm/v1/tracks?**', route => route.fulfill({ json: list([track]) }));
    await page.route('https://api.next.plyr.fm/v1/albums?**', route => route.fulfill({ json: list([]) }));
    await page.getByRole('link', { name: 'jack', exact: true }).first().click();
    await page.getByRole('tab', { name: 'tracks', exact: true }).waitFor();
    await checkTabs(page, 'Artist catalog');
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: artist catalog tabs follow the APG tabs pattern`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  for (const width of [390, 1280]) await run(browser, width, 'light');
}).catch(error => { console.error(error); process.exitCode = 1; });
