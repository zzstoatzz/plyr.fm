import { Client, ClientResponseError, ok } from '@atcute/client'
import type { ActorIdentifier, AtprotoAudience, Did } from '@atcute/lexicons/syntax'
import {
  CompositeDidDocumentResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  XrpcHandleResolver,
} from '@atcute/identity-resolver'
import { scope } from '@atcute/oauth-types'
import {
  OAuthUserAgent,
  configureOAuth,
  createAuthorizationUrl,
  deleteStoredSession,
  finalizeAuthorization,
  getSession,
  listStoredSessions,
  type Session,
} from '@atcute/oauth-browser-client'
import type {} from '@atcute/atproto'
import { API_BASE, RADIO_SERVICE_DID, RADIO_SERVICE_ID } from './config'
import type {
  ChatBan,
  ChatMessage,
  LoopMode,
  Playlist,
  QueueItem,
  RadioAlbum,
  RadioSnapshot,
  RadioState,
  Song,
  SongMetadataInput,
  SongUploadInput,
  SubsonicCreds,
  SubsonicSongResult,
  UrlSongInput,
} from './radio'

export interface SessionResponse {
  authenticated: boolean
  accountDid?: string | null
  isAdmin: boolean
}

export interface AdminPermission {
  key: string
  description: string
}

export interface AdminPermissionsResponse {
  whitelistedDids: string[]
  permissions: AdminPermission[]
}

const ACTIVE_DID_KEY = 'radio_oauth_account_did'
const LAST_AUTH_ERROR_KEY = 'radio_oauth_last_error'

const RADIO_XRPC_METHODS = [
  'pet.nkp.radio.admin.modify',
  'pet.nkp.radio.admin.permissions',
  'pet.nkp.radio.albums.list',
  'pet.nkp.radio.albums.modify',
  'pet.nkp.radio.chat.bans.list',
  'pet.nkp.radio.chat.bans.modify',
  'pet.nkp.radio.chat.messages.modify',
  'pet.nkp.radio.chat.send',
  'pet.nkp.radio.control',
  'pet.nkp.radio.playlists.list',
  'pet.nkp.radio.playlists.modify',
  'pet.nkp.radio.queue.list',
  'pet.nkp.radio.queue.modify',
  'pet.nkp.radio.songs.add',
  'pet.nkp.radio.songs.cover',
  'pet.nkp.radio.songs.list',
  'pet.nkp.radio.songs.modify',
  'pet.nkp.radio.songs.upload',
  'pet.nkp.radio.subsonic.import',
  'pet.nkp.radio.subsonic.search',
] as const

// Writes into the listener's own repo: teal.fm scrobbles and now-playing
// status, Bluesky shares, and the cover thumbnail a share embeds. These strings
// must match the backend's ATPROTO_OAUTH_SCOPE and the standalone
// client-metadata byte for byte, or the authorization server rejects sign-in.
// Written out rather than built with scope.repo(), which emits the
// `repo?collection=` form the backend's OAuth library can't parse.
const REPO_WRITE_SCOPES = [
  'repo:fm.teal.feed.play?action=create',
  'repo:app.bsky.feed.post?action=create',
  'repo:fm.teal.actor.status?action=create&action=update',
  'blob:image/*',
]

const DEFAULT_SCOPE = ['atproto', scope.rpc({ aud: '*', lxm: [...RADIO_XRPC_METHODS] }), ...REPO_WRITE_SCOPES].join(' ')

// Sessions granted before the repo-write scopes existed are signed out once so
// the next sign-in asks for them. The flag caps it at one forced sign-out per
// browser, even if a server echoes the granted scope back in another form.
const SCOPE_UPGRADE_KEY = 'radio_oauth_scope_upgrade'
const SCOPE_UPGRADE_VERSION = 'repo-writes-1'

type LooseClient = Client<Record<string, unknown>, Record<string, unknown>>
export interface RadioTarget {
  did?: string | null
  serviceId?: string | null
  baseUrl?: string | null
}

let oauthConfigured = false
const audienceCache = new Map<string, Promise<string>>()

