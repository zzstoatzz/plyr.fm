import type { AtlasData } from './types';

let cached: { at: number; load: Promise<AtlasData> } | undefined;

function isAtlas(value: unknown): value is AtlasData {
	if (!value || typeof value !== 'object') return false;
	const data = value as Partial<AtlasData>;
	return Array.isArray(data.points) && Array.isArray(data.artists)
		&& Array.isArray(data.clusters?.coarse) && Array.isArray(data.clusters?.fine)
		&& typeof data.meta?.nTracks === 'number';
}

export function loadAtlas() {
	if (cached && Date.now() - cached.at < 3_600_000) return cached.load;
	const load = fetch('https://api.plyr.fm/stats/atlas').then(async response => {
		if (!response.ok) throw new Error('could not load the atlas.');
		const data: unknown = await response.json();
		if (!isAtlas(data)) throw new Error('could not read the atlas.');
		return data;
	});
	cached = { at: Date.now(), load };
	void load.catch(() => { if (cached?.load === load) cached = undefined; });
	return load;
}
