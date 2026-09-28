import type { RadioIntegration } from '../../vendor/sister-radio/frontend/src/shared/lib/integration';
import type { Song } from '../../vendor/sister-radio/frontend/src/shared/lib/radio';
import type { RadioState, RadioStation, RadioTrack } from './radio.svelte';
import type { RadioListeners } from './radio-presence';

export type { RadioIntegration };

export function radioIntegration(input: {
	state: RadioState | null;
	stations: RadioStation[];
	selected: string;
	playing: boolean;
	position: number;
	volume: number;
	loading: boolean;
	error: string | null;
	listeners: RadioListeners | null;
	origin: string;
	cover: (track: RadioTrack) => string;
	play: () => void;
	pause: () => void;
	setVolume: (volume: number) => void;
	selectStation: (slug: string) => void;
	likeTrack: () => void;
}): RadioIntegration {
	const tracks = [...(input.state?.rotation ?? []), ...(input.state?.up_next ?? [])];
	if (input.state?.current) tracks.push(input.state.current);
	const profiles: RadioIntegration['profiles'] = {};
	const covers: Record<string, string> = {};
	for (const track of tracks) {
		profiles[track.artist_did] = {
			did: track.artist_did,
			handle: track.artist_handle,
			displayName: track.artist
		};
		covers[String(track.id)] = input.cover(track);
	}
	for (const listener of input.listeners?.listeners ?? []) {
		profiles[listener.did] = {
			did: listener.did,
			handle: listener.handle,
			displayName: listener.display_name,
			avatar: listener.avatar_url ?? undefined
		};
	}
	const song = (track: RadioTrack): Song => ({
		id: String(track.id),
		title: track.title,
		artist: track.artist,
		durationSeconds: track.duration,
		hasCover: Boolean(covers[String(track.id)]),
		addedByDid: track.artist_did,
		createdAt: Date.parse(track.created_at) / 1000
	});
	const stations = input.stations.map((station) => ({
		did: '',
		apiBase: '',
		url: `${input.origin}/radio/${station.slug}`,
		name: station.name,
		description: station.description,
		local: true
	}));
	return {
		...input,
		snapshot: input.state
			? {
					state: {
						currentSongId: input.state.current ? String(input.state.current.id) : null,
						status: input.state.current ? 'playing' : 'stopped',
						positionSeconds: input.position
					},
					currentSong: input.state.current ? song(input.state.current) : null,
					queue: input.state.up_next.map((track, index) => ({
						id: `${index}:${track.id}`,
						position: index,
						queuedByDid: track.artist_did,
						songId: String(track.id),
						song: song(track),
						title: track.title,
						artist: track.artist,
						durationSeconds: track.duration,
						addedByDid: track.artist_did
					}))
				}
			: null,
		stations,
		selectedStationUrl: `${input.origin}/radio/${input.selected}`,
		listenerCount: input.listeners?.count ?? null,
		listenerDids: input.listeners?.listeners.map((listener) => listener.did) ?? [],
		profiles,
		covers,
		embedUrl: `${input.origin}/embed/radio?station=${encodeURIComponent(input.selected)}`,
		selectStation: (url) => {
			const index = stations.findIndex((station) => station.url === url);
			if (index >= 0) input.selectStation(input.stations[index].slug);
		}
	};
}
