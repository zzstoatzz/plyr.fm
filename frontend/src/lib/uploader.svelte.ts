import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { auth } from './auth.svelte';
import { API_URL } from './config';
import { toast } from './toast.svelte';
import { tracksCache } from './tracks.svelte';
import type { FeaturedArtist } from './types';
import type { TrackRights } from './components/CopyrightRightsPanel.svelte';
import { setReturnUrl } from './utils/return-url';
import { finishUploadSession, UploadPartError, UploadSessionHttpError } from './upload-session';
import { sessionTransport, StagedTransfer, type StagedTransport } from './staged-transfer.svelte';

interface UploadTask {
	id: string;
	upload_id: string;
	file: File;
	title: string;
	album?: string;
	features?: FeaturedArtist[];
	tags?: string[];
	toastId: string;
	eventSource?: EventSource;
	xhr?: XMLHttpRequest;
	abort?: { abort(): void };
}

interface UploadProgressCallback {
	onProgress?: (_loaded: number, _total: number) => void;
	onSuccess?: (_uploadId: string) => void;
	onError?: (_error: string) => void;
}

/** one SSE frame from `/tracks/uploads/{id}/progress` */
interface UploadProgressUpdate {
	status?: 'processing' | 'completed' | 'failed';
	message?: string;
	server_progress_pct?: number | null;
	track_id?: number | null;
	atproto_uri?: string | null;
	atproto_cid?: string | null;
	warnings?: string[];
	pds_blob_failed?: boolean;
	error?: string;
}

export interface UploadResult {
	trackId: number;
	atprotoUri: string | null;
	atprotoCid: string | null;
}

function isMobileDevice(): boolean {
	if (!browser) return false;
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

const MOBILE_LARGE_FILE_THRESHOLD_MB = 50;

/**
 * Start the one-time OAuth scope upgrade that grants the permissioned-space
 * (private media) scope, then redirect to the authorization URL. After the user
 * returns, they retry the upload with the scope granted.
 */
export async function startPermissionedScopeUpgrade(): Promise<void> {
	toast.info('approving private media — your draft is saved', 6000);
	try {
		const res = await fetch(`${API_URL}/auth/scope-upgrade/start`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			// include_teal:false → the backend re-derives existing scopes from the
			// current session and only ADDS permissioned (doesn't force teal on).
			body: JSON.stringify({ include_teal: false, include_permissioned: true })
		});
		if (!res.ok) {
			// the PDS refused the permission set at PAR — it doesn't do spaces.
			// the backend has recorded that, so refreshing auth stops offering it.
			const detail = await res.json().catch(() => null);
			if (detail?.detail === 'spaces_refused') {
				toast.error("your PDS refused private media", 8000);
				await auth.refresh();
				return;
			}
			throw new Error(`scope upgrade failed (${res.status})`);
		}
		const data = await res.json();
		// preserve intent across the consent redirect via the same plyr_return_to
		// cookie jams/login use — the scope-upgrade lands on /settings, which
		// consumes it and bounces back to /upload (the stashed draft restores there).
		setReturnUrl('/upload');
		if (browser && data.auth_url) window.location.href = data.auth_url;
	} catch {
		toast.error('could not start the approval needed for private media');
	}
}

function buildNetworkErrorMessage(progressPercent: number, fileSizeMB: number, isMobile: boolean): string {
	const progressInfo = progressPercent > 0 ? ` (failed at ${progressPercent}%)` : '';

	if (isMobile && fileSizeMB > MOBILE_LARGE_FILE_THRESHOLD_MB) {
		return `upload failed${progressInfo}: large files often fail on mobile networks. try uploading from a desktop or use WiFi`;
	}

	if (progressPercent > 0 && progressPercent < 100) {
		return `upload failed${progressInfo}: connection was interrupted. check your network and try again`;
	}

	// at 100% the file finished uploading — the failure is on the server while it
	// processes the file, so don't blame the user's connection.
	if (progressPercent >= 100) {
		return `upload failed${progressInfo}: the server had trouble processing your file. please try again in a moment`;
	}

	return `upload failed before sending — try re-selecting the file`;
}

function buildTimeoutErrorMessage(progressPercent: number, fileSizeMB: number, isMobile: boolean): string {
	const progressInfo = progressPercent > 0 ? ` (stopped at ${progressPercent}%)` : '';

	if (isMobile) {
		return `upload timed out${progressInfo}: mobile uploads can be slow. try WiFi or a desktop browser`;
	}

	if (fileSizeMB > 100) {
		return `upload timed out${progressInfo}: large file (${Math.round(fileSizeMB)}MB) - try a faster connection`;
	}

	return `upload timed out${progressInfo}: try again with a better connection`;
}

