import { PUBLIC_API_URL } from '$env/static/public';

export const API_URL = PUBLIC_API_URL || 'http://localhost:8001';

export const PDS_AUDIO_UPLOADS_FLAG = 'pds-audio-uploads';
export const VIBE_SEARCH_FLAG = 'vibe-search';

/**
 * generate atprotofans support URL for an artist.
 * canonical format: https://atprotofans.com/support/{did}
 */
export function getAtprotofansSupportUrl(did: string): string {
	return `https://atprotofans.com/support/${did}`;
}

interface ServerConfig {
	max_upload_size_mb: number;
	max_image_size_mb: number;
	default_hidden_tags: string[];
	bufo_exclude_patterns: string[];
	bufo_include_patterns: string[];
	contact_email: string;
	privacy_email: string;
	dmca_email: string;
	dmca_registration_number: string;
	terms_last_updated: string;
}

let serverConfig: ServerConfig | null = null;

export async function getServerConfig(): Promise<ServerConfig> {
	if (serverConfig !== null) {
		return serverConfig;
	}

	const response = await fetch(`${API_URL}/config`);
	if (!response.ok) {
		throw new Error('failed to fetch server config');
	}

	const config: ServerConfig = await response.json();
	serverConfig = config;
	return config;
}