export function readClientAuthError(): string | null {
  const stored = sessionStorage.getItem(LAST_AUTH_ERROR_KEY)
  if (stored) {
    sessionStorage.removeItem(LAST_AUTH_ERROR_KEY)
    return stored
  }
  return null
}

export async function beginClientSignIn(input: string): Promise<void> {
  const identifier = input.trim()
  if (!identifier) {
    throw new Error('please enter a handle or did first.')
  }

  configureRadioOAuth()
  sessionStorage.removeItem(LAST_AUTH_ERROR_KEY)
  const authUrl = await createAuthorizationUrl({
    target: { type: 'account', identifier: identifier as ActorIdentifier },
    scope: oauthScope(),
  })
  window.location.assign(authUrl.href)
}

export async function loadClientSession(): Promise<SessionResponse> {
  configureRadioOAuth()

  const finalized = await finalizeCallbackIfPresent()
  const session = finalized ?? await activeSession({ allowStale: true })
  const upgradePending = localStorage.getItem(SCOPE_UPGRADE_KEY) !== SCOPE_UPGRADE_VERSION
  localStorage.setItem(SCOPE_UPGRADE_KEY, SCOPE_UPGRADE_VERSION)
  if (session && !finalized && upgradePending && !grantsRepoWrites(session)) {
    await signOutClient().catch((error) => console.warn('scope upgrade sign-out failed', error))
    return { authenticated: false, accountDid: null, isAdmin: false }
  }
  if (!session) {
    return { authenticated: false, accountDid: null, isAdmin: false }
  }

  localStorage.setItem(ACTIVE_DID_KEY, session.info.sub)
  let isAdmin = false
  if (defaultProxyTargetLooksPublic()) {
    try {
      await withTimeout(xrpcAdminPermissions(session), 5000, 'admin probe timed out')
      isAdmin = true
    } catch (error) {
      if (!(error instanceof ClientResponseError) || (error.status !== 401 && error.status !== 403)) {
        console.warn('admin probe failed', error)
      }
    }
  }

  return {
    authenticated: true,
    accountDid: session.info.sub,
    isAdmin,
  }
}

function grantsRepoWrites(session: Session): boolean {
  const granted = new Set(session.token.scope.split(' '))
  return REPO_WRITE_SCOPES.every((required) => granted.has(required))
}

/**
 * The signed-in listener and a client aimed at their own PDS, with no radio
 * proxy, for writing records into their repo.
 * @returns null when nobody is signed in.
 */
export async function listenerRepoClient(): Promise<{ did: Did; client: LooseClient; agent: OAuthUserAgent } | null> {
  const session = await activeSession()
  if (!session) return null
  const agent = new OAuthUserAgent(session)
  return {
    did: session.info.sub,
    client: new Client<Record<string, unknown>, Record<string, unknown>>({ handler: agent }),
    agent,
  }
}

export async function signOutClient(): Promise<void> {
  configureRadioOAuth()
  const session = await activeSession({ allowStale: true })
  try {
    if (session) {
      await new OAuthUserAgent(session).signOut()
    }
  } finally {
    const activeDid = localStorage.getItem(ACTIVE_DID_KEY)
    if (activeDid) {
      deleteStoredSession(activeDid as Did)
    }
    localStorage.removeItem(ACTIVE_DID_KEY)
    audienceCache.clear()
  }
}

export async function xrpcAdminPermissions(session?: Session | null, target?: RadioTarget): Promise<AdminPermissionsResponse> {
  const data = await radioGet<{ permissions: AdminPermissionsResponse }>(
    'pet.nkp.radio.admin.permissions',
    { session: session ?? await requiredSession(), target },
  )
  return data.permissions
}

export async function xrpcAddAdminDid(did: string, target?: RadioTarget): Promise<AdminPermissionsResponse> {
  const data = await radioPost<{ permissions: AdminPermissionsResponse }>('pet.nkp.radio.admin.modify', {
    action: 'add',
    did,
  }, { target })
  return data.permissions
}

export async function xrpcRemoveAdminDid(did: string, target?: RadioTarget): Promise<AdminPermissionsResponse> {
  const data = await radioPost<{ permissions: AdminPermissionsResponse }>('pet.nkp.radio.admin.modify', {
    action: 'remove',
    did,
  }, { target })
  return data.permissions
}

