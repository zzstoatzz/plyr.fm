import type { AtlasData, AtlasPoint } from '@plyr/next-core/atlas/types';

/** One of the atlas's coarse regions: tracks grouped by how they sound. */
export interface Sound {
	id: number;
	label: string;
	tracks: number;
	plays: number;
	/** share of all mapped tracks, 0..1 */
	trackShare: number;
	/** share of all plays on mapped tracks, 0..1 */
	playShare: number;
	/** most played track in the sound */
	top: AtlasPoint;
	/** display names of the artists with the most plays here */
	artists: string[];
}

/** Every sound, most played first. */
export function sounds(data: AtlasData): Sound[] {
	const totalTracks = data.points.length;
	const totalPlays = data.points.reduce((sum, point) => sum + point.plays, 0);
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
			trackShare: totalTracks ? points.length / totalTracks : 0,
			playShare: totalPlays ? plays / totalPlays : 0,
			top: points.reduce((best, point) => point.plays > best.plays ? point : best),
			artists: [...byArtist].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name)
		}];
	}).sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label));
}

/** How many times its share of tracks a sound's share of plays is. */
export const lift = (sound: Sound) => sound.trackShare ? sound.playShare / sound.trackShare : 0;

/** The most played sound, and the sizeable sound that gets the most plays for its size (if it isn't the same one). */
export function soundHeadline(list: Sound[]) {
	const [top] = list;
	if (!top) return undefined;
	const standout = list
		.filter(sound => sound !== top && sound.trackShare >= 0.03 && lift(sound) > 1.15)
		.sort((a, b) => lift(b) - lift(a))[0];
	return { top, standout };
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
	/** everyone's plays in this sound */
	soundPlays: number;
	/** the artist's slice of the sound's plays, 0..1 */
	share: number;
}

/** The sounds an artist's tracks fall in, most played first, plus each mapped track's sound by its legacy id. */
export function artistSounds(data: AtlasData, handle: string) {
	const everyone = new Map(sounds(data).map(sound => [sound.id, sound]));
	const mine = data.points.filter(point => point.handle === handle);
	const byId = new Map<number, string>();
	const grouped = new Map<number, ArtistSound>();
	for (const point of mine) {
		const sound = everyone.get(point.clusterCoarse);
		if (!sound) continue;
		byId.set(point.id, sound.label);
		const entry = grouped.get(sound.id) ?? { id: sound.id, label: sound.label, tracks: 0, plays: 0, soundPlays: sound.plays, share: 0 };
		entry.tracks += 1;
		entry.plays += point.plays;
		grouped.set(sound.id, entry);
	}
	const list = [...grouped.values()]
		.map(entry => ({ ...entry, share: entry.soundPlays ? entry.plays / entry.soundPlays : 0 }))
		.sort((a, b) => b.plays - a.plays || b.tracks - a.tracks);
	return { sounds: list, mapped: mine.length, byLegacyId: byId };
}
