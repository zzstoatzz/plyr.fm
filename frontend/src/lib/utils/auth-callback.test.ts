import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './auth-callback';

describe('parseAuthCallback', () => {
	it('reads the Zig exchange token from a URL fragment', () => {
		expect(parseAuthCallback('', '#exchange_token=zig-secret')).toEqual({
			exchangeToken: 'zig-secret',
			isDevToken: false,
			isScopeUpgrade: false
		});
	});

	it('retains compatibility with Python query callbacks', () => {
		expect(
			parseAuthCallback('?exchange_token=python-secret&dev_token=true&scope_upgraded=true', '')
		).toEqual({
			exchangeToken: 'python-secret',
			isDevToken: true,
			isScopeUpgrade: true
		});
	});

	it('prefers a fragment capability over a query parameter', () => {
		expect(
			parseAuthCallback('?exchange_token=stale', '#exchange_token=current')
		).toMatchObject({ exchangeToken: 'current' });
	});
});
