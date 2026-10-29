// OAuth staging smoke for protected PDS audio and anonymous playback.
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import {
	API,
	APP,
	ARTIFACTS,
	HANDLE,
	authorizeOnPds,
	currentStage,
	deleteTrack,
	fail,
	findTrackByTitle,
	me,
	observe,
	signIn,
	step,
	waitForTrack,
	wavBuffer
} from './lib.mjs';

const width = Number(process.env.E2E_VIEWPORT_WIDTH ?? 1280);
const theme = process.env.E2E_THEME ?? 'light';
if (!Number.isInteger(width) || width < 320 || !['light', 'dark'].includes(theme)) {
	throw new Error('invalid E2E_VIEWPORT_WIDTH or E2E_THEME');
}
const contextOptions = {
	viewport: { width, height: 1000 },
	hasTouch: width < 600,
	colorScheme: theme
};
const browser = await chromium.launch();
const title = `e2e protected ${Date.now()}`;
const nonce = Buffer.from(randomUUID());
const junk = Buffer.alloc(8 + nonce.length);
junk.write('JUNK');
junk.writeUInt32LE(nonce.length, 4);
nonce.copy(junk, 8);
const audioFixture = Buffer.concat([wavBuffer({ durationSeconds: 12, sampleRate: 44100 }), junk]);
audioFixture.writeUInt32LE(audioFixture.length - 8, 4);
const owner = await browser.newContext(contextOptions);
const page = await owner.newPage();
const dumpOwner = observe(page, 'protected-owner');
const errors = [];
let listener = null;
let dumpListener = null;
let trackId = null;
let signedIn = false;
let submitted = false;
let originalTheme = null;

function monitor(target, label) {
	const documents = new WeakMap();
	target.on('request', (request) => {
		if (request.isNavigationRequest()) documents.set(request, Date.now());
	});
	target.on('requestfailed', (request) => {
		if (request.url().startsWith(API))
			console.error(
				`[requestfailed] ${label} ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`
			);
		if (request.isNavigationRequest())
			console.error(
				`[navigation] ${label} failed after ${Date.now() - documents.get(request)}ms: ${request.failure()?.errorText} ${new URL(request.url()).pathname}`
			);
	});
	target.on('response', (response) => {
		const request = response.request();
		if (request.isNavigationRequest())
			console.log(
				`[navigation] ${label} ${response.status()} after ${Date.now() - documents.get(request)}ms ${new URL(response.url()).origin}${new URL(response.url()).pathname}`
			);
	});
	target.on('pageerror', (error) => errors.push(`${label}: ${String(error).slice(0, 200)}`));
	target.on('console', (message) => {
		if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
			errors.push(`${label}: ${message.text().slice(0, 200)}`);
		}
	});
	target.on('response', (response) => {
		if (response.url().startsWith(API) && response.status() >= 500) {
			errors.push(`${label}: ${response.status()} ${new URL(response.url()).pathname}`);
		}
	});
}

async function navigateOwner(path) {
	if (width <= 768) {
		await page.getByTitle('menu', { exact: true }).click();
		if (path === '/settings') {
			await page
				.locator('.menu-popover')
				.getByRole('button', { name: /^settings/ })
				.click();
		}
		await page.locator(`.menu-popover a[href="${path}"]`).click();
	} else if (path === '/upload') {
		await page.locator('a.upload-link').click();
	} else {
		await page.getByTitle('account menu', { exact: true }).click();
		await page.locator(`.dropdown a[href="${path}"]`).click();
	}
	await page.waitForURL(`${APP}${path}`);
}

