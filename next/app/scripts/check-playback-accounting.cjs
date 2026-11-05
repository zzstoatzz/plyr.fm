const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

module.exports = async function runAccounting({ browser, browserName, prepareContext, origin, track, output, reports, started }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await prepareContext(context, 'dark');
  const page = await context.newPage();
  page.setDefaultTimeout(40_000);
  const report = { name: `${browserName}-accounting-fixture`, requests: [], consoleErrors: [], occurrences: [], screenshots: [], timingsMs: {}, result: 'running' };
  reports.push(report);
  const accepted = new Map();
  const attempts = [];
  let mode = 'reject-first';
  let baseline = 0;
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('request', request => report.requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
  await page.route('**/v1/tracks/*/plays?*', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const occurrence = new URL(request.url()).searchParams.get('occurrence');
    assert.match(occurrence, /^[0-9a-f-]{36}$/);
    attempts.push(occurrence);
    report.occurrences.push({ occurrence, mode, at: Math.round(performance.now() - started) });
    if (mode === 'reject-first') {
      mode = 'accept';
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Injected play receipt failure' } }) });
    }
    if (!accepted.has(occurrence)) accepted.set(occurrence, baseline + accepted.size + 1);
    if (mode === 'lose-response') {
      mode = 'accept';
      return route.abort('connectionreset');
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      object: 'play_receipt', occurrence, track_id: track,
      record: { uri: Buffer.from(track.slice(4), 'base64url').toString() },
      play_count: accepted.get(occurrence), counted: true,
      dedup: { status: 'claimed', window_seconds: 30 },
      sources: { metrics: 'application_metrics', dedup: 'durable_occurrence_fixture' },
    }) });
  });
  const detail = `/v1/tracks/${track}`;
  const getCount = () => report.requests.filter(request => request.method === 'GET' && request.path === detail).length;
  const countText = value => new RegExp(`^${value} plays?$`);
  async function openTrack() {
    await page.goto(`${origin}/track/${track}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
  }
  async function play() {
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15));
  }
  try {
    await openTrack();
    baseline = Number.parseInt(await page.getByText(/^\d+ plays?$/).innerText(), 10);
    const beforeSeek = attempts.length;
    await play();
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Playback position', exact: true });
    await slider.waitFor();
    await page.waitForTimeout(400);
    const box = await slider.boundingBox();
    assert.ok(box);
    await slider.click({ position: { x: box.width * 0.94, y: box.height / 2 } });
    await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => audio.ended));
    await page.waitForTimeout(600);
    assert.equal(attempts.length, beforeSeek, 'Seeking near the end cannot qualify a play');
    report.seekNearEnd = 'no submission';

    await openTrack();
    const beforeQualification = getCount();
    const qualificationStarted = performance.now();
    await play();
    await page.getByText(countText(baseline + 1), { exact: true }).waitFor();
    report.timingsMs.qualificationAndRetry = Math.round(performance.now() - qualificationStarted);
    assert.equal(getCount(), beforeQualification, 'A receipt updates the count without refetching track detail');
    assert.equal(attempts.length, 2, 'First503 must retry exactly once');
    assert.equal(attempts[0], attempts[1], 'Retry reuses the qualified occurrence');
    await page.waitForTimeout(400);
    const countedScreenshot = `${browserName}-accounting-count.png`;
    await page.screenshot({ path: path.join(output, countedScreenshot) });
    report.screenshots.push(countedScreenshot);

    mode = 'lose-response';
    await openTrack();
    const beforeLoss = attempts.length;
    await play();
    await page.waitForRequest(request => request.method() === 'POST' && /\/plays\?/.test(request.url()), { timeout: 40_000 });
    await page.waitForFunction(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('plyr-next-play-outbox', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const pending = db.transaction('plays', 'readonly').objectStore('plays').getAll();
        pending.onsuccess = () => { resolve(pending.result.length > 0); db.close(); };
        pending.onerror = () => reject(pending.error);
      };
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(countText(baseline + 2), { exact: true }).waitFor();
    assert.equal(attempts.length, beforeLoss + 2, 'A pending submission resumes after reload');
    assert.equal(attempts[beforeLoss], attempts[beforeLoss + 1], 'Reload reuses the persisted occurrence');
    assert.equal(accepted.size, 2, 'Lost response does not create another accepted fixture occurrence');
    report.responseLossReload = 'same persisted occurrence, count reconciled';

    if (process.env.PLAYBACK_REPEAT === '1') {
      await openTrack();
      await play();
      await page.getByText(countText(baseline + 3), { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      await page.getByRole('button', { name: 'Queue', exact: true }).click();
      await page.getByRole('button', { name: 'Repeat: off', exact: true }).click();
      await page.getByRole('button', { name: 'Repeat: all', exact: true }).click();
      await page.getByRole('button', { name: 'Repeat: one', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      const repeatSlider = page.getByRole('slider', { name: 'Playback position', exact: true });
      await repeatSlider.waitFor();
      await page.waitForTimeout(400);
      const repeatBox = await repeatSlider.boundingBox();
      assert.ok(repeatBox);
      await repeatSlider.click({ position: { x: repeatBox.width * 0.95, y: repeatBox.height / 2 } });
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => audio.duration > 0 && audio.currentTime >= audio.duration - 1));
      await page.waitForTimeout(350);
      await repeatSlider.click({ position: { x: 1, y: repeatBox.height / 2 } });
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => audio.currentTime < 1));
      const beforeExplicitSeek = attempts.length;
      await page.getByRole('button', { name: 'Play', exact: true }).last().click();
      await page.waitForTimeout(6500);
      assert.equal(attempts.length, beforeExplicitSeek, 'An explicit backward seek cannot create a repeat occurrence');
      await page.waitForRequest(request => request.method() === 'POST' && /\/plays\?/.test(request.url()), { timeout: 20_000 });
      assert.equal(accepted.size, 4, 'A natural repeat qualifies another occurrence');
      assert.notEqual(attempts.at(-1), attempts[beforeExplicitSeek - 1]);
      await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
      report.repeatOne = 'explicit seek retained occurrence; natural loop created another';
    }
    assert.deepEqual(report.consoleErrors, [], 'No uncaught accounting errors');
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, `${browserName}-accounting-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
    console.log(JSON.stringify({ name: report.name, result: report.result, timingsMs: report.timingsMs, occurrences: report.occurrences, seekNearEnd: report.seekNearEnd, responseLossReload: report.responseLossReload }));
    await context.close();
  }
};