export async function xrpcQueueList(target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioGet<{ snapshot: unknown }>('pet.nkp.radio.queue.list', { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcSongsList(target?: RadioTarget): Promise<Song[]> {
  const data = await radioGet<{ songs: unknown[] }>('pet.nkp.radio.songs.list', { target })
  return data.songs.map(normalizeSong)
}

export async function xrpcAlbumsList(target?: RadioTarget): Promise<RadioAlbum[]> {
  const data = await radioGet<{ albums: unknown[] }>('pet.nkp.radio.albums.list', { target })
  return data.albums.map(normalizeAlbum)
}

export async function xrpcDeleteAlbum(albumId: string, target?: RadioTarget): Promise<RadioAlbum[]> {
  const data = await radioPost<{ albums: unknown[] }>('pet.nkp.radio.albums.modify', {
    action: 'delete',
    albumId,
  }, { target })
  return data.albums.map(normalizeAlbum)
}

export async function xrpcSetAlbumEnabled(albumId: string, enabled: boolean, target?: RadioTarget): Promise<RadioAlbum[]> {
  const data = await radioPost<{ albums: unknown[] }>('pet.nkp.radio.albums.modify', {
    action: 'setEnabled',
    albumId,
    enabled,
  }, { target })
  return data.albums.map(normalizeAlbum)
}

export async function xrpcSetAlbumWeight(albumId: string, weight: number, target?: RadioTarget): Promise<RadioAlbum[]> {
  const data = await radioPost<{ albums: unknown[] }>('pet.nkp.radio.albums.modify', {
    action: 'setWeight',
    albumId,
    weight,
  }, { target })
  return data.albums.map(normalizeAlbum)
}

export async function xrpcMergeAlbums(albumId: string, targetAlbumId: string, target?: RadioTarget): Promise<RadioAlbum[]> {
  const data = await radioPost<{ albums: unknown[] }>('pet.nkp.radio.albums.modify', {
    action: 'merge',
    albumId,
    targetAlbumId,
  }, { target })
  return data.albums.map(normalizeAlbum)
}

export async function xrpcEnqueueSongs(
  songIds: string[],
  target?: RadioTarget,
  atTop = false,
  sequence = false,
): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.queue.modify', {
    action: 'enqueue',
    songIds,
    ...(atTop ? { atTop: true } : {}),
    ...(sequence ? { sequence: true } : {}),
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

/** Reorders the pending queue by transition score. */
export async function xrpcSequenceQueue(target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.queue.modify', {
    action: 'sequence',
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcRemoveQueueItem(queueId: string, target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.queue.modify', {
    action: 'remove',
    queueId,
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcClearQueue(target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.queue.modify', {
    action: 'clear',
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcReorderQueue(queueIds: string[], target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.queue.modify', {
    action: 'reorder',
    queueIds,
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcControlRadio(
  action: 'play' | 'pause' | 'stop' | 'skip' | 'shuffle',
  intent: 'explicit_admin_action',
  target?: RadioTarget,
): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.control', { action, intent }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcUploadSong(input: SongUploadInput, target?: RadioTarget): Promise<Song> {
  const formData = new FormData()
  formData.set('file', input.file)
  formData.set('title', input.title)
  formData.set('artist', input.artist)
  formData.set('album', input.album ?? '')
  if (input.genre) formData.set('genre', input.genre)
  if (input.durationSeconds !== undefined) {
    formData.set('durationSeconds', String(input.durationSeconds))
  }
  formData.set('addToQueue', String(input.addToQueue))

  const data = await radioMultipart<{ songs: unknown[] }>('pet.nkp.radio.songs.upload', formData, target)
  const song = normalizeSong(data.songs[0])
  if (input.cover) {
    return xrpcUploadSongCover(song.id, input.cover, target)
  }
  return song
}

export async function xrpcUploadSongCover(songId: string, cover: File, target?: RadioTarget): Promise<Song> {
  const formData = new FormData()
  formData.set('songId', songId)
  formData.set('cover', cover)
  const data = await radioMultipart<{ song: unknown }>('pet.nkp.radio.songs.cover', formData, target)
  return normalizeSong(data.song)
}

export async function xrpcUpdateSongMetadata(songId: string, input: SongMetadataInput, target?: RadioTarget): Promise<Song> {
  const data = await radioPost<{ song?: unknown }>('pet.nkp.radio.songs.modify', {
    action: 'update',
    songId,
    ...input,
  }, { target })
  return normalizeSong(data.song)
}

export async function xrpcDeleteSong(songId: string, target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot?: unknown }>('pet.nkp.radio.songs.modify', {
    action: 'delete',
    songId,
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcUploadSongFromUrl(input: UrlSongInput, target?: RadioTarget): Promise<Song | null> {
  const data = await radioPost<{ songs: unknown[] }>('pet.nkp.radio.songs.add', {
    sources: [input],
  }, { target })
  return data.songs[0] ? normalizeSong(data.songs[0]) : null
}

export async function xrpcFetchPlaylists(target?: RadioTarget): Promise<Playlist[]> {
  const data = await radioGet<{ playlists: unknown[] }>('pet.nkp.radio.playlists.list', { target })
  return data.playlists.map(normalizePlaylist)
}

export async function xrpcCreatePlaylist(name: string, songIds: string[], target?: RadioTarget): Promise<Playlist> {
  const data = await radioPost<{ playlist?: unknown }>('pet.nkp.radio.playlists.modify', {
    action: 'create',
    name,
    songIds,
  }, { target })
  return normalizePlaylist(data.playlist)
}

export async function xrpcDeletePlaylist(playlistId: string, target?: RadioTarget): Promise<void> {
  await radioPost('pet.nkp.radio.playlists.modify', {
    action: 'delete',
    playlistId,
  }, { target })
}

export async function xrpcLoadPlaylist(
  playlistId: string,
  replace: boolean,
  target?: RadioTarget,
  shuffle?: boolean,
): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot?: unknown }>('pet.nkp.radio.playlists.modify', {
    action: 'load',
    playlistId,
    replace,
    ...(shuffle === undefined ? {} : { shuffle }),
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

/** Applies one of the playlist-editing actions and returns the updated set. */
async function xrpcEditPlaylist(payload: Record<string, unknown>, target?: RadioTarget): Promise<Playlist> {
  const data = await radioPost<{ playlist?: unknown }>('pet.nkp.radio.playlists.modify', payload, { target })
  return normalizePlaylist(data.playlist)
}

export function xrpcRenamePlaylist(playlistId: string, name: string, target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'rename', playlistId, name }, target)
}

export function xrpcAddPlaylistTracks(playlistId: string, songIds: string[], target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'addTracks', playlistId, songIds }, target)
}

export function xrpcRemovePlaylistTrack(playlistId: string, position: number, target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'removeTrack', playlistId, position }, target)
}

export function xrpcReorderPlaylistTracks(playlistId: string, songIds: string[], target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'reorder', playlistId, songIds }, target)
}

export function xrpcDuplicatePlaylist(playlistId: string, name: string, target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'duplicate', playlistId, name }, target)
}

