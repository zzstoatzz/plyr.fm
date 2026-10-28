import { describe, expect, it } from 'vitest';
import { defaultPublishing, type PublishingDefaults } from './publishing';
import { needsPlyrStorageAcceptance, needsSpacesApproval } from './upload-storage';

describe('upload storage consent', () => {
	it.each(['off', 'supporters'] as const)(
		'requires explicit storage acceptance for %s downloads without Spaces',
		(downloads) => {
			const publishing = {
				...defaultPublishing(),
				access: { listening: 'public', downloads, visibility: 'public' }
			} satisfies PublishingDefaults;
			expect(needsPlyrStorageAcceptance(publishing, false)).toBe(true);
			expect(needsPlyrStorageAcceptance(publishing, true)).toBe(false);
			expect(needsSpacesApproval(publishing, true, false)).toBe(true);
			expect(needsSpacesApproval(publishing, true, true)).toBe(false);
		}
	);

	it('keeps ordinary public uploads independent of Spaces', () => {
		expect(needsPlyrStorageAcceptance(defaultPublishing(), false)).toBe(false);
		expect(needsSpacesApproval(defaultPublishing(), true, false)).toBe(false);
	});

	it('does not substitute plyr storage for private Space membership', () => {
		const publishing = {
			...defaultPublishing(),
			access: { listening: 'space', downloads: 'off', visibility: 'private' }
		} satisfies PublishingDefaults;
		expect(needsPlyrStorageAcceptance(publishing, false)).toBe(false);
		expect(needsSpacesApproval(publishing, false, false)).toBe(true);
	});

	it('requires consent for restricted listening even with downloads allowed', () => {
		const publishing = {
			...defaultPublishing(),
			access: { listening: 'signed_in', downloads: 'open', visibility: 'unlisted' }
		} satisfies PublishingDefaults;
		expect(needsPlyrStorageAcceptance(publishing, false)).toBe(true);
		expect(needsSpacesApproval(publishing, true, false)).toBe(true);
	});
});
