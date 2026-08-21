/**
 * End-to-end: a private voice memo from /record, on a real spaces PDS.
 *
 * Chromium's fake microphone stands in for a person: sign in, record a few
 * seconds, choose "private", approve the one-time private-media consent the
 * page stashes the recording across, save, and confirm the track exists as
 * private with audio streaming through the space-credential proxy.
 *
 *   ZAT_TEST_HANDLE=... ZAT_TEST_PASSWORD=... node e2e/record-private.mjs
 */

import { chromium } from 'playwright';
import {
	API,
	APP,
	HANDLE,
	authorizeOnPds,
	currentStage,
	deleteTrack,
	fail,
	me,
	observe,
	signIn,
	step,
	waitForTrack
} from './lib.mjs';

const browser = await chromium.launch({
	args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const title = `e2e memo ${Date.now()}`;
let createdTrackId = null;
let context = null;
let dump = null;

const privateRadio = (page) => page.locator('input[type="radio"][value="private"]');

async function choosePrivateAndSave(page, granted) {
	await page.locator('#record-title').fill(title);
	await page.locator('label:has(input[type="radio"][value="private"])').click();
	const expected = granted ? 'save privately' : 'approve private media';
	const save = page.getByRole('button', { name: expected });
	if (!(await save.count())) fail(`choosing private did not relabel the button "${expected}"`);
	await save.click();
}

try {
	context = await browser.newContext({
		viewport: { width: 1000, height: 2000 },
		permissions: ['microphone']
	});
	const page = await context.newPage();
	dump = observe(page, 'record');

	step('sign-in', HANDLE);
	await signIn(page);
	const before = await me(page);
	if (before?.permissioned_spaces?.supported !== true) {
		fail(`spaces PDS not detected as supported: ${JSON.stringify(before?.permissioned_spaces)}`);
	}
	if (before.permissioned_spaces.granted !== true) {
		fail('sign-in on a spaces PDS did not carry the private-media grant');
	}
	step('capability', 'supported=true granted=true straight from sign-in');

	await page.goto(`${APP}/record`, { waitUntil: 'networkidle' });
	step('record', 'three seconds from the fake microphone');
	await page.getByRole('button', { name: 'start recording' }).click();
	await page.getByRole('button', { name: 'stop recording' }).waitFor({ timeout: 10000 });
	await page.waitForTimeout(3000);
	await page.getByRole('button', { name: 'stop recording' }).click();
	await page.locator('#record-title').waitFor({ timeout: 15000 });
	const mime = await page.evaluate(() => {
		const el = document.querySelector('audio');
		return el?.src?.startsWith('blob:') ? 'blob attached' : 'no preview blob';
	});
	step('preview', mime);
	if ((await privateRadio(page).count()) !== 1) fail('private option not offered on /record');

	await choosePrivateAndSave(page, before.permissioned_spaces.granted);

	if (!before.permissioned_spaces.granted) {
		step('consent', 'expecting the one-time private-media approval');
		await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
		await authorizeOnPds(page);
		await page.waitForTimeout(3000);
		const after = await me(page);
		if (after?.permissioned_spaces?.granted !== true) {
			fail(`grant absent after consent: ${JSON.stringify(after?.permissioned_spaces)}`);
		}
		step('granted', `back on ${new URL(page.url()).pathname}`);
		if (!page.url().includes('/record')) fail(`consent returned to ${page.url()}, not /record`);
		await page.locator('#record-title').waitFor({ timeout: 15000 });
		const restored = await page.locator('#record-title').inputValue();
		if (restored !== title) fail(`restored title is "${restored}", expected "${title}"`);
		step('restored', 'recording and title survived the round trip; the save resumes by itself');
	}

	step('uploading', 'waiting for the track to exist');
	createdTrackId = await waitForTrack(page, title);
	if (!createdTrackId) fail('recorded track never appeared');
	step('created', `track ${createdTrackId}`);

	const playback = await page.evaluate(
		async ([api, id]) => {
			const d = await fetch(`${api}/tracks/${id}`, { credentials: 'include' });
			if (!d.ok) return { detailStatus: d.status };
			const t = await d.json();
			const a = await fetch(`${api}/audio/${t.file_id}?track_id=${id}`, {
				credentials: 'include',
				headers: { Range: 'bytes=0-99' }
			});
			return { detailStatus: d.status, visibility: t.visibility, extension: t.extension, audioStatus: a.status };
		},
		[API, createdTrackId]
	);
	if (playback.visibility !== 'private') fail(`visibility is ${playback.visibility}, not private`);
	if (playback.audioStatus !== 206 && playback.audioStatus !== 200) {
		fail(`private audio did not stream: ${JSON.stringify(playback)}`);
	}
	step('playback', JSON.stringify(playback));

	console.log('PASS — a private voice memo from /record works end to end');
} catch (e) {
	if (process.exitCode !== 1) {
		console.error(`FAILED at [${currentStage()}]: ${String(e).slice(0, 400)}`);
		process.exitCode = 1;
	}
	if (dump) await dump();
} finally {
	if (createdTrackId && context) await deleteTrack(context, createdTrackId);
	await browser.close();
}