export function xrpcSequencePlaylistTracks(playlistId: string, target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'sequenceTracks', playlistId }, target)
}

export function xrpcSetPlaylistShuffleOnLoad(playlistId: string, shuffleOnLoad: boolean, target?: RadioTarget): Promise<Playlist> {
  return xrpcEditPlaylist({ action: 'setShuffleOnLoad', playlistId, shuffleOnLoad }, target)
}

export async function xrpcSetLoopMode(loopMode: LoopMode, target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.control', {
    action: 'setLoopMode',
    intent: 'explicit_admin_action',
    loopMode,
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

/** Pins the set that reloads when the queue drains; `null` unpins it. */
export async function xrpcSetLoopPlaylist(playlistId: string | null, target?: RadioTarget): Promise<RadioSnapshot> {
  const data = await radioPost<{ snapshot: unknown }>('pet.nkp.radio.control', {
    action: 'setLoopPlaylist',
    intent: 'explicit_admin_action',
    ...(playlistId ? { loopPlaylistId: playlistId } : {}),
  }, { target })
  return normalizeSnapshot(data.snapshot)
}

export async function xrpcSendChatMessage(text: string, target?: RadioTarget): Promise<ChatMessage> {
  const data = await radioPost<{ message: unknown }>('pet.nkp.radio.chat.send', { text }, { target })
  return normalizeChatMessage(data.message)
}

export async function xrpcFetchChatBans(target?: RadioTarget): Promise<ChatBan[]> {
  const data = await radioGet<{ bans: unknown[] }>('pet.nkp.radio.chat.bans.list', { target })
  return data.bans.map(normalizeChatBan)
}

export async function xrpcCreateChatBan(did: string, reason?: string, target?: RadioTarget): Promise<ChatBan> {
  const data = await radioPost<{ ban?: unknown }>('pet.nkp.radio.chat.bans.modify', {
    action: 'create',
    did,
    reason: reason ?? null,
  }, { target })
  return normalizeChatBan(data.ban)
}

export async function xrpcRemoveChatBan(did: string, target?: RadioTarget): Promise<void> {
  await radioPost('pet.nkp.radio.chat.bans.modify', { action: 'remove', did }, { target })
}

export async function xrpcDeleteChatMessage(messageId: string, target?: RadioTarget): Promise<void> {
  await radioPost('pet.nkp.radio.chat.messages.modify', {
    action: 'delete',
    messageId,
  }, { target })
}

export async function xrpcSearchSubsonic(
  creds: SubsonicCreds,
  query: string,
  target?: RadioTarget,
): Promise<SubsonicSongResult[]> {
  const data = await radioPost<{ results: unknown[] }>('pet.nkp.radio.subsonic.search', {
    ...creds,
    query,
  }, { target })
  return data.results.map(normalizeSubsonicResult)
}

export async function xrpcImportFromSubsonic(
  creds: SubsonicCreds,
  songId: string,
  coverArtId: string | null | undefined,
  addToQueue: boolean,
  target?: RadioTarget,
): Promise<Song> {
  const data = await radioPost<{ song: unknown }>('pet.nkp.radio.subsonic.import', {
    source: 'song',
    ...creds,
    songId,
    coverArtId: coverArtId ?? undefined,
    addToQueue,
  }, { target })
  return normalizeSong(data.song)
}

export async function xrpcImportFromSubsonicShare(
  shareUrl: string,
  addToQueue: boolean,
  target?: RadioTarget,
): Promise<Song> {
  const data = await radioPost<{ song: unknown }>('pet.nkp.radio.subsonic.import', {
    source: 'share',
    shareUrl,
    addToQueue,
  }, { target })
  return normalizeSong(data.song)
}

async function getServiceAuthToken(session: Session, nsid: string, target?: RadioTarget): Promise<string> {
  const pds = session.info.server.issuer.replace(/\/+$/, '')
  const audience = await radioAudience(target)

  const serviceAuthUrl = new URL(`${pds}/xrpc/com.atproto.server.getServiceAuth`)
  serviceAuthUrl.searchParams.append('aud', audience)
  serviceAuthUrl.searchParams.append('lxm', nsid)
  serviceAuthUrl.searchParams.append('exp', (Math.floor(Date.now() / 1000) + 60 * 30).toString())

  const response = await new OAuthUserAgent(session).handle(
    `${serviceAuthUrl.pathname}${serviceAuthUrl.search}`,
    {
      method: 'GET',
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`failed to get service auth: ${error}`)
  }

  const data = await response.json() as { token: string }
  return data.token
}

async function radioGet<T>(
  nsid: string,
  options: { session?: Session; target?: RadioTarget } = {},
): Promise<T> {
  if (isLocalTarget(options.target)) {
    const session = options.session ?? await requiredSession()
    const token = await getServiceAuthToken(session, nsid, options.target)
    const base = serviceBase(options.target)
    const response = await fetch(`${base}/xrpc/${nsid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    })
    if (!response.ok) {
      throw new ClientResponseError({
        status: response.status,
        headers: response.headers,
        data: await response.json().catch(() => ({ error: 'UnknownXRPCError' })),
      })
    }
    return await response.json() as T
  }

  const client = await radioClient(options.session ?? await requiredSession(), options.target)
  return await ok(client.get(nsid, { as: 'json' })) as T
}

async function radioPost<T = unknown>(
  nsid: string,
  input?: Record<string, unknown>,
  options: { target?: RadioTarget } = {},
): Promise<T> {
  if (isLocalTarget(options.target)) {
    const session = await requiredSession()
    const token = await getServiceAuthToken(session, nsid, options.target)
    const base = serviceBase(options.target)
    const response = await fetch(`${base}/xrpc/${nsid}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: input ? JSON.stringify(input) : undefined,
    })
    if (!response.ok) {
      throw new ClientResponseError({
        status: response.status,
        headers: response.headers,
        data: await response.json().catch(() => ({ error: 'UnknownXRPCError' })),
      })
    }
    return await response.json() as T
  }

  const client = await radioClient(await requiredSession(), options.target)
  return await ok(client.post(nsid, { input, as: 'json' })) as T
}

