/**
 * Who a sign-in is for and which host its OAuth redirect lands on, resolved
 * on the device: the public Bluesky appview for the profile, the account's
 * DID document for its PDS, and the PDS's protected-resource metadata for
 * its authorization server.
 */
export interface SignInPreview { handle: string; display_name?: string; avatar_url?: string; sign_in_host?: string }

/** where new accounts can be made; prod's `account_creation.recommended_pds` */
export const ACCOUNT_PROVIDERS = [
  { name: 'selfhosted.social', url: 'https://selfhosted.social', recommended: true,
    description: 'free, community-run PDS', info_url: 'https://selfhosted.social/info' },
];

async function json(url: string, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  return response.ok ? await response.json() : undefined;
}

function didDocumentUrl(did: string) {
  if (did.startsWith('did:plc:')) return 'https://plc.directory/' + did;
  if (did.startsWith('did:web:')) return 'https://' + decodeURIComponent(did.slice(8)) + '/.well-known/did.json';
  return undefined;
}

async function signInHost(did: string, signal: AbortSignal): Promise<string | undefined> {
  const documentUrl = didDocumentUrl(did);
  const document = documentUrl ? await json(documentUrl, signal) : undefined;
  const services = Array.isArray(document?.service) ? document.service as { id?: unknown; serviceEndpoint?: unknown }[] : [];
  const pds = services.find(service => typeof service.id === 'string' && service.id.endsWith('#atproto_pds'))?.serviceEndpoint;
  if (typeof pds !== 'string' || !pds.startsWith('https://')) return undefined;
  const resource = await json(pds.replace(/\/$/, '') + '/.well-known/oauth-protected-resource', signal);
  const server = Array.isArray(resource?.authorization_servers) ? resource.authorization_servers[0] : undefined;
  return typeof server === 'string' ? new URL(server).hostname : undefined;
}

export async function signInPreview(identifier: string, signal: AbortSignal): Promise<SignInPreview | undefined> {
  const profile = await json('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(identifier), signal);
  if (typeof profile?.did !== 'string' || typeof profile.handle !== 'string') return undefined;
  const host = await signInHost(profile.did, signal).catch(() => undefined);
  return {
    handle: profile.handle,
    display_name: typeof profile.displayName === 'string' && profile.displayName ? profile.displayName : undefined,
    avatar_url: typeof profile.avatar === 'string' ? profile.avatar : undefined,
    sign_in_host: host,
  };
}
