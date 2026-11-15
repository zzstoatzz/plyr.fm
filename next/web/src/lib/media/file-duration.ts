export async function fileDuration(file: Blob): Promise<number | undefined> {
	const url = URL.createObjectURL(file);
	try { return await audioDuration(url); }
	finally { URL.revokeObjectURL(url); }
}

export async function audioDuration(url: string): Promise<number | undefined> {
	const audio = document.createElement('audio');
	audio.preload = 'metadata';
	try {
		return await new Promise(resolve => {
			const timer = setTimeout(() => resolve(undefined), 2500);
			const finish = (duration?: number) => {
				clearTimeout(timer);
				resolve(duration);
			};
			audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined);
			audio.onerror = () => finish();
			audio.src = url;
		});
	} finally {
		audio.onloadedmetadata = null;
		audio.onerror = null;
		audio.removeAttribute('src');
		audio.load();
	}
}
