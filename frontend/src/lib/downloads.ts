import { API_URL } from '$lib/config';
import { toast } from '$lib/toast.svelte';

/**
 * trigger a file download of a track's audio via the backend download
 * endpoint, which redirects to a presigned URL with an attachment
 * disposition. probes first (without following the redirect) so a refusal
 * surfaces as a toast instead of navigating to a JSON error body.
 */
export async function downloadTrack(fileId: string): Promise<void> {
	const url = `${API_URL}/audio/${fileId}/download`;
	try {
		const probe = await fetch(url, { credentials: 'include', redirect: 'manual' });
		if (probe.type === 'opaqueredirect' || probe.ok) {
			window.location.assign(url);
			return;
		}
		const data = await probe.json().catch(() => ({}));
		toast.error(data.detail || 'download unavailable');
	} catch {
		toast.error('download failed');
	}
}
