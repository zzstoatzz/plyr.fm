// throwaway probe: signed-in track-page play, play to end, press again, reload, press again
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
const TRACK = app + '/track/trk_YXQ6Ly9kaWQ6cGxjOmEzdnEzaGpsa3oybmJmNjdicHY1ejZxcy9mbS5wbHlyLnRyYWNrLzNuMnpxdDdxM3Y1MjI';
function recordMedia() {
  window.__media = []; window.__log = []; const t0 = performance.now();
  const log = (el, ev) => window.__log.push(`${Math.round(performance.now()-t0)} ${ev} t=${el.currentTime.toFixed(1)} rs=${el.readyState} paused=${el.paused} src=${(el.currentSrc||el.getAttribute('src')||'').slice(-40)}`);
  const track = el => { if (window.__media.includes(el)) return; window.__media.push(el); for (const ev of ['loadstart','loadedmetadata','playing','pause','ended','error','emptied']) el.addEventListener(ev, () => log(el, ev)); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { track(this); log(this, 'play()'); const r = play.call(this); r?.catch?.(e => log(this, 'rejected ' + e?.name)); return r; };
}
const state = page => page.evaluate(() => ({ media: window.__media.map(e => ({ t: +e.currentTime.toFixed(1), paused: e.paused, ended: e.ended })), log: window.__log.slice(-12) }));
async function heard(page, step) {
  const start = await page.evaluate(() => window.__media.map(e => e.currentTime));
  try {
    await page.waitForFunction(start => window.__media.some((e, i) => !e.paused && e.currentTime - (start[i] ?? 0) >= 1.5), start, { timeout: 15000, polling: 250 });
    console.log(`OK   ${step}`);
  } catch {
    const s = await state(page);
    const dock = await page.getByTestId('player-dock').innerText().catch(() => '?');
    console.log(`FAIL ${step}\n  dock: ${dock.replace(/\n/g, ' | ')}\n  ${JSON.stringify(s.media)}\n  ${s.log.join('\n  ')}`);
    await page.screenshot({ path: `/tmp/probe/${step.replace(/\W+/g, '-')}.png` });
  }
}
const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
for (const [width, height] of [[390, 844], [1280, 860]]) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 720, isMobile: width < 720, serviceWorkers: 'block' });
  await context.addInitScript(recordMedia);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('console', m => { if (/queue|playback|audio|error/i.test(m.text())) console.log('  console', m.type(), m.text().slice(0, 200)); });
  await page.goto(app + '/upload', { waitUntil: 'domcontentloaded' });
  await (await browserAccount(handle, password, pdsUrl)).signIn(page, () => {});
  await page.waitForURL(url => url.origin === app);
  const hero = () => page.locator('main article').getByRole('button', { name: /^(Play|Pause)$/ }).first();
  const L = `${width}`;
  await page.goto(TRACK); await hero().waitFor();
  await hero().click(); await heard(page, `${L} first press`);
  const slider = page.getByRole('slider', { name: 'Playback position' }).first();
  await slider.focus(); await page.keyboard.press('End');
  await page.waitForTimeout(4000);
  console.log(`  after end: hero=${await hero().getAttribute('aria-label')} ${JSON.stringify((await state(page)).media)}`);
  await hero().click(); await heard(page, `${L} press after it ended`);
  await slider.focus(); await page.keyboard.press('End'); await page.waitForTimeout(4000);
  await page.reload(); await hero().waitFor(); await page.waitForTimeout(2000);
  console.log(`  after reload: hero=${await hero().getAttribute('aria-label')}`);
  await hero().click(); await heard(page, `${L} press after ended + reload`);
  await page.goto(app + '/'); await page.waitForTimeout(1500);
  await page.goto(TRACK); await hero().waitFor(); await page.waitForTimeout(1500);
  console.log(`  revisit: hero=${await hero().getAttribute('aria-label')}`);
  await hero().click(); await page.waitForTimeout(500);
  if ((await hero().getAttribute('aria-label')) === 'Play') await hero().click();
  await heard(page, `${L} press on revisit`);
  await context.close();
}
await browser.close();
