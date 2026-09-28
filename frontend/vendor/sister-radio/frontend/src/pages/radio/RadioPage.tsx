import type { RadioIntegration } from '../../shared/lib/integration'
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import { Check, ChevronLeft, ChevronRight, Clapperboard, Eye, Heart, PictureInPicture2, Pause, Play, RadioTower, Send, Share2, Volume2, VolumeX } from 'lucide-solid'
import { resolveAtprotoProfile, type AtprotoProfile } from '../../shared/lib/atproto'
import {
  fetchRadioSnapshot,
  fetchRotationInfo,
  fetchSongs,
  fetchSyndicatedStations,
  canUseRadioXrpcTarget,
  getListenerOptOut,
  getRadioViewerId,
  MAX_CHAT_BODY_LEN,
  openChatSocket,
  openRadioSocket,
  sendChatMessage,
  sendRadioHeart,
  sendRadioViewerHello,
  sendRadioViewerKeepalive,
  songAudioUrl,
  songCoverUrl as standaloneSongCoverUrl,
  SYNDICATION_WORKER_BASE,
  type ChatEvent,
  type ChatMessage,
  type QueueItem,
  type RadioEvent,
  type RadioState,
  type Song,
} from '../../shared/lib/radio'
import type { SessionResponse } from '../../shared/lib/auth'
import {
  isPlaceholderStation,
  labelFromStationUrl,
  normalizeStationUrl,
  readSelectedStationUrl,
  selectedTuneInStationFrom,
  sameTuneInStation,
  sameTuneInStations,
  stationListKey,
  stationRadioTarget,
  stationResourceKey as tuneInStationResourceKey,
  TUNE_IN_CHANGED_EVENT,
  tuneInStationsFrom,
  writeSelectedStationUrl,
  type TuneInStation,
} from '../../shared/lib/stationSelection'
import { PaginationRow } from '../../shared/components/PaginationRow'
import { ProfileAvatar } from '../../shared/components/ProfileAvatar'
import { SongCoverThumb } from '../../shared/components/SongCoverThumb'
import { EqualizerPanel, createEqualizerController } from '../../features/equalizer/EqualizerPanel'
import { createSongPrefetcher } from '../../features/playback/songPrefetch'
import { createPagedList } from '../../shared/primitives/createPagedList'
import { scrobbleEnabled, scrobblePlay, scrobbleThresholdSeconds, setNowPlayingStatus, type HeardTrack } from '../../features/listening/teal'
import { composeShareUrl, postShare, type ShareTrack } from '../../features/listening/share'

interface AlbumAccent {
  primary: string
  secondary: string
  primaryWash: string
  secondaryWash: string
  topWash: string
}

const DEFAULT_ALBUM_ACCENT: AlbumAccent = {
  primary: '190 124 143',
  secondary: '125 104 119',
  primaryWash: 'rgb(190 124 143 / 0%)',
  secondaryWash: 'rgb(125 104 119 / 0%)',
  topWash: 'rgb(190 124 143 / 0%)',
}

const SYNDICATION_REFRESH_MS = 10_000
// Matches the backend's CHAT_HISTORY_LIMIT (src/chat.rs).
const CHAT_HISTORY_LIMIT = 100
function fallbackProfile(did: string): AtprotoProfile {
  return { did, handle: did }
}

function readVolumeCookie(): number {
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('radio_volume='))
    ?.split('=')[1]
  const volume = Number(value)
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8
}

function writeVolumeCookie(volume: number): void {
  document.cookie = `radio_volume=${volume}; Max-Age=31536000; Path=/; SameSite=Lax`
}

// iOS silently ignores volume writes on media elements — and on some
// versions the property still echoes the written value back, so a
// write-then-read probe reports success while nothing audible changes.
// Treat element volume as uncontrollable there so callers fall back to the
// Web Audio gain, which is the only volume control iOS actually honors.
function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

function setElementVolume(audioElement: HTMLAudioElement, nextVolume: number): boolean {
  if (isIosDevice()) return false
  audioElement.volume = nextVolume
  return Math.abs(audioElement.volume - nextVolume) < 0.001
}

// Mobile browsers suspend <audio> in the background once it's routed through a
// Web Audio graph (MediaElementSource). iOS Safari is strict about it; Android
// is inconsistent but vulnerable on lock screen / battery saver. So the EQ
// panel is not offered on mobile at all, and the graph stays detached there.
// Desktop keeps visualizer + EQ from the start.
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPad|iPhone|iPod|Mobi/i.test(navigator.userAgent)) return true
  // iPadOS reports as Macintosh; touch points disambiguate it from real Macs.
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

interface RadioPageProps {
  integration?: RadioIntegration
  session?: SessionResponse
  /** `embed` renders only a compact player, for /embed. */
  variant?: 'page' | 'embed'
  /** Station URL an embed is pinned to (from `?station=`). */
  stationUrl?: string | null
  /** Transparent, control-free embed for stream overlays (`?overlay`). */
  overlay?: boolean
}

function rgbToHsl(red: number, green: number, blue: number): { hue: number; saturation: number; lightness: number } {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2

  if (max === min) {
    return { hue: 0, saturation: 0, lightness }
  }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = (() => {
    if (max === r) return (g - b) / delta + (g < b ? 6 : 0)
    if (max === g) return (b - r) / delta + 2
    return (r - g) / delta + 4
  })() / 6

  return { hue, saturation, lightness }
}

function themeColorFromAccent(accent: AlbumAccent): string {
  const [r, g, b] = accent.primary.split(' ').map(Number)
  if (![r, g, b].every(Number.isFinite)) return '#1e1e1e'
  // Blend the primary toward #1e1e1e ~78% so the status bar reads as a darkened
  // tint of the album rather than the saturated color.
  const blend = (channel: number, base: number) => Math.round(channel * 0.22 + base * 0.78)
  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return `#${toHex(blend(r, 0x1e))}${toHex(blend(g, 0x1e))}${toHex(blend(b, 0x1e))}`
}

function setMetaThemeColor(color: string): void {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const meta = existing ?? document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  if (!existing) document.head.append(meta)
}

function accentFromRgb(primary: { red: number; green: number; blue: number }, secondary: { red: number; green: number; blue: number }): AlbumAccent {
  return {
    primary: `${primary.red} ${primary.green} ${primary.blue}`,
    secondary: `${secondary.red} ${secondary.green} ${secondary.blue}`,
    primaryWash: `rgb(${primary.red} ${primary.green} ${primary.blue} / 30%)`,
    secondaryWash: `rgb(${secondary.red} ${secondary.green} ${secondary.blue} / 24%)`,
    topWash: `rgb(${primary.red} ${primary.green} ${primary.blue} / 12%)`,
  }
}

function extractAlbumAccent(image: HTMLImageElement): AlbumAccent {
  const canvas = document.createElement('canvas')
  const width = 28
  const height = 28
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return DEFAULT_ALBUM_ACCENT
  context.drawImage(image, 0, 0, width, height)

  const pixels = context.getImageData(0, 0, width, height).data
  const buckets = new Map<string, { red: number; green: number; blue: number; count: number; score: number }>()
  let neutralRed = 0
  let neutralGreen = 0
  let neutralBlue = 0
  let neutralCount = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (alpha < 180) continue

    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const { saturation, lightness } = rgbToHsl(red, green, blue)
    if (lightness >= 0.12 && lightness <= 0.88) {
      neutralRed += red
      neutralGreen += green
      neutralBlue += blue
      neutralCount += 1
    }
    if (saturation < 0.22 || lightness < 0.12 || lightness > 0.88) continue

    const key = `${Math.round(red / 24)}:${Math.round(green / 24)}:${Math.round(blue / 24)}`
    const existing = buckets.get(key) ?? { red: 0, green: 0, blue: 0, count: 0, score: 0 }
    existing.red += red
    existing.green += green
    existing.blue += blue
    existing.count += 1
    existing.score += saturation * (1 - Math.abs(lightness - 0.52))
    buckets.set(key, existing)
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      score: bucket.score * Math.log2(bucket.count + 1),
    }))
    .sort((left, right) => right.score - left.score)

  if (ranked.length === 0 && neutralCount > 0) {
    const neutral = {
      red: Math.round(neutralRed / neutralCount),
      green: Math.round(neutralGreen / neutralCount),
      blue: Math.round(neutralBlue / neutralCount),
    }
    const lift = 24
    return accentFromRgb(neutral, {
      red: Math.min(255, neutral.red + lift),
      green: Math.min(255, neutral.green + lift),
      blue: Math.min(255, neutral.blue + lift),
    })
  }

  const primary = ranked[0] ?? { red: 255, green: 55, blue: 95 }
  const secondary = ranked.find((candidate) => Math.abs(candidate.red - primary.red) + Math.abs(candidate.green - primary.green) + Math.abs(candidate.blue - primary.blue) > 80)
    ?? ranked[1]
    ?? { red: 255, green: 149, blue: 0 }

  return accentFromRgb(primary, secondary)
}

