const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const sample = Buffer.alloc(44 + 16000);
sample.write('RIFF'); sample.writeUInt32LE(sample.length - 8, 4); sample.write('WAVEfmt ', 8); sample.writeUInt32LE(16, 16); sample.writeUInt16LE(1, 20); sample.writeUInt16LE(1, 22); sample.writeUInt32LE(8000, 24); sample.writeUInt32LE(16000, 28); sample.writeUInt16LE(2, 32); sample.writeUInt16LE(16, 34); sample.write('data', 36); sample.writeUInt32LE(sample.length - 44, 40);
const attachment = 'https://plyr-next-audio.n8-3e9.workers.dev/media/' + 'a'.repeat(64) + '/12345678-1234-4123-8123-123456789abc';
const originalSample = Buffer.from(sample); originalSample[44] = 42;
async function run(browser, width, theme) {
  let policy = 'open', visibility = 'public', source = 'https://download-fixture.invalid/audio.wav', mismatch = false, gated = false, unavailable = false, huge = false, hold = false, release, entered = false;
  let mediaReads = 0, heads = 0;
  let processed = false, invalidManifest = false, manifestReads = 0;
  const otherUri = track.record.uri + '-second';
  const other = { ...track, id: 'trk_' + Buffer.from(otherUri).toString('base64url'), record: { ...track.record, uri: otherUri }, metadata: { ...track.metadata, title: 'another download fixture' }, access: { visibility: 'public', download_policy: 'open' } };
  const current = () => ({ ...track, access: { visibility, download_policy: policy } });
  const { page, context, errors } = await setup(browser, width, theme, current(), Number(process.env.DOWNLOAD_SCALE || 1));
  try {
    await page.route(url => url.origin === 'https://api.next.plyr.fm' && url.pathname === '/v1/tracks', route => route.fulfill({ json: { object: 'list', data: [current(), other], has_more: false } }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + other.id, route => route.fulfill({ json: other }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + other.id + '/playback', route => route.fulfill({ json: { object: 'playback', track_id: other.id, record: other.record, availability: { status: 'available', delivery: { url: 'https://download-fixture.invalid/second.wav', media_type: 'audio/wav' } } } }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + track.id, route => route.fulfill({ status: unavailable ? 404 : 200, json: unavailable ? { error: { message: 'unavailable' } } : current() }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + track.id + '/playback', route => route.fulfill({ json: { object: 'playback', track_id: track.id, record: { uri: track.record.uri, cid: mismatch ? 'other-revision' : track.record.cid }, availability: { status: gated ? 'gated' : 'available', delivery: { url: source, media_type: 'audio/wav' } } } }));
    await page.route('https://api.next.plyr.fm/v1/artists/' + encodeURIComponent(track.artist.did), route => route.fulfill({ json: { object: 'artist', did: track.artist.did, display_name: 'artist', handle: 'artist.test', support_url: 'https://support.fixture/artist' } }));
    await context.route('https://download-fixture.invalid/**', async route => {
      mediaReads++; if (hold) { entered = true; await new Promise(resolve => { release = resolve; }); }
      await route.fulfill({ body: sample, headers: { 'content-type': 'audio/wav', 'content-length': String(huge ? 104857601 : sample.length), 'access-control-allow-origin': '*' } }).catch(() => {});
    });
    await context.route(attachment + '?download=1', async route => {
      assert.ok(['HEAD', 'GET'].includes(route.request().method()));
      if (route.request().method() === 'HEAD') heads++; else mediaReads++;
      await route.fulfill({ body: route.request().method() === 'HEAD' ? '' : sample, headers: { 'content-type': 'audio/wav', 'content-disposition': 'attachment; filename="audio.wav"', 'content-length': String(route.request().method() === 'HEAD' ? 200_000_000 : sample.length), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-disposition, content-length' } });
    });
    await context.route(attachment + '/manifest', async route => {
      manifestReads++;
      await route.fulfill({ json: { processed, original: { url: invalidManifest ? 'https://foreign.invalid/audio' : attachment + '/original', contentType: 'audio/wav', fileType: 'wav', sizeBytes: originalSample.length }, playback: { url: attachment, contentType: 'audio/wav', sizeBytes: sample.length } } });
    });
    await context.route(attachment + '/original', async route => {
      assert.ok(['HEAD', 'GET'].includes(route.request().method()));
      if (route.request().method() === 'HEAD') heads++; else mediaReads++;
      await route.fulfill({ body: route.request().method() === 'HEAD' ? '' : originalSample, headers: { 'content-type': 'audio/wav', 'content-disposition': 'attachment; filename="original.wav"', 'content-length': String(originalSample.length), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-disposition, content-length' } });
    });
    const enter = async () => { await page.goto(new URL('/track/' + track.id, page.url()).href); await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('button', { name: 'add to queue', exact: true }).click({ trial: true }); await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))); };
    const download = () => page.getByRole('button', { name: 'download audio', exact: true }).click();
    const file = async (action, expected = sample) => {
      const pending = page.waitForEvent('download'); await action(); const result = await pending;
      let timer;
      try {
        assert.equal(await Promise.race([result.failure(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('download completion timed out')), 15000); })]), null);
        assert.ok((await fs.readFile(await result.path())).equals(expected), 'saved file bytes must exactly match the selected fixture');
        return result;
      } finally { clearTimeout(timer); }
    };
    await enter(); await page.getByRole('button', { name: 'download audio', exact: true }).waitFor(); await screenshot(page, `download-menu-${width}-${theme}`);
    assert.match((await file(download)).suggestedFilename(), /\.wav$/); assert.equal(mediaReads, 1);
    policy = 'off'; await download(); await page.getByText('downloads are unavailable for this track.', { exact: true }).waitFor(); assert.equal(mediaReads, 1);
    policy = 'open'; mismatch = true; await download(); await page.getByText('this track changed or is unavailable. try again.', { exact: true }).waitFor(); assert.equal(mediaReads, 1);
    mismatch = false; unavailable = true; await download(); await page.getByText('unavailable', { exact: true }).waitFor(); assert.equal(mediaReads, 1); unavailable = false;
    gated = true; await download(); await page.getByText('this track changed or is unavailable. try again.', { exact: true }).waitFor(); assert.equal(mediaReads, 1);
    gated = false; policy = 'ask'; await enter(); await download();
    await page.getByText('consider supporting this artist before downloading. support is optional.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Support artist', exact: true }).getAttribute('href'), 'https://support.fixture/artist');
    assert.equal(mediaReads, 1); await screenshot(page, `download-ask-${width}-${theme}`);
    await file(() => page.getByRole('button', { name: 'Continue download', exact: true }).click()); assert.equal(mediaReads, 2);
    policy = 'open'; source = attachment; await enter(); assert.equal((await file(download)).suggestedFilename(), 'audio.wav'); assert.equal(heads, 1); assert.equal(mediaReads, 3);
    assert.equal(await page.getByRole('button', { name: /^Original upload/ }).count(), 0, 'raw uploads must not offer duplicate formats');
    processed = true; await download();
    const originalButton = () => page.getByRole('button', { name: /^Original upload/ });
    await originalButton().waitFor(); await screenshot(page, `download-original-choice-${width}-${theme}`);
    const beforeOriginal = manifestReads;
    assert.equal((await file(() => originalButton().click(), originalSample)).suggestedFilename(), 'original.wav');
    assert.equal(manifestReads, beforeOriginal + 1, 'selection must refresh the manifest');
    await download(); await file(() => page.getByRole('button', { name: /^Playback audio/ }).click());
    policy = 'ask'; await download(); await originalButton().waitFor(); await screenshot(page, `download-original-ask-${width}-${theme}`);
    const beforeDenied = mediaReads; policy = 'off'; await originalButton().click();
    await page.getByText('downloads are unavailable for this track.', { exact: true }).waitFor(); assert.equal(mediaReads, beforeDenied);
    policy = 'open'; invalidManifest = true; await download();
    await page.getByText('the audio download information is unavailable. try again.', { exact: true }).waitFor(); assert.equal(mediaReads, beforeDenied); invalidManifest = false;
    await download(); await originalButton().waitFor(); processed = false; await originalButton().click();
    await page.getByText('the original download changed. choose a download again.', { exact: true }).waitFor(); assert.equal(mediaReads, beforeDenied);
    source = 'https://download-fixture.invalid/audio.wav'; huge = true; await download();
    await page.getByText('this source needs a direct download link for files over 100 MiB.', { exact: true }).waitFor(); await screenshot(page, `download-unavailable-${width}-${theme}`);
    huge = false; hold = true; await download(); for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(entered);
    const downloads = []; page.on('download', value => downloads.push(value));
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click(); release(); hold = false;
    await page.getByRole('button', { name: 'download audio', exact: true }).waitFor();
    await file(download); assert.equal(downloads.length, 1, 'cancelled request cannot save after next request');
    hold = true; entered = false; await download();
    for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(entered);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.getByRole('link', { name: 'Track details: another download fixture', exact: true }).click();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    release(); hold = false;
    await file(download); assert.equal(downloads.length, 2, 'old track completion cannot save or disable the new track menu');
    for (const denied of [undefined, 'off', 'future', 'supporters']) { policy = denied; await enter(); assert.equal(await page.getByRole('button', { name: 'download audio', exact: true }).count(), 0); }
    policy = 'open'; visibility = 'supporters'; await enter(); assert.equal(await page.getByRole('button', { name: 'download audio', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: exact downloaded bytes, optional support, fresh policy/CID/gating, attachment bypass, size refusal, cancellation and old-track completion isolation passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `download-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => { for (const width of process.env.DOWNLOAD_SMOKE ? [390] : [390, 1280]) for (const theme of process.env.DOWNLOAD_SMOKE ? ['light'] : ['light', 'dark']) await run(browser, width, theme); }).catch(error => { console.error(error); process.exitCode = 1; });
