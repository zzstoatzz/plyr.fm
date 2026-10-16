import { chromium } from 'playwright';
import { API, APP, ARTIFACTS, fail, observe, signIn, step } from './lib.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const dump = observe(page, 'equalizer');

try {
	await signIn(page);
	await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('checkbox', { name: 'equalizer', exact: true }).check();
	await page.goto(`${APP}/track/1249`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'play', exact: true }).click();
	await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 1);
	await page.getByRole('button', { name: 'equalizer', exact: true }).click();
	await page.getByRole('switch', { name: 'equalizer', exact: true }).check();
	await page.waitForFunction(() => {
		const audio = document.querySelector('audio');
		return audio?.crossOrigin === 'anonymous' && !audio.paused && audio.currentTime > 2 && !audio.error;
	});
	await page.screenshot({ path: `${ARTIFACTS}/equalizer-public.png` });
	step('equalizer-public', 'playback continues after enabling EQ mid-track');

	await page.goto(`${APP}/track/1303`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'play', exact: true }).click();
	await page.waitForFunction(() => {
		const audio = document.querySelector('audio');
		return audio?.crossOrigin === 'use-credentials' && audio.currentSrc.includes('cors=1') && !audio.paused && audio.currentTime > 1 && !audio.error;
	});
	const response = await context.request.get(`${API}/audio/cbbbaab3974f49a1?cors=1`, {
		headers: { Range: 'bytes=0-99' },
		maxRedirects: 0
	});
	if (response.status() !== 206 || (await response.body()).length !== 100) {
		fail(`authenticated range proxy returned ${response.status()}`);
	}
	step('equalizer-gated', 'credentialed playback and exact 100-byte range succeed');
	await page.getByRole('button', { name: 'equalizer', exact: true }).click();
	await page.getByRole('switch', { name: 'equalizer', exact: true }).uncheck();
	await page.screenshot({ path: `${ARTIFACTS}/equalizer-gated.png` });
	await page.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('checkbox', { name: 'equalizer', exact: true }).uncheck();
	console.log('PASS — public and gated equalizer playback');
} catch (error) {
	console.error(String(error).slice(0, 400));
	process.exitCode = 1;
	await dump();
} finally {
	await browser.close();
}
