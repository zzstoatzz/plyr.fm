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
	toastId: string;
	eventSource?: EventSource;
	xhr?: XMLHttpRequest;
}

interface UploadProgressCallback {
	onProgress?: (_loaded: number, _total: number) => void;
	onSuccess?: (_uploadId: string) => void;
	onError?: (_error: string) => void;
}

// global upload manager using Svelte 5 runes
class UploaderState {
	activeUploads = $state<Map<string, UploadTask>>(new Map());

	upload(
		file: File,
		title: string,
		album: string,
		features: FeaturedArtist[],
		image?: File | null,
		onSuccess?: () => void,
		callbacks?: UploadProgressCallback
	): void {
		const taskId = crypto.randomUUID();
		const fileSizeMB = file.size / 1024 / 1024;
		const uploadMessage = fileSizeMB > 10
			? 'uploading track... (large file, this may take a moment)'
			: 'uploading track...';
		const toastId = toast.info(uploadMessage, 30000);

		if (!browser) return;
		const formData = new FormData();
		formData.append('file', file);
		formData.append('title', title);
		if (album) formData.append('album', album);
		if (features.length > 0) {
			const handles = features.map(a => a.handle);
			formData.append('features', JSON.stringify(handles));
		}
		if (image) {
			formData.append('image', image);
		}

		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${API_URL}/tracks/`);
		xhr.withCredentials = true;

		let uploadComplete = false;

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable && !uploadComplete) {
				const percent = Math.round((e.loaded / e.total) * 100);
				const progressMsg = `uploading track... ${percent}%`;
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
						toastId,
						xhr
					};

					this.activeUploads.set(taskId, task);

					const eventSource = new EventSource(`${API_URL}/tracks/uploads/${upload_id}/progress`);
					task.eventSource = eventSource;

					eventSource.onmessage = (event) => {
						const update = JSON.parse(event.data);

						// always show backend processing messages (no percentage)
						if (update.message && update.status === 'processing') {
							toast.update(task.toastId, update.message);
						}

						if (update.status === 'completed') {
							eventSource.close();
							toast.dismiss(task.toastId);
							this.activeUploads.delete(taskId);

							toast.success('track uploaded successfully!');
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
						errorMsg = 'network error: connection failed. check your internet connection and try again';
					} else if (xhr.status >= 500) {
						errorMsg = 'server error: please try again in a moment';
					} else if (xhr.status === 413) {
						errorMsg = 'file too large: please use a smaller file';
					} else if (xhr.status === 408 || xhr.status === 504) {
						errorMsg = 'upload timed out: please try again with a better connection';
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
			const errorMsg = 'network error: connection failed. check your internet connection and try again';
			toast.error(errorMsg);
			if (callbacks?.onError) {
				callbacks.onError(errorMsg);
			}
		});

		xhr.addEventListener('timeout', () => {
			toast.dismiss(toastId);
			const errorMsg = 'upload timed out: please try again with a better connection';
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
