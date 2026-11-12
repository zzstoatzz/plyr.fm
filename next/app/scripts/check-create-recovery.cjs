const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:recoveryfixture';
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function run(browser, width, theme, kind) {
  const { page, context, errors } = await setup(browser, width, theme, track, Number(process.env.CREATE_SCALE || 1));
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await context.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await context.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    const records = new Map(), writes = [];
    let commit = true, lost = true, offline = true, hold = false, entered, release;
    await context.exposeFunction('__recoveryPds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://fixture.invalid');
      if (url.pathname.endsWith('listRecords')) return { status: 200, body: { records: [] } };
      if (url.pathname.endsWith('uploadBlob')) return { status: 200, body: { blob: { $type: 'blob', ref: { $link: 'bafkreigh2akiscaildcw4533xrlwoecrloyfg4huyh2fq7rmr5mnnxfk5q' }, mimeType: 'audio/wav', size: audio.length } } };
      if (url.pathname.endsWith('getRecord')) {
        if (offline) return { drop: true };
        const key = url.searchParams.get('rkey'), existing = records.get(key);
        return existing ? { status: 200, body: existing } : { status: 404, body: { error: 'RecordNotFound' } };
      }
      assert.ok(url.pathname.endsWith('createRecord'), `unexpected RPC ${url.pathname}`);
      const input = JSON.parse(body);
      writes.push(input);
      assert.equal(input.repo, did);
      const rkey = input.rkey ?? '3jzfcijpj2z2' + '234567ab'[writes.length % 8];
      const uri = `at://${input.repo}/${input.collection}/${rkey}`;
      if (records.has(rkey)) return { status: 500, body: { error: 'DuplicateKey' } };
      if (commit) records.set(rkey, { uri, cid: 'cid' + writes.length, value: input.record });
      if (hold) await new Promise(resolve => { release = resolve; entered(); });
      return lost ? { drop: true } : { status: 200, body: { uri, cid: 'cid' + writes.length } };
    });
    const signIn = (target, account = did) => target.evaluate(([id, account]) => globalThis.__r(id).setAuth(account, {
      handle: async (url, init) => {
        const result = await window.__recoveryPds(String(url), typeof init?.body === 'string' ? init.body : null);
        if (result.drop) throw new TypeError('fixture response lost');
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
      },
    }, 'atproto repo:fm.plyr.track repo:fm.plyr.list'), [authModule, account]);
    const pathname = kind === 'track' ? '/upload' : '/library';
    const gate = target => kind === 'track' ? target.getByRole('link', { name: 'Sign in', exact: true }) : target.getByText('sign in to see your liked tracks and playlists.', { exact: true });
    async function enter(target) { await target.goto(new URL(pathname, page.url()).href); await gate(target).waitFor(); await signIn(target); }
    async function start(name) {
      if (kind === 'playlist') {
        await page.getByRole('button', { name: 'New playlist', exact: true }).click();
        await page.getByRole('textbox', { name: 'Playlist name', exact: true }).fill(name);
        await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
      } else {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Choose audio', exact: true }).click();
        await (await chooser).setFiles({ name: 'recovery.wav', mimeType: 'audio/wav', buffer: audio });
        await page.getByRole('textbox', { name: 'Title', exact: true }).fill(name);
        await page.getByRole('textbox', { name: 'Artist', exact: true }).fill('fixture artist');
        await page.getByRole('button', { name: 'Upload', exact: true }).click();
      }
    }
    const view = target => target.getByRole('link', { name: kind === 'track' ? 'View track' : 'Open created playlist', exact: true });
    const dismiss = () => page.getByRole('button', { name: kind === 'track' ? 'Upload another' : 'Done', exact: true });
    await enter(page);
    await start('lost response, one record');
    await page.getByText('could not confirm creation. check again when connected.', { exact: true }).waitFor();
    assert.equal(writes.length, 1); assert.equal(records.size, 1);
    assert.match(writes[0].rkey, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
    await screenshot(page, `${kind}-unconfirmed-${width}-${theme}`);
    await enter(page);
    await page.getByText('could not confirm creation. check again when connected.', { exact: true }).waitFor();
    assert.equal(writes.length, 1, 'reload never automatically resubmits');
    await signIn(page, 'did:plc:otherfixture');
    assert.equal(await page.getByText('lost response, one record', { exact: true }).count(), 0);
    await signIn(page);
    await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
    offline = false;
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await view(page).waitFor();
    assert.equal(writes.length, 1, 'recovering accepted write is read-only');
    await screenshot(page, `${kind}-recovered-${width}-${theme}`);
    await dismiss().click();
    commit = false; lost = true;
    await start('retry the same creation');
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByRole('button', { name: 'Retry same creation', exact: true }).waitFor();
    const pending = writes[1];
    const second = await context.newPage();
    await enter(second);
    await second.getByRole('button', { name: 'Retry same creation', exact: true }).waitFor();
    commit = true; lost = false;
    await Promise.all([page.getByRole('button', { name: 'Retry same creation', exact: true }).click(), second.getByRole('button', { name: 'Retry same creation', exact: true }).click()]);
    await view(page).waitFor(); await view(second).waitFor();
    assert.ok(writes.slice(1).every(input => input.rkey === pending.rkey));
    assert.ok(writes.slice(1).every(input => JSON.stringify(input.record) === JSON.stringify(pending.record)));
    assert.equal(records.size, 2, 'two tabs recover exactly one additional record');
    await second.close();
    await dismiss().click();
    hold = true;
    const acceptedHeld = new Promise(resolve => { entered = resolve; });
    await start('acknowledged before response');
    await acceptedHeld;
    await signIn(page);
    await view(page).waitFor();
    await dismiss().click();
    const lateSettled = page.waitForResponse(response => response.url().includes('/v1/records/await?'));
    release(); hold = false;
    await lateSettled;
    await enter(page);
    if (kind === 'track') await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    else await page.getByRole('button', { name: 'New playlist', exact: true }).waitFor();
    assert.equal(await page.getByText('acknowledged before response', { exact: true }).count(), 0, 'late response cannot resurrect dismissed recovery');
    hold = true; lost = true; offline = true;
    const held = new Promise(resolve => { entered = resolve; });
    await start('previous session');
    await held;
    await signIn(page, 'did:plc:otherfixture');
    release(); hold = false;
    await gate(page).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('previous session', { exact: true }).count(), 0);
    await signIn(page);
    await page.getByText('could not confirm creation. check again when connected.', { exact: true }).waitFor();
    offline = false;
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await view(page).waitFor();
    await dismiss().click();
    commit = false;
    await start('collision must not overwrite');
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByRole('button', { name: 'Retry same creation', exact: true }).waitFor();
    const last = writes.at(-1), before = writes.length;
    const uri = `at://${did}/${last.collection}/${last.rkey}`;
    records.set(last.rkey, { uri, cid: 'external', value: { ...last.record, newerField: 'leave untouched' } });
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByText('a different record exists at this address. review it before continuing.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry same creation', exact: true }).count(), 0);
    assert.equal(writes.length, before);
    assert.equal(records.get(last.rkey).value.newerField, 'leave untouched');
    await screenshot(page, `${kind}-different-${width}-${theme}`);
    await page.getByRole('button', { name: 'Keep existing record', exact: true }).click();
    if (kind === 'track') await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    else await page.getByRole('button', { name: 'New playlist', exact: true }).waitFor();
    assert.equal(writes.length, before);
    assert.equal(records.get(last.rkey).value.newerField, 'leave untouched');
    await page.addInitScript(() => {
      if (localStorage.getItem('fixture-recovery-storage') === 'open') {
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (name, ...args) => { if (name === 'plyr-next-pending-creates') throw new Error('fixture storage unavailable'); return open(name, ...args); };
      } else {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          const result = transaction.apply(this, args);
          if (this.name === 'plyr-next-pending-creates' && args[1] !== 'readwrite') queueMicrotask(() => result.abort());
          return result;
        };
      }
    });
    await page.evaluate(() => localStorage.setItem('fixture-recovery-storage', 'open'));
    await enter(page);
    await page.getByText('could not load creation recovery. try again before publishing.', { exact: true }).waitFor();
    assert.equal(writes.length, before, 'unavailable recovery storage blocks new writes');
    await page.evaluate(() => localStorage.setItem('fixture-recovery-storage', 'abort'));
    await enter(page);
    await page.getByText('could not load creation recovery. try again before publishing.', { exact: true }).waitFor();
    assert.equal(writes.length, before, 'aborted recovery read fails closed without hanging');
    assert.deepEqual(errors, []);
    console.log(`${kind} ${width}/${theme}: lost response/reload, account isolation, same-key retry across tabs, accepted recovery and differing-record protection passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `${kind}-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) for (const kind of ['track', 'playlist']) await run(browser, width, theme, kind);
}).catch(error => { console.error(error); process.exitCode = 1; });
