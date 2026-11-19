import { createModerationClient, type ModerationClient } from '@plyr/next-core/moderation';
import type { Agent } from '@plyr/next-core/auth-state';
import { apiOrigin } from '$lib/api';
import { authConfig } from '$lib/auth-config';

/** Who sees the review queue; the server checks again on every call. */
const moderators = new Set((import.meta.env.PUBLIC_MODERATOR_DIDS || 'did:plc:xbtmt2zjwlrfegqvch7fboei').split(',').map((value: string) => value.trim()).filter(Boolean));
export function isModerator(did: string | null): boolean { return !!did && moderators.has(did); }

const clients = new WeakMap<Agent, ModerationClient>();
export function moderation(agent: Agent): ModerationClient {
	let client = clients.get(agent);
	if (!client) clients.set(agent, client = createModerationClient(agent, { apiOrigin, audience: authConfig.MODERATION_AUDIENCE, methods: authConfig.MODERATION_METHODS }));
	return client;
}