async function radioMultipart<T>(nsid: string, formData: FormData, target?: RadioTarget): Promise<T> {
  const session = await requiredSession()

  if (isLocalTarget(target)) {
    const token = await getServiceAuthToken(session, nsid, target)
    const base = serviceBase(target)
    const response = await fetch(`${base}/xrpc/${nsid}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    })
    if (!response.ok) {
      throw new ClientResponseError({
        status: response.status,
        headers: response.headers,
        data: await response.json().catch(() => ({ error: 'UnknownXRPCError' })),
      })
    }
    return await response.json() as T
  }

  const proxy = await radioProxyTarget(target)
  const headers: Record<string, string> = {}
  if (proxy) {
    headers['atproto-proxy'] = proxy
  }
  const response = await new OAuthUserAgent(session).handle(`/xrpc/${nsid}`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    throw new ClientResponseError({
      status: response.status,
      headers: response.headers,
      data: await response.json().catch(() => ({ error: 'UnknownXRPCError' })),
    })
  }

  return await response.json() as T
}

async function radioClient(session: Session, target?: RadioTarget): Promise<LooseClient> {
  return new Client<Record<string, unknown>, Record<string, unknown>>({
    handler: new OAuthUserAgent(session),
    proxy: await radioProxyTarget(target),
  })
}

async function requiredSession(): Promise<Session> {
  const session = await activeSession()
  if (!session) {
    throw new Error('sign in before using radio xrpcs.')
  }
  return session
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
}

async function activeSession(options?: { allowStale?: boolean }): Promise<Session | null> {
  configureRadioOAuth()
  const activeDid = localStorage.getItem(ACTIVE_DID_KEY)
  if (activeDid) {
    try {
      return await withTimeout(
        getSession(activeDid as Did, { allowStale: options?.allowStale }),
        5000,
        'stored oauth session timed out',
      )
    } catch (error) {
      console.warn('stored oauth session failed', error)
      if (!(error instanceof Error) || !error.message.includes('timed out')) {
        localStorage.removeItem(ACTIVE_DID_KEY)
      }
    }
  }

  for (const did of listStoredSessions()) {
    try {
      const session = await withTimeout(
        getSession(did, { allowStale: options?.allowStale }),
        5000,
        'stored oauth session timed out',
      )
      localStorage.setItem(ACTIVE_DID_KEY, session.info.sub)
      return session
    } catch (error) {
      console.warn('oauth session restore failed', error)
    }
  }

  return null
}

async function finalizeCallbackIfPresent(): Promise<Session | null> {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  const params = new URLSearchParams(hash)
  if (!params.has('state') || (!params.has('code') && !params.has('error'))) {
    return null
  }

  try {
    const { session } = await finalizeAuthorization(params)
    localStorage.setItem(ACTIVE_DID_KEY, session.info.sub)
    sessionStorage.removeItem(LAST_AUTH_ERROR_KEY)
    return session
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth callback failed'
    sessionStorage.setItem(LAST_AUTH_ERROR_KEY, message)
    return null
  } finally {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)
  }
}

function configureRadioOAuth(): void {
  if (oauthConfigured) return

  configureOAuth({
    metadata: {
      client_id: oauthClientId(),
      redirect_uri: oauthRedirectUri(),
    },
    identityResolver: new LocalActorResolver({
      handleResolver: new XrpcHandleResolver({ serviceUrl: 'https://public.api.bsky.app' }),
      didDocumentResolver: new CompositeDidDocumentResolver({
        methods: {
          plc: new PlcDidDocumentResolver(),
          web: new WebDidDocumentResolver(),
        },
      }),
    }),
    storageName: 'sister-radio-oauth',
  })
  oauthConfigured = true
}

function oauthScope(): string {
  return import.meta.env.VITE_OAUTH_SCOPE || DEFAULT_SCOPE
}

function oauthRedirectUri(): string {
  const configured = import.meta.env.VITE_OAUTH_REDIRECT_URI
  if (configured) return configured

  const origin = window.location.origin.replace('http://localhost:', 'http://127.0.0.1:')
  return `${origin}/auth`
}

function oauthClientId(): string {
  const configured = import.meta.env.VITE_OAUTH_CLIENT_ID
  if (configured) return configured

  const redirectUri = oauthRedirectUri()
  if (redirectUri.startsWith('http://127.0.0.1:')) {
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      scope: oauthScope(),
    })
    return `http://localhost?${params.toString()}`
  }

  return new URL('/client-metadata.json', serviceBase()).href
}

function serviceBase(target?: RadioTarget): string {
  return normalizeBase(target?.baseUrl) || normalizeBase(API_BASE) || window.location.origin
}

function normalizeBase(base?: string | null): string {
  return (base ?? '').trim().replace(/\/+$/, '')
}

function isLocalhost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || host === '::1'
}

