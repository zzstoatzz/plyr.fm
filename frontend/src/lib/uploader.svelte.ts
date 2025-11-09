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
		onSuccess?: () => void
	): void {
		const taskId = crypto.randomUUID();
		const fileSizeMB = file.size / 1024 / 1024;
		const uploadMessage = fileSizeMB > 10
			? 'uploading track... (large file, this may take a moment)'
			: 'uploading track...';
		const toastId = toast.info(uploadMessage, 30000); // 30s timeout as safety

		const sessionId = localStorage.getItem('session_id');
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

		// start upload (returns immediately with upload_id)
		fetch(`${API_URL}/tracks/`, {
			method: 'POST',
			body: formData,
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		})
			.then(async (response) => {
				if (!response.ok) {
					toast.dismiss(toastId);
					const error = await response.json();
					const errorMsg = error.detail || `upload failed (${response.status} ${response.statusText})`;
					toast.error(errorMsg);
					return;
				}

				const result = await response.json();
				const upload_id = result.upload_id;

				// create task with upload_id
				const task: UploadTask = {
					id: taskId,
					upload_id,
					file,
					title,
					album,
					features,
					toastId
				};

				this.activeUploads.set(taskId, task);

				// listen for progress via SSE
				const eventSource = new EventSource(`${API_URL}/tracks/uploads/${upload_id}/progress`);
				task.eventSource = eventSource;

				eventSource.onmessage = (event) => {
					const update = JSON.parse(event.data);

					// update toast with current status
					if (update.message && update.status === 'processing') {
						toast.update(task.toastId, update.message);
					}

					// handle completion
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

					// handle failure
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
			})
			.catch((e) => {
				toast.dismiss(toastId);
				const errorMsg = `network error: ${e instanceof Error ? e.message : 'unknown error'}`;
				toast.error(errorMsg);
			});
	}
}

export const uploader = new UploaderState();
