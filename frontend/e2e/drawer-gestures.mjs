import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.DRAWER_BASE_URL || 'https://stg.plyr.fm';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const cdp = await page.context().newCDPSession(page);

async function drag(locator, distance, { hold = 0, cancel = false, dismiss = false } = {}) {
	const box = await locator.boundingBox();
	assert(box);
	const x = box.x + Math.min(80, box.width / 2);
	const y = box.y + 5;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
	for (let step = 1; step <= 5; step++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove', touchPoints: [{ x, y: y + distance * step / 5 }]
		});
	}
	if (hold) await page.waitForTimeout(hold);
	const motion = dismiss ? locator.evaluate(element => {
		const sheet = element.closest('.sheet, .comments-panel');
		const frames = [];
		const start = globalThis.performance.now();
		return new Promise(resolve => {
			function sample() {
				if (sheet.isConnected && globalThis.getComputedStyle(sheet).visibility !== 'hidden') {
					frames.push(sheet.getBoundingClientRect().top);
				}
				if (globalThis.performance.now() - start < 650) globalThis.requestAnimationFrame(sample);
				else resolve(frames);
			}
			globalThis.requestAnimationFrame(sample);
		});
	}) : null;
	await cdp.send('Input.dispatchTouchEvent', {
		type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []
	});
	await page.waitForTimeout(450);
	if (motion) {
		const frames = await motion;
		assert(frames.length > 1, 'sampled dismissal frames');
		for (let i = 1; i < frames.length; i++) {
			assert(frames[i] >= frames[i - 1] - 1, `drawer reversed: ${frames[i - 1]} -> ${frames[i]}`);
		}
	}
}

async function openComments(trackId) {
	const commentsLoaded = page.waitForResponse(response =>
		response.url().endsWith(`/tracks/${trackId}/comments`) && response.status() === 200
	);
	await page.goto(`${baseURL}/track/${trackId}`, { waitUntil: 'domcontentloaded' });
	await commentsLoaded;
	await page.waitForTimeout(250);
	await page.locator('.comments-trigger').click();
	await page.locator('.comment-text').first().waitFor();
	await page.waitForTimeout(250);
}

try {
	if (baseURL.startsWith('http://127.0.0.1')) {
		await page.route('https://api-stg.plyr.fm/**', async route => {
			if (route.request().method() !== 'GET') return route.abort();
			const response = await route.fetch();
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					'access-control-allow-origin': baseURL,
					'access-control-allow-credentials': 'true'
				}
			});
		});
	}
	await openComments(2391);
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 844 });
		const layout = await page.locator('.comments-panel').evaluate(panel => {
			const close = panel.querySelector('.comments-panel-close').getBoundingClientRect();
			const title = panel.querySelector('.comments-title').getBoundingClientRect();
			const content = panel.querySelector('.comment-form, .login-prompt').getBoundingClientRect();
			return {
				alignment: Math.abs(close.y + close.height / 2 - title.y - title.height / 2),
				clearance: content.top - close.bottom,
				size: Math.min(close.width, close.height)
			};
		});
		assert(layout.alignment < 1, `close button must align with title at ${width}px`);
		assert(layout.clearance >= 0, `close button overlaps composer at ${width}px`);
		assert(layout.size >= 44, 'close button retains its touch target');
	}

	await drag(page.locator('.login-prompt'), 20, { hold: 200 });
	assert.equal(await page.locator('.comments-panel').count(), 1);
	await drag(page.locator('.login-prompt'), 90, { cancel: true });
	assert.equal(await page.locator('.comments-panel').count(), 1);
	await drag(page.locator('.comment-text'), 300, { dismiss: true });
	await page.locator('.comments-panel').waitFor({ state: 'detached' });

	await page.locator('.likes').click();
	const sheet = page.getByRole('dialog', { name: 'liked by' });
	await sheet.locator('.liker-row').first().waitFor();
	await page.waitForTimeout(250);
	await drag(sheet.locator('.liker-row').first(), 300, { dismiss: true });
	assert.equal(await page.locator('.sheet-backdrop.open').count(), 0);
	assert.equal(new URL(page.url()).pathname, '/track/2391');

	await page.locator('.likes').click();
	await page.waitForTimeout(250);
	await sheet.getByRole('button', { name: 'close', exact: true }).tap();
	assert.equal(await page.locator('.sheet-backdrop.open').count(), 0);

	await openComments(11);
	const scroller = page.locator('.comments-container');
	assert(await scroller.evaluate(el => el.scrollHeight > el.clientHeight));
	await drag(scroller, -100);
	assert(await scroller.evaluate(el => el.scrollTop > 0));
	await drag(scroller, 60);
	assert.equal(await page.locator('.comments-panel').count(), 1);
	await scroller.evaluate(el => { el.scrollTop = 0; });
	await drag(page.locator('.comments-title'), 100, { dismiss: true });
	await page.locator('.comments-panel').waitFor({ state: 'detached' });
	console.log('Passed: content and header dismissal, native scrolling, snap-back, cancellation, link suppression, close button.');
} finally {
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await browser.close();
}
