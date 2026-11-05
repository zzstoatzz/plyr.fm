const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function wave(seconds) {
  const sampleRate = 44_100;
  const frames = Math.round(sampleRate * seconds);
  const wave = Buffer.alloc(44 + frames * 2);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) wave.writeInt16LE(Math.round(Math.sin(frame / sampleRate * Math.PI * 880) * 4000), 44 + frame * 2);
  return wave;
}

module.exports = async function runShortPlayback({ browser, browserName, prepareContext, origin, track, output, reports, started }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await prepareContext(context, 'dark', { volume: 0.25 });
  const page = await context.newPage();
  const report = { name: `${browserName}-short-wave-fixture`, durationSeconds: 0.4, occurrences: [], result: 'running' };
  reports.push(report);
  let baseline = 0;
  await page.route(`**/v1/tracks/${track}/playback`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.availability = { status: 'available', delivery: { url: 'https://audio.fixture.invalid/short.wav', media_type: 'audio/wav' } };
    await route.fulfill({ response, json: body });
  });
  await page.route('https://audio.fixture.invalid/short.wav', route => route.fulfill({
    contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: wave(report.durationSeconds),
  }));
  await page.route('**/v1/tracks/*/plays?*', async route => {
    report.occurrences.push({ id: new URL(route.request().url()).searchParams.get('occurrence'), at: Math.round(performance.now() - started) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      object: 'play_receipt', occurrence: report.occurrences.at(-1).id, track_id: track,
      record: { uri: Buffer.from(track.slice(4), 'base64url').toString() }, play_count: baseline + 1, counted: true,
      dedup: { status: 'claimed', window_seconds: 30 }, sources: { metrics: 'application_metrics', dedup: 'postgres_durable' },
    }) });
  });
  try {
    await page.goto(`${origin}/track/${track}`, { waitUntil: 'domcontentloaded' });
    baseline = Number.parseInt(await page.getByText(/^\d+ plays?$/).innerText(), 10);
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => audio.ended), undefined, { timeout: 15_000 });
    await page.waitForTimeout(700);
    report.media = await page.evaluate(() => window.__plyrPlaybackMedia.map(audio => ({ duration: audio.duration, time: audio.currentTime, ended: audio.ended, volume: audio.volume })));
    report.events = await page.evaluate(() => window.__plyrPlaybackEvents);
    assert.ok(report.media.some(audio => audio.ended && Math.abs(audio.duration - report.durationSeconds) < 0.01), 'A real short WAV reaches its end');
    assert.ok(report.media.some(audio => audio.ended && audio.volume === 0.25), 'Source replacement preserves the selected volume');
    assert.equal(report.occurrences.length, 1, 'A 0.4second real listen qualifies once after half its duration');
    await page.getByText(new RegExp(`^${baseline + 1} plays?$`), { exact: true }).waitFor({ timeout: 4000 });
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).last().isEnabled(), true, 'A finished short track leaves the player ready to replay');
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
    console.log(JSON.stringify(report));
    await context.close();
  }
};
