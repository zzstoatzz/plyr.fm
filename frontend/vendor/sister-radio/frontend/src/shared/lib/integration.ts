import type { RadioSnapshot } from './radio'
import type { TuneInStation } from './stationSelection'
import type { AtprotoProfile } from './atproto'

export interface RadioIntegration {
  snapshot: RadioSnapshot | null
  stations: TuneInStation[]
  selectedStationUrl: string
  playing: boolean
  liked: boolean
  position: number
  volume: number
  loading: boolean
  error: string | null
  listenerCount: number | null
  listenerDids: string[]
  profiles: Record<string, AtprotoProfile>
  covers: Record<string, string>
  play: () => void
  pause: () => void
  setVolume: (volume: number) => void
  selectStation: (url: string) => void
  likeTrack: () => void
  embedUrl: string
}
