export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://next.plyr.fm').replace(/\/$/, '');
export const NATIVE_REDIRECT_URI = 'fm.plyr.next:/oauth/callback';
const prefix = process.env.EXPO_PUBLIC_NSID_PREFIX || 'fm.plyr';

export const NSID = {
	track: `${prefix}.track`,
	list: `${prefix}.list`,
	like: `${prefix}.like`,
	profile: `${prefix}.actor.profile`,
	policy: `${prefix}.policy`
} as const;

export const AUDIO_SPACE_TYPE = process.env.EXPO_PUBLIC_AUDIO_SPACE_TYPE || 'fm.plyr.next.audio';
export const SPACE_MANAGING_APP = process.env.EXPO_PUBLIC_SPACE_MANAGING_APP || 'did:web:api.next.plyr.fm#plyr_space';
export const CLOSE_SCOPE = `space:${AUDIO_SPACE_TYPE}?authority=self&collection=${NSID.track}&action=read&action=create&action=delete&manage=create`;
export function hasCloseGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?'), grant = new URLSearchParams(query);
    return type === `space:${AUDIO_SPACE_TYPE}` && grant.get('authority') === 'self' && grant.getAll('collection').includes(NSID.track)
      && ['read', 'create', 'delete'].every(action => grant.getAll('action').includes(action)) && grant.getAll('manage').includes('create');
  });
}
export function hasPolicyGrant(scope: string): boolean {
  return scope.split(' ').includes(`repo:${NSID.policy}`);
}

export const PRIVATE_SPACE_TYPE = `${prefix}.privateMedia`;
export const PRIVATE_DELETE_SCOPE = `space:${PRIVATE_SPACE_TYPE}?authority=self&skey=self&collection=${NSID.track}&action=read&action=delete`;
export function hasPrivateDeleteGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?'), grant = new URLSearchParams(query);
    return type === `space:${PRIVATE_SPACE_TYPE}` && grant.get('authority') === 'self' && grant.get('skey') === 'self'
      && grant.getAll('collection').includes(NSID.track) && grant.getAll('action').includes('read') && grant.getAll('action').includes('delete');
  });
}

export const PRIVATE_PUBLISH_SCOPE = `space:${PRIVATE_SPACE_TYPE}?authority=self&skey=self&collection=${NSID.track}&action=read&action=create&manage=create`;
export function hasPrivatePublishGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?'), grant = new URLSearchParams(query);
    return type === `space:${PRIVATE_SPACE_TYPE}` && grant.get('authority') === 'self' && grant.get('skey') === 'self'
      && grant.getAll('collection').includes(NSID.track) && grant.getAll('action').includes('read') && grant.getAll('action').includes('create') && grant.getAll('manage').includes('create');
  });
}

export const JAM_SPACE = {
	type: process.env.EXPO_PUBLIC_JAM_SPACE_TYPE || 'fm.plyr.next.jam',
	collection: process.env.EXPO_PUBLIC_JAM_STATE_COLLECTION || 'fm.plyr.next.jamState'
} as const;

export const JAM_COORDINATOR_URL = (process.env.EXPO_PUBLIC_JAM_COORDINATOR_URL || 'https://jams.next.plyr.fm').replace(/\/$/, '');
export const JAM_SERVICE_AUDIENCE = process.env.EXPO_PUBLIC_JAM_SERVICE_AUDIENCE || 'did:web:jams.next.plyr.fm#jams';
export const JAM_JOIN_METHOD = process.env.EXPO_PUBLIC_JAM_JOIN_METHOD || `${JAM_SPACE.type}.join`;

export const UPLOAD_AUTHORIZE_METHOD = process.env.EXPO_PUBLIC_UPLOAD_AUTHORIZE_METHOD || `${prefix}.upload.authorize`;
export const UPLOAD_SERVICE_AUDIENCE = process.env.EXPO_PUBLIC_UPLOAD_SERVICE_AUDIENCE || JAM_SERVICE_AUDIENCE;
export const UPLOAD_COORDINATOR_URL = (process.env.EXPO_PUBLIC_UPLOAD_COORDINATOR_URL || JAM_COORDINATOR_URL).replace(/\/$/, '');
export const UPLOAD_SCOPE = `rpc:${UPLOAD_AUTHORIZE_METHOD}?aud=${UPLOAD_SERVICE_AUDIENCE}`;
export const DOWNLOAD_AUTHORIZE_METHOD = `${prefix}.download.authorize`;
export const DOWNLOAD_SCOPE = `rpc:${DOWNLOAD_AUTHORIZE_METHOD}?aud=${JAM_SERVICE_AUDIENCE}`;
export function hasDownloadGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?');
    const grant = new URLSearchParams(query);
    return type === `rpc:${DOWNLOAD_AUTHORIZE_METHOD}` && grant.getAll('aud').length === 1 && grant.get('aud') === JAM_SERVICE_AUDIENCE;
  });
}
export function hasUploadGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?');
    return type === `rpc:${UPLOAD_AUTHORIZE_METHOD}` && new URLSearchParams(query).get('aud') === UPLOAD_SERVICE_AUDIENCE;
  });
}

export const SYNC_SCOPE = `rpc:${JAM_JOIN_METHOD}?aud=${JAM_SERVICE_AUDIENCE}`;
export const JAM_SCOPE_PARTS = [
	`space:${JAM_SPACE.type}?authority=self&collection=${JAM_SPACE.collection}&action=create&action=update&manage=create&manage=update`,
	`space:${JAM_SPACE.type}?authority=*&collection=${JAM_SPACE.collection}&action=read`
];

export function hasSyncGrant(scope: string): boolean {
  return scope.split(' ').some(value => {
    const [type, query] = value.split('?');
    return type === `rpc:${JAM_JOIN_METHOD}` && new URLSearchParams(query).get('aud') === JAM_SERVICE_AUDIENCE;
  });
}

export function hasJamGrant(scope: string): boolean {
	return hasSyncGrant(scope) && scope.split(' ').some(value => {
		const [type, query] = value.split('?');
		const grant = new URLSearchParams(query);
		return type === `space:${JAM_SPACE.type}` && grant.get('authority') === '*' && grant.getAll('action').includes('read');
	});
}

export const BASE_SCOPE_PARTS = ['atproto', ...Object.values(NSID).map(nsid => `repo:${nsid}`), 'blob:*/*'];
const protectedAudioScope = prefix === 'fm.plyr'
	? [`space:${prefix}.privateMedia?authority=*&collection=${NSID.track}&action=read`, `space:${AUDIO_SPACE_TYPE}?authority=*&collection=${NSID.track}&action=read`]
	: [];
export const SYNC_SCOPE_PARTS = [...BASE_SCOPE_PARTS, SYNC_SCOPE, UPLOAD_SCOPE, DOWNLOAD_SCOPE];
export const SCOPE_PARTS = [...SYNC_SCOPE_PARTS, ...protectedAudioScope, ...JAM_SCOPE_PARTS, PRIVATE_PUBLISH_SCOPE, PRIVATE_DELETE_SCOPE, CLOSE_SCOPE];
