interface Options {
  siteUrl?: string;
  nsidPrefix?: string;
  audioSpaceType?: string;
  spaceManagingApp?: string;
  jamSpaceType?: string;
  jamStateCollection?: string;
  jamCoordinatorUrl?: string;
  jamServiceAudience?: string;
  jamJoinMethod?: string;
  uploadAuthorizeMethod?: string;
  uploadServiceAudience?: string;
  uploadCoordinatorUrl?: string;
}

export function createAuthConfig(options: Options = {}) {
  const SITE_URL = (options.siteUrl || 'https://next.plyr.fm').replace(/\/$/, '');
  const NATIVE_REDIRECT_URI = 'fm.plyr.next:/oauth/callback';
  const prefix = options.nsidPrefix || 'fm.plyr';

  const NSID = {
    track: `${prefix}.track`,
    list: `${prefix}.list`,
    like: `${prefix}.like`,
    comment: `${prefix}.comment`,
    profile: `${prefix}.actor.profile`,
    policy: `${prefix}.policy`
  } as const;

  const AUDIO_SPACE_TYPE = options.audioSpaceType || 'fm.plyr.next.audio';
  const SPACE_MANAGING_APP = options.spaceManagingApp || 'did:web:api.next.plyr.fm#plyr_space';
  const CLOSE_SCOPE = `space:${AUDIO_SPACE_TYPE}?authority=self&collection=${NSID.track}&action=read&action=create&action=delete&manage=create`;
  function hasCloseGrant(scope: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?'), grant = new URLSearchParams(query);
      return type === `space:${AUDIO_SPACE_TYPE}` && grant.get('authority') === 'self' && grant.getAll('collection').includes(NSID.track)
        && ['read', 'create', 'delete'].every(action => grant.getAll('action').includes(action)) && grant.getAll('manage').includes('create');
    });
  }
  function hasPolicyGrant(scope: string): boolean {
    return scope.split(' ').includes(`repo:${NSID.policy}`);
  }
  function hasCommentGrant(scope: string): boolean {
    return scope.split(' ').includes(`repo:${NSID.comment}`);
  }

  const PRIVATE_SPACE_TYPE = `${prefix}.privateMedia`;
  const PRIVATE_DELETE_SCOPE = `space:${PRIVATE_SPACE_TYPE}?authority=self&skey=self&collection=${NSID.track}&action=read&action=delete`;
  function isOwnedPrivateGrant(type: string, grant: URLSearchParams, owner?: string): boolean {
    const authority = grant.get('authority');
    return type === `space:${PRIVATE_SPACE_TYPE}` && grant.getAll('authority').length === 1
      && (authority === 'self' || authority === owner) && grant.get('skey') === 'self'
      && grant.getAll('collection').includes(NSID.track);
  }
  function hasPrivateDeleteGrant(scope: string, owner?: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?'), grant = new URLSearchParams(query);
      return isOwnedPrivateGrant(type, grant, owner) && grant.getAll('action').includes('read') && grant.getAll('action').includes('delete');
    });
  }

  const PRIVATE_PUBLISH_SCOPE = `space:${PRIVATE_SPACE_TYPE}?authority=self&skey=self&collection=${NSID.track}&action=read&action=create&manage=create`;
  function hasPrivatePublishGrant(scope: string, owner?: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?'), grant = new URLSearchParams(query);
      return isOwnedPrivateGrant(type, grant, owner) && grant.getAll('action').includes('read') && grant.getAll('action').includes('create') && grant.getAll('manage').includes('create');
    });
  }

  const JAM_SPACE = {
    type: options.jamSpaceType || 'fm.plyr.next.jam',
    collection: options.jamStateCollection || 'fm.plyr.next.jamState'
  } as const;

  const JAM_COORDINATOR_URL = (options.jamCoordinatorUrl || 'https://jams.next.plyr.fm').replace(/\/$/, '');
  const JAM_SERVICE_AUDIENCE = options.jamServiceAudience || 'did:web:jams.next.plyr.fm#jams';
  const JAM_JOIN_METHOD = options.jamJoinMethod || `${JAM_SPACE.type}.join`;

  const UPLOAD_AUTHORIZE_METHOD = options.uploadAuthorizeMethod || `${prefix}.upload.authorize`;
  const UPLOAD_SERVICE_AUDIENCE = options.uploadServiceAudience || JAM_SERVICE_AUDIENCE;
  const UPLOAD_COORDINATOR_URL = (options.uploadCoordinatorUrl || JAM_COORDINATOR_URL).replace(/\/$/, '');
  const UPLOAD_SCOPE = `rpc:${UPLOAD_AUTHORIZE_METHOD}?aud=${UPLOAD_SERVICE_AUDIENCE}`;
  const DOWNLOAD_AUTHORIZE_METHOD = `${prefix}.download.authorize`;
  const DOWNLOAD_SCOPE = `rpc:${DOWNLOAD_AUTHORIZE_METHOD}?aud=${JAM_SERVICE_AUDIENCE}`;
  function hasDownloadGrant(scope: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?');
      const grant = new URLSearchParams(query);
      return type === `rpc:${DOWNLOAD_AUTHORIZE_METHOD}` && grant.getAll('aud').length === 1 && grant.get('aud') === JAM_SERVICE_AUDIENCE;
    });
  }
  function hasUploadGrant(scope: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?');
      return type === `rpc:${UPLOAD_AUTHORIZE_METHOD}` && new URLSearchParams(query).get('aud') === UPLOAD_SERVICE_AUDIENCE;
    });
  }

  const SYNC_SCOPE = `rpc:${JAM_JOIN_METHOD}?aud=${JAM_SERVICE_AUDIENCE}`;
  const JAM_SCOPE_PARTS = [
    `space:${JAM_SPACE.type}?authority=self&collection=${JAM_SPACE.collection}&action=create&action=update&manage=create&manage=update`,
    `space:${JAM_SPACE.type}?authority=*&collection=${JAM_SPACE.collection}&action=read`
  ];

  function hasSyncGrant(scope: string): boolean {
    return scope.split(' ').some(value => {
      const [type, query] = value.split('?');
      return type === `rpc:${JAM_JOIN_METHOD}` && new URLSearchParams(query).get('aud') === JAM_SERVICE_AUDIENCE;
    });
  }

  function hasJamGrant(scope: string): boolean {
    return hasSyncGrant(scope) && scope.split(' ').some(value => {
      const [type, query] = value.split('?');
      const grant = new URLSearchParams(query);
      return type === `space:${JAM_SPACE.type}` && grant.get('authority') === '*' && grant.getAll('action').includes('read');
    });
  }

  const BASE_SCOPE_PARTS = ['atproto', ...Object.values(NSID).map(nsid => `repo:${nsid}`), 'blob:*/*'];
  const protectedAudioScope = prefix === 'fm.plyr'
    ? [`space:${prefix}.privateMedia?authority=*&collection=${NSID.track}&action=read`, `space:${AUDIO_SPACE_TYPE}?authority=*&collection=${NSID.track}&action=read`]
    : [];
  const SYNC_SCOPE_PARTS = [...BASE_SCOPE_PARTS, SYNC_SCOPE, UPLOAD_SCOPE, DOWNLOAD_SCOPE];
  const SCOPE_PARTS = [...SYNC_SCOPE_PARTS, ...protectedAudioScope, ...JAM_SCOPE_PARTS, PRIVATE_PUBLISH_SCOPE, PRIVATE_DELETE_SCOPE, CLOSE_SCOPE];
  return {
    SITE_URL,
    NATIVE_REDIRECT_URI,
    NSID,
    AUDIO_SPACE_TYPE,
    SPACE_MANAGING_APP,
    CLOSE_SCOPE,
    hasCloseGrant,
    hasPolicyGrant,
    hasCommentGrant,
    PRIVATE_SPACE_TYPE,
    PRIVATE_DELETE_SCOPE,
    hasPrivateDeleteGrant,
    PRIVATE_PUBLISH_SCOPE,
    hasPrivatePublishGrant,
    JAM_SPACE,
    JAM_COORDINATOR_URL,
    JAM_SERVICE_AUDIENCE,
    JAM_JOIN_METHOD,
    UPLOAD_AUTHORIZE_METHOD,
    UPLOAD_SERVICE_AUDIENCE,
    UPLOAD_COORDINATOR_URL,
    UPLOAD_SCOPE,
    DOWNLOAD_AUTHORIZE_METHOD,
    DOWNLOAD_SCOPE,
    hasDownloadGrant,
    hasUploadGrant,
    SYNC_SCOPE,
    JAM_SCOPE_PARTS,
    hasSyncGrant,
    hasJamGrant,
    BASE_SCOPE_PARTS,
    SYNC_SCOPE_PARTS,
    SCOPE_PARTS,
  };
}

export type AuthConfig = ReturnType<typeof createAuthConfig>;
