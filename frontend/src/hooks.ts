import type { Reroute } from '@sveltejs/kit';

/**
 * rewrite at:// URI paths so they match the /at/[...uri] route.
 *
 * CDNs (Cloudflare) collapse "//" to "/" in URL paths, so a request for
 * /at://did:plc:xxx/fm.plyr.track/rkey arrives as /at:/did:plc:xxx/...
 * which doesn't match the routes/at/ directory. this hook normalizes
 * /at:/ and /at:// prefixes to /at/ before routing.
 */
export const reroute: Reroute = ({ url }) => {
	const match = url.pathname.match(/^\/at:\/{0,2}(.+)/);
	if (match) {
		return `/at/${match[1]}`;
	}
};
