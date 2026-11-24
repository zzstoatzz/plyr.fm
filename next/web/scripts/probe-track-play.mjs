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
for (const [width, height] of [[390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 720, isMobile: width < 720, serviceWorkers: 'block' });
  await context.addInitScript(recordMedia);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('console', m => { if (/queue|playback|audio|error/i.test(m.text())) console.log('  console', m.type(), m.text().slice(0, 200)); });
  await page.goto(app + '/upload', { waitUntil: 'domcontentloaded' });
  await (await browserAccount(handle, password, pdsUrl)).signIn(page, () => {});
  await page.waitForURL(url => url.origin === app);
  const hero = () => page.locator('main article').getByRole('button', { name: /^(Play|Pause)$/ }).first();
  const L = `${width}`;
  const dockText = async () => (await page.getByTestId('player-dock').innerText().catch(() => '?')).replace(/\n/g, ' | ');
  await page.goto(TRACK); await hero().waitFor();
  await hero().click(); await heard(page, `${L} first press`);
  await page.waitForTimeout(3000);
  await page.reload(); await hero().waitFor(); await page.waitForTimeout(2500);
  console.log(`  reload while playing: hero=${await hero().getAttribute('aria-label')} dock=${await dockText()}`);
  await hero().click(); await page.waitForTimeout(300);
  console.log(`  after press: hero=${await hero().getAttribute('aria-label')} dock=${await dockText()}`);
  await heard(page, `${L} press after reload while playing`);
  await page.waitForTimeout(2000);
  await page.goto(app + '/'); await page.waitForTimeout(2500);
  console.log(`  home while playing: dock=${await dockText()}`);
  await page.goto(TRACK); await hero().waitFor(); await page.waitForTimeout(2500);
  console.log(`  open link while playing: hero=${await hero().getAttribute('aria-label')} dock=${await dockText()}`);
  await hero().click(); await page.waitForTimeout(300);
  console.log(`  after press: hero=${await hero().getAttribute('aria-label')} dock=${await dockText()}`);
  await heard(page, `${L} press after opening link while playing`);
  const page2 = await context.newPage();
  await page2.goto(TRACK); const hero2 = page2.locator('main article').getByRole('button', { name: /^(Play|Pause)$/ }).first(); await hero2.waitFor(); await page2.waitForTimeout(2500);
  console.log(`  second tab: hero=${await hero2.getAttribute('aria-label')} dock=${(await page2.getByTestId('player-dock').innerText().catch(() => '?')).replace(/\n/g, ' | ')}`);
  await hero2.click(); await page2.waitForTimeout(300);
  console.log(`  second tab after press: hero=${await hero2.getAttribute('aria-label')}`);
  await heard(page2, `${L} second tab press`);
  await context.close();
}
await browser.close();
