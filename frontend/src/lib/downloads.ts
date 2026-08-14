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

/**
 * download an album zip. a cached zip redirects immediately; otherwise the
 * backend builds it on the worker and we follow the job's SSE progress
 * until the download URL is ready.
 */
export async function downloadAlbum(handle: string, slug: string): Promise<void> {
	const url = `${API_URL}/albums/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/download`;
	try {
		const res = await fetch(url, { credentials: 'include', redirect: 'manual' });
		if (res.type === 'opaqueredirect') {
			window.location.assign(url);
			return;
		}
		if (res.ok) {
			const data = await res.json();
			if (data.job_id) {
				toast.info('preparing album download...');
				const es = new EventSource(`${API_URL}/exports/${data.job_id}/progress`);
				es.onmessage = (event) => {
					const progress = JSON.parse(event.data);
					if (progress.status === 'completed') {
						es.close();
						if (progress.download_url) {
							window.location.assign(progress.download_url);
						} else {
							toast.error('album download failed');
						}
					} else if (progress.status === 'failed') {
						es.close();
						toast.error(progress.error || 'album download failed');
					}
				};
				es.onerror = () => {
					es.close();
					toast.error('album download failed');
				};
				return;
			}
		}
		const data = await res.json().catch(() => ({}));
		toast.error(data.detail || 'download unavailable');
	} catch {
		toast.error('download failed');
	}
}