type UploadFailure = UploadSessionHttpError | UploadPartError | Error;

/** a transfer the server refused for want of a session; submit's preflight owns the sign-in bounce. */
function sessionExpired(error: UploadFailure): boolean {
	if (error instanceof UploadSessionHttpError) return error.status === 401;
	return error instanceof UploadPartError && error.failure.kind === 'http' && error.failure.status === 401;
}

/**
 * map a session-upload failure to toast copy. returns null when the failure
 * was handled by a redirect (scope upgrade, sign-in) and no toast is due.
 */

function describeUploadFailure(
	error: UploadFailure,
	progressPercent: number,
	fileSizeMB: number,
	isMobile: boolean
): string | null {
	if (error instanceof UploadSessionHttpError) {
		if (error.status === 403 && error.detail === 'permissioned_scope_required') {
			void startPermissionedScopeUpgrade();
			return null;
		}
		if (error.status === 401 && error.detail === 'session_expired') {
			toast.error('your session expired — sign in to finish your upload');
			setReturnUrl('/upload');
			if (browser) void goto('/login');
			return null;
		}
		if (error.status === 413) return 'file too large: please use a smaller file';
		if (error.status === 409) return 'upload incomplete — try again';
		if (error.status >= 500) return 'server error: please try again in a moment';
		return error.detail ?? `upload failed (${error.status})`;
	}
	if (error instanceof UploadPartError) {
		const failure = error.failure;
		if (failure.kind === 'timeout') return buildTimeoutErrorMessage(progressPercent, fileSizeMB, isMobile);
		if (failure.kind === 'network') return buildNetworkErrorMessage(progressPercent, fileSizeMB, isMobile);
		if (failure.status === 401) {
			toast.error('your session expired — sign in to finish your upload');
			setReturnUrl('/upload');
			if (browser) void goto('/login');
			return null;
		}
		if (failure.status === 413) return 'file too large: please use a smaller file';
		if (failure.status >= 500) return 'server error: please try again in a moment';
		return failure.detail ?? `upload failed (${failure.status})`;
	}
	return 'upload failed — try again';
}

// global upload manager using Svelte 5 runes
class UploaderState {
	activeUploads = $state<Map<string, UploadTask>>(new Map());

	/**
	 * start moving a file into staging as observable state. `upload()` takes the
	 * result to finish; an unclaimed transfer is the caller's to abort.
	 */
	stage(file: File, transport: StagedTransport = sessionTransport): StagedTransfer {
		const fileSizeMB = file.size / 1024 / 1024;
		const isMobile = isMobileDevice();
		if (isMobile && fileSizeMB > MOBILE_LARGE_FILE_THRESHOLD_MB) {
			toast.info(`uploading ${Math.round(fileSizeMB)}MB file on mobile - ensure stable connection`, 5000);
		}
		return new StagedTransfer(file, transport, (failure, percent) =>
			sessionExpired(failure)
				? 'your session expired — sign in to finish your upload'
				: describeUploadFailure(failure, percent, fileSizeMB, isMobile)
		);
	}

