import { describe, expect, it } from 'vitest';
import { hasBotLabel } from './bot-label';

const did = 'did:plc:musician';
const label = { src: did, uri: `at://${did}/app.bsky.actor.profile/self`, val: 'bot', cts: '2026-09-06T00:00:00Z' };

describe('creator bot labels', () => {
	it('recognizes the standard profile self-label', () => {
		expect(hasBotLabel({ did, labels: [label] })).toBe(true);
	});
	it('ignores third-party, negated, and unrelated record labels', () => {
		for (const changed of [{ ...label, src: 'did:plc:other' }, { ...label, neg: true }, { ...label, uri: `at://${did}/app.bsky.feed.post/123` }]) {
			expect(hasBotLabel({ did, labels: [changed] })).toBe(false);
		}
	});
	it('does not infer automation from a name or a missing label', () => {
		expect(hasBotLabel({ did })).toBe(false);
	});
});
