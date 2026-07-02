// post-login intent preservation: a logged-out user who follows any deep link
// (shared jam, gated track, settings section) must land back on it after
// signing in, riding the plyr_return_to cookie across the OAuth round-trip.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { goto } from '$app/navigation';

const gotoSpy = vi.mocked(goto);

import { loginHref, redirectToLogin, resolvePostLogin } from './auth-redirect';
import { getReturnUrl, setReturnUrl, clearReturnUrl } from './return-url';

beforeEach(() => {
	gotoSpy.mockClear();
	clearReturnUrl();
});

describe('loginHref', () => {
	it('carries a relative destination', () => {
		expect(loginHref('/jam/abc123')).toBe(`/login?return_to=${encodeURIComponent('/jam/abc123')}`);
	});

	it('drops absolute and protocol-relative destinations (open-redirect guard)', () => {
		expect(loginHref('https://evil.example')).toBe('/login');
		expect(loginHref('//evil.example')).toBe('/login');
	});
});

describe('redirectToLogin', () => {
	it('stashes the intent in the cookie and navigates to login', () => {
		redirectToLogin('/track/7?t=42#comments');
		expect(getReturnUrl()).toBe('/track/7?t=42#comments');
		expect(gotoSpy).toHaveBeenCalledWith(
			`/login?return_to=${encodeURIComponent('/track/7?t=42#comments')}`
		);
	});

	it('never stashes an unsafe destination', () => {
		redirectToLogin('https://evil.example');
		expect(getReturnUrl()).toBeNull();
		expect(gotoSpy).toHaveBeenCalledWith('/login');
	});
});

describe('resolvePostLogin', () => {
	it('returns false with nothing stashed', () => {
		expect(resolvePostLogin()).toBe(false);
	});

	it('consumes the stash exactly once', () => {
		setReturnUrl('/jam/abc123');
		// jsdom forbids real navigation; observe the href assignment instead
		const target: { href?: string } = {};
		vi.spyOn(window, 'location', 'get').mockReturnValue(target as Location);
		expect(resolvePostLogin()).toBe(true);
		expect(target.href).toBe('/jam/abc123');
		vi.restoreAllMocks();
		expect(getReturnUrl()).toBeNull();
		expect(resolvePostLogin()).toBe(false);
	});
});
