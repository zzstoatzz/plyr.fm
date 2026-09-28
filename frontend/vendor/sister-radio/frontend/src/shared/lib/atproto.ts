export interface AtprotoProfile {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

interface SlingshotMiniDoc {
  did: string
  handle: string
  pds: string
}

interface SlingshotProfileRecord {
  value?: {
    displayName?: string
    avatar?: {
      ref?: {
        $link?: string
      }
    }
  }
}

const SLINGSHOT_URL = 'https://slingshot.microcosm.blue'
const profileCache = new Map<string, Promise<AtprotoProfile>>()

/**
 * Resolves an atproto DID to a handle and profile details through Slingshot.
 * @param did DID to resolve.
 * @returns Public profile data, falling back to the DID when lookup fails.
 */
export function resolveAtprotoProfile(did: string): Promise<AtprotoProfile> {
  const cached = profileCache.get(did)
  if (cached) {
    return cached
  }

  // Don't cache the fallback — a transient slingshot failure would otherwise
  // permanently pin the row to the raw DID with no chance of recovery.
  const profile = resolveSlingshotProfile(did).catch((error) => {
    profileCache.delete(did)
    console.warn('atproto profile resolution failed for', did, error)
    return { did, handle: did }
  })
  profileCache.set(did, profile)
  return profile
}

async function resolveSlingshotProfile(did: string): Promise<AtprotoProfile> {
  const miniDoc = await fetchJson<SlingshotMiniDoc>(
    `${SLINGSHOT_URL}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(did)}`,
  )
  const record = await fetchJson<SlingshotProfileRecord>(
    `${SLINGSHOT_URL}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(miniDoc.did)}&collection=app.bsky.actor.profile&rkey=self`,
  ).catch(() => undefined)
  const avatarCid = record?.value?.avatar?.ref?.$link

  return {
    did: miniDoc.did,
    handle: miniDoc.handle,
    displayName: record?.value?.displayName,
    avatar: avatarCid
      ? `${miniDoc.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(miniDoc.did)}&cid=${encodeURIComponent(avatarCid)}`
      : undefined,
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('atproto lookup failed')
  }

  return (await response.json()) as T
}
