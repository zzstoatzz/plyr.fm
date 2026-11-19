import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthConfig } from '../src/auth-config.ts';
import { oauthMetadata } from '../src/oauth-metadata.ts';
import { createModerationClient, ModerationError } from '../src/moderation.ts';

const config = createAuthConfig();
const moderation = { apiOrigin: 'https://api.example', audience: config.MODERATION_AUDIENCE, methods: config.MODERATION_METHODS };

function harness(answer: (url: string, init: RequestInit) => Response, grant = true) {
	const asked: string[] = [];
	const sent: { url: string; init: RequestInit }[] = [];
	const agent = { handle: async (path: string) => { asked.push(path); return grant ? Response.json({ token: 'jwt' }) : new Response('', { status: 400 }); } };
	const original = globalThis.fetch;
	globalThis.fetch = (async (url: string, init: RequestInit) => { sent.push({ url, init }); return answer(url, init); }) as typeof fetch;
	return { client: createModerationClient(agent, moderation), asked, sent, restore: () => { globalThis.fetch = original; } };
}

test('listeners are asked only to report; moderator grants are allowed but added later', () => {
	const asked = config.SCOPE_PARTS.join(' ');
	assert.equal(config.hasReportGrant(asked), true);
	assert.equal(config.hasModeratorGrant(asked), false);
	assert.equal(config.hasReportGrant(config.BASE_SCOPE_PARTS.join(' ')), false);
	const allowed = oauthMetadata(config, 'native').scope;
	for (const method of Object.values(config.MODERATION_METHODS)) assert.ok(allowed.includes(`rpc:${method}?aud=did:web:api.next.plyr.fm#plyr_appview`), method);
	assert.equal(config.hasModeratorGrant([asked, ...config.MODERATOR_SCOPE_PARTS].join(' ')), true);
});

test('a report is signed for createReport and sends only what the listener wrote', async () => {
	const { client, asked, sent, restore } = harness(() => Response.json({}));
	try {
		await client.report('at://did:plc:a/fm.plyr.track/1', 'copyright', '  this is my song  ');
		await client.report('at://did:plc:a/fm.plyr.track/1', 'spam', '   ');
	} finally { restore(); }
	assert.match(asked[0], /lxm=fm\.plyr\.moderation\.createReport/);
	assert.match(asked[0], /aud=did%3Aweb%3Aapi\.next\.plyr\.fm%23plyr_appview/);
	assert.equal(sent[0].url, 'https://api.example/xrpc/fm.plyr.moderation.createReport');
	assert.equal((sent[0].init.headers as Record<string, string>).authorization, 'Bearer jwt');
	assert.deepEqual(JSON.parse(String(sent[0].init.body)), { subject: 'at://did:plc:a/fm.plyr.track/1', reasonType: 'copyright', reason: 'this is my song' });
	assert.deepEqual(JSON.parse(String(sent[1].init.body)), { subject: 'at://did:plc:a/fm.plyr.track/1', reasonType: 'spam' });
});

test('server errors come back in plain words with their code', async () => {
	const { client, restore } = harness(() => Response.json({ error: 'RateLimitExceeded', message: 'x' }, { status: 429 }));
	try {
		await assert.rejects(client.report('did:plc:a', 'spam', ''), (error: unknown) => error instanceof ModerationError && error.code === 'RateLimitExceeded' && /try again in a while/.test(error.message));
	} finally { restore(); }
	const missing = harness(() => Response.json({}), false);
	try {
		await assert.rejects(missing.client.report('did:plc:a', 'spam', ''), (error: unknown) => error instanceof ModerationError && error.code === 'GrantRequired');
		assert.equal(missing.sent.length, 0);
	} finally { missing.restore(); }
});

test('queue pages and decisions use their own methods', async () => {
	const { client, asked, sent, restore } = harness(url => url.includes('getQueue')
		? Response.json({ items: [{ cursor: 4, subject: 'at://x', openedAt: 1, openCount: 2, reasonTypes: ['spam'], trackTitle: 't', trackOwner: 'did:plc:a', decision: null }], cursor: '4' })
		: Response.json({ id: 9 }));
	try {
		const page = await client.queue('3');
		assert.equal(page.cursor, '4');
		assert.equal(page.items[0].openCount, 2);
		await client.decide('at://x', 'label_applied', { value: 'sexual', reason: ' explicit cover ' });
	} finally { restore(); }
	assert.equal(sent[0].url, 'https://api.example/xrpc/fm.plyr.moderation.getQueue?cursor=3');
	assert.match(asked[1], /lxm=fm\.plyr\.moderation\.emitEvent/);
	assert.deepEqual(JSON.parse(String(sent[1].init.body)), { subject: 'at://x', action: 'label_applied', reason: 'explicit cover', value: 'sexual' });
});
