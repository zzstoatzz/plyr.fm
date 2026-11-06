export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://next.plyr.fm').replace(/\/$/, '');
export const NATIVE_REDIRECT_URI = 'fm.plyr.next:/oauth/callback';
const prefix = process.env.EXPO_PUBLIC_NSID_PREFIX || 'fm.plyr';

export const NSID = {
	track: `${prefix}.track`,
	list: `${prefix}.list`,
	like: `${prefix}.like`,
	profile: `${prefix}.actor.profile`
} as const;

export const PREFERENCE_SPACE = {
	type: process.env.EXPO_PUBLIC_PREFERENCE_SPACE_TYPE || 'fm.plyr.stg.preferences',
	collection: process.env.EXPO_PUBLIC_PREFERENCE_COLLECTION || 'fm.plyr.stg.preference'
} as const;

export const JAM_SPACE = {
	type: process.env.EXPO_PUBLIC_JAM_SPACE_TYPE || 'fm.plyr.stg.jam',
	collection: process.env.EXPO_PUBLIC_JAM_STATE_COLLECTION || 'fm.plyr.stg.jamState'
} as const;

export const JAM_COORDINATOR_URL = (process.env.EXPO_PUBLIC_JAM_COORDINATOR_URL || 'https://plyr-jams-next.fly.dev').replace(/\/$/, '');
export const JAM_SERVICE_AUDIENCE = process.env.EXPO_PUBLIC_JAM_SERVICE_AUDIENCE || 'did:web:plyr-jams-next.fly.dev#jams';
export const JAM_JOIN_METHOD = process.env.EXPO_PUBLIC_JAM_JOIN_METHOD || `${JAM_SPACE.type}.join`;

export const JAM_SCOPE_PARTS = [
  `rpc:${JAM_JOIN_METHOD}?aud=${JAM_SERVICE_AUDIENCE}`,
	`space:${JAM_SPACE.type}?authority=self&collection=${JAM_SPACE.collection}&action=create&action=update&manage=create&manage=update`,
	`space:${JAM_SPACE.type}?authority=*&action=read`
];

export function hasJamGrant(scope: string): boolean {
  const parts = scope.split(' ');
  const service = parts.some(value => {
    const [type, query] = value.split('?');
    return type === `rpc:${JAM_JOIN_METHOD}` && new URLSearchParams(query).get('aud') === JAM_SERVICE_AUDIENCE;
  });
	return service && parts.some(value => {
		const [type, query] = value.split('?');
		const grant = new URLSearchParams(query);
		return type === `space:${JAM_SPACE.type}` && grant.get('authority') === '*' && grant.getAll('action').includes('read');
	});
}

export const PREFERENCE_SYNC = process.env.EXPO_PUBLIC_PREFERENCE_SYNC !== 'false';
export const BASE_SCOPE_PARTS = ['atproto', ...Object.values(NSID).map(nsid => `repo:${nsid}`), 'blob:*/*'];
const preferenceScope = `space:${PREFERENCE_SPACE.type}?authority=self&skey=self&collection=${PREFERENCE_SPACE.collection}&action=read_self&action=create&action=update&manage=create`;
const protectedAudioScope = prefix === 'fm.plyr'
	? [`space:${prefix}.privateMedia?authority=*&collection=${NSID.track}&action=read`, `space:${process.env.EXPO_PUBLIC_AUDIO_SPACE_TYPE || 'fm.plyr.stg.audio'}?authority=*&collection=${NSID.track}&action=read`]
	: [];
export const STANDARD_SCOPE_PARTS = [...BASE_SCOPE_PARTS, ...(PREFERENCE_SYNC ? [preferenceScope] : []), ...protectedAudioScope];
export const SCOPE_PARTS = [...STANDARD_SCOPE_PARTS, ...JAM_SCOPE_PARTS];

export function hasPreferenceGrant(scope: string, did: string): boolean {
	return PREFERENCE_SYNC && scope.split(' ').some((value) => {
		const [type, query] = value.split('?');
		if (type !== `space:${PREFERENCE_SPACE.type}`) return false;
		const grant = new URLSearchParams(query);
		const authority = grant.get('authority') ?? 'self';
		const actions = grant.getAll('action');
		return (authority === 'self' || authority === did)
			&& grant.get('skey') === 'self'
			&& grant.getAll('collection').includes(PREFERENCE_SPACE.collection)
			&& (actions.includes('read_self') || actions.includes('read'))
			&& actions.includes('create') && actions.includes('update')
			&& grant.getAll('manage').includes('create');
	});
}
