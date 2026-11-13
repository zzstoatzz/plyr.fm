const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:privatepublishingfixture', space = `at://${did}/space/fm.plyr.privateMedia/self`;
const scope = 'atproto blob:*/* repo:fm.plyr.track space:fm.plyr.privateMedia?authority=self&skey=self&collection=fm.plyr.track&action=read&action=create&action=delete&manage=create';
const audio = Buffer.alloc(44 + 8000 * 20 * 2);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function run(browser, width, theme) {
  const [{ P256Keypair }, { cidForRawBytes, cidForCbor }, { encode }, { lexParse, lexStringify }, spaces] = await Promise.all([
    import('@atproto/crypto'), import('@atproto/lex-data'), import('@atproto/lex-cbor'), import('@atproto/lex-json'), import('@atproto/space'),
  ]);
  const kem = await P256Keypair.create(), signer = await P256Keypair.create(), blobCid = await cidForRawBytes(audio);
  const blob = { $type: 'blob', ref: { $link: blobCid.toString() }, mimeType: 'audio/wav', size: audio.length };
  const { page, context, errors } = await setup(browser, width, theme, track, Number(process.env.PRIVATE_SCALE || 1));
  try {
    let authModule, pdsModule; const targetModules = [];
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        if (module.includes('.createPds=')) pdsModule = Number(module.match(/\},(\d+),\[/)?.[1]);
        for (const name of ['usePersonalQueue', 'useJamPlayback']) if (module.includes('.' + name + '=')) targetModules.push([Number(module.match(/\},(\d+),\[/)?.[1]), name]);
      }
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule); assert.ok(pdsModule);

    const records = new Map(), writes = [], publicWrites = [], publicLeaks = [];
    let releaseBlob, holdBlob = false, blobEntered = false;
    let deletes = 0, loseDelete = false, holdDelete = false, releaseDelete, deleteEntered = false;
    let exists = false, publicPolicy = false, offline = false, loseCreate = true, blobs = 0, signedReads = 0, blobReads = 0;
    const policy = () => ({ $type: 'com.atproto.memberspace.policy', publicRead: publicPolicy, publicWrite: false, publishPolicy: false, publishMembers: false });
    await context.route('https://plc.directory/**', route => route.fulfill({ json: { verificationMethod: [{ id: `${did}#atproto_kem`, publicKeyMultibase: kem.did().slice(8) }], service: [{ id: `${did}#atproto_pds`, serviceEndpoint: 'https://private-pds.fixture' }] } }));
    page.on('request', request => { if (request.url().startsWith('https://api.next.plyr.fm/') && /private_|private song|private liner|privateMedia/.test(decodeURIComponent(request.url()) + (request.postData() || ''))) publicLeaks.push(request.url()); });
    await context.exposeFunction('__privateRpc', async (endpoint, body, binarySize) => {
      const url = new URL(endpoint, 'https://private-pds.fixture'), method = url.pathname.split('/').at(-1), input = body ? JSON.parse(body) : undefined;
      if (method === 'com.atproto.repo.listRecords') return { status: 200, body: { records: [] } };
      if (['com.atproto.repo.createRecord', 'com.atproto.repo.putRecord'].includes(method)) { publicWrites.push(input); return { status: 500, body: { error: 'FixtureBlockedPublicWrite' } }; }
      if (method === 'com.atproto.space.getDelegationToken') { assert.equal(url.searchParams.get('space'), space); return { status: 200, body: { token: 'synthetic-delegation' } }; }
      if (method === 'com.atproto.space.createSpace') { assert.equal(input.spaceType, 'fm.plyr.privateMedia'); assert.equal(input.skey, 'self'); assert.equal(input.policy.publicRead, false);
        if (exists) return { status: 400, body: { error: 'SpaceAlreadyExists' } }; exists = true; return { status: 200, body: { space } }; }
      if (method === 'com.atproto.space.getSpace') return exists && url.searchParams.get('space') === space ? { status: 200, body: { space, policy: policy() } } : { status: 404, body: { error: 'SpaceNotFound' } };
      if (method === 'com.atproto.repo.uploadBlob') { assert.equal(binarySize, audio.length); blobs++; if (holdBlob) { blobEntered = true; await new Promise(resolve => { releaseBlob = resolve; }); } return { status: 200, body: { blob } }; }
      if (method === 'com.atproto.space.listRecords') return { status: 200, body: { records: [...records].map(([rkey, stored]) => ({ collection: 'fm.plyr.track', rkey, cid: stored.cid, value: stored.value })) } };
      if (method === 'com.atproto.space.deleteRecord') {
        assert.equal(input.space, space); assert.equal(input.repo, did); assert.equal(input.collection, 'fm.plyr.track'); assert.equal(input.swapRecord, undefined);
        deletes++; if (holdDelete) { deleteEntered = true; await new Promise(resolve => { releaseDelete = resolve; }); }
        records.delete(input.rkey); if (loseDelete) { offline = true; return { drop: true }; } return { status: 200, body: {} };
      }
      if (method === 'com.atproto.space.getRecord') {
        if (offline) return { drop: true };
        const stored = records.get(url.searchParams.get('rkey'));
        return stored ? { status: 200, body: stored } : { status: 404, body: { error: 'RecordNotFound' } };
      }
      assert.equal(method, 'com.atproto.space.createRecord', 'no public record writes or unexpected RPC');
      assert.equal(input.space, space); assert.equal(input.repo, did); assert.equal(input.record.audioUrl, undefined); writes.push(input);
      if (records.has(input.rkey)) return { status: 400, body: { error: 'RecordAlreadyExists' } };
      const cid = await cidForCbor(encode(lexParse(JSON.stringify(input.record))));
      const stored = { uri: `${space}/${did}/fm.plyr.track/${input.rkey}`, cid: cid.toString(), value: input.record }; records.set(input.rkey, stored);
      if (loseCreate) { offline = true; return { drop: true }; }
      return { status: 200, body: { uri: stored.uri, cid: stored.cid } };
    });
    await context.route('https://private-pds.fixture/**', async route => {
      const url = new URL(route.request().url()), headers = route.request().headers();
      if (url.pathname.endsWith('getSpaceCredential')) {
        const input = route.request().postDataJSON(); assert.equal(input.delegationToken, 'synthetic-delegation');
        return route.fulfill({ json: { credential: await spaces.createSpaceCredential({ iss: did, sub: space, keyId: input.credentialKey, expiresInSec: 60, keypair: signer }) } });
      }
      const token = headers.authorization?.replace('Atproto-Space-Credential ', ''); assert.ok(token);
      await spaces.verifyCredentialSig(headers, spaces.parseSpaceToken('credential', token).payload.cnf.kid);
      if (url.pathname.endsWith('getRecord')) {
        signedReads++; const stored = records.get(url.searchParams.get('rkey')); assert.ok(stored);
        const request = spaces.parseMacRequest(headers['accept-signature'], spaces.RECORD_MAC_PROFILE); assert.ok(request);
        const value = lexParse(JSON.stringify(stored.value)), cid = await cidForCbor(encode(value));
        const signed = spaces.createRecordMacHeaders(stored.uri, cid, { ...request, sharedSecret: spaces.decapsulate(kem, request.keyShare) });
        return route.fulfill({ body: lexStringify({ uri: stored.uri, cid: stored.cid, value }), headers: { ...signed.headers, 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
      }
      assert.ok(url.pathname.endsWith('getBlob')); blobReads++;
      return route.fulfill({ body: audio, contentType: 'audio/wav' });
    });
    const signIn = (owner = did, grant = true) => page.evaluate(([id, owner, scope]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => { const result = await window.__privateRpc(String(url), typeof init?.body === 'string' ? init.body : null, init?.body instanceof ArrayBuffer ? init.body.byteLength : null);
        if (result.drop) throw new TypeError('fixture response lost'); return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } }); },
    }, scope), [authModule, owner, grant ? scope : 'atproto repo:fm.plyr.track blob:*/*']);
    const enter = async () => { await page.goto(new URL('/private', page.url()).href); await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor(); await signIn(); };
    const choose = async () => { const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose private audio', exact: true }).click()]); await chooser.setFiles({ name: 'private.wav', mimeType: 'audio/wav', buffer: audio }); };
    await enter(); await signIn(did, false);
    await page.getByRole('link', { name: 'Sign in for private uploads' }).waitFor(); assert.equal(blobs, 0);
    await signIn(); await choose();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('private song');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('private liner notes');
    assert.ok(await page.getByRole('button', { name: 'Upload privately', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Use my private space', exact: true }).click();
    await screenshot(page, `private-consent-${width}-${theme}`);
    await page.getByRole('button', { name: 'Upload privately', exact: true }).click();
    await page.getByText('could not confirm creation. check this private attempt before trying again.', { exact: true }).waitFor(); assert.equal(writes.length, 1);
    await enter(); assert.equal(writes.length, 1); offline = false; loseCreate = false;
    await page.getByRole('button', { name: 'Check private creation', exact: true }).click();
    await page.getByText('saved in your private space.', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Delete private song', exact: true }).isDisabled(), 'unresolved creation cannot be deleted then resumed');
    await page.getByRole('button', { name: 'Done with private upload', exact: true }).click();
    await page.getByRole('button', { name: 'Check private creation', exact: true }).waitFor({ state: 'detached' });
    const stored = [...records.values()][0], rkey = [...records.keys()][0];
    await page.evaluate(() => { navigator.serviceWorker.register = () => Promise.reject(new Error('fixture uses verified buffered playback')); });
    const play = async () => {
      await page.getByRole('button', { name: 'Play private song', exact: true }).click();
      await page.waitForFunction(() => window.__playerPresentationMedia && !window.__playerPresentationMedia.paused && window.__playerPresentationMedia.currentTime > 0.2);
    };
    await signIn(did, false);
    await page.getByRole('button', { name: 'Delete private song', exact: true }).click();
    await page.getByRole('link', { name: 'Sign in to delete private music', exact: true }).waitFor(); assert.equal(deletes, 0);
    const remainingValue = { ...stored.value, title: 'remaining private song' };
    const remainingCid = await cidForCbor(encode(lexParse(JSON.stringify(remainingValue))));
    records.set('3jzfcijpj2z2b', { ...stored, uri: stored.uri.slice(0, stored.uri.lastIndexOf('/') + 1) + '3jzfcijpj2z2b', cid: remainingCid.toString(), value: remainingValue });
    await enter(); await play();
    await page.getByRole('button', { name: 'Delete private song', exact: true }).click();
    await page.getByText(/this deletes the current version, including changes made elsewhere/).waitFor();
    await screenshot(page, `private-delete-confirm-${width}-${theme}`);
    await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click(); assert.equal(deletes, 0);
    await page.getByRole('button', { name: 'Delete private song', exact: true }).click();
    publicPolicy = true;
    await page.getByRole('button', { name: 'Delete current track', exact: true }).click();
    await page.getByRole('button', { name: 'Check deletion', exact: true }).waitFor(); assert.equal(deletes, 0, 'public policy cannot be deleted through private workflow');
    publicPolicy = false; await page.getByRole('button', { name: 'Check deletion', exact: true }).click();
    await page.getByRole('button', { name: 'Delete current track', exact: true }).waitFor();
    records.set(rkey, { ...stored, cid: 'concurrent-revision', value: { ...stored.value, title: 'changed elsewhere', future: true } });
    loseDelete = true;
    await page.getByRole('button', { name: 'Delete current track', exact: true }).click();
    await page.getByRole('button', { name: 'Check deletion', exact: true }).waitFor(); assert.equal(deletes, 1);
    assert.equal(await page.getByRole('button', { name: 'Delete current track', exact: true }).count(), 0);
    await screenshot(page, `private-delete-unknown-${width}-${theme}`);
    offline = false;
    await page.getByRole('button', { name: 'Check deletion', exact: true }).click();
    await page.getByRole('button', { name: 'Play private song', exact: true }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => !window.__playerPresentationMedia || window.__playerPresentationMedia.paused);
    assert.equal(deletes, 1);
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    await page.getByTestId('now-playing-title').filter({ hasText: 'remaining private song' }).waitFor();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__playerPresentationMedia && !window.__playerPresentationMedia.paused && window.__playerPresentationMedia.currentTime > 0.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    records.set(rkey, stored); loseDelete = false; await enter();
    await page.getByRole('button', { name: 'Delete private song', exact: true }).click();
    holdDelete = true; await page.getByRole('button', { name: 'Delete current track', exact: true }).click();
    for (let attempt = 0; attempt < 100 && !deleteEntered; attempt++) await require('node:timers/promises').setTimeout(20);
    assert.ok(deleteEntered); await signIn();
    await page.getByRole('button', { name: 'Delete private song', exact: true }).waitFor();
    releaseDelete(); await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name: 'Delete private song', exact: true }).count(), 1, 'old completion cannot remove new session list');
    assert.equal(deletes, 2); assert.deepEqual(publicLeaks, []); assert.deepEqual(publicWrites, []); assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: explicit current-URI deletion, lost-response check-only recovery, player release and session isolation passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `private-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of process.env.PRIVATE_SMOKE ? [390] : [390, 1280]) for (const theme of process.env.PRIVATE_SMOKE ? ['light'] : ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
