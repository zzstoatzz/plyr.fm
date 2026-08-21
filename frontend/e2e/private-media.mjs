/**
 * End-to-end: private media on a real spaces PDS, through a real browser.
 *
 * Drives exactly what a user does: OAuth sign-in to staging with the zat test
 * account, choose "private" on /upload, approve the one-time private-media
 * consent on the PDS, upload, then — in a FRESH session without the grant —
 * confirm the track is private and its audio streams through the
 * space-credential proxy. Fails loudly at whichever stage breaks.
 *
 * Runs on merge to main (.github/workflows/e2e-private-media.yml) and locally:
 *   ZAT_TEST_HANDLE=... ZAT_TEST_PASSWORD=... node e2e/private-media.mjs
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
	waitForTrack,
	wavBuffer
} from './lib.mjs';

const browser = await chromium.launch();
const title = `e2e private ${Date.now()}`;
let createdTrackId = null;
let ownerContext = null;
let dumpOwner = null;
let dumpFresh = null;

try {
	// --- session 1: sign in, upload privately through the consent round trip
	ownerContext = await browser.newContext({ viewport: { width: 1000, height: 2600 } });
	const page = await ownerContext.newPage();
	dumpOwner = observe(page, 'owner');

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

	await page.goto(`${APP}/upload`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	const privateRadio = page.locator('input[type="radio"][value="private"]');
	if ((await privateRadio.count()) !== 1) fail('private option not offered');

	const fillForm = async () => {
		await page.locator('input[type="text"]').first().fill(title);
		await page
			.locator('input[type="file"]')
			.first()
			.setInputFiles({ name: 'e2e.wav', mimeType: 'audio/wav', buffer: wavBuffer() });
		await page.locator('label:has(input[type="radio"][value="private"])').click();
		const attest = page.locator('.attestation input[type="checkbox"]').first();
		if (!(await attest.isChecked())) await attest.check();
	};
	step('upload-form', title);
	await fillForm();
	await page.locator('button[type="submit"]').last().click();

	if (!before.permissioned_spaces.granted) {
		step('consent', 'expecting the one-time private-media approval');
		await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
		await authorizeOnPds(page);
		await page.waitForTimeout(3000);
		const after = await me(page);
		if (after?.permissioned_spaces?.granted !== true) {
			fail(`grant absent after consent: ${JSON.stringify(after?.permissioned_spaces)}`);
		}
		step('granted', 'token carries the space grant; the upload resumes by itself');
	}

	step('uploading', 'waiting for the track to exist');
	createdTrackId = await waitForTrack(page, title);
	if (!createdTrackId) fail('uploaded track never appeared');
	step('created', `track ${createdTrackId}`);

	// --- session 2: a fresh sign-in (base scope, no grant) must still play it
	const freshContext = await browser.newContext({ viewport: { width: 1000, height: 2000 } });
	const fresh = await freshContext.newPage();
	dumpFresh = observe(fresh, 'fresh');
	step('fresh-session', 'signing in again without the grant');
	await signIn(fresh);
	const freshMe = await me(fresh);
	step('fresh-capability', JSON.stringify(freshMe?.permissioned_spaces));

	const playback = await fresh.evaluate(
		async ([api, id]) => {
			const d = await fetch(`${api}/tracks/${id}`, { credentials: 'include' });
			if (!d.ok) return { detailStatus: d.status };
			const t = await d.json();
			const a = await fetch(`${api}/audio/${t.file_id}?track_id=${id}`, {
				credentials: 'include',
				headers: { Range: 'bytes=0-99' }
			});
			return { detailStatus: d.status, visibility: t.visibility, audioStatus: a.status };
		},
		[API, createdTrackId]
	);
	if (playback.visibility !== 'private') fail(`visibility is ${playback.visibility}, not private`);
	if (playback.audioStatus !== 206 && playback.audioStatus !== 200) {
		fail(`private audio did not stream: ${JSON.stringify(playback)}`);
	}
	step('playback', JSON.stringify(playback));
	await freshContext.close();

	console.log('PASS — private media works end to end');
} catch (e) {
	if (process.exitCode !== 1) {
		console.error(`FAILED at [${currentStage()}]: ${String(e).slice(0, 400)}`);
		process.exitCode = 1;
	}
	if (dumpFresh) await dumpFresh();
	if (dumpOwner) await dumpOwner();
} finally {
	if (createdTrackId && ownerContext) await deleteTrack(ownerContext, createdTrackId);
	await browser.close();
}
