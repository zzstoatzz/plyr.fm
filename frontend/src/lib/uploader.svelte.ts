import { browser } from '$app/environment';
import { API_URL } from './config';
import { toast } from './toast.svelte';
import { tracksCache } from './tracks.svelte';
import type { FeaturedArtist } from './types';

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
}

interface UploadProgressCallback {
	onProgress?: (_loaded: number, _total: number) => void;
	onSuccess?: (_uploadId: string) => void;
	onError?: (_error: string) => void;
}

function isMobileDevice(): boolean {
	if (!browser) return false;
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

const MOBILE_LARGE_FILE_THRESHOLD_MB = 50;

function buildNetworkErrorMessage(progressPercent: number, fileSizeMB: number, isMobile: boolean): string {
	const progressInfo = progressPercent > 0 ? ` (failed at ${progressPercent}%)` : '';

	if (isMobile && fileSizeMB > MOBILE_LARGE_FILE_THRESHOLD_MB) {
		return `upload failed${progressInfo}: large files often fail on mobile networks. try uploading from a desktop or use WiFi`;
	}

	if (progressPercent > 0 && progressPercent < 100) {
		return `upload failed${progressInfo}: connection was interrupted. check your network and try again`;
	}

	return `upload failed${progressInfo}: connection failed. check your internet connection and try again`;
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

// global upload manager using Svelte 5 runes
class UploaderState {
	activeUploads = $state<Map<string, UploadTask>>(new Map());

	upload(
		file: File,
		title: string,
		album: string,
		features: FeaturedArtist[],
		image: File | null | undefined,
		tags: string[],
		supportGated: boolean,
		onSuccess?: () => void,
		callbacks?: UploadProgressCallback
	): void {
		const taskId = crypto.randomUUID();
		const fileSizeMB = file.size / 1024 / 1024;
		const isMobile = isMobileDevice();

		// warn about large files on mobile
		if (isMobile && fileSizeMB > MOBILE_LARGE_FILE_THRESHOLD_MB) {
			toast.info(`uploading ${Math.round(fileSizeMB)}MB file on mobile - ensure stable connection`, 5000);
		}

		const uploadMessage = fileSizeMB > 10
			? 'uploading track... (large file, this may take a moment)'
			: 'uploading track...';
		// 0 means infinite/persist until dismissed
		const toastId = toast.info(uploadMessage, 0);

		// track upload progress for error messages
		let lastProgressPercent = 0;

		if (!browser) return;
		const formData = new FormData();
		formData.append('file', file);
		formData.append('title', title);
		if (album) formData.append('album', album);
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
		if (supportGated) {
			formData.append('support_gate', JSON.stringify({ type: 'any' }));
		}

		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${API_URL}/tracks/`);
		xhr.withCredentials = true;

		let uploadComplete = false;

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable && !uploadComplete) {
				const percent = Math.round((e.loaded / e.total) * 100);
				lastProgressPercent = percent;
				const progressMsg = `retrieving your file... ${percent}%`;
				toast.update(toastId, progressMsg);
				if (callbacks?.onProgress) {
					callbacks.onProgress(e.loaded, e.total);
				}
			}
		});

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					uploadComplete = true;
					const result = JSON.parse(xhr.responseText);
					const upload_id = result.upload_id;

					if (callbacks?.onSuccess) {
						callbacks.onSuccess(upload_id);
					}

					const task: UploadTask = {
						id: taskId,
						upload_id,
						file,
						title,
						album,
						features,
						tags,
						toastId,
						xhr
					};

					this.activeUploads.set(taskId, task);

					const eventSource = new EventSource(`${API_URL}/tracks/uploads/${upload_id}/progress`);
					task.eventSource = eventSource;

					eventSource.onmessage = (event) => {
						const update = JSON.parse(event.data);

						// show backend processing messages
						if (update.message && update.status === 'processing') {
							// if we have meaningful server-side progress, show it
							// (skip 0% as it looks wrong during phase transitions)
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

							const trackId = update.track_id;
							toast.success('track uploaded successfully!', 5000, trackId ? {
								label: 'view track',
								href: `/track/${trackId}`
							} : undefined);
							tracksCache.invalidate();
							tracksCache.fetch(true);
							if (onSuccess) {
								onSuccess();
							}
						}

						if (update.status === 'failed') {
							eventSource.close();
							toast.dismiss(task.toastId);
							this.activeUploads.delete(taskId);

							const errorMsg = update.error || 'upload failed';
							toast.error(errorMsg);
						}
					};

					eventSource.onerror = () => {
						eventSource.close();
						toast.dismiss(task.toastId);
						this.activeUploads.delete(taskId);
						toast.error('lost connection to server');
					};
				} catch {
					toast.dismiss(toastId);
					toast.error('failed to parse server response');
					if (callbacks?.onError) {
						callbacks.onError('failed to parse server response');
					}
				}
			} else {
				toast.dismiss(toastId);
				let errorMsg = `upload failed (${xhr.status} ${xhr.statusText})`;
				try {
					const error = JSON.parse(xhr.responseText);
					errorMsg = error.detail || errorMsg;
				} catch {
					if (xhr.status === 0) {
						errorMsg = buildNetworkErrorMessage(lastProgressPercent, fileSizeMB, isMobile);
					} else if (xhr.status >= 500) {
						errorMsg = 'server error: please try again in a moment';
					} else if (xhr.status === 413) {
						errorMsg = 'file too large: please use a smaller file';
					} else if (xhr.status === 408 || xhr.status === 504) {
						errorMsg = buildTimeoutErrorMessage(lastProgressPercent, fileSizeMB, isMobile);
					}
				}
				toast.error(errorMsg);
				if (callbacks?.onError) {
					callbacks.onError(errorMsg);
				}
			}
		});

		xhr.addEventListener('error', () => {
			toast.dismiss(toastId);
			const errorMsg = buildNetworkErrorMessage(lastProgressPercent, fileSizeMB, isMobile);
			toast.error(errorMsg);
			if (callbacks?.onError) {
				callbacks.onError(errorMsg);
			}
		});

		xhr.addEventListener('timeout', () => {
			toast.dismiss(toastId);
			const errorMsg = buildTimeoutErrorMessage(lastProgressPercent, fileSizeMB, isMobile);
			toast.error(errorMsg);
			if (callbacks?.onError) {
				callbacks.onError(errorMsg);
			}
		});

		xhr.timeout = 300000;
		xhr.send(formData);
	}
}

export const uploader = new UploaderState();
