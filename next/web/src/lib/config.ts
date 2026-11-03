// baked in at build time (cloudflare pages build env); defaults suit next.
const env = import.meta.env as Record<string, string | undefined>;

/** the read-only zig appview. */
export const API_URL = (env.PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');

/** actor profiles (names, avatars) straight from typeahead, which follows the firehose. */
export const TYPEAHEAD_URL = (env.PUBLIC_TYPEAHEAD_URL || 'https://typeahead.waow.tech').replace(/\/$/, '');

/** public origin of this deployment; the oauth client_id lives under it. */
export const SITE_URL = (env.PUBLIC_SITE_URL || 'https://next.plyr.fm').replace(/\/$/, '');

/** record namespace for this deployment: next reads/writes the staging namespace. */
export const NSID_PREFIX = env.PUBLIC_NSID_PREFIX || 'fm.plyr.stg';

export const NSID = {
	track: `${NSID_PREFIX}.track`,
	list: `${NSID_PREFIX}.list`,
	like: `${NSID_PREFIX}.like`,
	profile: `${NSID_PREFIX}.actor.profile`
} as const;

/** oauth scope: only this deployment's record collections, plus blobs for uploads. */
export const SCOPE_PARTS = [
	'atproto',
	`repo:${NSID.like}`,
	`repo:${NSID.list}`,
	`repo:${NSID.track}`,
	`repo:${NSID.profile}`,
	'blob:*/*'
];