function isLocalTarget(target?: RadioTarget): boolean {
  const base = serviceBase(target)
  try {
    const url = new URL(base)
    return isLocalhost(url.hostname)
  } catch {
    return false
  }
}

function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (host.startsWith('127.') || host === '0.0.0.0') return true
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true
  const [first, second] = host.split('.').map((part) => Number(part))
  return first === 172 && Number.isFinite(second) && second >= 16 && second <= 31
}

function isPublicDid(did: string | null | undefined): boolean {
  const value = (did ?? '').trim().toLowerCase()
  if (!value) return false
  
  return !value.startsWith('did:web:localhost')
    && !value.startsWith('did:web:127.')
    && !value.startsWith('did:web:0.0.0.0')
}

function defaultProxyTargetLooksPublic(): boolean {
  if (isLocalTarget()) {
    return true
  }

  if (isPublicDid(RADIO_SERVICE_DID)) return true

  try {
    const url = new URL(serviceBase())
    return url.protocol === 'https:' && !isLoopbackOrPrivateHost(url.hostname)
  } catch {
    return false
  }
}

async function radioAudience(target?: RadioTarget): Promise<string> {
  const configured = target?.did || RADIO_SERVICE_DID
  if (configured) return configured

  const base = serviceBase(target)
  const cached = audienceCache.get(base)
  if (cached) return cached

  const promise = fetch(new URL('/.well-known/atproto-did', base).href, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error('failed to load radio service did')
    }
    return (await response.text()).trim()
  })
  audienceCache.set(base, promise)
  return promise
}

