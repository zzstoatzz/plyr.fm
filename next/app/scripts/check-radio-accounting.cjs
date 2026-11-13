const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

module.exports = async function runRadioAccounting({ browser, browserName, prepareContext, origin, track, output, reports, started }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await prepareContext(context, 'dark');
  const page = await context.newPage();
  const report = { name: `${browserName}-radio-canonical-identity`, errors: [], identityLookups: 0, result: 'running' };
  reports.push(report);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.host === 'api.plyr.fm' && /^\/tracks\/\d+$/.test(url.pathname)) report.identityLookups++; });
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
    const station = page.getByRole('button', { name: `Listen to ${(process.env.PLAYBACK_STATION || 'loved').replace('-', ' ')} radio`, exact: true });
    await station.waitFor();
    const receipt = page.waitForResponse(response => response.request().method() === 'POST' && /\/plays\?/.test(response.url()) && response.ok(), { timeout: 65_000 });
    const tapped = performance.now();
    await station.click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15));
    report.tapToMediaMs = Math.round(performance.now() - tapped);
    const sent = await receipt;
    report.canonicalTrack = decodeURIComponent(new URL(sent.url()).pathname.split('/')[3]);
    assert.match(report.canonicalTrack, /^trk_/, 'a radio play is counted against the catalog track the station named');
    assert.equal(report.identityLookups, 0, 'the station state carries the record, so no identity lookup runs');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: 'Stop radio', exact: true }).click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.every(audio => audio.paused));
    assert.deepEqual(report.errors, []);
    report.screenshot = `${browserName}-radio-identity.png`;
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, report.screenshot) });
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, `${browserName}-radio-identity-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
    console.log(JSON.stringify(report));
    await context.close();
  }
};
