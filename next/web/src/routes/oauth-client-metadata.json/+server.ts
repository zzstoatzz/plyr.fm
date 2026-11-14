import { json } from '@sveltejs/kit';
import { oauthMetadata } from '$core/oauth-metadata';
import { authConfig } from '$lib/auth-config';

export const prerender = true;
export const GET = () => json(oauthMetadata(authConfig, 'web'));