monitor(page, 'owner');
try {
	step('protected-sign-in', HANDLE);
	await signIn(page);
	signedIn = true;
	const user = await me(page);
	if (user?.permissioned_spaces?.supported !== true) fail('OAuth account PDS lacks Spaces support');

	const preferences = await owner.request.get(`${API}/preferences/`);
	if (!preferences.ok()) fail('could not read fixture theme');
	originalTheme = (await preferences.json()).theme;
	await navigateOwner('/settings');
	const themeSaved = page.waitForResponse(
		(response) => response.url() === `${API}/preferences/` && response.request().method() === 'POST'
	);
	await page.locator('.theme-buttons').getByRole('button', { name: theme, exact: true }).click();
	if (!(await themeSaved).ok()) fail('could not save fixture theme');
	await page.locator(`html.theme-${theme}`).waitFor();
	step('protected-config', `${width}px ${theme} touch=${contextOptions.hasTouch}`);

	step('protected-form', 'public listening, downloads off, unlisted integration fixture');
	await navigateOwner('/upload');
	await page.locator('input[type="file"]').first().setInputFiles({
		name: 'protected-e2e.wav',
		mimeType: 'audio/wav',
		buffer: audioFixture
	});
	await page.getByText('change for this track', { exact: true }).click();
	await page.getByRole('checkbox', { name: 'anyone can listen', exact: true }).check();
	await page.getByRole('checkbox', { name: 'anyone can download', exact: true }).uncheck();
	await page.getByLabel('who can download?').selectOption('off');
	await page.getByText('more options', { exact: true }).click();
	await page.getByRole('checkbox', { name: 'show in feeds', exact: true }).uncheck();
	const tags = page.getByPlaceholder('type to search tags...');
	await tags.fill('integration-test');
	await tags.press('Enter');
	await page.locator('.attestation input[type="checkbox"]').first().check();
	await page.getByLabel('track title', { exact: true }).fill(title);
	const notice = page.getByRole('region', { name: 'audio storage' });
	await notice
		.getByText('your audio will live in a Space on your PDS.', { exact: false })
		.waitFor();
	if (await notice.getByRole('checkbox').count())
		fail('Spaces account offered plyr-only fallback acceptance');
	await page.screenshot({ path: `${ARTIFACTS}/protected-storage-notice.png`, fullPage: true });
	submitted = true;
	await page.locator('button[type="submit"]').last().click();
	if (!user.permissioned_spaces.granted) {
		step('protected-consent', 'approve the owner Spaces permission bundle');
		await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
		await authorizeOnPds(page);
	}
	trackId = await waitForTrack(page, title);
	if (!trackId) fail('protected upload did not publish');
	const response = await owner.request.get(`${API}/tracks/${trackId}`);
	if (!response.ok()) fail(`owner track detail returned ${response.status()}`);
	const track = await response.json();
	if (
		!track.audio_space ||
		track.pds_blob_cid ||
		track.download_policy !== 'off' ||
		track.visibility !== 'unlisted'
	) {
		fail('protected upload lost its Space source or publishing policy');
	}
	if (
		!(track.tags ?? []).some(
			(tag) => (typeof tag === 'string' ? tag : tag.name) === 'integration-test'
		)
	) {
		fail('integration-test tag missing');
	}

	step('protected-ownership', `track ${trackId}`);
	await navigateOwner('/portal');
	await page.locator(`a.track-view-link[href="/track/${trackId}"]`).click();
	await page.waitForURL(`${APP}/track/${trackId}`);
	const recommendations = page.waitForResponse(
		(response) => new URL(response.url()).pathname === `/tracks/${trackId}/recommended-tags`,
		{ timeout: 120000 }
	);
	await page.getByRole('button', { name: 'edit track', exact: true }).click();
	const recommended = await recommendations;
	if (!recommended.ok()) fail(`suggested tags failed: ${recommended.status()}`);
	await page.getByText('audio & version history', { exact: true }).click();
	const ownership = page.locator('.audio-current-label').filter({ hasText: 'stored on your PDS' });
	await ownership.waitFor();
	await ownership.scrollIntoViewIfNeeded();
	await ownership.evaluate((element) => element.scrollIntoView({ block: 'center' }));
	await page.screenshot({ path: `${ARTIFACTS}/protected-pds-ownership.png`, fullPage: true });

	step('protected-listener', 'fresh anonymous browser plays the protected source');
	listener = await browser.newContext(contextOptions);
	await listener.addInitScript((selected) => {
		globalThis.localStorage.setItem('theme', selected);
	}, theme);
	const anonymous = await listener.newPage();
	monitor(anonymous, 'listener');
	dumpListener = observe(anonymous, 'protected-listener');
	await anonymous.goto(`${APP}/track/${trackId}`, { waitUntil: 'domcontentloaded' });
	await anonymous.locator(`html.theme-${theme}`).waitFor();
	await anonymous.getByText(title, { exact: true }).first().waitFor();
	const playRecorded = anonymous.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `/tracks/${trackId}/play` &&
			response.request().method() === 'POST',
		{ timeout: 60000 }
	);
	await anonymous.locator('button.btn-play').click();
	await anonymous.waitForFunction(
		() => {
			const audio = document.querySelector('audio');
			return audio && audio.currentTime > 0 && !audio.error;
		},
		null,
		{ timeout: 30000 }
	);
	if (!(await playRecorded).ok()) fail('anonymous player could not record playback');
	const currentResponse = await listener.request.get(`${API}/tracks/${trackId}`);
	if (!currentResponse.ok()) fail(`anonymous track detail returned ${currentResponse.status()}`);
	const current = await currentResponse.json();
	const audio = await listener.request.get(`${API}/audio/${current.file_id}`, {
		headers: { Range: 'bytes=0-99' }
	});
	if (![200, 206].includes(audio.status()) || !(await audio.body()).length) {
		fail(`anonymous audio failed: ${audio.status()}`);
	}
	const download = await listener.request.get(`${API}/audio/${current.file_id}/download`, {
		maxRedirects: 0
	});
	if (download.status() !== 403) fail(`anonymous download was not denied: ${download.status()}`);
	await anonymous.screenshot({
		path: `${ARTIFACTS}/protected-anonymous-playback.png`,
		fullPage: true
	});
	if (errors.length) fail(`browser errors: ${errors.join('; ')}`);
	console.log('PASS — OAuth protected upload, PDS ownership, anonymous playback, downloads denied');
} catch (error) {
	console.error(`FAILED at [${currentStage()}]: ${String(error).split('\n')[0].slice(0, 400)}`);
	process.exitCode = 1;
	if (dumpListener) await dumpListener();
	await dumpOwner();
} finally {
	try {
		if (!trackId && signedIn) {
			trackId = await findTrackByTitle(page, title);
			if (!trackId && submitted) trackId = await waitForTrack(page, title, 10);
		}
		if (trackId) await deleteTrack(owner, trackId);
	} catch (error) {
		console.error(`[cleanup] track delete failed: ${error.name}`);
		process.exitCode = 1;
	} finally {
		try {
			if (originalTheme !== null) {
				const restored = await owner.request.post(`${API}/preferences/`, {
					data: { theme: originalTheme }
				});
				console.log(`[cleanup] restore fixture theme -> ${restored.status()}`);
				if (!restored.ok()) process.exitCode = 1;
			}
		} catch (error) {
			console.error(`[cleanup] theme restore failed: ${error.name}`);
			process.exitCode = 1;
		} finally {
			if (signedIn) {
				try {
					const loggedOut = await owner.request.post(`${API}/auth/logout`);
					console.log(`[cleanup] fixture session logout -> ${loggedOut.status()}`);
					if (!loggedOut.ok()) process.exitCode = 1;
				} catch (error) {
					console.error(`[cleanup] logout failed: ${error.name}`);
					process.exitCode = 1;
				}
			}
			await listener?.close();
			await owner.close();
			await browser.close();
		}
	}
}
