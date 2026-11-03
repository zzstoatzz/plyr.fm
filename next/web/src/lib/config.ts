// baked in at build time (cloudflare pages build env); defaults suit next.
const env = import.meta.env as Record<string, string | undefined>;

/** the read-only zig appview. */
export const API_URL = (env.PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');

/** actor profiles (names, avatars) straight from typeahead, which follows the firehose. */
export const TYPEAHEAD_URL = (env.PUBLIC_TYPEAHEAD_URL || 'https://typeahead.waow.tech').replace(/\/$/, '');

/** public origin of this deployment; the oauth client_id lives under it. */
export const SITE_URL = (env.PUBLIC_SITE_URL || 'https://next.plyr.fm').replace(/\/$/, '');

/**
 * record namespace: next reads and writes the real fm.plyr.* records with the
 * published prod lexicon shapes (a parallel client to the same PDS data).
 */
export const NSID_PREFIX = env.PUBLIC_NSID_PREFIX || 'fm.plyr';

export const NSID = {
	track: `${NSID_PREFIX}.track`,
	list: `${NSID_PREFIX}.list`,
	like: `${NSID_PREFIX}.like`,
	profile: `${NSID_PREFIX}.actor.profile`
} as const;

/**
 * gated audio: a managedspace of this type on the artist's PDS, managed by
 * plyr (the appview answers checkUserAccess as this service).
 */
export const SPACE = {
	// never a prod NSID: this space type isn't a published plyr lexicon
	type: env.PUBLIC_SPACE_TYPE || 'fm.plyr.stg.audio',
	managingApp: env.PUBLIC_SPACE_MANAGING_APP || 'did:web:api.next.plyr.fm#plyr_space'
} as const;

/** oauth scope: only this deployment's record collections, plus blobs for uploads. */
export const BASE_SCOPE_PARTS = [
	'atproto',
	`repo:${NSID.like}`,
	`repo:${NSID.list}`,
	`repo:${NSID.track}`,
	`repo:${NSID.profile}`,
	'blob:*/*'
];

/**
 * spaces: create/write my own gate spaces, and read anyone's. `collection=`
 * keeps the PDS from needing a published space-type lexicon. requested only
 * from PDSes that advertise spaces, so others can still sign in.
 */
/**
 * next's gate spaces aren't the shape prod's fm.plyr.track `audioSpace`
 * accepts (prod's are fm.plyr.privateMedia), so gated uploads stay off while
 * next writes the real namespace; they only run against a staging namespace.
 */
export const GATED_UPLOADS = NSID_PREFIX !== 'fm.plyr';

export const PREFERENCE_SPACE = {
	type: env.PUBLIC_PREFERENCE_SPACE_TYPE || 'fm.plyr.stg.preferences',
	collection: env.PUBLIC_PREFERENCE_COLLECTION || 'fm.plyr.stg.preference'
} as const;

export const PREFERENCE_SCOPE = `space:${PREFERENCE_SPACE.type}?authority=self&skey=self&collection=${PREFERENCE_SPACE.collection}&action=read_self&action=create&action=update&manage=create`;

const AUDIO_SPACE_SCOPE_PARTS = !GATED_UPLOADS ? [] : [
	`space:${SPACE.type}?authority=self&collection=${NSID.track}&action=read&action=create&action=update&action=delete&manage=create&manage=update`,
	`space:${SPACE.type}?authority=*&collection=${NSID.track}&action=read`
];

/** everything this client may ask for (registered in its metadata). */
export const SCOPE_PARTS = [
	...BASE_SCOPE_PARTS,
	...(env.PUBLIC_PREFERENCE_SYNC === 'true' ? [PREFERENCE_SCOPE] : []),
	...AUDIO_SPACE_SCOPE_PARTS
];
