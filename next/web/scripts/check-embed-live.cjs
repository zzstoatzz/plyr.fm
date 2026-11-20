const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const protocol = 'fm.plyr.embed.experimental.v1';

(async () => {
  const origin = process.env.EMBED_SITE_ORIGIN || await serve();
  const fixture = JSON.parse(await fs.readFile(path.resolve(__dirname, '../static/experiments/embed-analysis.json'), 'utf8'));
  const audioBytes = await fs.readFile(path.resolve(__dirname, '../static' + fixture.content.path));
  const requests = new Map();
  const host = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/audio') {
      const scenario = url.searchParams.get('scenario');
      const counts = requests.get(scenario);
      if (req.headers.origin) counts.corsRequests++; else counts.plainRequests++;
      if (scenario !== 'no-cors') res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', 'audio/wav');
      if (scenario === 'slow' && req.headers.origin) setTimeout(() => res.end(audioBytes), 3500);
      else if (counts.delayFirst && url.searchParams.get('track') === tracks[0].id) setTimeout(() => res.end(audioBytes), 800);
      else res.end(audioBytes);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><iframe title="embed" allow="autoplay" style="width:600px;height:180px"></iframe>');
    }
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  const parent = `http://127.0.0.1:${host.address().port}`;
  const browser = await chromium.launch();
  const timings = [];
  try {
    for (const scenario of process.env.EMBED_BENCH ? ['plain', 'live', 'plain', 'live', 'plain', 'live'] : ['plain', 'live', 'no-cors', 'slow', 'mobile', 'no-capture']) {
      const { context, page, errors } = await setup(browser, 1280, 800, { phone: scenario === 'mobile' });
      await context.addInitScript(disable => {
        window.media = [];
        window.contexts = [];
        window.elementSources = 0;
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { if (!window.media.includes(this)) window.media.push(this); return play.call(this); };
        if (disable) Object.defineProperty(HTMLMediaElement.prototype, 'captureStream', { value: undefined });
        const Context = window.AudioContext;
        window.AudioContext = class extends Context {
          constructor(...args) { super(...args); window.contexts.push(this); }
          createMediaElementSource(...args) { window.elementSources++; return super.createMediaElementSource(...args); }
        };
      }, scenario === 'no-capture');
      const counts = { corsRequests: 0, plainRequests: 0 };
      requests.set(scenario, counts);
      await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getPlayback?**', route => route.fulfill({ json: {
        object: 'playback', track_id: tracks[0].id, record: tracks[0].record,
        availability: { status: 'available', delivery: { url: `${parent}/audio?scenario=${scenario}&track=${route.request().url().split('/').at(-2)}`, media_type: 'audio/wav' } }
      } }));
      await page.goto(parent);
      await page.evaluate(({ origin, protocol, id, optIn }) => {
        window.messages = [];
        const frame = document.querySelector('iframe');
        window.addEventListener('message', event => { if (event.source === frame.contentWindow && event.origin === origin && event.data.protocol === protocol) window.messages.push(event.data); });
        frame.src = origin + '/embed/track/' + id + (optIn ? '?analysis=live' : '');
      }, { origin, protocol, id: tracks[0].id, optIn: scenario !== 'plain' });
      const frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: 'Play', exact: true }).waitFor();
      const post = type => page.evaluate(({ origin, protocol, type }) => document.querySelector('iframe').contentWindow.postMessage({ protocol, type, subscription: 'live-test', hz: 10 }, origin), { origin, protocol, type });
      await post('subscribe');
      const start = performance.now();
      await frame.getByRole('button', { name: 'Play', exact: true }).click();
      await page.waitForFunction(() => window.messages.some(message => message.state === 'playing'));
      timings.push({ scenario, startupMs: Math.round(performance.now() - start) });
      const child = page.frames().find(frame => frame.url().includes('/embed/track/'));
      if (scenario === 'live') {
        await page.waitForFunction(() => window.messages.some(message => message.analysis?.rms > 0.005));
        assert.equal(await child.evaluate(() => window.elementSources), 0, 'native audio never enters a Web Audio output graph');
        await frame.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.waitForFunction(() => window.messages.at(-1).analysisStatus === 'paused');
        assert.equal(await page.evaluate(() => window.messages.at(-1).analysis), null);
        await frame.getByRole('button', { name: 'Play', exact: true }).click();
        await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.005);
        await child.evaluate(() => { window.media[0].currentTime = 5; window.media[0].playbackRate = 1.5; });
        await page.waitForFunction(() => window.messages.at(-1).position >= 5 && window.messages.at(-1).rate === 1.5 && window.messages.at(-1).analysis?.rms > 0.005);
        const before = await child.evaluate(() => window.media[0].currentTime);
        await child.evaluate(() => window.contexts[0].suspend());
        await page.waitForFunction(() => window.messages.at(-1).analysisStatus === 'gesture-required');
        await page.waitForTimeout(300);
        assert.ok(await child.evaluate(() => window.media[0].currentTime) > before + 0.2, 'suspended analysis preserves playback');
        await post('unsubscribe');
        await page.waitForTimeout(150);
        const unsubscribed = await child.evaluate(() => window.media[0].currentTime);
        await page.waitForTimeout(300);
        assert.ok(await child.evaluate(() => window.media[0].currentTime) > unsubscribed + 0.2, 'unsubscribe preserves playback');
        await post('subscribe');
        await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.005);
        let seed = 2744;
        for (let i = 0; i < 12; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          if (seed % 2) {
            await child.evaluate(value => { window.media[0].currentTime = value; }, (seed % 100) / 20);
          } else {
            await post('unsubscribe'); await page.waitForTimeout(110); await post('subscribe');
          }
          await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.001);
          assert.equal(await child.evaluate(() => window.media.length), 1, 'one playback owner throughout generated transitions');
        }
        assert.equal(await child.evaluate(() => window.contexts.length), 1, 'one reusable analysis context');
        assert.equal(counts.plainRequests, 0);
        await post('subscribe');
        await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.001);
        await child.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => window.messages.at(-1).analysisStatus === 'background');
        const hiddenTime = await child.evaluate(() => window.media[0].currentTime);
        await page.waitForTimeout(250);
        assert.ok(await child.evaluate(() => window.media[0].currentTime) > hiddenTime + 0.1);
        await child.evaluate(() => {
          delete document.visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.001);
        counts.delayFirst = true;
        await page.evaluate(origin => { window.messages = []; document.querySelector('iframe').src = origin + '/embed/album/fixture?analysis=live'; }, origin);
        await frame.getByRole('heading', { name: 'Fixture album' }).waitFor();
        await post('subscribe');
        await frame.getByRole('button', { name: 'Play ' + tracks[0].metadata.title, exact: true }).click();
        const secondTitle = tracks[1].metadata.title;
        await frame.getByRole('button', { name: 'Play ' + secondTitle, exact: true }).click();
        await page.waitForFunction(uri => window.messages.at(-1).track?.uri === uri && window.messages.at(-1).analysis?.rms > 0.001, tracks[1].record.uri);
        await page.waitForTimeout(900);
        assert.equal(await page.evaluate(() => window.messages.at(-1).track.uri), tracks[1].record.uri, 'cancelled load cannot replace the new track');
        counts.delayFirst = false;
        await page.route('https://api.plyr.fm/radio/state?*', route => route.fulfill({ json: {
          current: { id: 42, title: 'live capture radio fixture', artist: 'fixture', artist_handle: 'sketches.test', artist_did: tracks[0].artist.did,
            stream_url: `${parent}/audio?scenario=${scenario}`, duration: 16, artwork_url: null, thumbnail_url: null,
            atproto_record_uri: tracks[0].record.uri, atproto_record_cid: tracks[0].record.cid,
            created_at: '2026-11-16T00:00:00Z', like_count: 0, play_count: 0 },
          current_ends_at: new Date(Date.now() + 15000).toISOString(), progress_seconds: 0.5, up_next: []
        } }));
        await page.evaluate(origin => { window.messages = []; document.querySelector('iframe').src = origin + '/embed/radio?station=loved&analysis=live'; }, origin);
        await frame.getByRole('button', { name: 'Listen live' }).waitFor();
        await post('subscribe');
        await frame.getByRole('button', { name: 'Listen live' }).click();
        await page.waitForFunction(() => window.messages.at(-1).analysis?.rms > 0.001);
        await frame.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.waitForFunction(() => window.messages.at(-1).analysisStatus === 'paused');
      } else {
        const reason = scenario === 'plain' ? 'disabled' : ['no-cors', 'slow'].includes(scenario) ? 'cors-unavailable' : 'unsupported-browser';
        try { await page.waitForFunction(reason => window.messages.at(-1).analysisStatus === reason, reason); }
        catch (error) { console.error({scenario, counts, last: await page.evaluate(() => window.messages.slice(-2))}); throw error; }
        assert.equal(await page.evaluate(() => window.messages.at(-1).analysis), null);
        if (['no-cors', 'slow'].includes(scenario)) assert.ok(counts.corsRequests >= 1 && counts.plainRequests >= 1, 'CORS denial retries ordinary playback');
        else {
          assert.equal(counts.corsRequests, 0, 'plain and unsupported playback have no CORS change');
          assert.equal(await child.evaluate(() => window.contexts.length), 0, 'no analysis context outside supported opt-in');
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(JSON.stringify({ browser: browser.version(), seed: 2744, transitions: 12, timings }));
    console.log('real embed capture, opt-in, null reasons, CORS fallback, seek/rate, context suspension and subscriber teardown passed');
  } finally { await browser.close(); host.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
