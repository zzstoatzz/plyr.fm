import { ok } from '@atcute/client'
import { createSignal } from 'solid-js'
import { listenerRepoClient } from '../../shared/lib/radioXrpc'

// teal.fm records, per the stable lexicons in github.com/teal-fm/teal
// (lexicons/fm.teal/*). teal dropped the `alpha` namespace in July 2026; its
// ingester still canonicalizes fm.teal.alpha.* records, but new writes use
// the stable NSIDs.
const PLAY_COLLECTION = 'fm.teal.feed.play'
const STATUS_COLLECTION = 'fm.teal.actor.status'
const CLIENT_AGENT = 'pet.nkp.radio/1.0'

// The lexicon caps these strings at 256 (UTF-8 bytes).
const MAX_NAME_BYTES = 256

const SCROBBLE_STORAGE_KEY = 'radio_teal_scrobble'

function readScrobbleEnabled(): boolean {
  try {
    return localStorage.getItem(SCROBBLE_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

const [scrobbleEnabled, setScrobbleEnabledSignal] = createSignal(readScrobbleEnabled())

/** Whether the listener opted in to teal.fm scrobbling on this browser. */
export { scrobbleEnabled }

export function setScrobbleEnabled(enabled: boolean): void {
  setScrobbleEnabledSignal(enabled)
  try {
    localStorage.setItem(SCROBBLE_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private mode: the toggle still works for this page load.
  }
}

export interface HeardTrack {
  title: string
  artist: string
  album?: string | null
  durationSeconds?: number | null
  /** The station's public URL, e.g. https://radio.nekomimi.pet. */
  stationUrl: string
  /** When this listener started hearing the track. */
  startedAt: Date
}

/**
 * Seconds of actual listening after which a play counts, using the familiar
 * scrobbling rule: half the track or four minutes, whichever comes first.
 * @returns null for tracks too short to scrobble (under 30s) or of unknown length.
 */
export function scrobbleThresholdSeconds(durationSeconds: number | null | undefined): number | null {
  if (!durationSeconds || durationSeconds < 30) return null
  return Math.min(durationSeconds / 2, 240)
}

function clipBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= maxBytes) return value
  let clipped = ''
  for (const char of value) {
    if (encoder.encode(clipped + char).length > maxBytes) break
    clipped += char
  }
  return clipped
}

/** fm.teal.feed.defs#playView, shared by the play record and the status. */
function playView(track: HeardTrack): Record<string, unknown> {
  const view: Record<string, unknown> = {
    trackName: clipBytes(track.title, MAX_NAME_BYTES),
    // The station stores one artist string ("A feat. B"); splitting it would
    // be guesswork, so it goes in as a single credited artist.
    artists: [{ artistName: clipBytes(track.artist || 'unknown artist', MAX_NAME_BYTES) }],
    originUri: window.location.href,
    musicServiceUri: track.stationUrl,
    submissionClientAgent: CLIENT_AGENT,
    playedTime: track.startedAt.toISOString(),
  }
  if (track.album) view.releaseName = clipBytes(track.album, MAX_NAME_BYTES)
  if (track.durationSeconds && track.durationSeconds > 0) view.duration = Math.round(track.durationSeconds)
  return view
}

/** Writes a fm.teal.feed.play record for a track the listener heard enough of. */
export async function scrobblePlay(track: HeardTrack): Promise<void> {
  const repo = await listenerRepoClient()
  if (!repo) return
  await ok(repo.client.post('com.atproto.repo.createRecord', {
    input: {
      repo: repo.did,
      collection: PLAY_COLLECTION,
      record: { $type: PLAY_COLLECTION, ...playView(track) },
    },
    as: 'json',
  }))
}

/**
 * Sets the listener's teal.fm "now playing" status. It expires when the
 * track would end, so stopping the radio doesn't leave a stale status behind.
 */
export async function setNowPlayingStatus(track: HeardTrack, remainingSeconds: number | null): Promise<void> {
  const repo = await listenerRepoClient()
  if (!repo) return
  const now = new Date()
  // The lexicon's default expiry is 10 minutes when none is given.
  const lifetimeSeconds = remainingSeconds && remainingSeconds > 0 ? remainingSeconds + 15 : 600
  await ok(repo.client.post('com.atproto.repo.putRecord', {
    input: {
      repo: repo.did,
      collection: STATUS_COLLECTION,
      rkey: 'self',
      record: {
        $type: STATUS_COLLECTION,
        time: now.toISOString(),
        expiry: new Date(now.getTime() + lifetimeSeconds * 1000).toISOString(),
        item: playView(track),
      },
    },
    as: 'json',
  }))
}