/**
 * Renders the public listener radio view.
 * @returns The radio page view.
 */
export default function RadioPage(props: RadioPageProps) {
  let radioRoot: HTMLElement | undefined
  const embed = props.variant === 'embed'
  const songCoverUrl = (id: string, base?: string | null) => props.integration ? props.integration.covers[id] ?? '' : standaloneSongCoverUrl(id, base)
  // An embed pinned with ?station= plays that station regardless of what this
  // browser last tuned to, and never writes its own choice back.
  const pinnedStationUrl = embed ? normalizeStationUrl(props.stationUrl) || null : null
  const [selectedStationUrl, setSelectedStationUrl] = createSignal(pinnedStationUrl ?? readSelectedStationUrl())
  const [syndicatedStations, { refetch: refetchSyndicatedStations }] = createResource(
    () => props.integration ? 'disabled' : SYNDICATION_WORKER_BASE || 'disabled',
    (workerBase) => workerBase === 'disabled' ? Promise.resolve([]) : fetchSyndicatedStations(workerBase),
  )
  // The worker returns a new JSON array on every poll. Keep the derived
  // directory stable when its values have not changed so polling cannot
  // restart station-bound effects (notably the live listener socket).
  const tuneInStations = createMemo(
    () => props.integration?.stations ?? tuneInStationsFrom(syndicatedStations() ?? []),
    undefined,
    { equals: sameTuneInStations },
  )
  const selectedStation = createMemo(
    () => selectedTuneInStationFrom(tuneInStations(), props.integration?.selectedStationUrl ?? selectedStationUrl()),
    undefined,
    { equals: sameTuneInStation },
  )
  const selectedApiBase = createMemo(() => selectedStation().apiBase)
  const selectedStationKey = createMemo(() => tuneInStationResourceKey(selectedStation()))
  const selectedRadioTarget = createMemo(
    () => stationRadioTarget(selectedStation()),
    undefined,
    { equals: (prev, next) => prev?.did === next?.did && prev?.baseUrl === next?.baseUrl }
  )
  const selectedRadioCanUseXrpc = createMemo(() => canUseRadioXrpcTarget(selectedRadioTarget()))
  const canUseRadioXrpc = createMemo(() => Boolean(props.session?.authenticated) && selectedRadioCanUseXrpc())
  // While the standalone client waits for the station directory, the selected
  // station is a placeholder with no API base; a null key keeps resources idle
  // so nothing fetches against the static host serving this page.
  const stationResourceKey = createMemo(() => props.integration || isPlaceholderStation(selectedStation()) ? null : ({
    key: selectedStationKey(),
    authenticated: canUseRadioXrpc(),
    target: selectedRadioTarget(),
  }), undefined, {
    equals: (prev, next) =>
      prev?.key === next?.key &&
      prev?.authenticated === next?.authenticated &&
      prev?.target.did === next?.target.did &&
      prev?.target.baseUrl === next?.target.baseUrl
  })
  const [fetchedSnapshot, { mutate, refetch }] = createResource(stationResourceKey, ({ target, authenticated }) => fetchRadioSnapshot(target, authenticated))
  const snapshot = () => props.integration?.snapshot ?? fetchedSnapshot()
  const [songs, { refetch: refetchSongs }] = createResource(stationResourceKey, ({ target, authenticated }) => fetchSongs(target, authenticated))
  const [profiles, setProfiles] = createSignal<Record<string, AtprotoProfile>>({})
  const inFlightDids = new Set<string>()
  const [standaloneVolume, setStandaloneVolume] = createSignal(props.integration?.volume ?? readVolumeCookie())
  const volume = createMemo(() => props.integration?.volume ?? standaloneVolume())
  const setVolume = (value: number) => props.integration ? props.integration.setVolume(value) : setStandaloneVolume(value)
  // Level to restore when un-muting; the createEffect on volume() applies any
  // change (cookie, equalizer, element volume), so mute is just volume 0.
  let preMuteVolume = volume() > 0 ? volume() : 0.8
  const toggleMute = () => {
    if (volume() > 0) {
      preMuteVolume = volume()
      setVolume(0)
    } else {
      setVolume(preMuteVolume > 0 ? preMuteVolume : 0.8)
    }
  }
  // Once the Web Audio graph is attached its output gain applies the volume,
  // so the element stays at full level; before that the element carries it.
  const applyElementVolume = (audioElement: HTMLAudioElement, nextVolume: number): boolean => {
    if (equalizer.graphAttached()) {
      audioElement.volume = 1
      return true
    }
    return setElementVolume(audioElement, nextVolume)
  }
  const [hasStarted, setHasStarted] = createSignal(false)
  const [standalone_isAudioPlaying, setIsAudioPlaying] = createSignal<boolean>(false)
  const isAudioPlaying = () => props.integration ? props.integration.playing ?? false : standalone_isAudioPlaying()
  const [standalone_viewerCount, setViewerCount] = createSignal<number>(0)
  const viewerCount = () => props.integration ? props.integration.listenerCount ?? 0 : standalone_viewerCount()
  const [standalone_listenerDids, setListenerDids] = createSignal<string[]>([])
  const listenerDids = () => props.integration ? props.integration.listenerDids ?? [] : standalone_listenerDids()
  const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = createSignal('')
  const [chatConnected, setChatConnected] = createSignal(false)
  let chatSocket: WebSocket | null = null
  let chatLogRef: HTMLDivElement | undefined
  const [listenerOverflowOpen, setListenerOverflowOpen] = createSignal(false)

  createEffect(() => {
    if (props.integration) return
    if (pinnedStationUrl) return
    const syncSelectedStation = () => setSelectedStationUrl(readSelectedStationUrl())
    window.addEventListener('storage', syncSelectedStation)
    window.addEventListener(TUNE_IN_CHANGED_EVENT, syncSelectedStation)
    onCleanup(() => {
      window.removeEventListener('storage', syncSelectedStation)
      window.removeEventListener(TUNE_IN_CHANGED_EVENT, syncSelectedStation)
    })
  })
  const MAX_VISIBLE_LISTENERS = 8
  const visibleListenerDids = () => listenerDids().slice(0, MAX_VISIBLE_LISTENERS)
  const overflowListenerDids = () => listenerDids().slice(MAX_VISIBLE_LISTENERS)
  const [albumAccent, setAlbumAccent] = createSignal<AlbumAccent>(DEFAULT_ALBUM_ACCENT)
  let lastAmbientKey = ''
  const [volumeOverlayActive, setVolumeOverlayActive] = createSignal(false)
  let volumeOverlayTimeout: ReturnType<typeof setTimeout> | null = null
  let volumeOverlayInitialized = false

  const volumeMeterChars = () => {
    const v = Math.max(0, Math.min(1, volume()))
    const cells = 14
    const filled = Math.round(v * cells)
    return '█'.repeat(filled) + '▁'.repeat(cells - filled)
  }

  // Local playback state. Frontend self-advances through localQueue; backend
  // resyncs only on admin actions (detected via playbackKey diff).
  const [standalone_localCurrentSong, setLocalCurrentSong] = createSignal<Song | null>(null)
  const localCurrentSong = () => props.integration ? props.integration.snapshot?.currentSong ?? null : standalone_localCurrentSong()
  const [standalone_localQueue, setLocalQueue] = createSignal<QueueItem[]>([])
  const localQueue = standalone_localQueue
  let consumedQueueIds = new Set<string>()
  let lastPlaybackKey: string | null = null
  let emptyQueueEndSyncTimer: number | null = null
  let audioRef: HTMLAudioElement | undefined
  const narrowScreen = window.matchMedia('(max-width: 860px)')
  const [onMobile, setOnMobile] = createSignal(narrowScreen.matches)
  const onScreenChange = () => setOnMobile(narrowScreen.matches)
  narrowScreen.addEventListener('change', onScreenChange)
  onCleanup(() => narrowScreen.removeEventListener('change', onScreenChange))
  const equalizer = createEqualizerController(() => audioRef)
  const songPrefetcher = createSongPrefetcher()
  onCleanup(() => songPrefetcher.dispose())
  const viewerId = props.integration ? '' : getRadioViewerId()
  let previousSelectedStationKey: string | null = null
  let handledTuneInAutoplay = 0
  const [tuneInAutoplayVersion, setTuneInAutoplayVersion] = createSignal(0)
  createEffect(() => {
    if (props.integration) return
    const timer = window.setInterval(() => {
      void refetchSyndicatedStations()
    }, SYNDICATION_REFRESH_MS)
    onCleanup(() => window.clearInterval(timer))
  })
  createEffect(() => {
    if (props.integration) return
    const key = selectedStationKey()
    if (previousSelectedStationKey === null) {
      previousSelectedStationKey = key
      return
    }
    if (key === previousSelectedStationKey) return
    previousSelectedStationKey = key

    consumedQueueIds = new Set()
    lastPlaybackKey = null
    setLocalCurrentSong(null)
    setLocalQueue([])
    setViewerCount(0)
    setListenerDids([])
    setChatMessages([])
    setChatDraft('')
    setChatConnected(false)
    setListenerOverflowOpen(false)
    if (emptyQueueEndSyncTimer !== null) {
      window.clearTimeout(emptyQueueEndSyncTimer)
      emptyQueueEndSyncTimer = null
    }
    if (audioRef) {
      audioRef.pause()
      audioRef.removeAttribute('src')
      audioRef.load()
    }
  })
  // Re-read on socket events so an in-tab opt-out toggle takes effect on next
  // keepalive without forcing the user to reload.
  const listenerDid = (): string | null => {
    if (getListenerOptOut()) return null
    return props.session?.accountDid ?? null
  }

  const playbackKey = (state: RadioState | undefined) =>
    state ? `${state.currentSongId ?? ''}|${state.status}|${state.startedAt ?? ''}|${state.pausedAt ?? ''}` : ''

  const lookupSong = (id: string): Song | null =>
    (songs() ?? []).find((song) => song.id === id) ?? null

  const queueItemAsSong = (item: QueueItem): Song =>
    lookupSong(item.songId) ?? item.song ?? {
      id: item.songId,
      title: item.title,
      artist: item.artist,
      album: item.album ?? null,
      genre: null,
      durationSeconds: item.durationSeconds ?? null,
      mimeType: null,
      hasCover: false,
      addedByDid: item.addedByDid,
      createdAt: 0,
    }

  const seekAudioTo = async (positionSeconds: number): Promise<void> => {
    if (!audioRef) return
    if (audioRef.readyState >= 1) {
      audioRef.currentTime = positionSeconds
      return
    }
    const element = audioRef
    // Whichever event fires first removes both listeners; `once` alone would
    // leave the other attached to the long-lived element on every seek.
    const listeners = new AbortController()
    await new Promise<void>((resolve) => {
      element.addEventListener('loadedmetadata', () => {
        element.currentTime = positionSeconds
        resolve()
      }, { signal: listeners.signal })
      element.addEventListener('error', () => resolve(), { signal: listeners.signal })
    })
    listeners.abort()
  }

  const applyBackendPlayback = async (state: RadioState, song: Song | null, songChanged: boolean) => {
    if (!audioRef) return
    if (!song || state.status === 'stopped') {
      audioRef.pause()
      return
    }
    if (songChanged) {
      const expected = (currentSongIdForAudio() === song.id ? currentAudioUrl() : undefined) ?? songAudioUrl(song.id, selectedApiBase())
      const alreadyLoaded = audioRef.src === expected ||
        (!expected.startsWith('blob:') && audioRef.src.endsWith(`/api/songs/${song.id}/audio`))
      if (!alreadyLoaded) {
        audioRef.src = expected
        audioRef.load()
      }
      await seekAudioTo(Math.max(0, state.positionSeconds))
    }
    if (state.status === 'playing' && hasStarted()) {
      void audioRef.play().catch(() => undefined)
    } else if (state.status === 'paused') {
      audioRef.pause()
    }
  }

  // Merges incoming queue items with the current localQueue, reusing the
  // existing object reference whenever an id is unchanged. Snapshots arrive
  // with all-new objects on every WS push, so without this <For> would remount
  // every row on every broadcast.
  const mergeQueue = (incoming: QueueItem[]): QueueItem[] => {
    const existing = new Map(untrack(() => localQueue()).map((item) => [item.id, item]))
    return incoming.map((item) => {
      const prev = existing.get(item.id)
      if (
        prev &&
        prev.songId === item.songId &&
        prev.position === item.position &&
        prev.queuedByDid === item.queuedByDid &&
        prev.title === item.title &&
        prev.artist === item.artist &&
        prev.album === item.album &&
        prev.durationSeconds === item.durationSeconds &&
        prev.addedByDid === item.addedByDid
      ) {
        return prev
      }
      return item
    })
  }

  createEffect(() => {
    if (!props.integration) return
    setLocalQueue(mergeQueue(props.integration.snapshot?.queue ?? []))
  })

  const applyMergedQueue = (incoming: QueueItem[]) => {
    const filtered = incoming.filter((item) => !consumedQueueIds.has(item.id))
    setLocalQueue(mergeQueue(filtered))
  }

  // Snapshot diff: cold-start init, admin-action resync, queue-only merge.
  // Compare song id against what's locally playing, not against the previous
  // snapshot — the frontend self-advances ahead of the backend, so a snapshot
  // arriving with the song we already moved to should not trigger a reload.
  createEffect(() => {
    if (props.integration) return
    const snap = snapshot()
    if (!snap) return
    const key = playbackKey(snap.state)
    const isFirst = lastPlaybackKey === null

    if (isFirst || key !== lastPlaybackKey) {
      const prevSongId = untrack(() => localCurrentSong())?.id ?? null
      const newSongId = snap.currentSong?.id ?? null
      const songChanged = prevSongId !== newSongId

      lastPlaybackKey = key
      if (songChanged) {
        consumedQueueIds = new Set()
        setLocalQueue(snap.queue)
        setLocalCurrentSong(snap.currentSong ?? null)
      } else {
        applyMergedQueue(snap.queue)
      }
      if (!isFirst) {
        void applyBackendPlayback(snap.state, snap.currentSong ?? null, songChanged)
      }
    } else {
      applyMergedQueue(snap.queue)
    }
  })

  // Hearts: tapping sends one over the radio socket, and the station relays it
  // to every listener (sender included), so each heart floats up for everyone.
  let liveRadioSocket: WebSocket | null = null
  let nextHeartId = 0
  const [floatingHearts, setFloatingHearts] = createSignal<{ id: number; drift: number }[]>([])
  const floatHeart = () => {
    const id = nextHeartId++
    const drift = Math.round((Math.random() - 0.5) * 70)
    // Cap what's on screen so a flurry stays a flurry, not a wall.
    setFloatingHearts((hearts) => [...hearts.slice(-23), { id, drift }])
    window.setTimeout(() => setFloatingHearts((hearts) => hearts.filter((heart) => heart.id !== id)), 1800)
  }
  const heartLabel = () => props.integration ? (props.integration.liked ? 'unlike this track' : 'like this track') : 'send a heart'
  const sendHeart = () => {
    if (props.integration) return props.integration.likeTrack()
    if (liveRadioSocket?.readyState === WebSocket.OPEN) sendRadioHeart(liveRadioSocket)
  }

  createEffect(() => {
    if (props.integration) return
    if (isPlaceholderStation(selectedStation())) return
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      socket = openRadioSocket(selectedApiBase())
      liveRadioSocket = socket

      socket.addEventListener('open', () => {
        reconnectAttempt = 0
        if (socket) {
          sendRadioViewerHello(socket, viewerId, listenerDid())
        }
      })

      socket.addEventListener('message', (message) => {
        const event = JSON.parse(message.data) as RadioEvent
        if (event.type === 'snapshotChanged') {
          mutate(event.snapshot)
          // Don't refetch songs/albums here — most snapshot events are queue
          // mutations that don't affect the library. Local actions that do
          // change the library refetch explicitly.
        } else if (event.type === 'viewerCountChanged') {
          const count = event.viewerCount ?? event.viewer_count
          if (typeof count === 'number' && Number.isFinite(count)) {
            setViewerCount(count)
          }
          const dids = event.listenerDids ?? event.listener_dids
          if (Array.isArray(dids)) {
            setListenerDids(dids.filter((value): value is string => typeof value === 'string'))
          }
        } else if (event.type === 'viewerKeepalive' && socket?.readyState === WebSocket.OPEN) {
          sendRadioViewerKeepalive(socket, viewerId, listenerDid())
        } else if (event.type === 'heart') {
          floatHeart()
        }
      })

      const scheduleReconnect = () => {
        if (cancelled || reconnectTimer !== null) return
        // Refetch on every drop so state stays fresh while we wait to reopen.
        void refetch()
        void refetchSongs()
        const delay = Math.min(30000, 500 * 2 ** Math.min(reconnectAttempt, 6))
        reconnectAttempt += 1
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delay)
      }

      socket.addEventListener('close', scheduleReconnect)
      socket.addEventListener('error', () => socket?.close())
    }

    connect()

    onCleanup(() => {
      cancelled = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    })
  })

  createEffect(() => {
    if (props.integration) return
    // The embed never shows chat, so it doesn't hold a chat socket open.
    if (embed || isPlaceholderStation(selectedStation())) return
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      chatSocket = openChatSocket(selectedApiBase())

      chatSocket.addEventListener('open', () => {
        reconnectAttempt = 0
        setChatConnected(true)
      })

      chatSocket.addEventListener('message', (message) => {
        const event = JSON.parse(message.data) as ChatEvent
        if (event.type === 'history') {
          setChatMessages(event.messages)
        } else if (event.type === 'message') {
          // The station replays its last CHAT_HISTORY_LIMIT messages on
          // connect; keep the live list to the same size so a tab left open
          // all day doesn't grow a row per song forever.
          setChatMessages((current) => [...current, event.message].slice(-CHAT_HISTORY_LIMIT))
        } else if (event.type === 'messageDeleted') {
          setChatMessages((current) => current.filter((entry) => entry.id !== event.id))
        } else if (event.type === 'messagesPurged') {
          setChatMessages((current) => current.filter((entry) => entry.senderDid !== event.senderDid))
        }
      })

      const scheduleReconnect = () => {
        setChatConnected(false)
        if (cancelled || reconnectTimer !== null) return
        const delay = Math.min(30000, 500 * 2 ** Math.min(reconnectAttempt, 6))
        reconnectAttempt += 1
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delay)
      }

      chatSocket.addEventListener('close', scheduleReconnect)
      chatSocket.addEventListener('error', () => chatSocket?.close())
    }

    connect()

    onCleanup(() => {
      cancelled = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      chatSocket?.close()
      chatSocket = null
    })
  })

  // Auto-scroll the chat log to the newest message when it changes.
  createEffect(() => {
    if (props.integration) return
    chatMessages()
    if (chatLogRef) {
      queueMicrotask(() => {
        if (chatLogRef) chatLogRef.scrollTop = chatLogRef.scrollHeight
      })
    }
  })

  const canSendChat = () => Boolean(props.session?.accountDid) && chatConnected() && selectedRadioCanUseXrpc()

  const [shareStatus, setShareStatus] = createSignal<string | null>(null)
  // The share button's own state, since chat (and its status line) isn't on phones.
  const [shareButtonState, setShareButtonState] = createSignal<'idle' | 'armed' | 'posting' | 'done' | 'failed'>('idle')
  let shareStateTimer: number | undefined
  const setShareButtonFor = (state: 'idle' | 'armed' | 'posting' | 'done' | 'failed', resetAfterMs?: number) => {
    window.clearTimeout(shareStateTimer)
    setShareButtonState(state)
    if (resetAfterMs) shareStateTimer = window.setTimeout(() => setShareButtonState('idle'), resetAfterMs)
  }
  onCleanup(() => window.clearTimeout(shareStateTimer))
  const shareNow = (track: ShareTrack, note?: string) => {
    setShareStatus('sharing to bluesky…')
    setShareButtonFor('posting')
    void postShare(track, note)
      .then(() => {
        setShareStatus('shared to bluesky ✓')
        setShareButtonFor('done', 3000)
      })
      .catch((error) => {
        console.warn('share failed', error)
        setShareStatus('share failed, try again')
        setShareButtonFor('failed', 3000)
      })
      .finally(() => window.setTimeout(() => setShareStatus(null), 4000))
  }
  // Posting is public, so the button takes a second tap to confirm.
  const onShareButton = (track: ShareTrack) => {
    const state = shareButtonState()
    if (state === 'posting') return
    if (state === 'armed') {
      shareNow(track)
      return
    }
    setShareButtonFor('armed', 4000)
  }
  const shareButtonLabel = () => {
    switch (shareButtonState()) {
      case 'armed': return 'tap again to post to bluesky'
      case 'posting': return 'posting to bluesky…'
      case 'done': return 'shared to bluesky'
      case 'failed': return 'share failed, tap to try again'
      default: return 'share on bluesky'
    }
  }
  const submitChat = () => {
    const text = chatDraft().trim()
    if (!text) return
    // `/share [note]` posts the current song to the listener's Bluesky
    // instead of the chat.
    if (/^\/share(\s|$)/.test(text)) {
      const track = shareTrack()
      if (!track) return
      setChatDraft('')
      shareNow(track, text.slice('/share'.length))
      return
    }
    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) return
    void sendChatMessage(text.slice(0, MAX_CHAT_BODY_LEN), selectedRadioTarget())
      .catch((error) => console.warn('chat send failed', error))
    setChatDraft('')
  }

  const formatChatTime = (createdAt: number): string => {
    const date = new Date(createdAt * 1000)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  createEffect(() => {
    if (props.integration) return
    const senders = chatMessages()
      .filter((message) => message.kind === 'user')
      .map((message) => message.senderDid)
    const dids = senders.filter(
      (did, index, values) => values.indexOf(did) === index && !profiles()[did] && !inFlightDids.has(did),
    )
    for (const did of dids) {
      inFlightDids.add(did)
      void resolveAtprotoProfile(did)
        .then((profile) => setProfiles((current) => ({ ...current, [did]: profile })))
        .finally(() => inFlightDids.delete(did))
    }
  })

  createEffect(() => {
    if (props.integration) return
    const currentSongDid = snapshot()?.currentSong?.addedByDid
    const dids = [
      ...(songs() ?? []).map((song) => song.addedByDid),
      ...(currentSongDid ? [currentSongDid] : []),
      ...(snapshot()?.queue ?? []).flatMap((item) => [item.addedByDid, item.queuedByDid]),
      ...listenerDids(),
    ].filter((did, index, values) => values.indexOf(did) === index && !profiles()[did] && !inFlightDids.has(did))

    for (const did of dids) {
      inFlightDids.add(did)
      void resolveAtprotoProfile(did)
        .then((profile) => setProfiles((current) => ({ ...current, [did]: profile })))
        .finally(() => inFlightDids.delete(did))
    }
  })

  const currentSong = () => localCurrentSong()
  const currentSongTitle = createMemo(() => currentSong()?.title ?? ((props.integration?.error ?? fetchedSnapshot.error) ? 'station unavailable' : (props.integration?.loading ?? fetchedSnapshot.loading) ? 'tuning in…' : 'off air'))
  const currentSongArtist = () => currentSong()?.artist ?? ((props.integration?.error ?? fetchedSnapshot.error) ? 'try another station or reload' : 'no eligible plyr.fm tracks on this station')
  const artistAlbumLine = () => currentSong()?.album ? `${currentSongArtist()} · ${currentSong()?.album}` : currentSongArtist()
  // Marquee only when the rendered title actually overflows its container;
  // character counts misjudge proportional glyph widths and viewport size.
  const [titleHeadingEl, setTitleHeadingEl] = createSignal<HTMLHeadingElement>()
  const [titleTextEl, setTitleTextEl] = createSignal<HTMLSpanElement>()
  const [shouldMarqueeTitle, setShouldMarqueeTitle] = createSignal(false)
  createEffect(() => {
    const heading = titleHeadingEl()
    const text = titleTextEl()
    currentSongTitle()
    if (!heading || !text) return
    // Drop the marquee first so a title change restarts the animation from
    // zero instead of swapping text into a half-scrolled track, then measure
    // on the next frame once the new title has laid out.
    setShouldMarqueeTitle(false)
    const measure = () => {
      const overflowing = text.scrollWidth > heading.clientWidth + 1
      // Classic <marquee>: enter from the right edge, travel until the tail
      // clears the left edge, repeat. Constant px/s keeps long titles from
      // whipping past. Values land before the marquee class flips on, so the
      // running animation is never retargeted.
      heading.style.setProperty('--marquee-start', `${heading.clientWidth}px`)
      const distance = heading.clientWidth + text.scrollWidth
      heading.style.setProperty('--marquee-duration', `${Math.min(45, Math.max(8, distance / 60))}s`)
      setShouldMarqueeTitle(overflowing)
    }
    const raf = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    observer.observe(text)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    })
  })
  const viewerCountValue = () => viewerCount() ?? 0
  const viewerCountLabel = () => props.integration?.listenerCount === null ? 'unavailable' : viewerCountValue().toString()

  createEffect(() => {
    if (props.integration) return
    const song = currentSong()
    equalizer.setLoudness({
      lufs: song?.loudnessLufs ?? null,
      peak: song?.loudnessPeak ?? null,
    })
  })

  createEffect(() => {
    if (props.integration) return
    const song = currentSong()
    if (!song?.hasCover) {
      setAlbumAccent(DEFAULT_ALBUM_ACCENT)
      return
    }

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = songCoverUrl(song.id, selectedApiBase())
    image.onload = () => {
      if (cancelled) return
      try {
        setAlbumAccent(extractAlbumAccent(image))
      } catch {
        setAlbumAccent(DEFAULT_ALBUM_ACCENT)
      }
    }
    image.onerror = () => {
      if (!cancelled) setAlbumAccent(DEFAULT_ALBUM_ACCENT)
    }

    onCleanup(() => {
      cancelled = true
      image.onload = null
      image.onerror = null
    })
  })

  createEffect(() => {
    if (props.integration) return
    const accent = albumAccent()
    const key = `${accent.primary}|${accent.secondary}|${accent.topWash}`
    if (key === lastAmbientKey) return
    lastAmbientKey = key

    // The desktop washes are part of the page background (global.css); these
    // registered colours fade between songs instead of crossfading layers.
    const root = document.documentElement.style
    root.setProperty('--ambient-a-wash', accent.primaryWash)
    root.setProperty('--ambient-b-wash', accent.secondaryWash)

    // iOS Safari ignores theme-color and tints its top bar from body's
    // background-color, never a gradient; global.css makes that the tint on
    // phones and starts the page gradient from it. Other browsers still read
    // the meta tag.
    const themeColor = themeColorFromAccent(accent)
    setMetaThemeColor(themeColor)
    document.documentElement.style.setProperty('--page-tint', themeColor)
  })


  // Each song plays from its fully downloaded in-memory copy when the
  // prefetch finished in time, otherwise from the network. The choice is made
  // once per song (keyed on its id) so a download finishing mid-song never
  // swaps the source under the listener.
  const currentSongIdForAudio = createMemo(() => localCurrentSong()?.id ?? null)
  const currentAudioUrl = createMemo(() => {
    const songId = currentSongIdForAudio()
    if (!songId) return undefined
    return untrack(() => songPrefetcher.objectUrlFor(songId)) ?? songAudioUrl(songId, selectedApiBase())
  })
  const profileFor = (did: string) => props.integration?.profiles[did] ?? profiles()[did] ?? fallbackProfile(did)
  const selectTuneInStation = (station: TuneInStation) => {
    if (props.integration) return props.integration.selectStation(station.url)
    const url = normalizeStationUrl(station.url)
    if (!url) return
    writeSelectedStationUrl(url)
    setSelectedStationUrl(url)
    setHasStarted(true)
    setTuneInAutoplayVersion((version) => version + 1)
  }
  const isSelectedStation = (station: TuneInStation) =>
    stationListKey(station.url) === stationListKey(selectedStation().url)
  const stationHost = (station: TuneInStation) => station.local ? station.name : labelFromStationUrl(station.url)
  const stationSubtitle = (station: TuneInStation) => {
    const name = station.name.trim()
    const host = stationHost(station)
    if (
      name &&
      name.toLowerCase() !== host.toLowerCase() &&
      name.toLowerCase() !== 'radio' &&
      name.toLowerCase() !== 'this radio'
    ) {
      return name
    }

    const description = station.description?.trim()
    return description || (station.local ? 'local preview' : 'public station')
  }
  const stationPresetName = (station: TuneInStation) => {
    const name = station.name.trim()
    if (name && name.toLowerCase() !== 'radio' && name.toLowerCase() !== 'this radio') return name
    return stationHost(station)
  }
  const selectedStationIndex = () => {
    const index = tuneInStations().findIndex(isSelectedStation)
    return Math.max(0, index)
  }
  const stationNeedlePosition = () => {
    const stationCount = tuneInStations().length
    if (stationCount <= 1) return 50
    return (selectedStationIndex() / (stationCount - 1)) * 100
  }
  const tuneStationBy = (offset: number, focusPreset = false) => {
    const stations = tuneInStations()
    if (stations.length <= 1) return
    const nextIndex = (selectedStationIndex() + offset + stations.length) % stations.length
    selectTuneInStation(stations[nextIndex])
    if (focusPreset) {
      queueMicrotask(() => {
        radioRoot?.querySelector<HTMLButtonElement>(`[data-station-preset="${nextIndex}"]`)?.focus()
      })
    }
  }
  const tuneInStatus = () => {
    if (syndicatedStations.loading) return 'scanning'
    return `${tuneInStations().length} stations`
  }
  const tuneInCard = () => (
    <section class="glass-card tune-in-card">
      <div class="section-heading">
        <p class="eyebrow">tuner</p>
        <span>{tuneInStatus()}</span>
      </div>
      <div class="station-tuner-readout" title={selectedStation().url}>
        <span class="station-tuner-signal" aria-hidden="true">
          <RadioTower size={17} strokeWidth={1.8} />
          <span class="station-tuner-signal-bars">
            <i />
            <i />
            <i />
          </span>
        </span>
        <div class="station-tuner-copy">
          <span class="station-tuner-label">{currentSong() ? 'on air' : 'off air'}</span>
          <strong aria-live="polite">{stationHost(selectedStation())}</strong>
          <small>{stationSubtitle(selectedStation())}</small>
        </div>
        <div class="station-tuner-stepper">
          <button
            type="button"
            aria-label="previous station"
            title="previous station"
            disabled={tuneInStations().length <= 1}
            onClick={() => tuneStationBy(-1)}
          >
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
          <span>{String(selectedStationIndex() + 1).padStart(2, '0')}</span>
          <button
            type="button"
            aria-label="next station"
            title="next station"
            disabled={tuneInStations().length <= 1}
            onClick={() => tuneStationBy(1)}
          >
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div class="station-tuner-dial" style={`--station-needle: ${stationNeedlePosition()}%`}>
        <span aria-hidden="true">88</span>
        <div
          class="station-tuner-track"
          role="radiogroup"
          aria-label="station presets"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault()
              event.stopPropagation()
              tuneStationBy(-1, true)
            }
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault()
              event.stopPropagation()
              tuneStationBy(1, true)
            }
          }}
        >
          <i aria-hidden="true" />
          <For each={tuneInStations()}>
            {(station, index) => {
              const stationCount = () => tuneInStations().length
              const presetPosition = () => (stationCount() <= 1 ? 50 : (index() / (stationCount() - 1)) * 100)
              return (
                <button
                  type="button"
                  role="radio"
                  class="station-tuner-preset"
                  style={`left: ${presetPosition()}%`}
                  aria-checked={isSelectedStation(station)}
                  aria-label={`tune in to ${stationHost(station)}${isSelectedStation(station) ? ' (selected)' : ''}`}
                  data-tooltip={`${stationPresetName(station)}${isSelectedStation(station) ? ' · selected' : ''}`}
                  tabIndex={isSelectedStation(station) ? 0 : -1}
                  data-station-preset={index()}
                  onClick={() => selectTuneInStation(station)}
                />
              )
            }}
          </For>
        </div>
        <span aria-hidden="true">108</span>
      </div>
      <Show when={!onMobile()}>
        <div class="station-tuner-links">
          <a
            href={embedUrl()}
            target="_blank"
            rel="noreferrer"
            title="open a small player window for this station"
            onClick={(event) => {
              // A sized popup rather than a tab, so it can sit in a corner.
              if (window.open(embedUrl(), 'radio-embed', 'popup,width=520,height=200')) event.preventDefault()
            }}
          >
            <PictureInPicture2 size={14} strokeWidth={1.8} />
            pop-out player
          </a>
          <Show when={!props.integration}><a href={embedUrl(true)} target="_blank" rel="noreferrer" title="transparent now-playing card for obs or a stream">
            <Clapperboard size={14} strokeWidth={1.8} />
            stream overlay
          </a></Show>
        </div>
      </Show>
    </section>
  )

  const chatCard = () => (
    <section class="glass-card chat-card">
      <div class="section-heading">
        <p class="eyebrow">chat</p>
        <span>{chatConnected() ? 'live' : 'offline'}</span>
      </div>
      <div class="chat-log" ref={chatLogRef}>
        <Show
          when={chatMessages().length > 0}
          fallback={<p class="muted chat-empty">no messages yet</p>}
        >
          <ul class="chat-message-list">
            <For each={chatMessages()}>
              {(message) => {
                if (message.kind === 'now_playing') {
                  return (
                    <li class="chat-now-playing">
                      <span class="chat-now-playing-label" aria-label="now playing">♪</span>
                      <span class="chat-now-playing-body">{message.body}</span>
                      <span class="chat-message-time">{formatChatTime(message.createdAt)}</span>
                    </li>
                  )
                }
                const profile = () => profileFor(message.senderDid)
                return (
                  <li class="chat-message">
                    <a
                      class="chat-message-avatar"
                      href={`https://bsky.app/profile/${profile().handle}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ProfileAvatar profile={profile()} class="chat-avatar" title={`@${profile().handle}`} />
                    </a>
                    <div class="chat-message-body">
                      <div class="chat-message-meta">
                        <span class="chat-message-handle">
                          {profile().displayName || `@${profile().handle}`}
                        </span>
                        <span class="chat-message-time">{formatChatTime(message.createdAt)}</span>
                      </div>
                      <p class="chat-message-text">{message.body}</p>
                    </div>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </div>
      <Show when={shareStatus()}>
        {(status) => <p class="chat-share-status" role="status">{status()}</p>}
      </Show>
      <form
        class="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          submitChat()
        }}
      >
        <Show
          when={props.session?.accountDid}
          fallback={<p class="muted chat-empty">log in to chat</p>}
        >
          <Show
            when={selectedRadioCanUseXrpc()}
            fallback={<p class="muted chat-empty">chat needs a public radio xrpc endpoint</p>}
          >
            <input
              class="chat-input"
              type="text"
              placeholder="say something nice, or /share"
              maxlength={MAX_CHAT_BODY_LEN}
              value={chatDraft()}
              onInput={(event) => setChatDraft(event.currentTarget.value)}
              disabled={!chatConnected()}
            />
            <button
              class="chat-send"
              type="submit"
              aria-label="send"
              disabled={!canSendChat() || chatDraft().trim().length === 0}
            >
              <Send size={16} />
            </button>
          </Show>
        </Show>
      </form>
    </section>
  )

  const queuePageSize = 5
  const upNextPaging = createPagedList(localQueue, queuePageSize)

  // Live progress readout. When actually listening, the audio element is the
  // truth; otherwise derive the position from the snapshot state plus
  // elapsed wall time.
  const [clock, setClock] = createSignal(Date.now())
  const [stateSyncedAt, setStateSyncedAt] = createSignal(Date.now())
  {
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    onCleanup(() => window.clearInterval(interval))
  }
  createEffect(() => {
    if (props.integration) return
    if (snapshot()) setStateSyncedAt(Date.now())
  })
  const liveDisplayPosition = () => {
    if (props.integration) return props.integration.position
    void clock()
    if (audioRef && isAudioPlaying()) return audioRef.currentTime
    const state = snapshot()?.state
    if (!state) return 0
    if (state.status !== 'playing') return state.positionSeconds
    return Math.max(0, state.positionSeconds + Math.floor((clock() - stateSyncedAt()) / 1000))
  }
  const formatClock = (seconds: number | null | undefined) => {
    if (!seconds || seconds < 0) return '0:00'
    const minutes = Math.floor(seconds / 60)
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
  }
  const songProgressPercent = () => {
    const duration = currentSong()?.durationSeconds
    return duration ? Math.min(100, (liveDisplayPosition() / duration) * 100) : 0
  }


  // Deterministic rotation peek, so an empty queue can still say what's next.
  const [rotationInfo, { refetch: refetchRotationInfo }] = createResource(
    stationResourceKey,
    ({ target }) => fetchRotationInfo(target),
  )
  createEffect(() => {
    if (props.integration) return
    void currentSong()?.id
    void refetchRotationInfo()
  })

  // Download the upcoming song in full while this one plays: the first queued
  // song, or the rotation's pick when the queue is empty. Only once the
  // listener is actually listening, and only the current and next songs are
  // kept in memory.
  const nextSongIdForPrefetch = createMemo(() => localQueue()[0]?.songId ?? rotationInfo()?.upNext?.songId ?? null)
  createEffect(() => {
    if (props.integration) return
    const currentId = currentSongIdForAudio()
    const nextId = nextSongIdForPrefetch()
    songPrefetcher.retain([currentId, nextId])
    if (nextId && nextId !== currentId && hasStarted()) {
      songPrefetcher.prefetch(nextId, songAudioUrl(nextId, selectedApiBase()))
    }
  })

  // The single upcoming track: queued songs first, then the rotation's pick,
  // the same order the up next card lists them in.
  const nextUpLine = () => {
    const queued = localQueue()[0]
    if (queued) return `${queued.title} — ${queued.artist || 'unknown artist'}`
    const fromRotation = rotationInfo()?.upNext
    return fromRotation ? `${fromRotation.title} — ${fromRotation.artist}` : null
  }

  // Public URL of the station being listened to; the local station has none
  // of its own, so it is wherever this page is served from.
  const stationPublicUrl = () => selectedStation().url || window.location.origin
  const embedUrl = (overlay = false) => {
    if (props.integration) return props.integration.embedUrl
    const params = new URLSearchParams()
    if (selectedStation().url) params.set('station', selectedStation().url)
    const query = params.toString()
    return `/embed${query ? `?${query}` : ''}${overlay ? `${query ? '&' : '?'}overlay` : ''}`
  }

  const shareTrack = (): ShareTrack | null => {
    const song = currentSong()
    if (!song) return null
    return {
      title: song.title,
      artist: song.artist,
      stationName: stationPresetName(selectedStation()),
      stationUrl: stationPublicUrl(),
      coverUrl: song.hasCover ? songCoverUrl(song.id, selectedApiBase()) : null,
      accentRgb: albumAccent().primary,
    }
  }

  // teal.fm: count the seconds this listener actually hears each song (audio
  // playing, not muted), set their now-playing status once it starts, and
  // scrobble once it crosses the half-or-four-minutes threshold. Keyed on the
  // song id so snapshot refreshes of the same song don't reset the count.
  const currentSongId = createMemo(() => currentSong()?.id ?? null)
  createEffect(() => {
    if (props.integration) return
    const songId = currentSongId()
    if (!songId || !props.session?.authenticated || !scrobbleEnabled()) return
    const song = untrack(currentSong)
    if (!song) return
    const stationUrl = untrack(stationPublicUrl)
    const threshold = scrobbleThresholdSeconds(song.durationSeconds)
    let heardSeconds = 0
    let heard: HeardTrack | null = null
    let statusSent = false
    let scrobbled = false
    const tick = window.setInterval(() => {
      if (!isAudioPlaying() || volume() === 0) return
      heard ??= {
        title: song.title,
        artist: song.artist,
        album: song.album,
        durationSeconds: song.durationSeconds,
        stationUrl,
        startedAt: new Date(),
      }
      heardSeconds += 1
      if (!statusSent && heardSeconds >= 2) {
        statusSent = true
        const remaining = song.durationSeconds ? song.durationSeconds - liveDisplayPosition() : null
        void setNowPlayingStatus(heard, remaining).catch((error) => console.warn('teal status failed', error))
      }
      if (!scrobbled && threshold !== null && heardSeconds >= threshold) {
        scrobbled = true
        void scrobblePlay(heard).catch((error) => console.warn('teal scrobble failed', error))
      }
    }, 1000)
    onCleanup(() => window.clearInterval(tick))
  })

  const upNextCard = () => (
    <section class="glass-card up-next-card">
      <div class="section-heading">
        <p class="eyebrow">up next</p>
        <span>{snapshot()?.state.status ?? 'loading'}</span>
      </div>
      <Show when={!(props.integration?.loading ?? fetchedSnapshot.loading)} fallback={<p class="muted">loading queue...</p>}>
        <ul class="queue-list">
          <For
            each={upNextPaging.paged()}
            fallback={
              <li class="muted up-next-rotation-peek">
                <Show when={rotationInfo()?.upNext} fallback={<>queue is empty</>}>
                  {(next) => <>next from rotation: {next().title} — {next().artist}</>}
                </Show>
              </li>
            }
          >
            {(item, index) => {
              const profile = () => profileFor(item.queuedByDid)
              const hasCover = () => props.integration ? Boolean(props.integration.covers[item.songId]) : (songs() ?? []).some((song) => song.id === item.songId && song.hasCover)
              return (
                <li>
                  <span class="queue-number">{upNextPaging.page() * queuePageSize + index() + 1}</span>
                  <SongCoverThumb coverUrl={props.integration?.covers[item.songId]} songId={item.songId} hasCover={hasCover()} baseUrl={selectedApiBase()} />
                  <div class="up-next-copy">
                    <span class="up-next-title">{item.title}</span>
                    <small class="up-next-artist">{item.artist || 'unknown artist'}</small>
                  </div>
                  <ProfileAvatar profile={profile()} class="up-next-profile-avatar" title={`@${profile().handle}`} />
                </li>
              )
            }}
          </For>
        </ul>
        <Show when={upNextPaging.pageCount() > 1}>
          <PaginationRow page={upNextPaging.page()} pageCount={upNextPaging.pageCount()} onPageChange={upNextPaging.setPage} compact />
        </Show>
      </Show>
    </section>
  )

  const equalizerCard = () => (
    <section class="glass-card equalizer-card">
      <EqualizerPanel controller={equalizer} />
    </section>
  )

  const startListening = async () => {
    if (props.integration) return props.integration.play()
    if (!audioRef) return
    setHasStarted(true)
    if (!applyElementVolume(audioRef, volume()) && !isIosDevice()) {
      equalizer.setOutputVolume(volume())
      void equalizer.ensureGraph()
    }
    const snap = snapshot()
    if (snap?.state) {
      await seekAudioTo(Math.max(0, snap.state.positionSeconds))
    }
    // play() must happen synchronously inside the user-gesture call stack on
    // mobile, so do not await Web Audio setup before it.
    void audioRef.play().catch(() => undefined)
    // Desktop only: attach the equalizer graph upfront so visualizer + EQ work
    // immediately. Mobile never attaches it — routing through
    // MediaElementSource makes the OS suspend audio when the tab backgrounds
    // or the screen locks, which is why the EQ panel is desktop-only.
    if (!isMobileDevice()) {
      void equalizer.ensureGraph()
    }
  }

  createEffect(() => {
    if (props.integration) return
    const version = tuneInAutoplayVersion()
    if (version === 0 || version === handledTuneInAutoplay) return
    if (!currentSong()) return
    handledTuneInAutoplay = version
    queueMicrotask(() => void startListening())
  })

  const advanceLocally = () => {
    const queue = localQueue()
    if (queue.length === 0) {
      setLocalCurrentSong(null)
      return
    }
    const next = queue[0]
    consumedQueueIds.add(next.id)
    setLocalCurrentSong(queueItemAsSong(next))
    setLocalQueue(queue.slice(1))

    window.setTimeout(() => {
      if (audioRef && hasStarted()) {
        audioRef.currentTime = 0
        void audioRef.play().catch(() => undefined)
      }
    }, 0)
  }

  const syncEndedAutoplay = async (endedSongId: string | null, attempt = 0): Promise<void> => {
    if (localQueue().length > 0) {
      advanceLocally()
      return
    }

    const refreshed = await refetch()
    if (!refreshed) return

    const refreshedSongId = refreshed.currentSong?.id ?? null
    if (refreshedSongId === null || refreshed.state.status === 'stopped') {
      setLocalCurrentSong(null)
      return
    }

    if (refreshedSongId !== endedSongId || attempt >= 5) return

    emptyQueueEndSyncTimer = window.setTimeout(() => {
      emptyQueueEndSyncTimer = null
      void syncEndedAutoplay(endedSongId, attempt + 1)
    }, 1000)
  }

  const handleAudioEnded = () => {
    if (localQueue().length > 0) {
      advanceLocally()
      return
    }
    void syncEndedAutoplay(localCurrentSong()?.id ?? null)
  }

  // If we ran out of songs and admin later adds one, kick playback again.
  createEffect(() => {
    if (props.integration) return
    if (localCurrentSong() === null && localQueue().length > 0 && hasStarted()) {
      advanceLocally()
    }
  })

  createEffect(() => {
    if (props.integration) return
    const nextVolume = volume()
    writeVolumeCookie(nextVolume)
    equalizer.setOutputVolume(nextVolume)
    if (audioRef) {
      // iOS ignores element volume but honors `muted`, so mute works there
      // without routing through Web Audio (which suspends on screen lock).
      audioRef.muted = nextVolume === 0
      if (!applyElementVolume(audioRef, nextVolume) && hasStarted() && !isIosDevice()) {
        void equalizer.ensureGraph()
      }
    }
  })


  createEffect(() => {
    if (props.integration) return
    const song = currentSong()
    document.title = song ? `${song.title} - ${song.artist}` : 'radio'

    if (!('mediaSession' in navigator)) return
    if (!song) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album ?? undefined,
      artwork: song.hasCover
        ? [{ src: songCoverUrl(song.id, selectedApiBase()), sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
    navigator.mediaSession.setActionHandler('play', () => void startListening())
    navigator.mediaSession.setActionHandler('pause', () => audioRef?.pause())
    navigator.mediaSession.setActionHandler('stop', () => audioRef?.pause())
  })

  createEffect(() => {
    if (props.integration) return
    if (!('mediaSession' in navigator)) return
    if (isAudioPlaying()) {
      navigator.mediaSession.playbackState = 'playing'
    } else if (currentSong()) {
      navigator.mediaSession.playbackState = 'paused'
    } else {
      navigator.mediaSession.playbackState = 'none'
    }
  })

  createEffect(() => {
    if (!listenerOverflowOpen()) return
    const onDocClick = (event: MouseEvent) => {
      const target = event.composedPath()[0] as HTMLElement | null
      if (target && target.closest('.listener-avatars')) return
      setListenerOverflowOpen(false)
    }
    document.addEventListener('click', onDocClick)
    onCleanup(() => document.removeEventListener('click', onDocClick))
  })

  // iOS Safari can pause a backgrounded <audio> on tab switch / lock screen.
  // When the page becomes visible again, resume if the user previously chose
  // to listen and we still have audio loaded.
  createEffect(() => {
    if (props.integration) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!audioRef || !hasStarted()) return
      if (audioRef.paused && snapshot()?.state.status === 'playing') {
        void audioRef.play().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    onCleanup(() => document.removeEventListener('visibilitychange', onVisible))
  })

  // Show the CRT volume meter overlay briefly whenever volume changes (skip
  // the initial mount so it doesn't flash on page load).
  createEffect(() => {
    volume()
    if (!volumeOverlayInitialized) {
      volumeOverlayInitialized = true
      return
    }
    setVolumeOverlayActive(true)
    if (volumeOverlayTimeout) clearTimeout(volumeOverlayTimeout)
    volumeOverlayTimeout = setTimeout(() => setVolumeOverlayActive(false), 1400)
  })
  onCleanup(() => {
    if (emptyQueueEndSyncTimer !== null) window.clearTimeout(emptyQueueEndSyncTimer)
    if (volumeOverlayTimeout) clearTimeout(volumeOverlayTimeout)
  })

  const audioElements = () => props.integration ? null : (
    <>
      <audio
        ref={audioRef}
        class="radio-audio"
        crossOrigin="anonymous"
        src={currentAudioUrl() ?? ''}
        preload="auto"
        onPlay={() => setIsAudioPlaying(true)}
        onPause={() => setIsAudioPlaying(false)}
        onEnded={handleAudioEnded}
      />
    </>
  )

  const heartLayer = () => (
    <div class="heart-layer" aria-hidden="true">
      <For each={floatingHearts()}>
        {(heart) => (
          <span class="floating-heart" style={`--drift: ${heart.drift}px`}>
            <Heart size={22} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </For>
    </div>
  )

  // Compact player for /embed: a desktop widget window, or with ?overlay a
  // transparent now-playing card for a stream. Same playback path as the page.
  if (embed) {
    return (
      <div class="embed-player" classList={{ overlay: Boolean(props.overlay) }}>
        <div class="embed-art">
          <Show when={currentSong()} keyed fallback={<div class="art-glow" />}>
            {(song) => (
              <Show when={song.hasCover} fallback={<div class="art-glow" />}>
                <img class="album-cover" src={songCoverUrl(song.id, selectedApiBase())} alt="" />
              </Show>
            )}
          </Show>
          {heartLayer()}
        </div>
        <div class="embed-meta">
          <a class="embed-station" href={stationPublicUrl()} target="_blank" rel="noreferrer" title="open the station">
            {stationPresetName(selectedStation())}
          </a>
          <p class="embed-title" title={currentSongTitle()}>{currentSongTitle()}</p>
          <p class="embed-artist" title={currentSongArtist()}>{currentSongArtist()}</p>
          <div class="embed-progress" aria-hidden="true">
            <span style={`transform: scaleX(${songProgressPercent() / 100})`} />
          </div>
          {/* Controls sit under the bar they belong to, opposite the time,
              so the player reads as one object rather than three columns. */}
          <div class="embed-footer">
            <span class="embed-time">
              <Show when={currentSong()?.durationSeconds}>
                {formatClock(liveDisplayPosition())} / {formatClock(currentSong()?.durationSeconds)}
              </Show>
            </span>
            <Show when={!props.overlay}>
              <div class="embed-actions">
                <button type="button" class="nowplaying-action" classList={{ 'is-liked': props.integration?.liked }} aria-pressed={props.integration ? props.integration.liked : undefined} aria-label={heartLabel()} title={heartLabel()} onClick={sendHeart}>
                  <Heart size={18} strokeWidth={1.8} fill={props.integration?.liked ? 'currentColor' : 'none'} />
                </button>
                <Show
                  when={isAudioPlaying()}
                  fallback={
                    <button
                      type="button"
                      class="listen-icon-button"
                      aria-label="listen live"
                      title="listen live"
                      disabled={snapshot()?.state.status !== 'playing'}
                      onClick={() => void startListening()}
                    >
                      <Play size={18} strokeWidth={1.8} fill="currentColor" />
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="listen-icon-button"
                    aria-label={volume() === 0 ? 'unmute' : 'mute'}
                    aria-pressed={volume() === 0}
                    onClick={toggleMute}
                  >
                    <Show when={volume() === 0} fallback={<Volume2 size={18} />}>
                      <VolumeX size={18} />
                    </Show>
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
        {audioElements()}
      </div>
    )
  }

  return (
    <>
      <div class="top-tint-sampler" aria-hidden="true" />
      <section class="radio-page" ref={radioRoot}>
        <div class="now-playing-card">
        <div class="art-shell">
          <Show when={currentSong()?.id ?? ''} keyed>
            {(songId) => (
              <>
                <Show when={currentSong()?.hasCover} fallback={<div class="art-glow" />}>
                  <img class="album-cover" src={songCoverUrl(songId, selectedApiBase())} alt="" />
                </Show>
                <div class="art-crt-scanload" aria-hidden="true" />
              </>
            )}
          </Show>
          <div class="art-crt-sweep" aria-hidden="true" />
          <div class="art-crt-scanlines" aria-hidden="true" />
          <div class="art-crt-vignette" aria-hidden="true" />
          <Show when={volumeOverlayActive()}>
            <div class="art-crt-volume" aria-hidden="true">
              <span class="art-crt-volume-label">vol</span>
              <span class="art-crt-volume-bar">{volumeMeterChars()}</span>
            </div>
          </Show>
          {heartLayer()}
          <div class="station-id-card" aria-hidden="true">
            <small>sigil id: {currentSong()?.id.slice(0, 8) ?? 'awaiting'}</small>
          </div>
        </div>
        <Show when={!props.integration}><canvas class="nowplaying-waveform" aria-hidden="true" ref={equalizer.attachVisualizer} /></Show>
        <section class="nowplaying-details" aria-label="now playing">
          <p class="nowplaying-eyebrow">now playing</p>
          <div class="nowplaying-title-row">
            <h1 ref={setTitleHeadingEl} classList={{ marquee: shouldMarqueeTitle() }} title={currentSongTitle()}>
              <span class="marquee-track">
                <span ref={setTitleTextEl}>{currentSongTitle()}</span>
              </span>
            </h1>
            <Show when={currentSong()}>
              <div class="nowplaying-actions">
                <button type="button" class="nowplaying-action" classList={{ 'is-liked': props.integration?.liked }} aria-pressed={props.integration ? props.integration.liked : undefined} aria-label={heartLabel()} title={heartLabel()} onClick={sendHeart}>
                  <Heart size={18} strokeWidth={1.8} fill={props.integration?.liked ? 'currentColor' : 'none'} />
                </button>
                <Show when={shareTrack()}>
                  {(track) => (
                    <Show
                      when={props.session?.accountDid}
                      fallback={
                        <a
                          class="nowplaying-action"
                          href={composeShareUrl(track())}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="share on bluesky"
                          title="share on bluesky"
                        >
                          <Share2 size={17} strokeWidth={1.8} />
                        </a>
                      }
                    >
                      <button
                        type="button"
                        class="nowplaying-action nowplaying-share"
                        data-state={shareButtonState()}
                        aria-label={shareButtonLabel()}
                        title={shareButtonLabel()}
                        onClick={() => onShareButton(track())}
                      >
                        <Show when={shareButtonState() === 'done'} fallback={<Share2 size={17} strokeWidth={1.8} />}>
                          <Check size={17} strokeWidth={2} />
                        </Show>
                        <Show when={shareButtonState() === 'armed'}>
                          <span class="nowplaying-share-hint" aria-hidden="true">post?</span>
                        </Show>
                      </button>
                    </Show>
                  )}
                </Show>
              </div>
            </Show>
            <Show when={currentSong() && snapshot()?.state.status === 'playing'}>
              <button
                class="listen-icon-button"
                type="button"
                onClick={() => {
                  if (isAudioPlaying()) { setHasStarted(false); if (props.integration) props.integration.pause(); else audioRef?.pause() }
                  else void startListening()
                }}
                aria-label={isAudioPlaying() ? 'pause' : 'listen live'}
                title={isAudioPlaying() ? 'pause' : 'listen live'}
              >
                <Show when={isAudioPlaying()} fallback={<Play size={19} strokeWidth={1.8} fill="currentColor" />}>
                  <Pause size={19} strokeWidth={1.9} />
                </Show>
              </button>
            </Show>
          </div>
          <div class="nowplaying-artist-time-row">
            <p class="subtitle nowplaying-artist-album" title={artistAlbumLine()}>{artistAlbumLine()}</p>
            <Show when={currentSong()?.durationSeconds}>
              <p class="nowplaying-time-simple">
                {formatClock(liveDisplayPosition())} / {formatClock(currentSong()?.durationSeconds)}
              </p>
            </Show>
          </div>
          <div class="volume-control local-volume">
            <button
              type="button"
              class="volume-mute-btn"
              aria-label={volume() === 0 ? 'unmute' : 'mute'}
              aria-pressed={volume() === 0}
              title={volume() === 0 ? 'unmute' : 'mute'}
              onClick={toggleMute}
            >
              <Show when={volume() === 0} fallback={<Volume2 size={17} />}>
                <VolumeX size={17} />
              </Show>
            </button>
            <Show when={!isIosDevice()}>
            <input
              type="range"
              aria-label="volume"
              min="0"
              max="1"
              step="0.01"
              value={volume()}
              style={`--volume-progress: ${volume() * 100}%`}
              onInput={(event) => {
                const nextVolume = event.currentTarget.valueAsNumber
                setVolume(nextVolume)
                equalizer.setOutputVolume(nextVolume)
                if (audioRef && !applyElementVolume(audioRef, nextVolume) && hasStarted() && !isIosDevice()) {
                  void equalizer.ensureGraph()
                }
              }}
            />
            </Show>
            {/* Phones take volume from the hardware buttons, so this row shows
                song position there instead of a slider. */}
            <div class="nowplaying-progress" aria-hidden="true">
              <span style={`transform: scaleX(${songProgressPercent() / 100})`} />
            </div>
          </div>
          <div class="nowplaying-meta-row">
            <div class="live-viewer-counter compact-viewer-counter" aria-live="polite">
              <Eye size={16} />
              <span>{viewerCountLabel()}</span>
              <Show when={listenerDids().length > 0}>
                <ul class="listener-avatars" aria-label="listeners">
                  <For each={visibleListenerDids()}>
                    {(did) => {
                      const profile = () => profileFor(did)
                      return (
                        <li>
                          <a
                            href={`https://bsky.app/profile/${profile().handle}`}
                            target="_blank"
                            rel="noreferrer"
                            data-handle={`@${profile().handle}`}
                          >
                            <ProfileAvatar profile={profile()} class="listener-avatar" title={`@${profile().handle}`} />
                          </a>
                        </li>
                      )
                    }}
                  </For>
                  <Show when={overflowListenerDids().length > 0}>
                    <li>
                      <button
                        type="button"
                        class="listener-avatar-more"
                        aria-expanded={listenerOverflowOpen()}
                        aria-label={`show ${overflowListenerDids().length} more listeners`}
                        data-handle={`+${overflowListenerDids().length} more`}
                        onClick={() => setListenerOverflowOpen((open) => !open)}
                      >
                        +{overflowListenerDids().length}
                      </button>
                    </li>
                    <Show when={listenerOverflowOpen()}>
                      <ul class="listener-avatars-overflow" aria-label="more listeners">
                        <For each={overflowListenerDids()}>
                          {(did) => {
                            const profile = () => profileFor(did)
                            return (
                              <li>
                                <a
                                  href={`https://bsky.app/profile/${profile().handle}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ProfileAvatar profile={profile()} class="listener-avatar" title={`@${profile().handle}`} />
                                  <span>{profile().displayName || `@${profile().handle}`}</span>
                                </a>
                              </li>
                            )
                          }}
                        </For>
                      </ul>
                    </Show>
                  </Show>
                </ul>
              </Show>
            </div>
            <Show when={currentSong()}>
              {(song) => {
                const profile = () => profileFor(song().addedByDid)
                return (
                  <a class="track-attribution" href={`https://bsky.app/profile/${profile().handle}`} target="_blank" rel="noreferrer" title={`uploaded by @${profile().handle}`}>
                    <ProfileAvatar profile={profile()} class="track-attribution-avatar" title={`@${profile().handle}`} />
                    <span>
                      uploaded by <strong>@{profile().handle}</strong>
                    </span>
                  </a>
                )
              }}
            </Show>
          </div>
        </section>
        {audioElements()}
        {/* Phones get one screen and no scrolling: the station switcher and
            a single next-track line under now playing. The full up next list
            and chat stay on desktop. Safari's tinted top bar only looks right
            on a page that doesn't scroll. */}
        {onMobile() && tuneInCard()}
        <Show when={onMobile() && nextUpLine()}>
          {(line) => (
            <p class="mobile-next-up" title={line()}>
              <span class="mobile-next-up-label">next</span>
              <span class="mobile-next-up-track">{line()}</span>
            </p>
          )}
        </Show>
      </div>


      <Show when={!onMobile()}>
        <aside class="radio-panel">
          {tuneInCard()}
          {upNextCard()}
          {!props.integration && chatCard()}
          {!props.integration && equalizerCard()}
        </aside>
      </Show>
      </section>
    </>
  )
}
