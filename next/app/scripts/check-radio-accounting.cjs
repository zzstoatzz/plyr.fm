const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

module.exports = async function runRadioAccounting({ browser, browserName, prepareContext, origin, track, output, reports, started }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await prepareContext(context, 'dark');
  const page = await context.newPage();
  const report = { name: `${browserName}-radio-delayed-identity-fixture`, errors: [], result: 'running' };
  reports.push(report);
  page.on('pageerror', error => report.errors.push(error.message));
  let releaseIdentity;
  const gate = new Promise(resolve => { releaseIdentity = resolve; });
  await page.route('https://api.plyr.fm/tracks/*', async route => {
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.route('**/v1/tracks/*/plays?*', async route => {
    const url = new URL(route.request().url());
    const canonical = decodeURIComponent(url.pathname.split('/')[3]);
    report.submittedOccurrence = url.searchParams.get('occurrence');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      object: 'play_receipt', occurrence: report.submittedOccurrence, track_id: canonical,
      record: { uri: Buffer.from(canonical.slice(4), 'base64url').toString() },
      play_count: 1, counted: true,
      dedup: { status: 'claimed', window_seconds: 30 },
      sources: { metrics: 'application_metrics', dedup: 'postgres_durable' },
    }) });
  });
  try {
    await page.goto(`${origin}/radio?station=${process.env.PLAYBACK_STATION || 'loved'}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Listen live', exact: true }).waitFor();
    const lookup = page.waitForRequest(request => new URL(request.url()).host === 'api.plyr.fm' && /^\/tracks\/\d+$/.test(new URL(request.url()).pathname), { timeout: 65_000 });
    const tapped = performance.now();
    await page.getByRole('button', { name: 'Listen live', exact: true }).click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15));
    report.tapToMediaMs = Math.round(performance.now() - tapped);
    await lookup;
    report.tapToIdentityLookupMs = Math.round(performance.now() - tapped);
    assert.ok(report.tapToIdentityLookupMs >= 28_000, 'Canonical identity lookup stays off the tune-in path');
    report.pending = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('plyr-next-play-outbox', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const pending = db.transaction('plays', 'readonly').objectStore('plays').getAll();
        pending.onsuccess = () => { resolve(pending.result); db.close(); };
        pending.onerror = () => reject(pending.error);
      };
    }));
    assert.equal(report.pending.length, 1);
    assert.match(report.pending[0].trackId, /^radio:/);
    await page.getByRole('button', { name: 'Stop listening', exact: true }).first().click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.every(audio => audio.paused));
    const receipt = page.waitForResponse(response => response.request().method() === 'POST' && /\/plays\?/.test(response.url()) && response.ok());
    releaseIdentity();
    await receipt;
    assert.equal(report.submittedOccurrence, report.pending[0].occurrenceId);
    await page.waitForFunction(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('plyr-next-play-outbox', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const pending = db.transaction('plays', 'readonly').objectStore('plays').getAll();
        pending.onsuccess = () => { resolve(pending.result.length === 0); db.close(); };
        pending.onerror = () => reject(pending.error);
      };
    }));
    report.pendingCleared = true;
    assert.deepEqual(report.errors, []);
    report.screenshot = `${browserName}-radio-delayed-identity.png`;
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, report.screenshot) });
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, `${browserName}-radio-identity-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    releaseIdentity();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
    console.log(JSON.stringify(report));
    await context.close();
  }
};
