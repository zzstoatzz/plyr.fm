export interface AuthCallbackParameters {
	exchangeToken: string | null;
	isDevToken: boolean;
	isScopeUpgrade: boolean;
}

/**
 * Read either callback shape during the parallel-backend transition.
 *
 * Zig puts its bearer in the fragment so it never reaches the frontend host,
 * access logs, or referrer headers. Python still uses query parameters; the
 * fragment wins when both are present.
 */
export function parseAuthCallback(search: string, hash: string): AuthCallbackParameters {
	const query = new URLSearchParams(search);
	const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
	const value = (name: string): string | null => fragment.get(name) ?? query.get(name);
	return {
		exchangeToken: value('exchange_token'),
		isDevToken: value('dev_token') === 'true',
		isScopeUpgrade: value('scope_upgraded') === 'true'
	};
}
