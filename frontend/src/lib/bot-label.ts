import type { AppBskyActorDefs } from '@atproto/api';

export function hasBotLabel(profile: Pick<AppBskyActorDefs.ProfileViewDetailed, 'did' | 'labels'>): boolean {
	return profile.labels?.some((label) =>
		label.src === profile.did &&
		label.uri === `at://${profile.did}/app.bsky.actor.profile/self` &&
		label.val === 'bot' && !label.neg
	) ?? false;
}
