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
	MEMBER_HANDLE,
	MEMBER_PASSWORD,
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
let dumpMember = null;

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

	// --- the artist page: listed for the owner, absent for everyone else
	await page.goto(`${APP}/u/${before.handle}`, { waitUntil: 'networkidle' });
	await page.getByText(title, { exact: true }).first().waitFor({ timeout: 15000 });
	const ownerCount = await page.evaluate(
		async ([api, did]) => (await (await fetch(`${api}/artists/${did}/analytics`, { credentials: 'include' })).json()).total_items,
		[API, before.did]
	);
	step('artist-page', `owner sees "${title}" listed; analytics total_items=${ownerCount}`);
	const stranger = await (await browser.newContext()).newPage();
	await stranger.goto(`${APP}/u/${before.handle}`, { waitUntil: 'networkidle' });
	await stranger.waitForTimeout(2000);
	const strangerSees = await stranger.getByText(title, { exact: true }).count();
	const strangerCount = await stranger.evaluate(
		async ([api, did]) => (await (await fetch(`${api}/artists/${did}/analytics`)).json()).total_items,
		[API, before.did]
	);
	await stranger.context().close();
	if (strangerSees) fail('a signed-out visitor can see the private track on the artist page');
	// the fixture account may hold other private tracks, so only the direction is fixed
	if (!(strangerCount < ownerCount)) {
		fail(`analytics leak: stranger total_items=${strangerCount}, owner=${ownerCount}`);
	}
	step('artist-page-anon', `hidden from a signed-out visitor; total_items=${strangerCount}`);

	// --- a second account on a spaces PDS: refused, then added, then plays it
	if (MEMBER_HANDLE && MEMBER_PASSWORD) {
		const memberContext = await browser.newContext({ viewport: { width: 1000, height: 2000 } });
		const member = await memberContext.newPage();
		dumpMember = observe(member, 'member');
		step('member-sign-in', MEMBER_HANDLE);
		await signIn(member, MEMBER_HANDLE, MEMBER_PASSWORD);
		const memberMe = await me(member);
		if (memberMe?.permissioned_spaces?.reader !== true) {
			fail(`member session lacks the reader grant: ${JSON.stringify(memberMe?.permissioned_spaces)}`);
		}
		const probe = (p) =>
			p.evaluate(
				async ([api, id]) => (await fetch(`${api}/tracks/${id}`, { credentials: 'include' })).status,
				[API, createdTrackId]
			);
		if ((await probe(member)) !== 404) fail('a non-member could read the private track');
		step('member-before', 'not a member yet → 404');

		await page.goto(`${APP}/portal/manage`, { waitUntil: 'networkidle' });
		const search = page.locator('.private-media-section input.search-input');
		await search.waitFor({ timeout: 15000 });
		await search.fill(MEMBER_HANDLE);
		await page.locator('.private-media-section .search-result-item').first().click({ timeout: 20000 });
		await page.getByText(`@${MEMBER_HANDLE} can hear your private tracks`).waitFor({ timeout: 15000 });
		step('member-added', `owner added ${MEMBER_HANDLE} in the portal`);

		if ((await probe(member)) !== 200) fail('the member still cannot read the private track');
		const memberPlayback = await member.evaluate(
			async ([api, id]) => {
				const t = await (await fetch(`${api}/tracks/${id}`, { credentials: 'include' })).json();
				const a = await fetch(`${api}/audio/${t.file_id}?track_id=${id}`, {
					credentials: 'include',
					headers: { Range: 'bytes=0-99' }
				});
				return a.status;
			},
			[API, createdTrackId]
		);
		if (memberPlayback !== 206 && memberPlayback !== 200) {
			fail(`member audio did not stream through their own PDS: ${memberPlayback}`);
		}
		step('member-plays', `audio ${memberPlayback} via the member's own delegation token`);

		await page.locator('.private-media-section .selected-artist-chip button').first().click();
		await page.getByText(/removed @/).waitFor({ timeout: 15000 });
		if ((await probe(member)) !== 404) fail('a removed member can still read the private track');
		step('member-removed', 'removed → 404 again');
		await memberContext.close();
	} else {
		step('member', 'skipped — set ALPHA_TEST_HANDLE/ALPHA_TEST_PASSWORD for the cross-account leg');
	}

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
	if (dumpMember) await dumpMember();
	if (dumpFresh) await dumpFresh();
	if (dumpOwner) await dumpOwner();
} finally {
	if (createdTrackId && ownerContext) await deleteTrack(ownerContext, createdTrackId);
	await browser.close();
}
