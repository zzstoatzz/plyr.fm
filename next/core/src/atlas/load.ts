import type { AtlasData } from './types.ts';

let cached: { at: number; load: Promise<AtlasData> } | undefined;

export function atlasSummary(data: AtlasData) {
	const tally = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
	return [tally(data.meta.nTracks, 'track'), tally(data.clusters.coarse.length, 'region'), tally(data.clusters.fine.length, 'cluster')].join(' · ');
}

function isAtlas(value: unknown): value is AtlasData {
	if (!value || typeof value !== 'object') return false;
	const data = value as Partial<AtlasData>;
	return Array.isArray(data.points) && Array.isArray(data.artists)
		&& Array.isArray(data.clusters?.coarse) && Array.isArray(data.clusters?.fine)
		&& typeof data.meta?.nTracks === 'number';
}

/** the atlas, kept for an hour; `fetchAtlas` is the client's own `api.atlas` */
export function loadAtlas(fetchAtlas: () => Promise<unknown>) {
	if (cached && Date.now() - cached.at < 3_600_000) return cached.load;
	const load = fetchAtlas().catch(() => { throw new Error('could not load the atlas.'); }).then(data => {
		if (!isAtlas(data)) throw new Error('could not read the atlas.');
		return data;
	});
	cached = { at: Date.now(), load };
	void load.catch(() => { if (cached?.load === load) cached = undefined; });
	return load;
}
