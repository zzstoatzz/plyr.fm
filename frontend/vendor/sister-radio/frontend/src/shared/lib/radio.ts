import { API_BASE, BASE_URL, SYNDICATION_WORKER_BASE } from './config'
import {
  xrpcAlbumsList,
  xrpcClearQueue,
  xrpcControlRadio,
  xrpcCreateChatBan,
  xrpcCreatePlaylist,
  xrpcDeleteAlbum,
  xrpcDeleteChatMessage,
  xrpcDeletePlaylist,
  xrpcDeleteSong,
  xrpcEnqueueSongs,
  xrpcFetchChatBans,
  xrpcFetchPlaylists,
  xrpcImportFromSubsonic,
  xrpcImportFromSubsonicShare,
  xrpcLoadPlaylist,
  xrpcRemoveChatBan,
  xrpcRemoveQueueItem,
  xrpcReorderQueue,
  xrpcQueueList,
  xrpcSearchSubsonic,
  xrpcSendChatMessage,
  xrpcSetAlbumEnabled,
  xrpcSetAlbumWeight,
  xrpcMergeAlbums,
  xrpcSongsList,
  xrpcUpdateSongMetadata,
  xrpcUploadSong,
  xrpcUploadSongCover,
  xrpcUploadSongFromUrl,
  type RadioTarget,
} from './radioXrpc'

export { API_BASE, BASE_URL, SYNDICATION_WORKER_BASE, type RadioTarget }

const VIEWER_ID_KEY = 'radio_viewer_id'

export interface Song {
  id: string
  title: string
  artist: string
  album?: string | null
  genre?: string | null
  durationSeconds?: number | null
  mimeType?: string | null
  hasCover: boolean
  addedByDid: string
  createdAt: number
  loudnessLufs?: number | null
  loudnessPeak?: number | null
}

export interface RadioAlbum {
  id: string
  title: string
  position: number
  isEnabled: boolean
  tracks: Song[]
}

export interface QueueItem {
  id: string
  position: number
  queuedByDid: string
  /** True when the row was auto-filled by shuffle mode rather than queued by an admin. */
  isShuffle?: boolean
  songId: string
  song?: Song
  title: string
  artist: string
  album?: string | null
  durationSeconds?: number | null
  addedByDid: string
}

export interface RadioState {
  currentSongId?: string | null
  status: 'playing' | 'paused' | 'stopped'
  startedAt?: number | null
  pausedAt?: number | null
  positionSeconds: number
  updatedByDid?: string | null
  /** Station-wide shuffle mode: empty-queue fallback plays random songs. */
  shuffle?: boolean
  /** How finished queue tracks are recycled. */
  loopMode?: LoopMode
  /** Set that reloads automatically whenever the queue drains. */
  loopPlaylistId?: string | null
}

/**
 * Queue recycling modes. `queue` sends finished tracks to the back instead of
 * dropping them; `one` repeats the current track. Distinct from `loopPlaylistId`,
 * which reloads a saved set once the queue is empty.
 */
export type LoopMode = 'off' | 'one' | 'queue'

export interface RadioSeek {
  positionSeconds: number
}

export interface RadioSnapshot {
  state: RadioState
  currentSong?: Song | null
  nowPlaying?: Song | null
  queue: QueueItem[]
}

export interface SyndicatedStation {
  did: string
  uri: string
  cid?: string | null
  rev: string
  url: string
  name: string
  description?: string | null
  updatedAt: string
  indexedAt: string
}

export type RadioEvent = {
  type: 'snapshotChanged'
  snapshot: RadioSnapshot
} | {
  type: 'viewerCountChanged'
  viewerCount?: number
  viewer_count?: number
  listenerDids?: string[]
  listener_dids?: string[]
} | {
  type: 'viewerKeepalive'
} | {
  /** A listener tapped the heart; the station relays it to everyone. */
  type: 'heart'
  did?: string | null
}

export interface SongUploadInput {
  file: File
  title: string
  artist: string
  album?: string
  genre?: string
  durationSeconds?: number
  cover?: File | null
  addToQueue: boolean
}

export interface SongMetadataInput {
  title: string
  artist: string
  album?: string | null
  genre?: string | null
  durationSeconds?: number | null
}

export interface UrlSongInput {
  url: string
  title?: string
  artist?: string
  album?: string
  addToQueue: boolean
}

function normalizeBase(base?: string | null): string {
  return (base ?? '').trim().replace(/\/+$/, '')
}

