import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthConfig } from '../src/auth-config.ts';
import { oauthMetadata } from '../src/oauth-metadata.ts';
import { returnPath } from '../src/return-path.ts';

test('both OAuth documents publish the same scope universe supplied to the clients', () => {
	const config = createAuthConfig({ siteUrl: 'https://preview.example/' });
	for (const kind of ['web', 'native'] as const) {
		const metadata = oauthMetadata(config, kind);
		assert.equal(metadata.client_uri, 'https://preview.example');
		assert.equal(metadata.client_id, 'https://preview.example/oauth-' + (kind === 'native' ? 'native-' : '') + 'client-metadata.json');
		assert.deepEqual(metadata.redirect_uris, kind === 'native' ? ['fm.plyr.next:/oauth/callback'] : ['https://preview.example/oauth/callback']);
		const grants = new Set(metadata.scope.split(' '));
		assert.ok(config.BASE_SCOPE_PARTS.every(scope => grants.has(scope)));
		assert.ok(config.SYNC_SCOPE_PARTS.every(scope => grants.has(scope)));
		assert.equal(config.hasSyncGrant(metadata.scope), true);
	}
});

test('sign-in return paths stay on this site and avoid auth loops', () => {
	assert.equal(returnPath('/track/example?listen=yes#comments'), '/track/example?listen=yes#comments');
	for (const path of ['https://example.com/', '//example.com/', '/%2fexample.com', '/%5cexample.com', '/login?again=1', '/oauth/callback', '/%6cogin']) {
		assert.equal(returnPath(path), undefined, path);
	}
});