	upload(
		source: File | StagedTransfer,
		title: string,
		album: string,
		features: FeaturedArtist[],
		image: File | null | undefined,
		tags: string[],
		visibility: string,
		autoTag: boolean,
		description: string,
		onSuccess?: (_result?: UploadResult) => void,
		callbacks?: UploadProgressCallback,
		label?: string,
		albumId?: string,
		copyright?: TrackRights | null,
		selfLabels: string[] = []
	): void {
		if (!browser) return;
		const staged = source instanceof StagedTransfer ? source : this.stage(source);
		staged.claimed = true;
		const file = staged.file;
		const taskId = crypto.randomUUID();
		const fileSizeMB = file.size / 1024 / 1024;
		const isMobile = isMobileDevice();
		const displayName = label ?? title;

		const uploadMessage = fileSizeMB > 10
			? `uploading "${displayName}"... (large file)`
			: `uploading "${displayName}"...`;
		// 0 means infinite/persist until dismissed
		const toastId = toast.info(uploadMessage, 0);

		const formData = new FormData();
		formData.append('title', title);
		if (albumId) {
			formData.append('album_id', albumId);
		} else if (album) {
			formData.append('album', album);
		}
		if (features.length > 0) {
			const handles = features.map(a => a.handle);
			formData.append('features', JSON.stringify(handles));
		}
		if (tags.length > 0) {
			formData.append('tags', JSON.stringify(tags));
		}
		if (image) {
			formData.append('image', image);
		}
		// visibility is the single source of truth (public | unlisted | supporters
		// | private); copyright is orthogonal (rides on public/unlisted).
		formData.append('visibility', visibility);
		if (copyright) {
			formData.append('copyright', JSON.stringify(copyright));
		}
		if (autoTag) {
			formData.append('auto_tag', 'true');
		}
		if (description) {
			formData.append('description', description);
		}
		if (selfLabels.length > 0) {
			formData.append('self_labels', JSON.stringify(selfLabels));
		}

		const task: UploadTask = {
			id: taskId,
			upload_id: staged.uploadId ?? '',
			file,
			title,
			album,
			features,
			tags,
			toastId,
			abort: staged
		};
		this.activeUploads.set(taskId, task);

		const fail = (message: string) => {
			toast.dismiss(toastId);
			this.activeUploads.delete(taskId);
			toast.error(message);
			callbacks?.onError?.(message);
		};

		const showTransfer = (loaded: number, total: number) => {
			toast.update(toastId, `retrieving your file... ${Math.round((loaded / total) * 100)}%`);
			callbacks?.onProgress?.(loaded, total);
		};
		staged.onProgress = showTransfer;
		if (staged.status === 'transferring') showTransfer(staged.loaded, staged.total);

		void (async () => {
			try {
				const sessionId = await staged.whenTransferred();
				task.upload_id = sessionId;
				toast.update(toastId, 'finishing up…');
				const upload_id = await finishUploadSession(sessionId, formData);
				task.upload_id = upload_id;
				callbacks?.onSuccess?.(upload_id);
				this.followProcessing(task, displayName, onSuccess);
			} catch (error) {
				const failure: UploadFailure = error instanceof Error ? error : new Error(String(error));
				const message = describeUploadFailure(failure, staged.progressPercent, fileSizeMB, isMobile);
				if (message === null) {
					toast.dismiss(toastId);
					this.activeUploads.delete(taskId);
					return;
				}
				fail(message);
			}
		})();
	}

	/** subscribe to the worker's SSE progress once the transfer is done. */
	private followProcessing(
		task: UploadTask,
		displayName: string,
		onSuccess?: (_result?: UploadResult) => void
	): void {
		const eventSource = new EventSource(`${API_URL}/tracks/uploads/${task.upload_id}/progress`);
		task.eventSource = eventSource;

		eventSource.onmessage = (event) => {
			const update: UploadProgressUpdate = JSON.parse(event.data);

			if (update.message && update.status === 'processing') {
				const serverProgress = update.server_progress_pct;
				if (serverProgress !== undefined && serverProgress !== null && serverProgress > 0) {
					toast.update(task.toastId, `${update.message} (${Math.round(serverProgress)}%)`);
				} else {
					toast.update(task.toastId, update.message);
				}
			}

			if (update.status === 'completed') {
				eventSource.close();
				toast.dismiss(task.toastId);
				this.activeUploads.delete(task.id);

				const trackId = update.track_id ?? null;
				toast.success(`"${displayName}" uploaded`, 5000, trackId ? {
					label: 'view track',
					href: `/track/${trackId}`
				} : undefined);

				const warnings: string[] = update.warnings ?? [];
				const warningAction = update.pds_blob_failed
					? { label: 'save to your PDS', href: '/portal/manage?save=pds' }
					: undefined;
				for (const w of warnings) {
					toast.warning(w, 0, warningAction);
				}

				tracksCache.invalidate();
				tracksCache.fetch(true);
				if (onSuccess) {
					onSuccess(
						trackId !== null
							? {
									trackId,
									atprotoUri: update.atproto_uri ?? null,
									atprotoCid: update.atproto_cid ?? null
								}
							: undefined
					);
				}
			}

			if (update.status === 'failed') {
				eventSource.close();
				toast.dismiss(task.toastId);
				this.activeUploads.delete(task.id);
				toast.error(update.error || 'upload failed');
			}
		};

		eventSource.onerror = () => {
			eventSource.close();
			toast.dismiss(task.toastId);
			this.activeUploads.delete(task.id);
			toast.error('lost connection to server');
		};
	}

