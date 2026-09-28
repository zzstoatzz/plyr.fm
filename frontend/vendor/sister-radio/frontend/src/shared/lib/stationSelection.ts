import { stations as plyrStations } from '../../../../catalog/stations'
import { API_BASE, BASE_URL, STANDALONE } from './config'
import type { RadioTarget } from './radioXrpc'
import type { SyndicatedStation } from './radio'

export const RELATIVE_API_BASE = '__relative__'
export const TUNE_IN_CHANGED_EVENT = 'radio:tune-in-changed'

export interface TuneInStation {
  did: string
  url: string
  apiBase: string
  name: string
  description?: string | null
  updatedAt?: string | null
  indexedAt?: string | null
  local: boolean
}

/**
 * Compares the rendered station fields so directory polling does not replace
 * an otherwise identical station list with fresh object identities.
 */
export function sameTuneInStation(left: TuneInStation | undefined, right: TuneInStation | undefined): boolean {
  return left === right || (
    left !== undefined &&
    right !== undefined &&
    left.did === right.did &&
    left.url === right.url &&
    left.apiBase === right.apiBase &&
    left.name === right.name &&
    left.description === right.description &&
    left.updatedAt === right.updatedAt &&
    left.indexedAt === right.indexedAt &&
    left.local === right.local
  )
}

/** Returns whether two rendered station lists carry the same directory data. */
export function sameTuneInStations(left: TuneInStation[], right: TuneInStation[]): boolean {
  return left === right || (
    left.length === right.length &&
    left.every((station, index) => sameTuneInStation(station, right[index]))
  )
}

export function normalizeStationUrl(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim()
  if (!trimmed) return ''

  let normalized = ''
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    parsed.search = ''
    normalized = parsed.href.replace(/\/+$/, '')
  } catch {
    normalized = trimmed.replace(/\/+$/, '')
  }

  if (STANDALONE && typeof window !== 'undefined' && normalized === window.location.origin.replace(/\/+$/, '')) {
    return ''
  }
  return normalized
}

export function stationListKey(url: string): string {
  return normalizeStationUrl(url).toLowerCase()
}

export function labelFromStationUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function firstConfiguredPublicBase(candidates: string[]): string {
  for (const candidate of candidates) {
    const url = normalizeStationUrl(candidate)
    if (!url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
    } catch {
      continue
    }
  }
  return ''
}

export function defaultStationUrl(): string {
  // Standalone builds are served from arbitrary domains; a build-time base URL
  // must never leak into station selection or the UI.
  if (STANDALONE) return ''
  return firstConfiguredPublicBase([BASE_URL, API_BASE]) || normalizeStationUrl(window.location.origin)
}

export function defaultStationApiBase(): string {
  if (STANDALONE) return ''
  const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  return firstConfiguredPublicBase([API_BASE, BASE_URL]) || normalizeStationUrl(local ? '' : window.location.origin)
}

export function stationStorageKey(defaultUrl: string = defaultStationUrl()): string {
  return `radio_tune_in:${defaultUrl || window.location.origin}`
}

export function readSelectedStationUrl(): string {
  const slug = new URLSearchParams(window.location.search).get('station')
    ?? window.location.pathname.match(/^\/stations\/([^/]+)/)?.[1]
  const station = plyrStations.find((station) => station.slug === slug)
  if (station) return station.slug === 'loved' ? defaultStationUrl() : `${window.location.origin}/stations/${station.slug}`
  return normalizeStationUrl(localStorage.getItem(stationStorageKey()) || defaultStationUrl())
}

export function writeSelectedStationUrl(url: string): string {
  const normalized = normalizeStationUrl(url)
  if (!normalized) return ''
  localStorage.setItem(stationStorageKey(), normalized)
  const selected = new URL(normalized, window.location.origin)
  if (selected.origin === window.location.origin) {
    const url = new URL(window.location.href)
    url.searchParams.set('station', selected.pathname.split('/')[2] || 'loved')
    window.history.replaceState({}, '', url)
  }
  window.dispatchEvent(new CustomEvent(TUNE_IN_CHANGED_EVENT, { detail: { url: normalized } }))
  return normalized
}

export function localTuneInStation(): TuneInStation {
  return {
    did: 'local',
    url: defaultStationUrl(),
    apiBase: defaultStationApiBase(),
    name: 'plyr.fm · loved',
    description: null,
    updatedAt: null,
    indexedAt: null,
    local: true,
  }
}

export function tuneInStationsFrom(_syndicatedStations: SyndicatedStation[] = []): TuneInStation[] {
  const local = localTuneInStation()
  return plyrStations.map((station) => {
    const url = station.slug === 'loved' ? local.url : `${window.location.origin}/stations/${station.slug}`
    return { ...local, url, apiBase: station.slug === 'loved' ? local.apiBase : url, name: station.name, description: station.description }
  })
}

export function selectedTuneInStationFrom(stations: TuneInStation[], selectedUrl: string = readSelectedStationUrl()): TuneInStation {
  const found = stations.find((station) => stationListKey(station.url) === stationListKey(selectedUrl))
  return found ?? stations[0] ?? localTuneInStation()
}

export function isPlaceholderStation(station: TuneInStation): boolean {
  return station.did === 'loading'
}

export function stationResourceKey(station: TuneInStation): string {
  if (station.local) return station.apiBase || RELATIVE_API_BASE
  return (station.apiBase || station.url) || RELATIVE_API_BASE
}

export function stationRadioTarget(station: TuneInStation): RadioTarget {
  return {
    did: station.did === 'local' || station.did === 'remembered' ? undefined : station.did,
    baseUrl: station.local ? station.apiBase : (station.apiBase || station.url),
  }
}
