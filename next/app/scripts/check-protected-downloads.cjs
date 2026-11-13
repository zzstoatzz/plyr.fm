const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const sdk = Promise.all([import('@atproto/crypto'), import('@atproto/lex-data'), import('@atproto/lex-cbor'), import('@atproto/lex-json'), import('@atproto/space')]);
const did = track.artist.did, space = `at://${did}/space/fm.plyr.audio/signed-in`, uri = `${space}/${did}/${track.record.collection}/protected`;
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function run(browser, width, theme) {
  const [{ P256Keypair }, { cidForRawBytes, cidForCbor }, { encode }, { lexParse, lexStringify }, spaces] = await sdk;
  const kem = await P256Keypair.create(), signer = await P256Keypair.create(), blobCid = await cidForRawBytes(audio);
  let policy = 'open', publicPolicy = 'open', supportGate, publicGate, visibility, corrupt = false, short = false, hold, entered = false, release;
  let recordReads = 0, blobReads = 0;
  const leaks = [], downloads = [];
  const current = () => ({ ...track, access: { visibility: 'public', download_policy: publicPolicy, gate: publicGate } });
  const { page, context, errors } = await setup(browser, width, theme, current(), Number(process.env.DOWNLOAD_SCALE || 1));
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await context.route('https://plc.directory/**', route => route.fulfill({ json: { verificationMethod: [{ id: `${did}#atproto_kem`, publicKeyMultibase: kem.did().slice(8) }], service: [{ id: `${did}#atproto_pds`, serviceEndpoint: 'https://protected-pds.fixture' }] } }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + track.id, route => route.fulfill({ json: current() }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + track.id + '/playback', route => route.fulfill({ json: { object: 'playback', track_id: track.id, record: track.record, availability: { status: 'gated', space: { uri: space, record: uri, gate: 'signed-in' } } } }));
    await page.route('https://api.next.plyr.fm/v1/artists/' + encodeURIComponent(did), route => route.fulfill({ json: { object: 'artist', did, support_url: 'https://support.fixture/artist' } }));
    page.on('request', request => { const content = decodeURIComponent(request.url()) + (request.postData() || ''); if (request.url().startsWith('https://api.next.plyr.fm/') && (content.includes('secret protected title') || content.includes(uri))) leaks.push(request.url()); });
    page.on('console', message => { if (message.text().includes('secret protected title')) leaks.push('console'); });
    await context.route('https://protected-pds.fixture/**', async route => {
      const url = new URL(route.request().url()), headers = route.request().headers();
      if (url.pathname.endsWith('getSpaceCredential')) {
        const input = route.request().postDataJSON(); assert.equal(input.delegationToken, 'synthetic-delegation');
        return route.fulfill({ json: { credential: await spaces.createSpaceCredential({ iss: did, sub: space, keyId: input.credentialKey, expiresInSec: 60, keypair: signer }) } });
      }
      const token = headers.authorization?.replace('Atproto-Space-Credential ', ''); assert.ok(token);
      await spaces.verifyCredentialSig(headers, spaces.parseSpaceToken('credential', token).payload.cnf.kid);
      if (url.pathname.endsWith('getRecord')) {
        recordReads++;
        const request = spaces.parseMacRequest(headers['accept-signature'], spaces.RECORD_MAC_PROFILE); assert.ok(request);
        const value = lexParse(JSON.stringify({ $type: track.record.collection, title: 'secret protected title', downloadPolicy: policy, supportGate, visibility, audioBlob: { $type: 'blob', ref: { $link: blobCid.toString() }, mimeType: 'audio/wav', size: audio.length } }));
        const cid = await cidForCbor(encode(value));
        const signed = spaces.createRecordMacHeaders(uri, cid, { ...request, sharedSecret: spaces.decapsulate(kem, request.keyShare) });
        if (corrupt) signed.headers.signature = 'mac=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:';
        if (hold === 'record') { entered = true; await new Promise(resolve => { release = resolve; }); }
        return route.fulfill({ body: lexStringify({ uri, cid: cid.toString(), value }), headers: { ...signed.headers, 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } }).catch(() => {});
      }
      assert.ok(url.pathname.endsWith('getBlob')); blobReads++;
      if (hold === 'blob') { entered = true; await new Promise(resolve => { release = resolve; }); }
      return route.fulfill({ body: short ? audio.subarray(0, 100) : audio, contentType: 'audio/wav' }).catch(() => {});
    });
    const signIn = (owner = 'did:plc:listenerfixture') => page.evaluate(([id, owner, space]) => globalThis.__r(id).setAuth(owner, {
      async handle(endpoint) { const url = new URL(String(endpoint), 'https://protected-pds.fixture');
        if (url.pathname.endsWith('listRecords')) return Response.json({ records: [] });
        if (url.pathname.endsWith('getDelegationToken') && url.searchParams.get('space') === space) return Response.json({ token: 'synthetic-delegation' });
        throw new Error('unexpected fixture RPC'); }
    }, 'atproto'), [authModule, owner, space]);
    const signOut = () => page.evaluate(id => globalThis.__r(id).clearAuth(), authModule);
    const download = () => page.getByRole('button', { name: 'download audio', exact: true }).click();
    const save = async action => { const pending = page.waitForEvent('download'); await action(); const result = await pending; assert.equal(await result.failure(), null); assert.ok((await fs.readFile(await result.path())).equals(audio)); assert.match(result.suggestedFilename(), /\.wav$/); };
    page.on('download', value => downloads.push(value));
    await page.goto(new URL('/track/' + track.id, page.url()).href);
    await page.waitForFunction(id => globalThis.__r(id).getAuth().ready, authModule);
    await page.getByRole('button', { name: 'More', exact: true }).click(); await download();
    await page.getByText('sign in to download this protected track.', { exact: true }).waitFor(); assert.equal(blobReads, 0);
    await signIn(); await save(download); assert.equal(blobReads, 1);
    for (const denied of ['off', 'supporters', undefined, 'future']) {
      policy = denied; await download(); await page.getByText('downloads are unavailable for this protected track.', { exact: true }).waitFor(); assert.equal(blobReads, 1);
    }
    policy = 'open'; supportGate = { type: 'any' }; await download(); await page.getByText('downloads are unavailable for this protected track.', { exact: true }).waitFor(); assert.equal(blobReads, 1);
    supportGate = undefined; visibility = 'private'; await download(); await page.getByText('downloads are unavailable for this protected track.', { exact: true }).waitFor(); assert.equal(blobReads, 1); visibility = undefined;
    publicGate = { type: 'any' }; await download(); await page.getByText('downloads are unavailable for this track.', { exact: true }).waitFor(); assert.equal(blobReads, 1); publicGate = undefined;
    publicPolicy = 'supporters'; await download(); await page.getByText('downloads are unavailable for this track.', { exact: true }).waitFor(); assert.equal(blobReads, 1); publicPolicy = 'open';
    corrupt = true; await download(); await page.getByText('could not verify this protected track', { exact: true }).waitFor(); assert.equal(blobReads, 1); corrupt = false;
    policy = 'ask'; await download(); await page.getByRole('button', { name: 'Continue download', exact: true }).waitFor();
    await screenshot(page, `protected-download-ask-${width}-${theme}`);
    const beforeContinue = recordReads; policy = 'off'; await page.getByRole('button', { name: 'Continue download', exact: true }).click();
    await page.getByText('downloads are unavailable for this protected track.', { exact: true }).waitFor(); assert.equal(blobReads, 1); assert.equal(recordReads, beforeContinue + 1);
    policy = 'ask'; await download(); await save(() => page.getByRole('button', { name: 'Continue download', exact: true }).click());
    policy = 'open'; short = true; const beforeShort = downloads.length; await download(); await page.getByText('incomplete protected audio', { exact: true }).waitFor(); assert.equal(downloads.length, beforeShort); short = false;
    hold = 'blob'; entered = false; const beforeCancel = downloads.length; await download();
    for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(entered);
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click(); release(); hold = undefined;
    await page.getByRole('button', { name: 'download audio', exact: true }).waitFor();
    assert.equal(await page.getByText('download opened.', { exact: true }).count(), 0); assert.equal(downloads.length, beforeCancel);
    await save(download); assert.equal(downloads.length, beforeCancel + 1, 'cancelled blob cannot save after same-session retry');
    for (const [stage, next] of [['record', signOut], ['blob', signIn], ['blob', () => signIn('did:plc:otherlistener')]]) {
      await signIn(); hold = stage; entered = false; const before = downloads.length; await download();
      for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(entered);
      await next(); release(); hold = undefined;
      await page.getByRole('button', { name: 'download audio', exact: true }).waitFor(); await signIn(); await save(download);
      assert.equal(downloads.length, before + 1, 'old session cannot save after replacement');
    }
    assert.deepEqual(leaks, []); assert.deepEqual(errors, []);
    assert.equal(await page.getByText('secret protected title', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes('secret protected title'))), false);
    console.log(`${width}/${theme}: signed protected bytes, both policies, support gates, MAC, length, fresh continuation, logout/RPC/account replacement and no private metadata leakage passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `protected-download-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => { for (const width of process.env.DOWNLOAD_SMOKE ? [390] : [390, 1280]) for (const theme of process.env.DOWNLOAD_SMOKE ? ['light'] : ['light', 'dark']) await run(browser, width, theme); }).catch(error => { console.error(error); process.exitCode = 1; });
