export const AVATAR_TYPES = ['image/png', 'image/jpeg'] as const;
export const MAX_AVATAR_BYTES = 1_000_000;

export interface ProfileRecord {
	$type?: string;
	displayName?: string;
	bio?: string;
	avatar?: string;
	avatarBlob?: unknown;
	createdAt?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

export interface ProfileEdits {
	bio: string;
	/** an avatar URL; ignored when `image` is given */
	avatar?: string;
	/** an uploaded avatar, or null to remove the avatar */
	image?: { blob: unknown; url: string } | null;
}

/** apply edits to the stored record, keeping every field another client wrote. */
export function editedProfile(current: ProfileRecord | null, edits: ProfileEdits, type: string, now: string): ProfileRecord {
	const record: ProfileRecord = { ...(current ?? {}), $type: type, createdAt: current?.createdAt ?? now };
	const bio = edits.bio.trim();
	if (bio) record.bio = bio;
	else delete record.bio;
	if (edits.image) {
		record.avatar = edits.image.url;
		record.avatarBlob = edits.image.blob;
	} else if (edits.image === null) {
		delete record.avatar;
		delete record.avatarBlob;
	} else if (edits.avatar !== undefined) {
		const avatar = edits.avatar.trim();
		if (avatar !== (current?.avatar ?? '')) {
			delete record.avatarBlob;
			if (avatar) record.avatar = avatar;
			else delete record.avatar;
		}
	}
	if (current) record.updatedAt = now;
	return record;
}
