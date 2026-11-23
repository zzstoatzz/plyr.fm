// Live: a press actually makes sound on next.plyr.fm — signed out and signed in (account queue), on a phone and a desktop.
// Each step taps the way a person does and passes only when an <audio> element is playing and its clock moves.
// It covers a row press, the dock's next, and the dock's play after a reload (the restored queue).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-live-playback';
await mkdir(output, { recursive: true });
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
const signedIn = !!(handle && password && pdsUrl);
if (!signedIn) console.log('no dedicated account in this environment: running the signed-out checks only');

function recordMedia() {
	window.__media = [];
	window.__mediaLog = [];
	const t0 = performance.now();
	const log = (element, event) => {
		const index = window.__media.indexOf(element);
		window.__mediaLog.push(`${Math.round(performance.now() - t0)} #${index} ${event} t=${element.currentTime.toFixed(1)} rs=${element.readyState} paused=${element.paused} err=${element.error?.code ?? '-'} src=${(element.currentSrc || element.getAttribute('src') || '').slice(0, 90)}`);
		if (window.__mediaLog.length > 300) window.__mediaLog.shift();
	};
	const track = element => {
		if (window.__media.includes(element)) return;
		window.__media.push(element);
		for (const event of ['loadstart', 'loadedmetadata', 'play', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error', 'emptied', 'abort']) element.addEventListener(event, () => log(element, event));
	};
	const play = HTMLMediaElement.prototype.play;
	HTMLMediaElement.prototype.play = function () {
		track(this);
		log(this, 'play()');
		const result = play.call(this);
		result?.catch?.(error => log(this, 'play() rejected ' + error?.name));
		return result;
	};
	const load = HTMLMediaElement.prototype.load;
	HTMLMediaElement.prototype.load = function () { track(this); return load.call(this); };
}

/** Waits until one element is playing with its clock at least `advance` seconds past where it was when the wait began. */
async function heard(page, step, { advance = 1.5, timeout = 25_000, differentFrom } = {}) {
	const start = await page.evaluate(() => window.__media.map(element => element.currentTime));
	try {
		return await page.waitForFunction(({ start, advance, differentFrom }) => {
			const element = window.__media.find((element, index) => !element.paused && !element.ended && element.readyState >= 2
				&& element.currentTime - (start[index] ?? 0) >= advance
				&& (!differentFrom || element.currentSrc !== differentFrom));
			return element ? element.currentSrc : false;
		}, { start, advance, differentFrom }, { timeout, polling: 250 }).then(handle => handle.jsonValue());
	} catch (error) {
		await page.screenshot({ path: path.join(output, `${step.replace(/\W+/g, '-')}.png`) }).catch(() => {});
		const log = await page.evaluate(() => window.__mediaLog.slice(-40).join('\n')).catch(() => '(no media log)');
		const dock = await page.locator('[aria-label="Pause"], [aria-label="Play"]').first().getAttribute('aria-label').catch(() => '?');
		const alerts = await page.locator('[role=status], [role=alert]').allInnerTexts().catch(() => []);
		throw new Error(`${step}: no audio was heard within ${timeout / 1000}s (dock button: ${dock}; status: ${alerts.filter(Boolean).join(' | ').slice(0, 300) || 'none'})\nmedia log:\n${log || '(no media element was ever played)'}`, { cause: error });
	}
}

async function dockPlay(page) {
	const dock = page.locator('.dock, [class*=dock]').getByRole('button', { name: 'Play', exact: true });
	return (await dock.count() ? dock : page.getByRole('button', { name: 'Play', exact: true })).first();
}

async function run(browser, { width, height, signIn }) {
	const label = `${width}px ${signIn ? 'signed in' : 'signed out'}`;
	const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 720, isMobile: width < 720, serviceWorkers: 'block' });
	await context.addInitScript(recordMedia);
	const page = await context.newPage();
	page.setDefaultTimeout(20_000);
	const consoleLines = [];
	page.on('console', message => { if (/plays|queue|playback|audio/i.test(message.text())) consoleLines.push(`${message.type()} ${message.text()}`.slice(0, 240)); });
	page.on('pageerror', error => consoleLines.push('pageerror ' + error.message));
	let account;
	try {
		await page.goto(app + '/');
		if (signIn) {
			account = await browserAccount(handle, password, pdsUrl);
			await account.signIn(page, () => {});
			await page.waitForURL(url => url.origin === app);
		}
		const row = page.locator('main').getByRole('button', { name: /^Play / }).first();
		await row.waitFor();
		const name = (await row.getAttribute('aria-label'))?.replace(/^Play /, '');
		await row.click();
		const first = await heard(page, `${label} row press`);
		console.log(`${label}: pressing "${name}" plays ${first}`);

		const next = page.getByRole('button', { name: 'Next track', exact: true }).first();
		if (await next.isVisible()) {
			await next.click();
			const second = await heard(page, `${label} next track`, { differentFrom: first, advance: 1 });
			console.log(`${label}: next track plays ${second}`);
		}

		await page.reload();
		const play = await dockPlay(page);
		await play.waitFor();
		await play.click();
		const restored = await heard(page, `${label} dock play after reload`);
		console.log(`${label}: the restored queue plays from the dock (${restored})`);
		await page.screenshot({ path: path.join(output, `${width}-${signIn ? 'in' : 'out'}.png`) });
	} catch (error) {
		if (consoleLines.length) error.message += '\nconsole:\n' + consoleLines.slice(-30).join('\n');
		throw error;
	} finally {
		if (account) await account.signOut(page, '/').catch(error => console.log('sign-out after the check failed: ' + error.message));
		await context.close();
	}
}

const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
const failures = [];
try {
	for (const options of [{ width: 390, height: 844, signIn: false }, { width: 1280, height: 860, signIn: false },
		...(signedIn ? [{ width: 390, height: 844, signIn: true }, { width: 1280, height: 860, signIn: true }] : [])]) {
		try { await run(browser, options); }
		catch (error) { failures.push(error); console.error(String(error.message)); }
	}
} finally {
	await browser.close();
}
assert.equal(failures.length, 0, `${failures.length} playback check(s) failed`);
console.log('live playback: every press made sound');
