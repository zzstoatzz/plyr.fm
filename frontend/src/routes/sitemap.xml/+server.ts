import { API_URL } from '$lib/config';
import type { RequestHandler } from './$types';

interface SitemapData {
	tracks: Array<{ id: number; updated: string }>;
	artists: Array<{ handle: string; updated: string }>;
	albums: Array<{ handle: string; slug: string; updated: string }>;
}

// static pages with their approximate update frequency
const STATIC_PAGES = [
	{ path: '', updated: '2026-01-28' }, // homepage
	{ path: '/terms', updated: '2026-01-20' },
	{ path: '/privacy', updated: '2026-01-20' },
	{ path: '/costs', updated: '2026-01-01' }
];

export const GET: RequestHandler = async ({ fetch }) => {
	const baseUrl = 'https://plyr.fm';

	// fetch dynamic content from backend
	let data: SitemapData = { tracks: [], artists: [], albums: [] };
	try {
		const response = await fetch(`${API_URL}/sitemap-data`);
		if (response.ok) {
			data = await response.json();
		}
	} catch {
		// if backend is down, still return static pages
	}

	// build XML
	const urls: string[] = [];

	// static pages
	for (const page of STATIC_PAGES) {
		urls.push(`
	<url>
		<loc>${baseUrl}${page.path}</loc>
		<lastmod>${page.updated}</lastmod>
	</url>`);
	}

	// track pages
	for (const track of data.tracks) {
		urls.push(`
	<url>
		<loc>${baseUrl}/track/${track.id}</loc>
		<lastmod>${track.updated}</lastmod>
	</url>`);
	}

	// artist pages
	for (const artist of data.artists) {
		urls.push(`
	<url>
		<loc>${baseUrl}/u/${artist.handle}</loc>
		<lastmod>${artist.updated}</lastmod>
	</url>`);
	}

	// album pages
	for (const album of data.albums) {
		urls.push(`
	<url>
		<loc>${baseUrl}/u/${album.handle}/album/${album.slug}</loc>
		<lastmod>${album.updated}</lastmod>
	</url>`);
	}

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'max-age=0, s-maxage=3600' // CDN caches for 1 hour
		}
	});
};