	/**
	 * Replace the audio bytes for an existing track via PUT /tracks/{id}/audio.
	 *
	 * Mirrors the upload() flow (XHR upload → SSE progress) but:
	 * - PUTs to a track-specific endpoint instead of POSTing
	 * - Sends only the file (no metadata — the track keeps its title, tags, etc.)
	 * - On completion, calls onComplete with the new file_id so the caller can
	 *   refresh local caches and the player.
	 */
	replaceAudio(
		trackId: number,
		file: File,
		title: string,
		onComplete?: (_result: { trackId: number; atprotoCid: string | null }) => void
	): void {
		if (!browser) return;

		const taskId = crypto.randomUUID();
		const fileSizeMB = file.size / 1024 / 1024;
		const isMobile = isMobileDevice();

		if (isMobile && fileSizeMB > MOBILE_LARGE_FILE_THRESHOLD_MB) {
			toast.info(`replacing audio: ${Math.round(fileSizeMB)}MB on mobile - ensure stable connection`, 5000);
		}

		const startMessage = fileSizeMB > 10
			? `replacing audio for "${title}"... (large file)`
			: `replacing audio for "${title}"...`;
		const toastId = toast.info(startMessage, 0);

		let lastProgressPercent = 0;
		const formData = new FormData();
		formData.append('file', file);

		const xhr = new XMLHttpRequest();
		xhr.open('PUT', `${API_URL}/tracks/${trackId}/audio`);
		xhr.withCredentials = true;

		let uploadComplete = false;

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable && !uploadComplete) {
				const percent = Math.round((e.loaded / e.total) * 100);
				lastProgressPercent = percent;
				toast.update(toastId, `uploading new audio... ${percent}%`);
			}
		});

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					uploadComplete = true;
					const result = JSON.parse(xhr.responseText);
					const upload_id = result.upload_id;

					const task: UploadTask = {
						id: taskId,
						upload_id,
						file,
						title,
						toastId,
						xhr
					};
					this.activeUploads.set(taskId, task);

					const eventSource = new EventSource(`${API_URL}/tracks/uploads/${upload_id}/progress`);
					task.eventSource = eventSource;

					eventSource.onmessage = (event) => {
						const update: UploadProgressUpdate = JSON.parse(event.data);

						if (update.message && update.status === 'processing') {
							const serverProgress = update.server_progress_pct;
							if (serverProgress !== undefined && serverProgress !== null && serverProgress > 0) {
								toast.update(task.toastId, `${update.message} (${Math.round(serverProgress)}%)`);
							} else {
								toast.update(task.toastId, update.message);
							}
						}

						if (update.status === 'completed') {
							eventSource.close();
							toast.dismiss(task.toastId);
							this.activeUploads.delete(taskId);

							toast.success(`audio for "${title}" replaced`, 5000);
							tracksCache.invalidate();
							tracksCache.fetch(true);

							onComplete?.({
								trackId,
								atprotoCid: update.atproto_cid ?? null
							});
						}

						if (update.status === 'failed') {
							eventSource.close();
							toast.dismiss(task.toastId);
							this.activeUploads.delete(taskId);
							toast.error(update.error || 'audio replace failed');
						}
					};

					eventSource.onerror = () => {
						eventSource.close();
						toast.dismiss(task.toastId);
						this.activeUploads.delete(taskId);
						toast.error('lost connection during audio replace');
					};
				} catch {
					toast.dismiss(toastId);
					toast.error('failed to parse server response');
				}
			} else {
				toast.dismiss(toastId);
				let errorMsg = `audio replace failed (${xhr.status} ${xhr.statusText})`;
				try {
					const error = JSON.parse(xhr.responseText);
					errorMsg = error.detail || errorMsg;
				} catch {
					if (xhr.status === 0) {
						errorMsg = buildNetworkErrorMessage(lastProgressPercent, fileSizeMB, isMobile);
					} else if (xhr.status === 413) {
						errorMsg = 'file too large: please use a smaller file';
					} else if (xhr.status === 403) {
						errorMsg = "you can only replace audio on your own tracks";
					} else if (xhr.status === 404) {
						errorMsg = 'track not found';
					} else if (xhr.status >= 500) {
						errorMsg = 'server error: please try again in a moment';
					}
				}
				toast.error(errorMsg);
			}
		});

		xhr.addEventListener('error', () => {
			toast.dismiss(toastId);
			toast.error(buildNetworkErrorMessage(lastProgressPercent, fileSizeMB, isMobile));
		});

		xhr.addEventListener('timeout', () => {
			toast.dismiss(toastId);
			toast.error(buildTimeoutErrorMessage(lastProgressPercent, fileSizeMB, isMobile));
		});

		xhr.timeout = 300000;
		xhr.send(formData);
	}
}

export const uploader = new UploaderState();
