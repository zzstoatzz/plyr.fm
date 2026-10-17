import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.DRAWER_BASE_URL || 'https://stg.plyr.fm';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const cdp = await page.context().newCDPSession(page);

async function drag(locator, distance, { hold = 0, cancel = false } = {}) {
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
	await cdp.send('Input.dispatchTouchEvent', {
		type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: []
	});
	await page.waitForTimeout(450);
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
	await drag(page.locator('.login-prompt'), 20, { hold: 200 });
	assert.equal(await page.locator('.comments-panel').count(), 1);
	await drag(page.locator('.login-prompt'), 90, { cancel: true });
	assert.equal(await page.locator('.comments-panel').count(), 1);
	await drag(page.locator('.comment-text'), 48);
	await page.locator('.comments-panel').waitFor({ state: 'detached' });

	await page.locator('.likes').click();
	const sheet = page.getByRole('dialog', { name: 'liked by' });
	await sheet.locator('.liker-row').first().waitFor();
	await page.waitForTimeout(250);
	await drag(sheet.locator('.liker-row').first(), 48);
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
	await drag(page.locator('.comments-title'), 100);
	await page.locator('.comments-panel').waitFor({ state: 'detached' });
	console.log('Passed: content and header dismissal, native scrolling, snap-back, cancellation, link suppression, close button.');
} finally {
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await browser.close();
}
