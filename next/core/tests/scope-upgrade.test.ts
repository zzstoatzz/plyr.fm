import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthConfig } from '../src/auth-config.ts';
import { oauthMetadata, registeredScopeParts } from '../src/oauth-metadata.ts';
import { upgradeScope } from '../src/scope-upgrade.ts';
import { TEAL_SCOPE_PARTS } from '../src/teal-scrobble.ts';

const config = createAuthConfig();
const registered = registeredScopeParts(config);
const did = 'did:plc:xbtmt2zjwlrfegqvch7fboei';
const subset = (scope: string) => scope.split(' ').every(part => registered.includes(part));

test('the registered scope is what the client metadata publishes', () => {
	assert.equal(oauthMetadata(config, 'web').scope, registered.join(' '));
	assert.equal(oauthMetadata(config, 'native').scope, registered.join(' '));
});

test('an upgrade asks only for registered parts, keeping what the session holds', () => {
	const granted = config.SCOPE_PARTS.join(' ');
	const scope = upgradeScope(registered, granted, config.MODERATOR_SCOPE_PARTS, did);
	assert.ok(subset(scope));
	for (const part of [...config.SCOPE_PARTS, ...config.MODERATOR_SCOPE_PARTS]) assert.ok(scope.split(' ').includes(part), part);
	assert.ok(config.hasModeratorGrant(scope));
	assert.ok(config.hasCloseGrant(scope));
});

test("the host's own wording of a grant maps back to the registered part", () => {
	// a host may name the account for `self` and put parameters in its own order
	const reworded = config.SCOPE_PARTS.map(part => {
		const [type, query] = part.split('?');
		if (!query) return part;
		return `${type}?${query.split('&').reverse().join('&').replace('authority=self', `authority=${did}`)}`;
	});
	const scope = upgradeScope(registered, reworded.join(' '), config.MODERATOR_SCOPE_PARTS, did);
	assert.ok(subset(scope));
	for (const part of config.SCOPE_PARTS) assert.ok(scope.split(' ').includes(part), part);
});

test('parts this build no longer registers are left out instead of failing the request', () => {
	const granted = [...config.SCOPE_PARTS, 'transition:generic', 'repo:fm.plyr.gone', 'rpc:fm.plyr.moderation.removeReader?aud=did:web:api.next.plyr.fm#plyr_appview'].join(' ');
	const scope = upgradeScope(registered, granted, TEAL_SCOPE_PARTS, did);
	assert.ok(subset(scope));
	assert.ok(!scope.includes('transition:generic') && !scope.includes('fm.plyr.gone') && !scope.includes('removeReader'));
});

test("another account's authority is not read as self", () => {
	const other = config.CLOSE_SCOPE.replace('authority=self', 'authority=did:plc:someoneelse');
	const scope = upgradeScope(registered, `atproto ${other}`, [], did);
	assert.equal(scope, 'atproto');
});

test('asking for an unregistered part is a bug, not a request', () => {
	assert.throws(() => upgradeScope(registered, 'atproto', ['repo:com.example.thing'], did));
});

test('a close grant the host wrote with the account DID still counts as self', () => {
	const granted = config.CLOSE_SCOPE.replace('authority=self', `authority=${did}`);
	assert.ok(config.hasCloseGrant(granted, did));
	assert.ok(!config.hasCloseGrant(granted, 'did:plc:someoneelse'));
	assert.ok(config.hasCloseGrant(config.CLOSE_SCOPE));
});
