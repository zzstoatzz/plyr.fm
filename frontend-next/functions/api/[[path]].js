const API_ORIGIN = 'https://plyr-api-zig-canary.fly.dev';
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const RESPONSE_HEADERS = [
	'cache-control',
	'content-length',
	'content-type',
	'etag',
	'last-modified',
	'x-request-id'
];

/**
 * Fixed-target, read-only transport for the Zig API. It deliberately does not
 * translate response bodies or expose arbitrary upstream URLs.
 *
 * @param {{request: Request, params: {path?: string | string[]}}} context
 */
export async function onRequest(context) {
	if (!ALLOWED_METHODS.has(context.request.method)) {
		return new Response('method not allowed', {
			status: 405,
			headers: { allow: 'GET, HEAD' }
		});
	}

	const path = Array.isArray(context.params.path)
		? context.params.path.join('/')
		: (context.params.path ?? '');
	if (path !== 'v1' && !path.startsWith('v1/')) {
		return new Response('not found', { status: 404 });
	}

	const incoming = new URL(context.request.url);
	const upstreamUrl = new URL(`/${path}`, API_ORIGIN);
	upstreamUrl.search = incoming.search;
	const requestHeaders = new Headers({ accept: context.request.headers.get('accept') ?? 'application/json' });
	const requestId = context.request.headers.get('x-request-id');
	if (requestId) requestHeaders.set('x-request-id', requestId);

	const upstream = await fetch(upstreamUrl, {
		method: context.request.method,
		headers: requestHeaders,
		redirect: 'manual'
	});
	const headers = new Headers();
	for (const name of RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set('x-content-type-options', 'nosniff');
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers
	});
}
