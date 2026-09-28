import {
  beginClientSignIn,
  loadClientSession,
  readClientAuthError,
  signOutClient,
  xrpcAddAdminDid,
  xrpcAdminPermissions,
  xrpcRemoveAdminDid,
  type AdminPermission,
  type AdminPermissionsResponse,
  type RadioTarget,
  type SessionResponse,
} from './radioXrpc'

export type { AdminPermission, AdminPermissionsResponse, SessionResponse }

export async function fetchSession(): Promise<SessionResponse> {
  return loadClientSession()
}

export async function fetchAdminPermissions(target?: RadioTarget): Promise<AdminPermissionsResponse> {
  return xrpcAdminPermissions(null, target)
}

export async function addAdminDid(did: string, target?: RadioTarget): Promise<AdminPermissionsResponse> {
  return xrpcAddAdminDid(did, target)
}

export async function removeAdminDid(did: string, target?: RadioTarget): Promise<AdminPermissionsResponse> {
  return xrpcRemoveAdminDid(did, target)
}

export function startSignIn(input: string): Promise<void> {
  return beginClientSignIn(input)
}

export function signOut(): Promise<void> {
  return signOutClient()
}

export function readAuthError(search: string = window.location.search): string | null {
  return new URLSearchParams(search).get('error') ?? readClientAuthError()
}

export function formatAuthError(code: string): string {
  switch (code) {
    case 'missing_input':
      return 'you need to enter a handle or did before starting oauth.'
    case 'missing_code':
      return 'the oauth callback came back without a code. rude.'
    case 'oauth_start_failed':
      return 'could not kick off the oauth flow.'
    case 'oauth_callback_failed':
      return 'oauth callback failed.'
    case 'session_create_failed':
      return 'oauth worked, but saving the browser session did not.'
    default:
      return code
  }
}
