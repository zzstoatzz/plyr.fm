import { IS_ZIG_V1, ZIG_API_ORIGIN } from '$lib/config';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RESPONSE_HEADERS = [
	'cache-control',
	'content-length',
	'content-type',
	'etag',
	'last-modified',
	'x-request-id'
];

const proxy: RequestHandler = async ({ fetch, params, request, url }) => {
	if (!IS_ZIG_V1 || !ZIG_API_ORIGIN) error(404, 'not found');
	const path = params.path ?? '';
	if (path !== 'v1' && !path.startsWith('v1/')) error(404, 'not found');

	const origin = new URL(ZIG_API_ORIGIN);
	if (
		origin.protocol !== 'https:' ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/'
	) {
		error(500, 'invalid Zig API origin');
	}
	const upstreamUrl = new URL(`/${path}`, origin);
	upstreamUrl.search = url.search;
	const headers = new Headers({ accept: request.headers.get('accept') ?? 'application/json' });
	const requestId = request.headers.get('x-request-id');
	if (requestId) headers.set('x-request-id', requestId);
	const playCookie = extractPlayCookie(request.headers.get('cookie'));
	if (playCookie) headers.set('cookie', `plyr_play_id=${playCookie}`);
	const upstream = await fetch(upstreamUrl, {
		method: request.method,
		headers,
		redirect: 'manual'
	});
	const responseHeaders = new Headers();
	for (const name of RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) responseHeaders.set(name, value);
	}
	const setCookie = upstream.headers.get('set-cookie');
	if (setCookie) responseHeaders.set('set-cookie', setCookie);
	responseHeaders.set('x-content-type-options', 'nosniff');
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders
	});
};

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;

function extractPlayCookie(header: string | null): string | null {
	if (!header) return null;
	for (const raw of header.split(';')) {
		const [name, ...rest] = raw.trim().split('=');
		const value = rest.join('=');
		if (name === 'plyr_play_id' && /^[A-Za-z0-9_-]{22}$/.test(value)) return value;
	}
	return null;
}
