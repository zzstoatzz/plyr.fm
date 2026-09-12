import { describe, expect, it } from 'vitest';
import { defaultPublishing, parsePublishing, publishingSummary } from './publishing';

describe('publishing contract', () => {
	it('describes public listening independently of file access', () => {
		const settings = parsePublishing(
			JSON.stringify({
				access: { listening: 'public', downloads: 'off', visibility: 'public' },
				attach_rights: true
			})
		);
		expect(publishingSummary(settings)).toBe('anyone can listen · downloads off');
	});
	it('rejects old or incomplete settings instead of assuming public', () => {
		expect(() => parsePublishing(JSON.stringify({ visibility: 'private' }))).toThrow();
		expect(() =>
			parsePublishing(JSON.stringify({ access: { listening: 'purchasers' }, attach_rights: false }))
		).toThrow();
	});
	it('creates independent default values', () => {
		const first = defaultPublishing();
		first.access.downloads = 'off';
		expect(defaultPublishing().access.downloads).toBe('open');
	});
});
