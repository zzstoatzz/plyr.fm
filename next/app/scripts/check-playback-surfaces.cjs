const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

module.exports = async function runSurfaces({ browser, browserName, prepareContext, origin, track, output, reports, started }) {
  for (const surface of ['embed', 'radio']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await prepareContext(context, 'dark', surface === 'radio' ? { volume: 0.25 } : {});
    const page = await context.newPage();
    page.setDefaultTimeout(40_000);
    const report = { name: `${browserName}-${surface}-real-receipt`, requests: [], playbackLogs: [], errors: [], result: 'running' };
    reports.push(report);
    await context.route('https://api.plyr.fm/**', route => route.request().method() === 'POST' ? route.abort('blockedbyclient') : route.continue());
    const receipts = [];
    context.on('request', request => {
      const url = new URL(request.url());
      report.requests.push({ method: request.method(), host: url.host, path: url.pathname });
      if (request.method() === 'POST' && url.host === 'api.plyr.fm') report.errors.push('Unexpected production POST');
    });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => {
      if (/^\[(plays|playback)\]/.test(message.text())) report.playbackLogs.push(message.text());
    });
    context.on('response', response => {
      if (response.request().method() === 'POST' && /\/v1\/tracks\/[^/]+\/plays/.test(response.url())) {
        receipts.push({ response, at: performance.now() });
      }
    });
    let tapped;
    try {
      let target = page;
      if (surface === 'embed') {
        await page.route('https://embed-harness.invalid/**', route => route.fulfill({ contentType: 'text/html', body:
          `<html><body style="margin:20px;background:#202329"><iframe title="Track embed" src="${origin}/embed/track/${track}" allow="autoplay" style="width:350px;height:350px;border:0"></iframe></body></html>` }));
        await page.goto('https://embed-harness.invalid/', { waitUntil: 'domcontentloaded' });
        const frame = page.frameLocator('iframe');
        await frame.getByRole('button', { name: 'Play', exact: true }).waitFor();
        target = page.frames().find(frame => frame.url().startsWith(origin + '/embed/track/'));
        assert.ok(target, 'The embed must load in a separate origin iframe');
        tapped = performance.now();
        await frame.getByRole('button', { name: 'Play', exact: true }).click();
      } else {
        await page.goto(`${origin}/radio?station=${process.env.PLAYBACK_STATION || 'loved'}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'listen live', exact: true }).waitFor();
        await page.waitForTimeout(400);
        report.preTuneAudioReads = report.requests.filter(request => /\/api\/songs\/[^/]+\/audio$/.test(request.path)).length;
        assert.equal(report.preTuneAudioReads, 0, 'The Radio page cannot preload audio before tuning');
        tapped = performance.now();
        await page.getByRole('button', { name: 'listen live', exact: true }).click();
      }
      await target.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15));
      report.tapToMediaProgressMs = Math.round(performance.now() - tapped);
      await page.waitForTimeout(400);
      report.screenshot = `${browserName}-${surface}-real-receipt.png`;
      await page.screenshot({ path: path.join(output, report.screenshot) });
      const deadline = performance.now() + 65_000;
      while (!receipts.length && performance.now() < deadline) await page.waitForTimeout(100);
      assert.ok(receipts.length, 'Natural playback must produce a real Next receipt');
      assert.equal(receipts[0].response.status(), 200);
      report.receipt = await receipts[0].response.json();
      report.tapToReceiptMs = Math.round(receipts[0].at - tapped);
      report.media = await target.evaluate(() => window.__plyrPlaybackMedia.map(audio => ({ playing: !audio.paused, time: audio.currentTime, duration: audio.duration, volume: audio.volume })));
      const active = report.media.find(audio => audio.playing);
      assert.ok(active, 'The receipt must arrive while real audio is playing');
      const threshold = Math.min(30, active.duration / 2);
      assert.ok(report.tapToReceiptMs >= threshold * 1000 - 500, 'Station position or loading cannot qualify listening early');
      assert.equal(report.receipt.object, 'play_receipt');
      assert.equal(report.receipt.counted, true);
      assert.equal(report.receipt.sources.metrics, 'application_metrics');
      if (surface === 'radio') {
        assert.equal(active.volume, 0.25, 'Radio source replacement preserves the selected volume');
        report.stateReadCount = report.requests.filter(request => request.path === '/api/radio/state').length;
        report.audioSourceReads = report.requests.filter(request => /\/api\/songs\/[^/]+\/audio$/.test(request.path)).length;
        assert.ok(report.stateReadCount <= Math.ceil(report.tapToReceiptMs / 5000) + 2, 'Page and player must share one polling cadence');
        assert.equal(report.audioSourceReads, 1, 'Only the actual Radio output loads the source');
      }
      if (surface === 'embed') {
        const firstListener = new URL(receipts[0].response.url()).searchParams.get('listener');
        await page.reload({ waitUntil: 'domcontentloaded' });
        const frame = page.frameLocator('iframe');
        await frame.getByRole('button', { name: 'Play', exact: true }).click();
        const replayDeadline = performance.now() + 20_000;
        while (receipts.length < 2 && performance.now() < replayDeadline) await page.waitForTimeout(100);
        assert.ok(receipts.length >= 2, 'Reloaded third-party iframe must deliver its next real occurrence');
        assert.equal(receipts[1].response.status(), 200);
        const secondListener = new URL(receipts[1].response.url()).searchParams.get('listener');
        report.sameListenerAcrossIframeReload = firstListener !== null && firstListener === secondListener;
        report.replayReceipt = await receipts[1].response.json();
        report.receiptIntervalMs = Math.round(receipts[1].at - receipts[0].at);
        assert.ok(report.sameListenerAcrossIframeReload, 'Anonymous listener continuity must survive iframe reload');
        assert.notEqual(report.replayReceipt.occurrence, report.receipt.occurrence);
        assert.ok(report.receiptIntervalMs < report.receipt.dedup.window_seconds * 1000, 'Replay must arrive inside the cooldown to exercise suppression');
        assert.equal(report.replayReceipt.counted, false);
        assert.equal(report.replayReceipt.dedup.status, 'suppressed');
      }
      assert.deepEqual(report.errors, []);
      report.result = 'passed';
    } catch (error) {
      report.result = 'failed';
      report.error = error.stack;
      await page.screenshot({ path: path.join(output, `${browserName}-${surface}-receipt-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
      console.log(JSON.stringify({ name: report.name, result: report.result, tapToMediaProgressMs: report.tapToMediaProgressMs, tapToReceiptMs: report.tapToReceiptMs }));
      await context.close();
    }
  }
};
