const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const sdk = Promise.all([import('@atproto/crypto'), import('@atproto/lex-data'), import('@atproto/lex-cbor'), import('@atproto/lex-json'), import('@atproto/space')]);
const did = track.artist.did, space = `at://${did}/space/fm.plyr.stg.audio/supporters`, uri = `${space}/${did}/${track.record.collection}/protected`;
const downloadScope = 'rpc:fm.plyr.download.authorize?aud=did:web:plyr-jams-next.fly.dev#jams';
const attachment = 'https://plyr-next-audio.n8-3e9.workers.dev/media/' + 'a'.repeat(64) + '/12345678-1234-4123-8123-123456789abc';
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function run(browser, width, theme) {
  const [{ P256Keypair }, { cidForRawBytes, cidForCbor }, { encode }, { lexParse, lexStringify }, spaces] = await sdk;
  const kem = await P256Keypair.create(), signer = await P256Keypair.create(), blobCid = await cidForRawBytes(audio);
  let policy = 'supporters', publicPolicy = 'supporters', supportGate, publicGate, visibility, corrupt = false, short = false, hold, entered = false, release;
  let decisionStatus = 200, decisionPatch = {}, changedAfterDecision, publicCid = track.record.cid, publicVisibility = 'public', publicDelivery = false, decisions = 0, serviceRequests = 0;
  let shortCredential = false, credentialMints = 0, legacyPlayback = false;
  let recordReads = 0, blobReads = 0;
  const leaks = [], downloads = [];
  const current = () => ({ ...track, record: { ...track.record, cid: publicCid }, access: { visibility: publicVisibility, download_policy: publicPolicy, gate: publicGate } });
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
    await page.route('https://api.next.plyr.fm/v1/tracks/' + track.id + '/playback', route => route.fulfill({ status: legacyPlayback ? 401 : 200, json: legacyPlayback ? { error: { message: 'authentication required' } } : { object: 'playback', track_id: track.id, record: current().record, availability: publicDelivery ? { status: 'available', delivery: { url: publicDelivery === 'attachment' ? attachment : 'https://supporter-public.fixture/audio.wav', media_type: 'audio/wav' } } : { status: 'gated', space: { uri: space, record: uri, gate: 'supporters' } } } }));
    await context.route('https://supporter-public.fixture/audio.wav', route => { blobReads++; return route.fulfill({ body: audio, contentType: 'audio/wav' }); });
    await context.route(attachment + '/manifest', route => route.fulfill({ json: { processed: false, playback: { url: attachment, contentType: 'audio/wav', sizeBytes: audio.length }, original: { url: attachment + '/original', contentType: 'audio/wav', fileType: 'wav', sizeBytes: audio.length } } }));
    await context.route(attachment + '?download=1', async route => {
      const head = route.request().method() === 'HEAD';
      if (head && hold === 'head') { entered = true; await new Promise(resolve => { release = resolve; }); }
      if (!head) blobReads++;
      return route.fulfill({ body: head ? '' : audio, headers: { 'content-type': 'audio/wav', 'content-disposition': 'attachment; filename="audio.wav"', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-disposition' } }).catch(() => {});
    });
    await context.exposeFunction('__supporterService', (owner, endpoint) => {
      serviceRequests++;
      const url = new URL(endpoint, 'https://protected-pds.fixture');
      assert.equal(url.pathname, '/xrpc/com.atproto.server.getServiceAuth');
      assert.equal(url.searchParams.get('aud'), 'did:web:plyr-jams-next.fly.dev#jams');
      assert.equal(url.searchParams.get('lxm'), 'fm.plyr.download.authorize');
      return { token: 'fixture-service:' + owner };
    });
    await context.route('https://plyr-jams-next.fly.dev/v1/downloads/authorize', async route => {
      decisions++;
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['recordCid', 'recordUri', 'serviceToken']);
      assert.equal(body.recordUri, track.record.uri); assert.equal(body.recordCid, publicCid);
      assert.ok(body.serviceToken.startsWith('fixture-service:'));
      const value = { viewer: body.serviceToken.slice('fixture-service:'.length), recordUri: body.recordUri, recordCid: body.recordCid, downloadPolicy: 'supporters', expiresAt: Date.now() + 29_000, ...decisionPatch };
      if (changedAfterDecision === 'off') publicPolicy = 'off';
      if (changedAfterDecision === 'cid') publicCid = 'changed-public-cid';
      if (changedAfterDecision === 'private') publicVisibility = 'private';
      if (hold === 'decision') { entered = true; await new Promise(resolve => { release = resolve; }); }
      return route.fulfill({ status: decisionStatus, json: decisionStatus === 200 ? value : {} }).catch(() => {});
    });
    await page.route('https://api.next.plyr.fm/v1/artists/' + encodeURIComponent(did), route => route.fulfill({ json: { object: 'artist', did, support_url: 'https://support.fixture/artist' } }));
    page.on('request', request => { const content = decodeURIComponent(request.url()) + (request.postData() || ''); if (request.url().startsWith('https://api.next.plyr.fm/') && (content.includes('secret protected title') || content.includes(uri))) leaks.push(request.url()); });
    page.on('console', message => { if (message.text().includes('secret protected title')) leaks.push('console'); });
    await context.route('https://protected-pds.fixture/**', async route => {
      const url = new URL(route.request().url()), headers = route.request().headers();
      if (url.pathname.endsWith('getSpaceCredential')) {
        credentialMints++;
        const input = route.request().postDataJSON(); assert.equal(input.delegationToken, 'synthetic-delegation');
        if (hold === 'secondCredential' && credentialMints === 2) { entered = true; await new Promise(resolve => { release = resolve; }); }
        return route.fulfill({ json: { credential: await spaces.createSpaceCredential({ iss: did, sub: space, keyId: input.credentialKey, expiresInSec: shortCredential ? 10 : 60, keypair: signer }) } });
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
    const signIn = async (grant = true, owner = 'did:plc:listenerfixture') => page.evaluate(([id, owner, space, scope]) => globalThis.__r(id).setAuth(owner, {
      async handle(endpoint) { const url = new URL(String(endpoint), 'https://protected-pds.fixture');
        if (url.pathname.endsWith('listRecords')) return Response.json({ records: [] });
        if (url.pathname.endsWith('getServiceAuth')) return Response.json(await window.__supporterService(owner, String(endpoint)));
        if (url.pathname.endsWith('getDelegationToken') && url.searchParams.get('space') === space) return Response.json({ token: 'synthetic-delegation' });
        throw new Error('unexpected fixture RPC'); }
    }, scope), [authModule, owner, space, 'atproto' + (grant ? ' ' + downloadScope : '')]);
    const signOut = () => page.evaluate(id => globalThis.__r(id).clearAuth(), authModule);
    const download = () => page.getByRole('button', { name: 'download audio', exact: true }).click();
    const save = async action => { const pending = page.waitForEvent('download'); await action(); const result = await pending; assert.equal(await result.failure(), null); assert.ok((await fs.readFile(await result.path())).equals(audio)); };
    const denied = async text => { const before = blobReads; await download(); await page.getByText(text, { exact: true }).waitFor(); assert.equal(blobReads, before); };
    const enter = async () => {
      await page.goto(new URL('/track/' + track.id, page.url()).href);
      await page.waitForFunction(id => globalThis.__r(id).getAuth().ready, authModule);
      await page.getByRole('button', { name: 'More', exact: true }).click();
    };
    const waitHeld = async () => { for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(entered); };
    const clock = offset => page.evaluate(offset => { window.__originalDownloadClock ??= Date.now; Date.now = () => window.__originalDownloadClock() + offset; }, offset);
    page.on('download', value => downloads.push(value));
    await enter(); await page.getByRole('button', { name: 'Sign in for supporter downloads', exact: true }).waitFor();
    assert.equal(serviceRequests, 0); assert.equal(decisions, 0); assert.equal(blobReads, 0);
    await signIn(false); await page.getByRole('button', { name: 'Reconnect for supporter downloads', exact: true }).waitFor();
    await screenshot(page, `supporter-download-reconnect-${width}-${theme}`);
    await page.getByRole('button', { name: 'Reconnect for supporter downloads', exact: true }).click();
    await page.getByRole('heading', { name: 'sign in to plyr.fm', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('return_to'), '/track/' + track.id); assert.equal(decisions, 0);
    await enter(); await signIn(); await save(download); assert.equal(decisions, 1); assert.equal(blobReads, 1);
    publicGate = { type: 'any' }; supportGate = { type: 'any' }; await save(download); publicGate = undefined; supportGate = undefined;
    for (const status of [403, 409, 503]) { decisionStatus = status; await denied(status === 403 ? 'could not authorize this download.' : status === 409 ? 'this track changed. try the download again.' : 'download access checks are unavailable. try again.'); }
    await screenshot(page, `supporter-download-unavailable-${width}-${theme}`); decisionStatus = 200;
    for (const patch of [{ viewer: 'did:plc:wrong' }, { recordCid: 'stale' }, { recordUri: track.record.uri + '-other' }, { downloadPolicy: 'open' }, { expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 90_000 }]) {
      decisionPatch = patch; await denied('could not verify download access. try again.');
    }
    decisionPatch = {};
    for (const change of ['off', 'cid', 'private']) {
      changedAfterDecision = change; await denied('this track changed or is unavailable. try again.');
      changedAfterDecision = undefined; publicPolicy = 'supporters'; publicCid = track.record.cid; publicVisibility = 'public';
    }
    for (const gate of [{ type: 'owner' }, { type: 'future' }]) { publicGate = gate; await denied('downloads are unavailable for this track.'); publicGate = undefined; supportGate = gate; await denied('downloads are unavailable for this protected track.'); supportGate = undefined; }
    for (const deniedPolicy of ['off', undefined, 'future']) { policy = deniedPolicy; await denied('downloads are unavailable for this protected track.'); }
    policy = 'supporters'; publicPolicy = 'open'; await denied('downloads are unavailable for this protected track.'); publicPolicy = 'supporters';
    legacyPlayback = true; await denied('this track has no supported download source.'); legacyPlayback = false;
    corrupt = true; await denied('could not verify this protected track'); corrupt = false;
    policy = 'ask'; await download(); await page.getByRole('button', { name: 'Continue download', exact: true }).waitFor();
    await screenshot(page, `supporter-download-ask-${width}-${theme}`);
    const beforeContinue = decisions; await save(() => page.getByRole('button', { name: 'Continue download', exact: true }).click()); assert.equal(decisions, beforeContinue + 1);
    policy = 'supporters';
    hold = 'record'; entered = false; const beforeExpired = blobReads; await download(); await waitHeld(); await clock(31_000); release(); hold = undefined;
    await page.getByText('download access expired. try again.', { exact: true }).waitFor(); assert.equal(blobReads, beforeExpired); await clock(0);
    await signIn(); shortCredential = true; credentialMints = 0; hold = 'secondCredential'; entered = false; await download(); await waitHeld(); await clock(31_000); release(); hold = undefined;
    await page.getByText('download access expired. try again.', { exact: true }).waitFor(); assert.equal(blobReads, beforeExpired); await clock(0); shortCredential = false; await signIn();
    hold = 'blob'; entered = false;
    await save(async () => { await download(); await waitHeld(); await clock(31_000); release(); hold = undefined; }); await clock(0);
    for (const [stage, next] of [['decision', signOut], ['decision', () => signIn()], ['blob', () => signIn(true, 'did:plc:otherlistener')]]) {
      await signIn(); hold = stage; entered = false; const before = downloads.length; await download(); await waitHeld();
      await next(); release(); hold = undefined; await signIn(); await save(download);
      assert.equal(downloads.length, before + 1, 'old session cannot save after new authorization');
    }
    hold = 'decision'; entered = false; const beforeCancel = downloads.length; await download(); await waitHeld();
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click(); release(); hold = undefined;
    await save(download); assert.equal(downloads.length, beforeCancel + 1);
    publicDelivery = true; const beforePublic = recordReads; await save(download); assert.equal(recordReads, beforePublic, 'authorized public bytes do not require a fake protected record');
    publicDelivery = 'attachment'; hold = 'head'; entered = false; const beforeHead = blobReads; await download(); await waitHeld(); await clock(31_000); release(); hold = undefined;
    await page.getByText('download access expired. try again.', { exact: true }).waitFor(); assert.equal(blobReads, beforeHead); await clock(0); await save(download);
    assert.deepEqual(leaks, []); assert.deepEqual(errors, []);
    assert.equal(await page.getByText('secret protected title', { exact: true }).count(), 0);
    console.log(`${width}/${theme}: dedicated reconnect, exact decision, fresh moderation/CID, protected gates/MAC, expiry before bytes, slow transfer, account/RPC/cancel and public delivery passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `supporter-download-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => { for (const width of process.env.DOWNLOAD_SMOKE ? [390] : [390, 1280]) for (const theme of process.env.DOWNLOAD_SMOKE ? ['light'] : ['light', 'dark']) await run(browser, width, theme); }).catch(error => { console.error(error); process.exitCode = 1; });
