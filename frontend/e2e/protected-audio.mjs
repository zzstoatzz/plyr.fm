/** OAuth browser smoke for public listening with downloads-off audio on Spaces.
 * Run against staging with the same test credentials as private-media.mjs.
 */
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

const browser = await chromium.launch();
const title = `e2e protected ${Date.now()}`;
const nonce = Buffer.from(randomUUID());
const junk = Buffer.alloc(8 + nonce.length);
junk.write('JUNK');
junk.writeUInt32LE(nonce.length, 4);
nonce.copy(junk, 8);
const audioFixture = Buffer.concat([wavBuffer(), junk]);
audioFixture.writeUInt32LE(audioFixture.length - 8, 4);
const owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await owner.newPage();
const dumpOwner = observe(page, 'protected-owner');
const errors = [];
let listener = null;
let dumpListener = null;
let trackId = null;
let signedIn = false;
let submitted = false;

function monitor(target, label) {
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

monitor(page, 'owner');
try {
	step('protected-sign-in', HANDLE);
	await signIn(page);
	signedIn = true;
	const user = await me(page);
	if (user?.permissioned_spaces?.supported !== true) fail('OAuth account PDS lacks Spaces support');

	step('protected-form', 'public listening, downloads off, unlisted integration fixture');
	await page.goto(`${APP}/upload`, { waitUntil: 'domcontentloaded' });
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
	await page.goto(`${APP}/track/${trackId}`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: 'edit track', exact: true }).click();
	await page.getByText('audio & version history', { exact: true }).click();
	await page.locator('.audio-current-label').filter({ hasText: 'stored on your PDS' }).waitFor();
	await page.screenshot({ path: `${ARTIFACTS}/protected-pds-ownership.png`, fullPage: true });

	step('protected-listener', 'fresh anonymous browser plays the protected source');
	listener = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
	const anonymous = await listener.newPage();
	monitor(anonymous, 'listener');
	dumpListener = observe(anonymous, 'protected-listener');
	await anonymous.goto(`${APP}/track/${trackId}`, { waitUntil: 'domcontentloaded' });
	await anonymous.getByText(title, { exact: true }).first().waitFor();
	await anonymous.locator('button.btn-play').click();
	await anonymous.waitForFunction(
		() => {
			const audio = document.querySelector('audio');
			return audio && audio.currentTime > 0 && !audio.error;
		},
		null,
		{ timeout: 30000 }
	);
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
	console.error(`FAILED at [${currentStage()}]: ${String(error).slice(0, 400)}`);
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
	} finally {
		await listener?.close();
		await owner.close();
		await browser.close();
	}
}
