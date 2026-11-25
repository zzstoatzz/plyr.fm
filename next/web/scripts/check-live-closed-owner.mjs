// Uploads an "only you" track to live Next as the dedicated test account and proves its owner can
// play it: the track page's Play reaches Pause, and the player never says the account cannot
// access it. This walks the whole owner path against a real space PDS (delegation token,
// authorizeSpaceSync, signed getRecord, getBlob), so a PDS that changes how it names spaces fails
// here instead of on an owner's own track. The track is deleted afterwards, whatever happened.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: origin } = process.env;
const title = `live closed owner check ${new Date().toISOString()}`;
// eight seconds of quiet 8 kHz mono WAV, which every Chromium build decodes
const audio = Buffer.alloc(44 + 8000 * 2 * 8);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

const account = await browserAccount(handle, password, origin);
const browser = await chromium.launch();
const errors = [];
let page, consented = false, uploaded = false, deleted = false, stage = 'signing in to the test account';

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('https://jams.next.plyr.fm/v1/playback/join', route => route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('dialog', dialog => dialog.accept());

  await page.goto(app + '/upload');
  await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
  await account.signIn(page, label => { stage = label; });
  consented = true;
  await page.waitForURL(app + '/upload');

  stage = 'uploading an only-you track';
  const editor = page.locator('form:visible');
  await editor.getByLabel('audio file', { exact: true }).setInputFiles({ name: 'closed owner check.wav', mimeType: 'audio/wav', buffer: audio });
  await editor.getByRole('textbox', { name: 'title', exact: true }).fill(title);
  await editor.getByRole('radiogroup', { name: 'who can listen' }).getByRole('radio').nth(1).check();
  await editor.getByText('no ways in means only you can play it', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'upload', exact: true }).click();
  await page.waitForURL('**/portal', { timeout: 90_000 });
  uploaded = true;
  const row = page.getByRole('list', { name: 'Your tracks' }).getByRole('listitem').filter({ hasText: title });
  await row.getByText('only you', { exact: true }).first().waitFor({ timeout: 30_000 });

  stage = 'playing it as its owner';
  await row.getByRole('link', { name: title }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.locator('article').getByRole('button', { name: 'Play', exact: true }).click();
  const refused = page.getByText(/cannot access this track|would not ask for this track/);
  const pause = page.getByRole('button', { name: 'Pause', exact: true }).first();
  await Promise.race([pause.waitFor({ timeout: 30_000 }), refused.first().waitFor({ timeout: 30_000 })]);
  if (await refused.count()) throw new Error(`the owner was refused: "${(await refused.first().innerText()).trim()}"`);
  await page.waitForFunction(() => window.jamAudio?.some(media => !media.paused && media.currentTime > 1), null, { timeout: 20_000 });
  await pause.click();

  stage = 'deleting the track';
  await page.getByRole('button', { name: 'delete track', exact: true }).click();
  await page.getByRole('button', { name: 'delete track', exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'detached' });
  deleted = true;
  console.log(`the owner played their only-you track "${title}" on the first try`);
} catch (error) {
  errors.push(new Error(`live closed owner check failed at ${stage}: ${error.message.split('\n')[0]}`));
  if (page) await mkdir('/tmp/plyr-live-playback', { recursive: true }).then(() => page.screenshot({ path: '/tmp/plyr-live-playback/closed-owner-failure.png' })).catch(() => {});
}
finally {
  try {
    if (uploaded && !deleted) {
      await page.goto(app + '/portal');
      const row = page.getByRole('list', { name: 'Your tracks' }).getByRole('listitem').filter({ hasText: title });
      await row.getByRole('link', { name: title }).click();
      await page.getByRole('button', { name: 'delete track', exact: true }).click();
      await page.getByRole('button', { name: 'delete track', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'detached' });
    }
  } catch (error) { errors.push(new Error(`deleting the test track failed (${error.message.split('\n')[0]})`)); }
  try { if (consented) { await page.setViewportSize({ width: 1280, height: 900 }); await account.signOut(page, '/settings'); } }
  catch (error) {
    errors.push(new Error(`browser sign-out failed: ${error.message.split('\n')[0]} (at ${page.url()})`));
    await mkdir('/tmp/plyr-live-playback', { recursive: true }).then(() => page.screenshot({ path: '/tmp/plyr-live-playback/closed-owner-sign-out.png' })).catch(() => {});
  }
  try { await browser.close(); }
  catch (error) { errors.push(new Error(`browser cleanup failed (${error.name})`)); }
}
if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
