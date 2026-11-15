import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { createCatalogPages } from '@plyr/next-core/catalog/pages';
import { api } from '$lib/api';

function createArtistCatalog(did: string) {
	return {
		tracks: createCatalogPages(cursor => api.tracks({ artist_did: did, limit: 50, cursor }), () => catalogRevision(did, 'tracks')),
		albums: createCatalogPages(cursor => api.albums(did, { limit: 30, cursor }), () => catalogRevision(did, 'collections')),
		playlists: createCatalogPages(cursor => api.playlists({ owner_did: did, limit: 30, cursor }), () => catalogRevision(did, 'collections')),
		likes: createCatalogPages(cursor => api.actorLikes(did, { limit: 50, cursor }), () => catalogRevision(did, 'likes'))
	};
}

const recentArtists = new Map<string, ReturnType<typeof createArtistCatalog>>();

export function artistCatalogFor(did: string) {
	const catalog = recentArtists.get(did) ?? createArtistCatalog(did);
	recentArtists.delete(did);
	recentArtists.set(did, catalog);
	const oldest = recentArtists.keys().next().value;
	if (recentArtists.size > 8 && oldest !== undefined) recentArtists.delete(oldest);
	return catalog;
}
