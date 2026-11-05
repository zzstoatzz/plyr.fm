const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium, webkit } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const axe = require.resolve(process.env.AXE_CORE_MODULE || 'axe-core/axe.min.js');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const origin = 'https://next.plyr.fm';
const output = process.env.UI_AUDIT_OUTPUT || '/tmp/plyr-ui-audit';
const engine = process.env.UI_AUDIT_BROWSER || 'chromium';
const anonymous = process.env.UI_AUDIT_ANONYMOUS === 'true';
const list = data => ({ object: 'list', data, has_more: false });
const artwork = 'https://ui.fixture.test/art.svg';
const uri = 'at://did:plc:fixture/fm.plyr.track/polish';
const id = 'trk_' + Buffer.from(uri).toString('base64url');
const audio = Buffer.alloc(44 + 8000 * 120 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
(async () => {
  await fs.mkdir(output, { recursive: true });
  const report = [];
  const browser = await (engine === 'webkit' ? webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks'] }));
  try {
    for (const width of (process.env.UI_AUDIT_WIDTHS || '390,1280').split(',').map(Number)) for (const theme of ['light', 'dark']) {
      const name = 'ui' + engine[0] + width + theme[0] + Date.now().toString(36);
      const accounts = await fixtureAccounts([name]);
      const handle = name + '.test';
      const did = accounts[handle].did;
      const options = { dist: process.env.UI_AUDIT_DIST,
        preferences: { theme, accent: '#6a9fff', scale: Number(process.env.UI_AUDIT_SCALE || 1) },
        context: { viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' } };
      let { page, context } = await fixturePage(browser, accounts, options);
      let catalogState = 'populated';
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const track = { object: 'track', id, record: { uri, cid: 'bafyreifkfixture', revision: null, collection: 'fm.plyr.track', rkey: 'polish' },
        metadata: { title: 'A long track title, with enough words to test the edges of the layout', artist_name: 'An artist with a longer display name', description: 'A description of the music.\nA second paragraph with a link-like name and more words.', album: 'A collection of recordings', duration_seconds: 120, created_at: '2026-11-05T00:00:00Z' },
        artist: { did, profile: { handle, display_name: 'A longer artist display name', avatar_url: artwork } },
        media: { artwork: { url: artwork } }, access: { visibility: 'public' }, metrics: { play_count: 24, like_count: 3 } };
      const tracks = [track, ...[1, 2, 3].map(index => ({ ...track, id: id + index, record: { ...track.record, uri: uri + index }, metadata: { ...track.metadata, title: 'Another recording ' + index } }))];
      const collection = kind => ({ object: kind, id: kind === 'album' ? 'alb_fixture' : 'pls_fixture', record: { uri: `at://${did}/fm.plyr.list/${kind}`, cid: 'bafyreifkfixture', collection: 'fm.plyr.list', rkey: kind },
        metadata: { name: 'A longer ' + kind + ' name with room to wrap', created_at: '2026-11-05T00:00:00Z' }, owner: { did, profile: { handle, display_name: 'A longer artist display name' } },
        media: { artwork: { url: artwork } }, metrics: { member_count: tracks.length, available_count: tracks.length, total_plays: 24 },
        members: tracks.map((track, position) => ({ position, subject: track.record, track })) });
      async function configureRoutes() {
        await context.route('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?*', route => route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { follows: [{ did, avatar: artwork }] } }));
        await context.route('https://ui.fixture.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><circle cx="200" cy="200" r="140" fill="#8da4c6"/></svg>' }));
        await context.route('https://ui-audio.fixture.test/**', route => route.fulfill({ body: audio, contentType: 'audio/wav' }));
        await context.route(/https:\/\/[^/]*radio\.plyr\.fm\//, route => {
          if (new URL(route.request().url()).pathname.endsWith('/cover')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/></svg>' });
          return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { currentSong: { id, title: track.metadata.title, artist: 'A longer artist name', durationSeconds: 120, hasCover: true }, state: { status: 'playing', positionSeconds: 10, startedAt: Date.now() - 10000 } } });
        });
        await context.route('https://api.next.plyr.fm/**', async route => {
          const url = new URL(route.request().url());
          const p = url.pathname;
          if (process.env.UI_AUDIT_DEBUG && p === '/v1/tracks') console.log('catalog fixture', catalogState, route.request().url());
          if (route.request().method() === 'POST' && p === '/v1/artists/resolve') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([{ did, handle, display_name: 'An artist you know', avatar_url: artwork, track_count: 4 }]) });
          if (route.request().method() !== 'GET') return route.abort();
          if (p === '/v1/tracks' && catalogState === 'error') return route.fulfill({ status: 503, json: { error: { message: 'UI audit catalog unavailable' } } });
          if (p === '/v1/tracks' && catalogState === 'empty') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([]) });
          if (p === '/v1/tracks' && catalogState === 'loading') {
            const owner = route.request().frame().page();
            await new Promise(resolve => setTimeout(resolve, 1800));
            if (owner.isClosed()) return;
          }
          if (p.endsWith('/playback')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { object: 'playback', track_id: id, record: track.record, availability: { status: 'available', delivery: { url: 'https://ui-audio.fixture.test/audio.wav', media_type: 'audio/wav' } } } });
          if (p === '/v1/charts/tracks') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list(tracks.map(track => ({ track, plays: 24 }))) });
          if (p === '/v1/tracks' || p.startsWith('/v1/actors/')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list(tracks) });
          if (p.startsWith('/v1/tracks/') && p.endsWith('/likes')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([{ record: { uri: 'at://did:web:listener.test/fm.plyr.like/a' }, actor: { did: 'did:web:listener.test', profile: { handle: 'listener.test', display_name: 'A listener', avatar_url: artwork } } }]) });
          if (p.startsWith('/v1/tracks/')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: track });
          if (p === '/v1/tags') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([{ name: 'ambient', track_count: 4, total_plays: 24 }, { name: 'experimental', track_count: 3, total_plays: 12 }]) });
          if (p === '/v1/playlists') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([collection('playlist')]) });
          if (p.startsWith('/v1/playlists/')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: collection('playlist') });
          if (p === '/v1/albums') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([collection('album')]) });
          if (p.startsWith('/v1/albums/')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: collection('album') });
          if (p.endsWith('/metrics')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { object: 'artist_metrics', artist_did: did, totals: { plays: 24, tracks: 4, duration_seconds: 480 }, top_track: null } });
          if (p.startsWith('/v1/artists/')) return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { object: 'artist', did, handle, display_name: 'A longer artist display name', bio: 'A short bio with enough words to wrap on a phone screen.', avatar_url: artwork, support_url: 'https://example.com/support' } });
          if (p === '/v1/search') return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list(['track', 'artist', 'album', 'playlist'].map(type => ({ type, id: type === 'track' ? id : type === 'artist' ? did : type === 'album' ? 'alb_fixture' : 'pls_fixture', title: type === 'track' ? track.metadata.title : 'A longer ' + type + ' name', owner: { did, handle, display_name: 'A longer artist display name' }, image_url: artwork }))) });
          return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: list([]) });
        });
        await context.route('https://api.plyr.fm/albums/**', route => route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { metadata: { title: 'A legacy album', artist_handle: handle, image_url: artwork }, tracks: [] } }));
      }
      await configureRoutes();
      async function scan(name) {
        await page.waitForTimeout(350);
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({ path: axe });
        const result = await page.evaluate(async () => {
          const { violations, incomplete } = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
          return { violations: violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })) };
        });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        const entry = { name, engine, auth: anonymous ? 'anonymous' : 'disposable-oauth', width, theme, scale: Number(process.env.UI_AUDIT_SCALE || 1), overflow, errors: [...errors], ...result };
        errors.length = 0;
        report.push(entry);
        await page.screenshot({ path: `${output}/${engine}-${width}-${theme}-${name}.png`, fullPage: true });
        const scrollers = page.locator('div').filter({ hasNot: page.locator('iframe') });
        const count = await scrollers.evaluateAll(nodes => {
          const scrolls = nodes.filter(node => node.clientHeight > 100 && node.scrollHeight > node.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(node).overflowY));
          for (const node of scrolls) node.scrollTop = node.scrollHeight;
          return scrolls.length;
        });
        if (count) {
          await page.screenshot({ path: `${output}/${engine}-${width}-${theme}-${name}-bottom.png` });
          await scrollers.evaluateAll(nodes => { for (const node of nodes) if (node.scrollTop) node.scrollTop = 0; });
        }
        await fs.writeFile(output + '/report.json', JSON.stringify(report, null, 2));
        console.log(`${engine}/${width}/${theme}/${name}: ${result.violations.map(v => v.id).join(', ') || 'clear'}${overflow ? ' OVERFLOW' : ''}`);
      }
      async function freshHome() {
        if (anonymous && engine === 'webkit') {
          await context.unrouteAll({ behavior: 'ignoreErrors' });
          await context.close();
          const fresh = await fixturePage(browser, accounts, options);
          page = fresh.page;
          context = fresh.context;
          await configureRoutes();
        } else {
          await page.close();
          page = await context.newPage();
        }
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
      }
      try {
        await page.goto(origin + '/login');
        await page.getByLabel('atmosphere account').waitFor();
        await page.getByRole('button', { name: 'sign in', exact: true }).first().focus();
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
        assert.ok(focus.width >= 2 && focus.style !== 'none', 'Keyboard focus is visible');
        await scan('login');
        await page.getByRole('button', { name: 'create account', exact: true }).click();
        await page.waitForTimeout(400);
        await scan('create-account');
        await page.getByRole('button', { name: 'sign in', exact: true }).first().click();
        if (!anonymous) {
          await authorizeFixture(page, accounts, handle);
          await page.waitForURL(url => url.origin === origin && url.pathname !== '/oauth/callback');
        }
        for (const [name, route, wait] of [
          ['home', '/', 'heading'], ['search', '/search?q=music', 'heading'], ['library', '/library', 'heading'], ['liked', '/liked', 'heading'],
          ['playlists', '/playlists', 'heading'], ['artist', '/u/' + handle, 'heading'], ['track', '/track/' + id, 'heading'],
          ['album', '/album/alb_fixture', 'heading'], ['playlist', '/playlist/pls_fixture', 'heading'],
          ['portal', '/portal', 'portal'], ['profile-alias', '/profile', 'portal'], ['settings', '/settings', 'heading'],
          ['upload', '/upload', 'Title'], ['edit-track', '/edit-track/' + id, 'Title'], ['edit-profile', '/edit-profile', 'Bio'],
          ['jam', `/jam/${did}~audit?track=${id}`, 'heading'], ['queue-empty', '/queue', 'heading'], ['radio', '/radio', 'heading'],
          ['embed-track', '/embed/track/' + id, 'Play'], ['embed-album', '/embed/album/alb_fixture', 'heading'],
          ['embed-playlist', '/embed/playlist/pls_fixture', 'heading'], ['embed-artist', '/embed/u/' + handle, 'heading'],
          ['embed-radio', '/embed/radio', 'Listen live'], ['embed-album-slug', '/embed/album/' + handle + '/fixture', 'heading'],
        ]) {
          if (process.env.UI_AUDIT_ONLY && !process.env.UI_AUDIT_ONLY.split(',').includes(name)) continue;
          await page.goto(origin + route);
          if (anonymous && ['portal', 'profile-alias', 'upload', 'edit-track', 'edit-profile'].includes(name)) await page.getByRole('heading').first().waitFor();
          else if (wait === 'heading') await page.getByRole('heading').first().waitFor();
          else if (wait === 'portal') await page.getByRole('link', { name: 'upload', exact: true }).waitFor();
          else await page.getByLabel(wait, { exact: true }).first().waitFor();
          await scan(name);
          if (name === 'portal' && !anonymous) {
            const upload = await page.getByRole('link', { name: 'upload', exact: true }).boundingBox();
            assert.ok(upload.height >= 44, 'Linked actions retain button styles');
            const tab = page.getByRole('tab', { name: 'tracks', exact: true });
            await tab.focus(); await page.keyboard.press('ArrowRight');
            assert.equal(await page.getByRole('tab', { name: 'albums', exact: true }).getAttribute('aria-selected'), 'true');
            await scan('portal-albums');
          }
          if (name === 'track') {
            await page.getByRole('button', { name: /See .* likes/, exact: true }).click(); await scan('likers');
            await page.getByRole('button', { name: 'Close', exact: true }).click();
            await page.getByRole('button', { name: 'More', exact: true }).click(); await scan('track-menu');
            if (!anonymous) {
              const edit = await page.getByRole('link', { name: 'edit track', exact: true }).boundingBox();
              assert.ok(edit.height >= 54 && edit.width >= Math.min(300, width - 40), 'Linked menu actions retain full-row styles');
            }
            await page.getByRole('button', { name: 'Close', exact: true }).click();
          }
          if (!anonymous && (name === 'playlist' || name === 'album')) {
            await page.getByRole('button', { name: name === 'album' ? 'Edit album' : 'Edit playlist', exact: true }).click();
            await scan(name + '-editing');
          }
        }
        for (const state of ['empty', 'error', 'loading']) {
          catalogState = state;
          await freshHome();
          if (state === 'empty') await page.getByText('no tracks yet', { exact: true }).waitFor();
          if (state === 'error') await page.getByText('UI audit catalog unavailable', { exact: true }).waitFor();
          if (state === 'loading') await page.getByRole('progressbar', { name: 'loading tracks...', exact: true }).waitFor();
          await scan('home-' + state);
        }
        catalogState = 'populated';
        await freshHome();
        await page.getByRole('button', { name: /^Play / }).first().click();
        await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
        await scan('now-playing');
        await page.getByRole('button', { name: 'Queue', exact: true }).click(); await scan('queue');
        await page.getByRole('button', { name: 'Volume', exact: true }).click(); await scan('queue-volume');
        const volume = page.getByRole('slider', { name: 'Volume', exact: true });
        await volume.focus(); await page.keyboard.press('Home');
        assert.equal(await volume.getAttribute('aria-valuenow'), '0');
        await page.keyboard.press('ArrowRight');
        assert.equal(await volume.getAttribute('aria-valuenow'), '0.01');
      } catch (error) {
        await page.screenshot({ path: `${output}/${engine}-${width}-${theme}-failure.png` });
        console.log((await page.locator('body').innerText()).slice(0, 3000));
        throw error;
      } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
    }
  } finally { await browser.close(); }
  const failures = report.filter(entry => entry.violations.length || entry.overflow || entry.errors.length);
  console.log(`${report.length} rendered states; ${failures.length} with findings. Screenshots and axe report: ${output}`);
  if (process.env.UI_AUDIT_STRICT === 'true') assert.equal(failures.length, 0);
})().catch(error => { console.error(error); process.exitCode = 1; });
