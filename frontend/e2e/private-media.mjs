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

const APP = process.env.PLYR_APP_URL ?? 'https://stg.plyr.fm';
const API = process.env.PLYR_API_URL ?? 'https://api-stg.plyr.fm';
const HANDLE = required('ZAT_TEST_HANDLE');
const PASSWORD = required('ZAT_TEST_PASSWORD');

function required(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(`missing ${name}`);
		process.exit(2);
	}
	return value;
}

let stage = 'start';
const step = (name, detail = '') => {
	stage = name;
	console.log(`[${name}] ${detail}`);
};
const fail = (detail) => {
	console.error(`FAILED at [${stage}]: ${detail}`);
	process.exitCode = 1;
	throw new Error(detail);
};

/** 0.2s of 8kHz mono sine — small but decodable, and unique per run so the
 * content-hash dedupe never mistakes two test runs for the same track. */
const seed = Date.now() % 997;
function wavBuffer() {
	const frames = 1600;
	const data = frames * 2;
	const b = Buffer.alloc(44 + data);
	b.write('RIFF');
	b.writeUInt32LE(36 + data, 4);
	b.write('WAVE', 8);
	b.write('fmt ', 12);
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(1, 22);
	b.writeUInt32LE(8000, 24);
	b.writeUInt32LE(16000, 28);
	b.writeUInt16LE(2, 32);
	b.writeUInt16LE(16, 34);
	b.write('data', 36);
	b.writeUInt32LE(data, 40);
	for (let i = 0; i < frames; i++) {
		b.writeInt16LE(Math.floor(3000 * Math.sin(i / (10 + seed / 100))), 44 + i * 2);
	}
	return b;
}

/** the zds consent page: expand the password form and authorize. */
async function authorizeOnPds(page) {
	await page.waitForTimeout(800);
	const usePassword = page.getByText('use password instead');
	if (await usePassword.count()) await usePassword.click().catch(() => undefined);
	await page.locator('input[name="username"]').fill(HANDLE);
	await page.locator('input[name="password"]').fill(PASSWORD);
	await page.getByRole('button', { name: 'authorize' }).click();
	await page.waitForURL((u) => u.href.startsWith(APP), { timeout: 30000 });
}

async function signIn(page) {
	await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
	await page.locator('input').first().fill(HANDLE);
	await page.keyboard.press('Enter');
	await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
	await authorizeOnPds(page);
	await page.waitForTimeout(2500);
	const terms = page.locator('.terms-overlay');
	if (await terms.count()) {
		await terms.getByRole('button', { name: /accept/i }).click();
		await page.waitForTimeout(1500);
	}
}

const me = (page) =>
	page.evaluate(async (api) => (await (await fetch(`${api}/auth/me`, { credentials: 'include' })).json()), API);

const browser = await chromium.launch();
const title = `e2e private ${Date.now()}`;
let createdTrackId = null;
let ownerContext = null;

try {
	// --- session 1: sign in, upload privately through the consent round trip
	ownerContext = await browser.newContext({ viewport: { width: 1000, height: 2600 } });
	const page = await ownerContext.newPage();

	step('sign-in', HANDLE);
	await signIn(page);
	const before = await me(page);
	if (before?.permissioned_spaces?.supported !== true) {
		fail(`spaces PDS not detected as supported: ${JSON.stringify(before?.permissioned_spaces)}`);
	}
	step('capability', `supported=true granted=${before.permissioned_spaces.granted}`);

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
		step('granted', 'token carries the space grant');
		if (!page.url().includes('/upload')) await page.goto(`${APP}/upload`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(2000);
		// the stash restores text + visibility; the file must be re-attached
		await fillForm();
		await page.locator('button[type="submit"]').last().click();
	}

	step('uploading', 'waiting for the track to exist');
	for (let i = 0; i < 30 && !createdTrackId; i++) {
		await page.waitForTimeout(2000);
		createdTrackId = await page.evaluate(
			async ([api, wanted]) => {
				const r = await fetch(`${api}/auth/me`, { credentials: 'include' });
				if (!r.ok) return null;
				const who = await r.json();
				const tr = await fetch(`${api}/tracks/?artist_did=${who.did}&limit=50`, { credentials: 'include' });
				if (!tr.ok) return null;
				const data = await tr.json();
				const list = data.tracks ?? data;
				return list.find((t) => t.title === wanted)?.id ?? null;
			},
			[API, title]
		);
	}
	if (!createdTrackId) fail('uploaded track never appeared');
	step('created', `track ${createdTrackId}`);

	// --- session 2: a fresh sign-in (base scope, no grant) must still play it
	const freshContext = await browser.newContext({ viewport: { width: 1000, height: 2000 } });
	const fresh = await freshContext.newPage();
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
		console.error(`FAILED at [${stage}]: ${String(e).slice(0, 400)}`);
		process.exitCode = 1;
	}
} finally {
	// leave the fixture account the way we found it
	if (createdTrackId && ownerContext) {
		const cleanup = await ownerContext.newPage();
		const deleted = await cleanup
			.goto(`${APP}/portal`, { waitUntil: 'domcontentloaded' })
			.then(() =>
				cleanup.evaluate(
					async ([api, id]) =>
						(await fetch(`${api}/tracks/${id}`, { method: 'DELETE', credentials: 'include' })).status,
					[API, createdTrackId]
				)
			)
			.catch((e) => `cleanup error: ${e}`);
		console.log(`[cleanup] DELETE /tracks/${createdTrackId} -> ${deleted}`);
	}
	await browser.close();
}
