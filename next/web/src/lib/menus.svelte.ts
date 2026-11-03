import type { Track } from './api';

/** app-wide sheets, rendered once by the layout. */
class Menus {
	track = $state<Track | null>(null);
	addTo = $state<Track | null>(null);
	nowPlaying = $state(false);
	queue = $state(false);
}

export const menus = new Menus();

export async function share(path: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
	const url = new URL(path, location.origin).toString();
	try {
		if (navigator.share && matchMedia('(pointer: coarse)').matches) {
			await navigator.share({ title, url });
			return 'shared';
		}
		await navigator.clipboard.writeText(url);
		return 'copied';
	} catch {
		return 'failed';
	}
}
