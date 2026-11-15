import { createAuthConfig } from '@plyr/next-core/auth-config';

export const authConfig = createAuthConfig({
  siteUrl: import.meta.env.PUBLIC_SITE_URL,
  nsidPrefix: import.meta.env.PUBLIC_NSID_PREFIX,
  audioSpaceType: import.meta.env.PUBLIC_AUDIO_SPACE_TYPE,
  spaceManagingApp: import.meta.env.PUBLIC_SPACE_MANAGING_APP,
  jamSpaceType: import.meta.env.PUBLIC_JAM_SPACE_TYPE,
  jamStateCollection: import.meta.env.PUBLIC_JAM_STATE_COLLECTION,
  jamCoordinatorUrl: import.meta.env.PUBLIC_JAM_COORDINATOR_URL,
  jamServiceAudience: import.meta.env.PUBLIC_JAM_SERVICE_AUDIENCE,
  jamJoinMethod: import.meta.env.PUBLIC_JAM_JOIN_METHOD,
  uploadAuthorizeMethod: import.meta.env.PUBLIC_UPLOAD_AUTHORIZE_METHOD,
  uploadServiceAudience: import.meta.env.PUBLIC_UPLOAD_SERVICE_AUDIENCE,
  uploadCoordinatorUrl: import.meta.env.PUBLIC_UPLOAD_COORDINATOR_URL,
});
