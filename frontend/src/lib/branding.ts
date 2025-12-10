const DEFAULT_APP_NAME = 'plyr.fm';
const DEFAULT_TAGLINE = 'music on atproto';
const DEFAULT_APP_STAGE = 'alpha';
const DEFAULT_CANONICAL_HOST = 'plyr.fm';
const DEFAULT_BROADCAST_PREFIX = 'plyr';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? DEFAULT_APP_NAME;
const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE ?? DEFAULT_TAGLINE;
const APP_STAGE = import.meta.env.VITE_APP_STAGE ?? DEFAULT_APP_STAGE;
const APP_CANONICAL_HOST =
	import.meta.env.VITE_APP_CANONICAL_HOST ?? DEFAULT_CANONICAL_HOST;
const APP_CANONICAL_URL =
	import.meta.env.VITE_APP_CANONICAL_URL ?? `https://${APP_CANONICAL_HOST}`;

const APP_BROADCAST_PREFIX = (
	import.meta.env.VITE_APP_BROADCAST_PREFIX ?? DEFAULT_BROADCAST_PREFIX
)
	.toString()
	.trim()
	.replace(/\s+/g, '-')
	.toLowerCase();

export {
	APP_NAME,
	APP_TAGLINE,
	APP_STAGE,
	APP_CANONICAL_HOST,
	APP_CANONICAL_URL,
	APP_BROADCAST_PREFIX
};
