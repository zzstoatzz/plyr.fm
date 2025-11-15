export const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:8001';

interface ServerConfig {
	max_upload_size_mb: number;
	max_image_size_mb: number;
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
