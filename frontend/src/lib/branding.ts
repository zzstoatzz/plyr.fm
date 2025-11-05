const DEFAULT_APP_NAME = 'relay';
const DEFAULT_TAGLINE = 'music streaming on atproto';
const DEFAULT_CANONICAL_HOST = 'relay.zzstoatzz.io';
const DEFAULT_BROADCAST_PREFIX = 'relay';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? DEFAULT_APP_NAME;
const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE ?? DEFAULT_TAGLINE;
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
	APP_CANONICAL_HOST,
	APP_CANONICAL_URL,
	APP_BROADCAST_PREFIX
};
