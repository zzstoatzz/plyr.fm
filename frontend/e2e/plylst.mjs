import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
	API,
	APP,
	ARTIFACTS,
	HANDLE,
	authorizeOnPds,
	me,
	waitForTrack,
	wavBuffer
} from './lib.mjs';

assert.equal(new URL(APP).hostname, 'stg.plyr.fm');
assert.equal(new URL(API).hostname, 'api-stg.plyr.fm');
const browser = await chromium.launch();
const owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await owner.newPage();
const title = `integration-test plylst ${Date.now()}`;
let albumId;
let trackId;
let originalTheme;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
	const ready = page.waitForResponse((response) => response.url() === `${API}/auth/pds-options`);
	await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
	await ready;
	await page.getByPlaceholder('you.example.com').fill(HANDLE);
	await page.locator('form button[type="submit"]').click({ timeout: 60000 });
	await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
	await authorizeOnPds(page);
	let user;
	for (let i = 0; i < 60; i++) {
		user = await me(page).catch(() => null);
		if (user?.did) break;
		await page.waitForTimeout(500);
	}
	assert.ok(user?.did, 'OAuth session established');
	assert.equal(await page.locator('.terms-overlay').count(), 0, 'fixture already accepted terms');
	originalTheme = (await (await owner.request.get(`${API}/preferences/`)).json()).theme;
	const publishing = {
		access: { listening: 'public', downloads: 'off', visibility: 'unlisted' },
		attach_rights: false
	};
	const created = await owner.request.post(`${API}/albums/`, {
		data: { title, publishing_defaults: publishing }
	});
	assert.equal(created.status(), 200);
	const album = await created.json();
	albumId = album.id;
	assert.equal(album.show_plylst, false);
	const uploaded = await owner.request.post(`${API}/tracks/`, {
		multipart: {
			title,
			album_id: albumId,
			tags: JSON.stringify(['integration-test']),
			auto_tag: 'false',
			accept_plyr_storage: 'true',
			file: {
				name: 'integration-test.wav',
				mimeType: 'audio/wav',
				buffer: wavBuffer({ durationSeconds: 1 })
			}
		}
	});
	assert.ok(uploaded.ok(), `upload accepted: ${uploaded.status()}`);
	trackId = await waitForTrack(page, title, 60);
	assert.ok(trackId, 'fixture upload completed');
	const path = `/u/${user.handle}/album/${album.slug}`;
	const name = 'open album in plylst (opens in a new tab)';
	await page.goto(`${APP}${path}`);
	assert.equal(await page.getByRole('link', { name }).count(), 0);
	await page.getByRole('button', { name: 'edit album', exact: true }).click();
	const saved = page.waitForResponse(
		(response) =>
			response.url().includes(`albums/${albumId}?show_plylst=true`) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('checkbox', { name: /show plylst link/ }).check();
	assert.equal((await saved).status(), 200);
	await page.getByRole('link', { name }).waitFor();
	assert.equal(
		await page.getByRole('link', { name }).getAttribute('href'),
		`https://plylst.renderg.host/u/${encodeURIComponent(user.handle)}/album/${encodeURIComponent(album.slug)}`
	);
	for (const [width, theme] of [
		[1280, 'light'],
		[1280, 'dark'],
		[390, 'light'],
		[390, 'dark']
	]) {
		assert.ok((await owner.request.post(`${API}/preferences/`, { data: { theme } })).ok());
		await page.setViewportSize({ width, height: 1000 });
		await page.goto(`${APP}${path}`);
		await page.getByRole('button', { name: 'edit album', exact: true }).click();
		await page.locator(`html.theme-${theme}`).waitFor();
		assert.equal(await page.getByRole('checkbox', { name: /show plylst link/ }).isChecked(), true);
		assert.equal(
			await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth),
			true,
			'no horizontal overflow'
		);
		await page.screenshot({
			path: `${ARTIFACTS}/plylst-owner-${width}-${theme}.png`,
			fullPage: true
		});
		const visitor = await browser.newContext({
			viewport: { width, height: 1000 },
			colorScheme: theme
		});
		try {
			await visitor.addInitScript(
				(preferredTheme) => globalThis.localStorage.setItem('theme', preferredTheme),
				theme
			);
			const publicPage = await visitor.newPage();
			await publicPage.goto(`${APP}${path}`);
			await publicPage.getByRole('link', { name }).waitFor();
			await publicPage.locator(`html.theme-${theme}`).waitFor();
			assert.equal(
				await publicPage.getByRole('button', { name: 'edit album', exact: true }).count(),
				0
			);
			assert.equal(
				await publicPage.getByRole('link', { name }).getAttribute('rel'),
				'noopener noreferrer'
			);
			await publicPage.screenshot({
				path: `${ARTIFACTS}/plylst-visitor-${width}-${theme}.png`,
				fullPage: true
			});
			assert.equal(
				(await visitor.request.patch(`${API}/albums/${albumId}?show_plylst=false`)).status(),
				401
			);
		} finally {
			await visitor.close();
		}
	}
	const disabled = page.waitForResponse(
		(response) =>
			response.url().includes(`albums/${albumId}?show_plylst=false`) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('checkbox', { name: /show plylst link/ }).uncheck();
	assert.equal((await disabled).status(), 200);
	await page.getByRole('link', { name }).waitFor({ state: 'hidden' });
	assert.equal(await page.getByRole('link', { name }).count(), 0);
	const fresh = await (
		await owner.request.get(`${API}/albums/${user.handle}/${album.slug}`)
	).json();
	assert.equal(fresh.metadata.show_plylst, false);
	assert.deepEqual(errors, []);
	console.log(
		'plylst staging smoke passed: owner persistence, visitor link, authorization, desktop/mobile, light/dark'
	);
} catch (error) {
	await page
		.screenshot({ path: `${ARTIFACTS}/plylst-failure.png`, fullPage: true })
		.catch(() => {});
	throw error;
} finally {
	const cleanup = async (label, operation) => {
		try {
			await operation();
		} catch {
			console.error(`fixture cleanup failed: ${label}`);
			process.exitCode = 1;
		}
	};
	try {
		if (originalTheme !== undefined)
			await cleanup('theme', async () =>
				assert.ok(
					(await owner.request.post(`${API}/preferences/`, { data: { theme: originalTheme } })).ok()
				)
			);
		if (trackId)
			await cleanup(`track ${trackId}`, async () =>
				assert.equal((await owner.request.delete(`${API}/tracks/${trackId}`)).status(), 200)
			);
		if (albumId)
			await cleanup(`album ${albumId}`, async () =>
				assert.equal((await owner.request.delete(`${API}/albums/${albumId}`)).status(), 200)
			);
	} finally {
		await browser.close();
	}
}
