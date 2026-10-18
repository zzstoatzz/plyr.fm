import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import UploadSponsorCard from './UploadSponsorCard.svelte';
import { auth } from '$lib/auth.svelte';
import { DEFAULT_PREFERENCES, preferences } from '$lib/preferences.svelte';

let component: ReturnType<typeof mount> | undefined;
let uploaded = 25 * 3600;
let threshold = 24;
let failure = false;
const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
	uploaded = 25 * 3600;
	threshold = 24;
	failure = false;
	auth.user = {
		did: 'did:plc:sponsor',
		handle: 'sponsor.test',
		linked_accounts: [],
		enabled_flags: []
	};
	auth.isAuthenticated = true;
	preferences.data = { ...DEFAULT_PREFERENCES, ui_settings: {} };
	fetcher.mockReset();
	fetcher.mockImplementation(async (input) => {
		if (String(input).endsWith('/config')) {
			return Response.json({ upload_sponsor_threshold_hours: threshold });
		}
		if (failure) return new Response(null, { status: 503 });
		return Response.json({ uploaded_audio_seconds: uploaded, scanned_audio_seconds: 7200 });
	});
	vi.stubGlobal('fetch', fetcher);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	auth.user = null;
	auth.isAuthenticated = false;
	preferences.data = null;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function render(): Promise<void> {
	component = mount(UploadSponsorCard, { target: document.body });
	flushSync();
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
	await new Promise((resolve) => setTimeout(resolve, 10));
	flushSync();
}

it('shows uploaded hours and estimates only successfully scanned audio', async () => {
	await render();
	expect(document.body.textContent).toContain('25.0 hours');
	expect(document.body.textContent).toContain('$3.00');
	expect(document.querySelector('a')?.href).toBe('https://github.com/sponsors/zzstoatzz');
});

it('requires strictly more than the threshold', async () => {
	uploaded = 24 * 3600;
	await render();
	expect(document.querySelector('aside')).toBeNull();
});

it('hides the optional prompt when usage cannot be loaded', async () => {
	failure = true;
	await render();
	expect(document.querySelector('aside')).toBeNull();
});

it('persists dismissal through the account preferences endpoint', async () => {
	await render();
	document.querySelector('button')?.click();
	flushSync();
	expect(document.querySelector('aside')).toBeNull();
	const saved = fetcher.mock.calls.find(([url]) => String(url).endsWith('/preferences/'));
	expect(saved?.[1]?.credentials).toBe('include');
	expect(
		JSON.parse(String(saved?.[1]?.body)).ui_settings.upload_sponsor_dismissed_at
	).toBeGreaterThan(0);
});

it('honors a dismissal from another device', async () => {
	preferences.data = {
		...DEFAULT_PREFERENCES,
		ui_settings: { upload_sponsor_dismissed_at: Date.now() }
	};
	await render();
	expect(document.querySelector('aside')).toBeNull();
});

it('shows again after thirty days', async () => {
	preferences.data = {
		...DEFAULT_PREFERENCES,
		ui_settings: { upload_sponsor_dismissed_at: Date.now() - 31 * 86400000 }
	};
	await render();
	expect(document.querySelector('aside')).not.toBeNull();
});

it('uses a lowered production threshold without a frontend rebuild', async () => {
	threshold = 0.01;
	uploaded = 60;
	await render();
	expect(document.querySelector('aside')).not.toBeNull();
});
