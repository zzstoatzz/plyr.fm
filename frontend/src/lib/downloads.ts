import { API_URL, getAtprotofansSupportUrl } from '$lib/config';
import { downloadAsk } from '$lib/download-ask.svelte';
import { toast } from '$lib/toast.svelte';

export interface DownloadAskInfo {
	artistName: string;
	artistDid?: string;
	policy?: string;
	supportUrl?: string | null;
}

function resolveSupportHref(info: DownloadAskInfo): string | null {
	if (!info.supportUrl) return null;
	if (info.supportUrl === 'atprotofans') {
		return info.artistDid ? getAtprotofansSupportUrl(info.artistDid) : null;
	}
	return info.supportUrl;
}

/** run a download, interposing the support-ask modal when the artist's
 * policy requests it. */
function withAsk(info: DownloadAskInfo | null, proceed: () => void): void {
	const href = info && info.policy === 'ask' ? resolveSupportHref(info) : null;
	if (info && href) {
		downloadAsk.open(info.artistName, href, proceed);
	} else {
		proceed();
	}
}

/** entry point for track download buttons/menus. */
export function requestTrackDownload(
	fileId: string,
	ask: DownloadAskInfo | null = null
): void {
	withAsk(ask, () => void downloadTrack(fileId));
}

/** entry point for album download buttons. */
export function requestAlbumDownload(
	handle: string,
	slug: string,
	ask: DownloadAskInfo | null = null
): void {
	withAsk(ask, () => void downloadAlbum(handle, slug));
}

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
				// persistent, live-updating toast: a cold build takes a while, and
				// it keeps building server-side even if they navigate away — the
				// next click is a cache hit.
				const toastId = toast.add(
					'preparing album — takes a minute, safe to leave',
					'info',
					0
				);
				const es = new EventSource(`${API_URL}/exports/${data.job_id}/progress`);
				es.onmessage = (event) => {
					const progress = JSON.parse(event.data);
					if (progress.status === 'completed') {
						es.close();
						toast.dismiss(toastId);
						if (progress.download_url) {
							toast.success('album ready');
							window.location.assign(progress.download_url);
						} else {
							toast.error('album download failed');
						}
					} else if (progress.status === 'failed') {
						es.close();
						toast.dismiss(toastId);
						toast.error(progress.error || 'album download failed');
					} else if (progress.message) {
						toast.update(toastId, progress.message);
					}
				};
				es.onerror = () => {
					es.close();
					toast.dismiss(toastId);
					toast.info('still working — try again in a minute', 6000);
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