function isLocalhost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || host === '::1'
}

function isLocalTarget(target?: RadioTarget): boolean {
  const base = normalizeBase(target?.baseUrl || API_BASE)
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '')
  try {
    const url = new URL(origin)
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

export function canUseRadioXrpcTarget(target?: RadioTarget): boolean {
  if (target?.baseUrl && new URL(target.baseUrl, window.location.origin).pathname.startsWith('/stations/')) return false
  if (isLocalTarget(target)) {
    return true
  }

  if (target?.did) return isPublicDid(target.did)

  const base = normalizeBase(target?.baseUrl || API_BASE)
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '')
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && !isLoopbackOrPrivateHost(url.hostname)
  } catch {
    return false
  }
}

export function radioApiUrl(path: string, base: string | null | undefined = API_BASE): string {
  return `${normalizeBase(base)}${path}`
}

function socketUrl(path: string, base: string | null | undefined = API_BASE): string {
  const normalized = normalizeBase(base)
  if (normalized) {
    const url = new URL(normalized)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${path}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.port === '5173'
    ? `${window.location.hostname}:3000`
    : window.location.host
  return `${protocol}//${host}${path}`
}

export function songAudioUrl(songId: string, base: string | null | undefined = API_BASE): string {
  return radioApiUrl(`/api/songs/${encodeURIComponent(songId)}/audio`, base)
}

// Covers used to be served as immutable for a year, so browsers never asked
// again even after a cover was replaced. They now revalidate with ETags; the
// version query gives already-cached copies a fresh URL, once.
const COVER_URL_VERSION = 'v=2'

export function songCoverUrl(songId: string, base: string | null | undefined = API_BASE): string {
  return radioApiUrl(`/api/songs/${encodeURIComponent(songId)}/cover?${COVER_URL_VERSION}`, base)
}

export function songCoverThumbnailUrl(songId: string, base: string | null | undefined = API_BASE): string {
  return radioApiUrl(`/api/songs/${encodeURIComponent(songId)}/cover/thumbnail?${COVER_URL_VERSION}`, base)
}

/**
 * Loads the current public radio snapshot.
 * @param base Optional radio base URL. Defaults to the current radio.
 * @returns The current radio state and queue.
 * @throws Error When the backend request fails.
 */
export async function fetchRadioSnapshot(target?: RadioTarget, authenticated?: boolean): Promise<RadioSnapshot> {
  if (authenticated && canUseRadioXrpcTarget(target)) {
    try {
      return await xrpcQueueList(target)
    } catch (error) {
      console.warn('xrpc queue.list failed, falling back to public radio state', error)
    }
  }
  const base = target?.baseUrl || API_BASE
  const response = await fetch(radioApiUrl('/api/radio/state', base), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('failed to load radio state')
  }
  return (await response.json()) as RadioSnapshot
}

/**
 * Loads the current backend seek position in seconds.
 * @param base Optional radio base URL. Defaults to the current radio.
 * @returns The current seek position.
 * @throws Error When the backend request fails.
 */
export async function fetchRadioSeek(base: string | null | undefined = API_BASE): Promise<RadioSeek> {
  const response = await fetch(radioApiUrl('/api/radio/seek', base), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('failed to load radio seek')
  }

  return (await response.json()) as RadioSeek
}

/**
 * Opens a websocket for realtime radio events.
 * @param base Optional radio base URL. Defaults to the current radio.
 * @returns A connected websocket instance.
 */
export function openRadioSocket(base: string | null | undefined = API_BASE): WebSocket {
  return new WebSocket(socketUrl('/api/radio/ws', base))
}

/**
 * Returns this tab's stable viewer id for websocket presence.
 * @returns A UUID-like id scoped to the current browser tab.
 */
export function getRadioViewerId(): string {
  const stored = window.sessionStorage.getItem(VIEWER_ID_KEY)
  if (stored) return stored

  const viewerId = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  window.sessionStorage.setItem(VIEWER_ID_KEY, viewerId)
  return viewerId
}

export function sendRadioViewerHello(socket: WebSocket, viewerId: string, did?: string | null): void {
  socket.send(JSON.stringify({ type: 'viewerHello', viewer_id: viewerId, did: did ?? null }))
}

export function sendRadioViewerKeepalive(socket: WebSocket, viewerId: string, did?: string | null): void {
  socket.send(JSON.stringify({ type: 'viewerKeepalive', viewer_id: viewerId, did: did ?? null }))
}

export function sendRadioHeart(socket: WebSocket): void {
  socket.send(JSON.stringify({ type: 'heart' }))
}

export const MAX_CHAT_BODY_LEN = 1000

export type ChatMessageKind = 'user' | 'now_playing'

export interface ChatMessage {
  id: string
  senderDid: string
  body: string
  createdAt: number
  kind: ChatMessageKind
}

export type ChatEvent =
  | { type: 'history'; messages: ChatMessage[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'messageDeleted'; id: string }
  | { type: 'messagesPurged'; senderDid: string }

export interface ChatBan {
  did: string
  bannedByDid: string
  reason?: string | null
  createdAt: number
}

export async function deleteChatMessage(messageId: string, target?: RadioTarget): Promise<void> {
  await xrpcDeleteChatMessage(messageId, target)
}

export async function fetchChatBans(target?: RadioTarget): Promise<ChatBan[]> {
  return xrpcFetchChatBans(target)
}

export async function createChatBan(did: string, reason?: string, target?: RadioTarget): Promise<ChatBan> {
  return xrpcCreateChatBan(did, reason, target)
}

export async function removeChatBan(did: string, target?: RadioTarget): Promise<void> {
  await xrpcRemoveChatBan(did, target)
}

/**
 * Opens a websocket for the relayed chat channel.
 * @param base Optional radio base URL. Defaults to the current radio.
 * @returns A connected websocket instance.
 */
export function openChatSocket(base: string | null | undefined = API_BASE): WebSocket {
  return new WebSocket(socketUrl('/api/radio/chat/ws', base))
}

export async function sendChatMessage(text: string, target?: RadioTarget): Promise<ChatMessage> {
  return xrpcSendChatMessage(text, target)
}

const LISTENER_OPT_OUT_KEY = 'radio_listener_opt_out'

export function getListenerOptOut(): boolean {
  return localStorage.getItem(LISTENER_OPT_OUT_KEY) === 'on'
}

export function setListenerOptOut(optOut: boolean): void {
  localStorage.setItem(LISTENER_OPT_OUT_KEY, optOut ? 'on' : 'off')
}

/**
 * Loads all songs added to the radio library.
 * @returns Songs ordered by newest first.
 * @throws Error When the backend request fails.
 */
export async function fetchAlbums(target?: RadioTarget): Promise<RadioAlbum[]> {
  return xrpcAlbumsList(target)
}


/**
 * Deletes an album loop.
 * @param albumId Album loop id.
 * @returns Remaining album loops.
 * @throws Error When the backend request fails.
 */
export async function deleteAlbum(albumId: string, target?: RadioTarget): Promise<RadioAlbum[]> {
  return xrpcDeleteAlbum(albumId, target)
}

/**
 * Enables or disables an album loop.
 * @param albumId Album loop id.
 * @param enabled Whether the album should loop.
 * @returns Updated album loops.
 * @throws Error When the backend request fails.
 */
export async function setAlbumEnabled(albumId: string, enabled: boolean, target?: RadioTarget): Promise<RadioAlbum[]> {
  return xrpcSetAlbumEnabled(albumId, enabled, target)
}

export async function setAlbumWeight(albumId: string, weight: number, target?: RadioTarget): Promise<RadioAlbum[]> {
  return xrpcSetAlbumWeight(albumId, weight, target)
}

export interface PlayHistoryItem {
  songId: string
  title: string
  artist: string
  startedAt: number
}

export interface RotationUpNext {
  songId: string
  title: string
  artist: string
  source: string
}

export interface RotationInfo {
  weights: Record<string, number>
  recentlyPlayed: PlayHistoryItem[]
  upNext?: RotationUpNext | null
}

export async function fetchRotationInfo(target?: RadioTarget): Promise<RotationInfo | null> {
  const base = target?.baseUrl || API_BASE
  // This endpoint is ours only — upstream sister-radio stations 404 it. The
  // rotation peek is decorative, so unavailable means null, never a throw: a
  // rejected resource here takes the whole page's reactive graph down.
  try {
    const response = await fetch(radioApiUrl('/api/radio/rotation-info', base), { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json() as RotationInfo
  } catch {
    return null
  }
}

/**
 * Merges a duplicate source album into a target album.
 * @param albumId Source album id to merge and delete.
 * @param targetAlbumId Target/destination album id.
 * @returns Updated album loops.
 * @throws Error When the backend request fails.
 */
export async function mergeAlbums(albumId: string, targetAlbumId: string, target?: RadioTarget): Promise<RadioAlbum[]> {
  return xrpcMergeAlbums(albumId, targetAlbumId, target)
}

/**
 * Loads all songs added to the radio library.
 * @returns Songs ordered by newest first.
 * @throws Error When the backend request fails.
 */
export async function fetchSongs(target?: RadioTarget, authenticated?: boolean): Promise<Song[]> {
  if (authenticated && canUseRadioXrpcTarget(target)) {
    try {
      return await xrpcSongsList(target)
    } catch (error) {
      console.warn('xrpc songs.list failed, falling back to public songs', error)
    }
  }
  const base = target?.baseUrl || API_BASE
  const response = await fetch(radioApiUrl('/api/songs', base), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('failed to load songs')
  }
  return (await response.json()) as Song[]
}

export async function fetchSyndicatedStations(
  workerBase: string | null | undefined = SYNDICATION_WORKER_BASE,
): Promise<SyndicatedStation[]> {
  const base = normalizeBase(workerBase)
  if (!base) return []

  try {
    const response = await fetch(`${base}/stations`, { cache: 'no-store' })
    if (!response.ok) {
      console.warn('failed to load syndicated stations', response.status)
      return []
    }
    return (await response.json()) as SyndicatedStation[]
  } catch (error) {
    console.warn('failed to reach syndication worker', error)
    return []
  }
}

/**
 * Adds existing songs to the queue.
 * @param songIds Song ids to enqueue, in order.
 * @param atTop Jump them ahead of everything already queued instead of appending.
 * @returns The updated radio snapshot.
 * @throws Error When the backend request fails.
 */
export async function enqueueAlbum(
  songIds: string[],
  target?: RadioTarget,
  atTop = false,
  sequence = false,
): Promise<RadioSnapshot> {
  return xrpcEnqueueSongs(songIds, target, atTop, sequence)
}

export async function enqueueSong(songId: string, target?: RadioTarget, atTop = false): Promise<RadioSnapshot> {
  return xrpcEnqueueSongs([songId], target, atTop)
}

/**
 * Removes a queue item.
 * @param queueId Queue item id to remove.
 * @returns The updated radio snapshot.
 * @throws Error When the backend request fails.
 */
export async function removeQueueItem(queueId: string, target?: RadioTarget): Promise<RadioSnapshot> {
  return xrpcRemoveQueueItem(queueId, target)
}

/**
 * Clears every item from the queue.
 * @returns The updated radio snapshot.
 * @throws Error When the backend request fails.
 */
export async function clearQueue(target?: RadioTarget): Promise<RadioSnapshot> {
  return xrpcClearQueue(target)
}

/**
 * Reorders the queue using the supplied ordered list of queue ids.
 * @param queueIds Queue item ids in the desired order.
 * @returns The updated radio snapshot.
 * @throws Error When the backend request fails.
 */
export async function reorderQueue(queueIds: string[], target?: RadioTarget): Promise<RadioSnapshot> {
  return xrpcReorderQueue(queueIds, target)
}

/**
 * Uploads an audio file as a new song.
 * @param input Song upload form values.
 * @returns The created song.
 * @throws Error When upload fails.
 */
export async function uploadSong(input: SongUploadInput, target?: RadioTarget): Promise<Song> {
  try {
    return await xrpcUploadSong(input, target)
  } catch (error) {
    throw new Error(error instanceof Error && error.message.includes('UnsupportedAudio')
      ? 'upload playlist files together with their referenced audio tracks.'
      : 'song upload failed')
  }
}

/**
 * Uploads or replaces a song album cover.
 * @param songId Song id to update.
 * @param cover Cover image file.
 * @returns Updated song metadata.
 * @throws Error When upload fails.
 */
export async function uploadSongCover(songId: string, cover: File, target?: RadioTarget): Promise<Song> {
  return xrpcUploadSongCover(songId, cover, target)
}

/**
 * Updates editable song metadata.
 * @param songId Song id to update.
 * @param input Updated song metadata.
 * @returns Updated song metadata.
 * @throws Error When update fails.
 */
export async function updateSongMetadata(songId: string, input: SongMetadataInput, target?: RadioTarget): Promise<Song> {
  return xrpcUpdateSongMetadata(songId, input, target)
}

/**
 * Deletes a song from the library and queue.
 * @param songId Song id to delete.
 * @returns Updated radio snapshot.
 * @throws Error When deletion fails.
 */
export async function deleteSong(songId: string, target?: RadioTarget): Promise<RadioSnapshot> {
  return xrpcDeleteSong(songId, target)
}

/**
 * Sends an admin radio control action.
 * @param action Playback action to perform.
 * @returns The updated radio snapshot.
 * @throws Error When the control request fails.
 */
export interface SubsonicCreds {
  serverUrl: string
  username: string
  password: string
}

export interface SubsonicSongResult {
  id: string
  title: string
  artist: string
  album?: string | null
  durationSeconds?: number | null
  coverArtId?: string | null
}

const SUBSONIC_CREDS_KEY = 'radio_subsonic_creds'

export function loadSubsonicCreds(): SubsonicCreds {
  try {
    return JSON.parse(localStorage.getItem(SUBSONIC_CREDS_KEY) ?? '{}') as SubsonicCreds
  } catch {
    return { serverUrl: '', username: '', password: '' }
  }
}

export function saveSubsonicCreds(creds: SubsonicCreds): void {
  localStorage.setItem(SUBSONIC_CREDS_KEY, JSON.stringify(creds))
}

export async function searchSubsonic(creds: SubsonicCreds, query: string, target?: RadioTarget): Promise<SubsonicSongResult[]> {
  return xrpcSearchSubsonic(creds, query, target)
}

export async function importFromSubsonic(
  creds: SubsonicCreds,
  songId: string,
  coverArtId: string | null | undefined,
  addToQueue: boolean,
  target?: RadioTarget,
): Promise<Song> {
  return xrpcImportFromSubsonic(creds, songId, coverArtId, addToQueue, target)
}

export async function importFromSubsonicShare(
  shareUrl: string,
  addToQueue: boolean,
  target?: RadioTarget,
): Promise<Song> {
  return xrpcImportFromSubsonicShare(shareUrl, addToQueue, target)
}

export async function uploadSongFromUrl(input: UrlSongInput, target?: RadioTarget): Promise<Song | null> {
  try {
    return await xrpcUploadSongFromUrl(input, target)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw new Error(
      message.includes('source_unavailable')
        ? 'that video is unavailable (removed, private, or region-locked).'
        : message.includes('url_fetch_failed')
          ? 'could not fetch audio from that url.'
          : message.includes('playlist_requires_batch_import')
            ? 'nested playlists are not supported yet.'
            : 'url import failed',
    )
  }
}

export async function controlRadio(
  action: 'play' | 'pause' | 'stop' | 'skip' | 'shuffle',
  intent: 'explicit_admin_action',
  target?: RadioTarget,
): Promise<RadioSnapshot> {
  return xrpcControlRadio(action, intent, target)
}

export interface Playlist {
  id: string
  name: string
  createdAt: number
  /** Randomize this set's order every time it is loaded into the queue. */
  shuffleOnLoad: boolean
  tracks: Song[]
}

export async function fetchPlaylists(target?: RadioTarget): Promise<Playlist[]> {
  return xrpcFetchPlaylists(target)
}

export async function createPlaylist(name: string, songIds: string[], target?: RadioTarget): Promise<Playlist> {
  return xrpcCreatePlaylist(name, songIds, target)
}

export async function deletePlaylist(playlistId: string, target?: RadioTarget): Promise<void> {
  await xrpcDeletePlaylist(playlistId, target)
}

export async function loadPlaylist(
  playlistId: string,
  replace: boolean,
  target?: RadioTarget,
  shuffle?: boolean,
): Promise<RadioSnapshot> {
  return xrpcLoadPlaylist(playlistId, replace, target, shuffle)
}

export {
  xrpcRenamePlaylist as renamePlaylist,
  xrpcAddPlaylistTracks as addPlaylistTracks,
  xrpcRemovePlaylistTrack as removePlaylistTrack,
  xrpcReorderPlaylistTracks as reorderPlaylistTracks,
  xrpcDuplicatePlaylist as duplicatePlaylist,
  xrpcSetPlaylistShuffleOnLoad as setPlaylistShuffleOnLoad,
  xrpcSequencePlaylistTracks as sequencePlaylistTracks,
  xrpcSequenceQueue as sequenceQueue,
  xrpcSetLoopMode as setLoopMode,
  xrpcSetLoopPlaylist as setLoopPlaylist,
} from './radioXrpc'