async function radioProxyTarget(target?: RadioTarget): Promise<AtprotoAudience | undefined> {
  if (typeof window !== 'undefined' && isLocalhost(window.location.hostname)) {
    return undefined
  }

  const did = await radioAudience(target)
  const rawServiceId = target?.serviceId || RADIO_SERVICE_ID || '#radio_xrpc'
  const serviceId = rawServiceId.startsWith('#') ? rawServiceId : `#${rawServiceId}`
  return `${did}${serviceId}` as AtprotoAudience
}

function normalizeSong(value: unknown): Song {
  const data = asRecord(value, 'song')
  return {
    id: stringValue(data.id),
    title: stringValue(data.title),
    artist: stringValue(data.artist),
    album: nullableString(data.album),
    genre: nullableString(data.genre),
    durationSeconds: nullableNumber(data.durationSeconds),
    mimeType: nullableString(data.mimeType),
    hasCover: Boolean(data.hasCover),
    addedByDid: stringValue(data.addedByDid),
    createdAt: numberValue(data.createdAt),
    loudnessLufs: nullableNumber(data.loudnessLufs),
    loudnessPeak: nullableNumber(data.loudnessPeak),
  }
}

function normalizeQueueItem(value: unknown): QueueItem {
  const data = asRecord(value, 'queue item')
  return {
    id: stringValue(data.id),
    position: numberValue(data.position),
    queuedByDid: stringValue(data.queuedByDid),
    isShuffle: Boolean(data.isShuffle),
    songId: stringValue(data.songId),
    song: data.song ? normalizeSong(data.song) : undefined,
    title: stringValue(data.title),
    artist: stringValue(data.artist),
    album: nullableString(data.album),
    durationSeconds: nullableNumber(data.durationSeconds),
    addedByDid: stringValue(data.addedByDid),
  }
}

