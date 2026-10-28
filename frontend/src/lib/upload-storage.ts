import type { PublishingDefaults } from './publishing';

export function needsProtectedAudio(publishing: PublishingDefaults): boolean {
	return (
		publishing.access.listening !== 'public' ||
		publishing.access.downloads === 'off' ||
		publishing.access.downloads === 'supporters'
	);
}

export function needsPlyrStorageAcceptance(
	publishing: PublishingDefaults,
	spacesSupported: boolean
): boolean {
	return (
		publishing.access.visibility !== 'private' &&
		needsProtectedAudio(publishing) &&
		!spacesSupported
	);
}

export function needsSpacesApproval(
	publishing: PublishingDefaults,
	spacesSupported: boolean,
	spacesGranted: boolean
): boolean {
	return (
		!spacesGranted &&
		(publishing.access.visibility === 'private' ||
			(spacesSupported && needsProtectedAudio(publishing)))
	);
}
