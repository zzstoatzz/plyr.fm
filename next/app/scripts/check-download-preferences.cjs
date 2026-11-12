const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const initial = { $type: 'fm.plyr.track', title: 'download preference fixture', artist: 'fixture artist', createdAt: '2026-11-12T00:00:00Z', audioUrl: 'https://public.example/audio', fileType: 'wav', extra: { kept: true }, labels: { values: [{ val: 'porn' }] } };

async function run(browser, width, theme, scale) {
  const { page, context, errors } = await setup(browser, width, theme, track, scale);
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let record = structuredClone(initial), cid = 'first', visibility = 'public', lost = false, unreadable = false, held = false, release, entered;
    const writes = [];
    await page.route(`https://api.next.plyr.fm/v1/tracks/${track.id}`, route => route.fulfill({ json: { ...track, access: { visibility } } }));
    await page.exposeFunction('__downloadPolicyPds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://fixture.invalid');
      if (url.pathname.endsWith('listRecords')) return { status: 200, body: { records: [] } };
      if (url.pathname.endsWith('getRecord')) return unreadable ? { status: 503, body: { error: 'Unavailable' } } : { status: 200, body: { uri: track.record.uri, cid, value: record } };
      assert.ok(url.pathname.endsWith('putRecord'));
      const input = JSON.parse(body); writes.push(input);
      assert.equal(input.repo, track.artist.did);
      assert.deepEqual(input.record.labels, initial.labels);
      assert.equal(input.record.audioUrl, initial.audioUrl);
      if (input.swapRecord !== cid) return { status: 409, body: { error: 'InvalidSwap' } };
      record = input.record; cid = `accepted-${writes.length}`;
      if (held) await new Promise(resolve => { release = resolve; entered(); });
      if (lost) { unreadable = lost === 'unconfirmed'; return { status: 503, body: { error: 'Unavailable' } }; }
      return { status: 200, body: { uri: track.record.uri, cid } };
    });
    const signIn = () => page.evaluate(([id, did]) => globalThis.__r(id).setAuth(did, { handle: async (url, init) => {
      const reply = await window.__downloadPolicyPds(String(url), init?.body);
      if (String(url).includes('putRecord')) window.__downloadPolicySettled = (window.__downloadPolicySettled || 0) + 1;
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    } }, 'atproto repo:fm.plyr.track'), [authModule, track.artist.did]);
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const view = page.getByRole('button', { name: 'View track', exact: true });
    const off = page.getByRole('button', { name: 'Downloads off', exact: true });
    const allowed = page.getByRole('button', { name: 'Downloads allowed', exact: true });
    const ask = page.getByRole('button', { name: 'Allowed, with a support prompt', exact: true });
    const reset = async extra => { record = { ...structuredClone(initial), ...extra }; cid = `fresh-${writes.length}`; lost = false; unreadable = false; visibility = 'public'; await signIn(); await title.waitFor(); };
    await page.goto(new URL(`/edit-track/${track.id}`, page.url()).href);
    await page.getByText('only the artist can edit this track.', { exact: true }).waitFor();
    await signIn(); await allowed.waitFor();
    assert.equal(await allowed.getAttribute('aria-pressed'), 'true');
    await off.click();
    await screenshot(page, `download-preferences-${width}-${theme}-${scale}`);
    await save.click(); await view.waitFor();
    assert.equal(record.downloadPolicy, 'off');
    assert.equal(writes[0].swapRecord, 'first');
    await reset({ downloadPolicy: 'off', visibility: 'unlisted' });
    visibility = 'unlisted'; await ask.click(); lost = true;
    await save.click(); await view.waitFor();
    assert.equal(record.downloadPolicy, 'ask');
    assert.equal(writes.length, 2, 'lost accepted response reconciles without another write');
    await reset(); await off.click(); cid = 'newer'; record.extra = { newer: true };
    await save.click(); await page.getByText('this track changed elsewhere. reload the latest version before saving.', { exact: true }).waitFor();
    assert.equal(await off.getAttribute('aria-pressed'), 'true');
    assert.equal(await ask.isDisabled(), true);
    await screenshot(page, `download-preferences-conflict-${width}-${theme}-${scale}`);
    await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
    await allowed.waitFor(); await ask.click(); await save.click(); await view.waitFor();
    assert.equal(record.downloadPolicy, 'ask'); assert.deepEqual(record.extra, { newer: true });
    for (const extra of [{ downloadPolicy: 'future' }, { downloadPolicy: 'supporters' }, { downloadPolicy: 'off', audioSpace: 'at://private' }]) {
      await reset(extra); assert.equal(await off.count(), 0);
      await title.fill('metadata only'); await save.click(); await view.waitFor();
      for (const [key, value] of Object.entries(extra)) assert.deepEqual(record[key], value);
    }
    await reset(); await title.fill('keep absent policy'); await save.click(); await view.waitFor();
    assert.equal(Object.hasOwn(record, 'downloadPolicy'), false);
    await reset(); await off.click(); visibility = 'supporters';
    const before = writes.length; await save.click();
    await page.getByText('these download settings cannot be changed here.', { exact: true }).waitFor();
    assert.equal(writes.length, before, 'fresh effective access rejects policy write');
    await reset(); await off.click(); lost = 'unconfirmed';
    await save.click(); await page.getByText('could not confirm the saved track. reload the latest version before saving again.', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true); assert.equal(await ask.isDisabled(), true);
    await reset(); await off.click(); held = true;
    const holding = new Promise(resolve => { entered = resolve; });
    await save.click(); await holding;
    assert.equal(await ask.isDisabled(), true);
    await signIn(); await title.waitFor(); await ask.click();
    const settled = await page.evaluate(() => window.__downloadPolicySettled || 0);
    held = false; release(); await page.waitForFunction(value => window.__downloadPolicySettled === value + 1, settled);
    assert.equal(await ask.getAttribute('aria-pressed'), 'true'); assert.equal(await save.isEnabled(), true);
    assert.equal(await view.count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}/${scale}: policy CAS, preservation, lost-response, access and session guards passed`);
  } catch (error) { await screenshot(page, `download-preferences-failure-${width}-${theme}-${scale}`); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const scale of [1, 1.3]) await run(browser, width, theme, scale);
}).catch(error => { console.error(error); process.exitCode = 1; });