function normalizeRadioState(value: unknown): RadioState {
  const data = asRecord(value, 'radio state')
  return {
    currentSongId: nullableString(data.currentSongId),
    status: data.status === 'paused' || data.status === 'stopped' ? data.status : 'playing',
    startedAt: nullableNumber(data.startedAt),
    pausedAt: nullableNumber(data.pausedAt),
    positionSeconds: numberValue(data.positionSeconds),
    updatedByDid: nullableString(data.updatedByDid),
    shuffle: Boolean(data.shuffle),
    loopMode: data.loopMode === 'one' || data.loopMode === 'queue' ? data.loopMode : 'off',
    loopPlaylistId: nullableString(data.loopPlaylistId),
  }
}

function normalizeSnapshot(value: unknown): RadioSnapshot {
  const data = asRecord(value, 'radio snapshot')
  return {
    state: normalizeRadioState(data.state),
    currentSong: data.currentSong ? normalizeSong(data.currentSong) : null,
    nowPlaying: data.nowPlaying ? normalizeSong(data.nowPlaying) : null,
    queue: Array.isArray(data.queue) ? data.queue.map(normalizeQueueItem) : [],
  }
}

function normalizeAlbum(value: unknown): RadioAlbum {
  const data = asRecord(value, 'album')
  return {
    id: stringValue(data.id),
    title: stringValue(data.title),
    position: numberValue(data.position),
    isEnabled: Boolean(data.isEnabled),
    tracks: Array.isArray(data.tracks) ? data.tracks.map(normalizeSong) : [],
  }
}

function normalizePlaylist(value: unknown): Playlist {
  const data = asRecord(value, 'playlist')
  return {
    id: stringValue(data.id),
    name: stringValue(data.name),
    createdAt: numberValue(data.createdAt),
    shuffleOnLoad: Boolean(data.shuffleOnLoad),
    tracks: Array.isArray(data.tracks) ? data.tracks.map(normalizeSong) : [],
  }
}

function normalizeChatMessage(value: unknown): ChatMessage {
  const data = asRecord(value, 'chat message')
  const kind = data.kind === 'now_playing' ? 'now_playing' : 'user'
  return {
    id: stringValue(data.id),
    senderDid: stringValue(data.senderDid),
    body: stringValue(data.body),
    createdAt: numberValue(data.createdAt),
    kind,
  }
}

function normalizeChatBan(value: unknown): ChatBan {
  const data = asRecord(value, 'chat ban')
  return {
    did: stringValue(data.did),
    bannedByDid: stringValue(data.bannedByDid),
    reason: nullableString(data.reason),
    createdAt: numberValue(data.createdAt),
  }
}

function normalizeSubsonicResult(value: unknown): SubsonicSongResult {
  const data = asRecord(value, 'subsonic result')
  return {
    id: stringValue(data.id),
    title: stringValue(data.title),
    artist: stringValue(data.artist),
    album: nullableString(data.album),
    durationSeconds: nullableNumber(data.durationSeconds),
    coverArtId: nullableString(data.coverArtId),
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`invalid ${label} response`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : 0
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}
