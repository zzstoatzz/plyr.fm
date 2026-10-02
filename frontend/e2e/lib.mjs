/** shared plumbing for the browser e2e flows against staging. */

import { mkdirSync } from 'node:fs';

export const APP = process.env.PLYR_APP_URL ?? 'https://stg.plyr.fm';
export const API = process.env.PLYR_API_URL ?? 'https://api-stg.plyr.fm';
export const HANDLE = required('ZAT_TEST_HANDLE');
export const PASSWORD = required('ZAT_TEST_PASSWORD');
export const MEMBER_HANDLE = process.env.ALPHA_TEST_HANDLE?.trim() || null;
export const MEMBER_PASSWORD = process.env.ALPHA_TEST_PASSWORD?.trim() || null;

function required(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(`missing ${name}`);
		process.exit(2);
	}
	return value;
}

let stage = 'start';
export const currentStage = () => stage;
export const step = (name, detail = '') => {
	stage = name;
	console.log(`[${name}] ${detail}`);
};
export const fail = (detail) => {
	console.error(`FAILED at [${stage}]: ${detail}`);
	process.exitCode = 1;
	throw new Error(detail);
};

export const ARTIFACTS = process.env.E2E_ARTIFACT_DIR ?? 'e2e-artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

/** every API request and console error a page makes, so a failure can say
 * what the browser actually did instead of just where it stopped. */
export function observe(page, label) {
	const seen = [];
	page.on('request', (r) => {
		if (r.url().startsWith(API)) seen.push(`${r.method()} ${new URL(r.url()).pathname}`);
	});
	page.on('response', (r) => {
		if (r.url().startsWith(API) && r.status() >= 400) seen.push(`  -> ${r.status()} ${new URL(r.url()).pathname}`);
	});
	page.on('console', (m) => {
		if (m.type() === 'error') seen.push(`console.error: ${m.text().slice(0, 200)}`);
	});
	page.on('pageerror', (e) => seen.push(`pageerror: ${String(e).slice(0, 200)}`));
	return async () => {
		console.error(`--- ${label}: url=${new URL(page.url()).origin}${new URL(page.url()).pathname}`);
		console.error(`--- ${label}: requests\n${seen.map((l) => '    ' + l).join('\n')}`);
		const text = await page
			.locator('body')
			.innerText()
			.then((t) => t.replace(/\s+/g, ' ').slice(0, 600))
			.catch(() => '(no body)');
		console.error(`--- ${label}: text: ${text}`);
		await page.screenshot({ path: `${ARTIFACTS}/${label}.png`, fullPage: true }).catch(() => undefined);
	};
}

/** 0.2s of 8kHz mono sine — small but decodable, and unique per run so the
 * content-hash dedupe never mistakes two test runs for the same track. */
export const seed = Date.now() % 997;
export function wavBuffer() {
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
export async function authorizeOnPds(page, who = HANDLE, secret = PASSWORD) {
	await page.waitForTimeout(800);
	const usePassword = page.getByText('use password instead');
	if (await usePassword.count()) await usePassword.click().catch(() => undefined);
	await page.locator('input[name="username"]').fill(who);
	await page.locator('input[name="password"]').fill(secret);
	await page.getByRole('button', { name: 'authorize' }).click();
	await page.waitForURL((u) => u.href.startsWith(APP), { timeout: 30000 });
}

export async function signIn(page, who = HANDLE, secret = PASSWORD) {
	const ready = page.waitForResponse((response) => response.url() === `${API}/auth/pds-options`);
	await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
	await ready;
	const handle = page.getByPlaceholder('you.example.com');
	await handle.waitFor({ timeout: 15000 });
	await handle.fill(who);
	await page.locator('form button[type="submit"]').click();
	await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
	await authorizeOnPds(page, who, secret);
	let signedIn = false;
	for (let attempt = 0; attempt < 60; attempt++) {
		const user = await me(page).catch(() => null);
		if (user?.did) {
			signedIn = true;
			break;
		}
		await page.waitForTimeout(500);
	}
	if (!signedIn) fail('OAuth callback did not establish an authenticated session');
	const terms = page.locator('.terms-overlay');
	if (await terms.count()) {
		await terms.getByRole('button', { name: /accept/i }).click();
		await page.waitForTimeout(1500);
	}
}

export const me = (page) =>
	page.evaluate(async (api) => (await (await fetch(`${api}/auth/me`, { credentials: 'include' })).json()), API);


/** the id of the signed-in artist's track with this exact title, or null. */
export const findTrackByTitle = (page, wanted) =>
	page.evaluate(
		async ([api, title]) => {
			const r = await fetch(`${api}/auth/me`, { credentials: 'include' });
			if (!r.ok) return null;
			const who = await r.json();
			const tr = await fetch(`${api}/tracks/?artist_did=${who.did}&limit=50`, { credentials: 'include' });
			if (!tr.ok) return null;
			const data = await tr.json();
			const list = data.tracks ?? data;
			return list.find((t) => t.title === title)?.id ?? null;
		},
		[API, wanted]
	);

/** poll until the track exists (the upload finishes asynchronously). */
export async function waitForTrack(page, title, attempts = 30) {
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(2000);
		const id = await findTrackByTitle(page, title);
		if (id) return id;
	}
	return null;
}

/** leave the fixture account the way we found it. */
export async function deleteTrack(context, id) {
	const response = await context.request.delete(`${API}/tracks/${id}`);
	console.log(`[cleanup] DELETE /tracks/${id} -> ${response.status()}`);
	if (response.status() !== 200) {
		console.error(`could not delete test track ${id}`);
		process.exitCode = 1;
	}
}
