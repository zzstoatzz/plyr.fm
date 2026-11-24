import type { AtlasData, AtlasPoint } from '@plyr/next-core/atlas/types';

/** One of the atlas's coarse regions: tracks grouped by how they sound. */
export interface Sound {
	id: number;
	label: string;
	tracks: number;
	plays: number;
	/** most played track in the sound */
	top: AtlasPoint;
	/** display names of the artists with the most plays here */
	artists: string[];
}

/** Every sound, most played first. */
export function sounds(data: AtlasData): Sound[] {
	return data.clusters.coarse.flatMap(cluster => {
		const points = data.points.filter(point => point.clusterCoarse === cluster.id);
		if (!points.length) return [];
		const plays = points.reduce((sum, point) => sum + point.plays, 0);
		const byArtist = new Map<string, number>();
		for (const point of points) byArtist.set(point.artist, (byArtist.get(point.artist) ?? 0) + point.plays);
		return [{
			id: cluster.id,
			label: cluster.label,
			tracks: points.length,
			plays,
			top: points.reduce((best, point) => point.plays > best.plays ? point : best),
			artists: [...byArtist].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
		}];
	}).sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label));
}

/** Plays per track across every mapped track: what a typical track gets. */
export function typicalPlays(data: AtlasData) {
	return data.points.length ? data.points.reduce((sum, point) => sum + point.plays, 0) / data.points.length : 0;
}

/** How a sound's plays per track compare with a typical track's: well above, about the same, or below. */
export function pace(sound: Pick<Sound, 'plays' | 'tracks'>, typical: number): 'above' | 'about' | 'below' {
	const perTrack = sound.tracks ? sound.plays / sound.tracks : 0;
	if (!typical) return 'about';
	return perTrack >= typical * 1.4 ? 'above' : perTrack < typical * 0.75 ? 'below' : 'about';
}

/** The most played sound, and the sizeable sound whose tracks get the most plays each (if it isn't the same one). */
export function soundHeadline(list: Sound[], typical: number) {
	const [top] = list;
	if (!top) return undefined;
	const total = list.reduce((sum, sound) => sum + sound.tracks, 0);
	const perTrack = (sound: Sound) => sound.plays / sound.tracks;
	const standout = list
		.filter(sound => sound !== top && sound.tracks >= total * 0.03 && pace(sound, typical) === 'above')
		.sort((a, b) => perTrack(b) - perTrack(a))[0];
	return { top, standout, standoutPerTrack: standout ? perTrack(standout) : 0 };
}

/** Each artist's home sound (where their plays are), by handle. */
export function homeSounds(data: AtlasData): Map<string, string> {
	const labels = new Map(data.clusters.coarse.map(cluster => [cluster.id, cluster.label]));
	const plays = new Map<string, Map<number, number>>();
	for (const point of data.points) {
		const mine = plays.get(point.handle) ?? new Map<number, number>();
		mine.set(point.clusterCoarse, (mine.get(point.clusterCoarse) ?? 0) + point.plays + 1);
		plays.set(point.handle, mine);
	}
	const homes = new Map<string, string>();
	for (const [handle, mine] of plays) {
		const [id] = [...mine].sort((a, b) => b[1] - a[1])[0];
		const label = labels.get(id);
		if (label) homes.set(handle, label);
	}
	return homes;
}

/** One sound an artist is in: their tracks and plays there, against everyone's. */
export interface ArtistSound {
	id: number;
	label: string;
	tracks: number;
	plays: number;
	/** where the artist ranks among everyone in this sound by plays, from 1 */
	rank: number;
}

/** The sounds an artist's tracks fall in, most played first, with where they rank in each, plus each mapped track's sound by its track id. */
export function artistSounds(data: AtlasData, handle: string) {
	const labels = new Map(data.clusters.coarse.map(cluster => [cluster.id, cluster.label]));
	const bySound = new Map<number, Map<string, number>>();
	for (const point of data.points) {
		const artists = bySound.get(point.clusterCoarse) ?? new Map<string, number>();
		artists.set(point.handle, (artists.get(point.handle) ?? 0) + point.plays);
		bySound.set(point.clusterCoarse, artists);
	}
	const mine = data.points.filter(point => point.handle === handle);
	const byId = new Map<string | number, string>();
	const grouped = new Map<number, ArtistSound>();
	for (const point of mine) {
		const label = labels.get(point.clusterCoarse);
		if (!label) continue;
		byId.set(point.id, label);
		const entry = grouped.get(point.clusterCoarse) ?? { id: point.clusterCoarse, label, tracks: 0, plays: 0, rank: 0 };
		entry.tracks += 1;
		entry.plays += point.plays;
		grouped.set(point.clusterCoarse, entry);
	}
	const list = [...grouped.values()]
		.map(entry => {
			const everyone = bySound.get(entry.id) ?? new Map<string, number>();
			return { ...entry, rank: 1 + [...everyone].filter(([other, plays]) => other !== handle && plays > entry.plays).length };
		})
		.sort((a, b) => b.plays - a.plays || b.tracks - a.tracks);
	return { sounds: list, mapped: mine.length, byTrackId: byId };
}
