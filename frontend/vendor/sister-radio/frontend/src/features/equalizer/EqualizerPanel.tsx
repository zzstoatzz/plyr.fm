import { ChevronDown, Radio, RadioOff } from 'lucide-solid'
import { createMemo, createSignal, For, Index, onCleanup, Show, type Accessor } from 'solid-js'

const EQ_STORAGE_KEY = 'radio_eq_bands'
const EQ_PRESETS_STORAGE_KEY = 'radio_eq_named_presets'
const NORMALIZATION_STORAGE_KEY = 'radio_playback_normalization_v2'
const LEGACY_EQ_STORAGE_KEY = 'radio_eq_gains'
const EQ_MIN_FREQUENCY = 20
const EQ_MAX_FREQUENCY = 20000
const EQ_GRAPH_POINTS = 80
const VISUALIZER_BAR_COUNT = 48
const EQ_FILTER_TYPES = ['peaking', 'lowshelf', 'highshelf'] as const
const EQ_GRAPH_FREQUENCIES = Array.from({ length: EQ_GRAPH_POINTS }, (_, index) => {
  const progress = index / (EQ_GRAPH_POINTS - 1)
  return EQ_MIN_FREQUENCY * (EQ_MAX_FREQUENCY / EQ_MIN_FREQUENCY) ** progress
})

type EqualizerFilterType = (typeof EQ_FILTER_TYPES)[number]

interface EqualizerBand {
  frequency: number
  gain: number
  type: EqualizerFilterType
}

interface EqualizerPreset {
  id: string
  label: string
  bands?: EqualizerBand[]
  gains?: number[]
}

export interface EqualizerController {
  bands: Accessor<EqualizerBand[]>
  customPresets: Accessor<EqualizerPreset[]>
  enabled: Accessor<boolean>
  graphPath: Accessor<string>
  normalizationEnabled: Accessor<boolean>
  /** Hands the controller the canvas the waveform bars are drawn into. */
  attachVisualizer: (canvas: HTMLCanvasElement | undefined) => void
  applyPreset: (preset: EqualizerPreset) => void
  ensureGraph: () => Promise<void>
  /** Whether audio runs through the Web Audio graph, whose gain then carries volume. */
  graphAttached: () => boolean
  reset: () => void
  savePreset: (name: string) => void
  setEnabled: (enabled: boolean) => void
  setNormalizationEnabled: (enabled: boolean) => void
  /** Per-song integrated LUFS + true-peak measurements from the backend. */
  setLoudness: (loudness: { lufs: number | null | undefined; peak: number | null | undefined }) => void
  /** Sets the final Web Audio output volume for browsers that ignore media element volume. */
  setOutputVolume: (volume: number) => void
  updateBand: (index: number, patch: Partial<EqualizerBand>) => void
}

interface EqualizerPanelProps {
  controller: EqualizerController
}

const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  { frequency: 60, gain: 0, type: 'lowshelf' },
  { frequency: 170, gain: 0, type: 'peaking' },
  { frequency: 310, gain: 0, type: 'peaking' },
  { frequency: 600, gain: 0, type: 'peaking' },
  { frequency: 1000, gain: 0, type: 'peaking' },
  { frequency: 3000, gain: 0, type: 'peaking' },
  { frequency: 6000, gain: 0, type: 'peaking' },
  { frequency: 12000, gain: 0, type: 'highshelf' },
]

const EQ_PRESETS: EqualizerPreset[] = [
  { id: 'builtin-flat', label: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0] },
  // The 60hz shelf only reaches full gain around 30hz, so audible bass weight
  // comes from the 170hz band; leaning on the shelf just adds sub rumble.
  { id: 'builtin-bass-boost', label: 'bass boost', gains: [3, 4, 1, -1, 0, 0, 0, 0] },
  { id: 'builtin-treble-boost', label: 'treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4] },
  { id: 'builtin-rock', label: 'rock', gains: [3, 2, -1, -2, -1, 2, 3, 2] },
  { id: 'builtin-electronic', label: 'electronic', gains: [3, 3, 0, -1, 0, 1, 2, 3] },
  { id: 'builtin-acoustic', label: 'acoustic', gains: [2, 1, -1, 0, 1, 2, 2, 2] },
  { id: 'builtin-classical', label: 'classical', gains: [2, 0, -1, -1, 0, 1, 2, 2] },
  { id: 'builtin-vocal-clarity', label: 'vocal clarity', gains: [-2, -2, -1, 1, 2, 3, 1, -1] },
  { id: 'builtin-spoken-word', label: 'spoken word', gains: [-8, -3, -1, 1, 2, 3, 0, -3] },
  // Low-volume listening: ears lose bass and air first as level drops.
  { id: 'builtin-quiet-listening', label: 'quiet listening', gains: [4, 2, 0, -1, 0, 0, 1, 3] },
  // Phone/laptop drivers cannot move sub-bass; spend the energy on upper bass instead.
  { id: 'builtin-small-speakers', label: 'small speakers', gains: [-6, 2, 2, 0, 0, 1, 1, 0] },
]

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${Number((frequency / 1000).toFixed(1))}k` : `${Math.round(frequency)}`
}

function readEqualizerBands(): EqualizerBand[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EQ_STORAGE_KEY) ?? 'null')
    if (Array.isArray(parsed) && parsed.length === DEFAULT_EQ_BANDS.length) {
      return parsed.map((band, index) => ({
        frequency: clampNumber(Number(band?.frequency), EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) || DEFAULT_EQ_BANDS[index].frequency,
        gain: Number.isFinite(Number(band?.gain)) ? clampNumber(Number(band.gain), -12, 12) : 0,
        type: EQ_FILTER_TYPES.includes(band?.type) ? band.type : DEFAULT_EQ_BANDS[index].type,
      }))
    }

    const legacyGains = JSON.parse(localStorage.getItem(LEGACY_EQ_STORAGE_KEY) ?? '[]')
    if (Array.isArray(legacyGains) && legacyGains.length === DEFAULT_EQ_BANDS.length) {
      return DEFAULT_EQ_BANDS.map((band, index) => ({
        ...band,
        gain: Number.isFinite(Number(legacyGains[index])) ? clampNumber(Number(legacyGains[index]), -12, 12) : 0,
      }))
    }
  } catch {
    // ignore cooked localStorage and fall back to defaults.
  }
  return DEFAULT_EQ_BANDS.map((band) => ({ ...band }))
}

function writeEqualizerBands(bands: EqualizerBand[]): void {
  localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(bands))
}

function normalizeEqualizerBand(band: Partial<EqualizerBand>, fallback: EqualizerBand): EqualizerBand {
  return {
    frequency: clampNumber(Number(band.frequency), EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) || fallback.frequency,
    gain: Number.isFinite(Number(band.gain)) ? clampNumber(Number(band.gain), -12, 12) : fallback.gain,
    type: EQ_FILTER_TYPES.includes(band.type as EqualizerFilterType) ? (band.type as EqualizerFilterType) : fallback.type,
  }
}

function readCustomPresets(): EqualizerPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EQ_PRESETS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((preset) => typeof preset?.label === 'string' && Array.isArray(preset?.bands))
      .map((preset) => ({
        id: typeof preset.id === 'string' ? preset.id : `custom-${preset.label}`,
        label: preset.label.trim(),
        bands: preset.bands.map((band: Partial<EqualizerBand>, index: number) => normalizeEqualizerBand(band, DEFAULT_EQ_BANDS[index] ?? DEFAULT_EQ_BANDS[0])),
      }))
      .filter((preset) => preset.label && preset.bands?.length === DEFAULT_EQ_BANDS.length)
  } catch {
    return []
  }
}

function writeCustomPresets(presets: EqualizerPreset[]): void {
  localStorage.setItem(EQ_PRESETS_STORAGE_KEY, JSON.stringify(presets))
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPad|iPhone|iPod|Mobi/i.test(navigator.userAgent)) return true
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

function readNormalizationEnabled(): boolean {
  const stored = localStorage.getItem(NORMALIZATION_STORAGE_KEY)
  if (stored === 'on') return true
  if (stored === 'off') return false
  // Default: on for desktop, off for mobile. Mobile audio routing through Web
  // Audio is fragile (background suspension, EQ-on-EQ artifacts in some
  // OS-level pipelines); leave it untouched unless the user opts in.
  return !isMobileUserAgent()
}

function writeNormalizationEnabled(enabled: boolean): void {
  localStorage.setItem(NORMALIZATION_STORAGE_KEY, enabled ? 'on' : 'off')
}

// Sample rate used to evaluate the EQ curve before (or without) an AudioContext.
// The response below ~16k barely moves between 44.1k and 48k.
const EQ_RESPONSE_SAMPLE_RATE = 48000
const EQ_PEAKING_Q = 1

/**
 * Returns the dB response of one band at a frequency, using the same biquad
 * formulas as Web Audio's BiquadFilterNode (shelves ignore Q, i.e. slope 1).
 */
function equalizerBandGainAt(band: EqualizerBand, frequency: number): number {
  if (band.gain === 0) return 0
  const a = 10 ** (band.gain / 40)
  const w0 = (2 * Math.PI * band.frequency) / EQ_RESPONSE_SAMPLE_RATE
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (band.type === 'peaking') {
    const alpha = sin / (2 * EQ_PEAKING_Q)
    ;[b0, b1, b2, a0, a1, a2] = [1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a]
  } else {
    const shelf = 2 * Math.sqrt(a) * (sin / 2) * Math.SQRT2
    if (band.type === 'lowshelf') {
      b0 = a * ((a + 1) - (a - 1) * cos + shelf)
      b1 = 2 * a * ((a - 1) - (a + 1) * cos)
      b2 = a * ((a + 1) - (a - 1) * cos - shelf)
      a0 = (a + 1) + (a - 1) * cos + shelf
      a1 = -2 * ((a - 1) + (a + 1) * cos)
      a2 = (a + 1) + (a - 1) * cos - shelf
    } else {
      b0 = a * ((a + 1) + (a - 1) * cos + shelf)
      b1 = -2 * a * ((a - 1) + (a + 1) * cos)
      b2 = a * ((a + 1) + (a - 1) * cos - shelf)
      a0 = (a + 1) - (a - 1) * cos + shelf
      a1 = 2 * ((a - 1) - (a + 1) * cos)
      a2 = (a + 1) - (a - 1) * cos - shelf
    }
  }
  const w = (2 * Math.PI * frequency) / EQ_RESPONSE_SAMPLE_RATE
  const [c1, s1, c2, s2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)]
  const numerator = (b0 + b1 * c1 + b2 * c2) ** 2 + (b1 * s1 + b2 * s2) ** 2
  const denominator = (a0 + a1 * c1 + a2 * c2) ** 2 + (a1 * s1 + a2 * s2) ** 2
  return 10 * Math.log10(numerator / denominator)
}

/**
 * Creates a Web Audio equalizer controller for the provided audio element.
 * @param getAudioElement Accessor returning the managed HTML audio element.
 * @returns Equalizer state and imperative graph controls.
 */
// Target integrated loudness in LUFS. -14 matches Spotify / YouTube / Apple
// Music streaming references; tracks louder than this get attenuated, quieter
// ones get boosted (bounded by true-peak headroom so we never clip).
const NORMALIZATION_TARGET_LUFS = -14
// Keep at least this much headroom below 0 dBFS after gain is applied.
const NORMALIZATION_PEAK_HEADROOM_DB = 1
// Hard cap on positive gain to avoid blowing up tracks with bogus measurements.
const NORMALIZATION_MAX_BOOST_DB = 12

export function createEqualizerController(getAudioElement: () => HTMLAudioElement | undefined): EqualizerController {
  const [equalizerBands, setEqualizerBands] = createSignal(readEqualizerBands())
  const [customPresets, setCustomPresets] = createSignal(readCustomPresets())
  const [enabled, setEnabledSignal] = createSignal(true)
  const [normalizationEnabled, setNormalizationEnabledSignal] = createSignal(readNormalizationEnabled())
  let audioContext: AudioContext | null = null
  let audioSource: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let normalizationGain: GainNode | null = null
  let outputGain: GainNode | null = null
  let equalizerFilters: BiquadFilterNode[] = []
  let outputVolume = 1
  let currentLoudness: { lufs: number | null; peak: number | null } = { lufs: null, peak: null }
  let persistenceTimer: number | null = null
  let visualizerFrame: number | null = null
  let lastVisualizerUpdate = 0
  // Bars draw into one canvas: updating 48 elements' heights meant layout and
  // paint for each of them every update, which kept a quarter of a core busy.
  let visualizerCanvas: HTMLCanvasElement | undefined
  let visualizerResize: ResizeObserver | undefined
  let visualizerAccent = '#be7c8f'
  let visualizerFramesSinceAccent = 0
  const visualizerLevels = new Float32Array(VISUALIZER_BAR_COUNT).fill(0.08)
  let visualizerSamples: Uint8Array<ArrayBuffer> | null = null

  const scheduleEqualizerPersistence = (bands: EqualizerBand[]) => {
    if (persistenceTimer !== null) window.clearTimeout(persistenceTimer)
    persistenceTimer = window.setTimeout(() => {
      persistenceTimer = null
      writeEqualizerBands(bands)
    }, 180)
  }

  const effectiveGain = (gain: number) => (enabled() ? gain : 0)

  // Combined EQ response sampled across the graph frequencies, in dB.
  const equalizerResponse = createMemo(() => {
    const bands = equalizerBands()
    return EQ_GRAPH_FREQUENCIES.map((frequency) => bands.reduce((total, band) => total + equalizerBandGainAt(band, frequency), 0))
  })

  // Loudest point of the active EQ curve; the gain stage after the filters
  // backs off by this much so boosted presets cannot push peaks past 0 dBFS.
  const equalizerMaxBoostDb = createMemo(() => (enabled() ? Math.max(0, ...equalizerResponse()) : 0))

  const computeNormalizationGainLinear = (): number => {
    const eqBoostDb = equalizerMaxBoostDb()
    const normalizing = normalizationEnabled()
    // Untouched playback: nothing to normalize and nothing to make room for.
    if (!normalizing && eqBoostDb === 0) return 1
    const { lufs, peak } = currentLoudness
    let gainDb = normalizing && lufs !== null && Number.isFinite(lufs) ? NORMALIZATION_TARGET_LUFS - lufs : 0
    if (peak !== null && Number.isFinite(peak)) {
      // Cap so peak + EQ boost + gainDb stays below -headroom dBFS, preventing clipping.
      const peakCeilingDb = -NORMALIZATION_PEAK_HEADROOM_DB - peak - eqBoostDb
      gainDb = Math.min(gainDb, peakCeilingDb)
    } else {
      // Without a measured peak, assume the master already sits near full scale.
      gainDb -= eqBoostDb
    }
    gainDb = Math.min(gainDb, NORMALIZATION_MAX_BOOST_DB)
    return 10 ** (gainDb / 20)
  }

  const applyNormalization = () => {
    if (!audioContext || !normalizationGain) return
    const now = audioContext.currentTime
    normalizationGain.gain.setTargetAtTime(computeNormalizationGainLinear(), now, 0.05)
  }

  const applyOutputVolume = () => {
    if (!audioContext || !outputGain) return
    outputGain.gain.setTargetAtTime(clampNumber(outputVolume, 0, 1), audioContext.currentTime, 0.015)
  }

  const applyFilters = (bands: EqualizerBand[]) => {
    equalizerFilters.forEach((filter, index) => {
      const band = bands[index]
      if (!band) return
      filter.type = band.type
      filter.frequency.setTargetAtTime(band.frequency, audioContext?.currentTime ?? 0, 0.015)
      filter.gain.setTargetAtTime(effectiveGain(band.gain), audioContext?.currentTime ?? 0, 0.015)
    })
    // The EQ's peak boost feeds the headroom in the normalization stage.
    applyNormalization()
  }

  const graphPath = createMemo(() => {
    return equalizerResponse().map((response, index) => {
      const gain = clampNumber(response, -12, 12)
      const x = (index / (EQ_GRAPH_POINTS - 1)) * 100
      const y = 50 - (gain / 12) * 40
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    }).join(' ')
  })

  const drawVisualizer = () => {
    const canvas = visualizerCanvas
    const context = canvas?.getContext('2d')
    if (!canvas || !context || canvas.width === 0) return
    // The accent follows the cover; re-reading it every frame would force a
    // style lookup per frame, so refresh it about twice a second.
    if (visualizerFramesSinceAccent++ % 20 === 0) {
      visualizerAccent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || visualizerAccent
    }
    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    context.fillStyle = visualizerAccent
    const slot = width / VISUALIZER_BAR_COUNT
    const barWidth = Math.max(1, slot * 0.62)
    const minHeight = height * 0.05
    for (let index = 0; index < VISUALIZER_BAR_COUNT; index += 1) {
      const level = visualizerLevels[index]
      const barHeight = minHeight + level * (height - minHeight)
      context.globalAlpha = 0.24 + level * 0.76
      context.beginPath()
      context.roundRect(index * slot + (slot - barWidth) / 2, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2)
      context.fill()
    }
    context.globalAlpha = 1
  }

  const updateVisualizer = () => {
    if (!analyser) return
    const audioElement = getAudioElement()
    if (!audioElement || audioElement.paused || audioElement.ended) {
      visualizerFrame = null
      return
    }
    visualizerFrame = window.requestAnimationFrame(updateVisualizer)

    // About 40 updates a second: lively without redrawing on every frame of a
    // 120Hz display. On 60Hz it lands on every other frame (30fps).
    const now = performance.now()
    if (now - lastVisualizerUpdate < 24) {
      return
    }
    lastVisualizerUpdate = now

    visualizerSamples ??= new Uint8Array(analyser.fftSize)
    const samples = visualizerSamples
    analyser.getByteTimeDomainData(samples)
    const bucketSize = Math.floor(samples.length / VISUALIZER_BAR_COUNT)
    for (let bucketIndex = 0; bucketIndex < VISUALIZER_BAR_COUNT; bucketIndex += 1) {
      const start = bucketIndex * bucketSize
      const end = Math.min(samples.length, start + bucketSize)
      let peak = 0
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index] - 128) / 128)
      }
      visualizerLevels[bucketIndex] = visualizerLevels[bucketIndex] * 0.32 + Math.max(0.025, Math.min(1, peak * 4.2)) * 0.68
    }
    drawVisualizer()
  }

  const attachVisualizer = (canvas: HTMLCanvasElement | undefined) => {
    visualizerResize?.disconnect()
    visualizerCanvas = canvas
    if (!canvas) return
    // Keep the backing store at device pixels so bars stay crisp.
    visualizerResize = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      drawVisualizer()
    })
    visualizerResize.observe(canvas)
  }

  const startVisualizer = () => {
    if (visualizerFrame === null) {
      visualizerFrame = window.requestAnimationFrame(updateVisualizer)
    }
  }

  const stopVisualizer = () => {
    if (visualizerFrame !== null) {
      window.cancelAnimationFrame(visualizerFrame)
      visualizerFrame = null
    }
  }

  const ensureGraph = async (): Promise<void> => {
    const audioElement = getAudioElement()
    if (!audioElement) return
    audioContext ??= new AudioContext()
    if (!audioSource) {
      audioSource = audioContext.createMediaElementSource(audioElement)
      // From here the output gain carries the listener's volume. Leaving the
      // element's own volume set as well applied it twice (50% played at 25%)
      // and fed the visualizer an already turned-down signal.
      audioElement.volume = 1
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.42
      normalizationGain = audioContext.createGain()
      normalizationGain.gain.value = computeNormalizationGainLinear()
      outputGain = audioContext.createGain()
      outputGain.gain.value = clampNumber(outputVolume, 0, 1)
      equalizerFilters = equalizerBands().map((band) => {
        const filter = audioContext!.createBiquadFilter()
        filter.type = band.type
        filter.frequency.value = band.frequency
        filter.Q.value = EQ_PEAKING_Q
        filter.gain.value = effectiveGain(band.gain)
        return filter
      })
      const chain = [audioSource, ...equalizerFilters, normalizationGain, outputGain, audioContext.destination]
      chain.slice(0, -1).forEach((node, index) => node.connect(chain[index + 1]))
      // The visualizer taps the signal before the listener's volume, so it
      // stays lively when someone listens quietly (it used to go flat).
      normalizationGain.connect(analyser)

      audioElement.addEventListener('play', startVisualizer)
      audioElement.addEventListener('pause', stopVisualizer)
      audioElement.addEventListener('ended', stopVisualizer)
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => undefined)
    }
    startVisualizer()
  }

  const updateBand = (index: number, patch: Partial<EqualizerBand>) => {
    const next = equalizerBands().map((band, currentIndex) => {
      if (currentIndex !== index) return band
      return {
        frequency: patch.frequency === undefined ? band.frequency : clampNumber(patch.frequency, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY),
        gain: patch.gain === undefined ? band.gain : clampNumber(patch.gain, -12, 12),
        type: patch.type ?? band.type,
      }
    })
    setEqualizerBands(next)
    applyFilters(next)
    scheduleEqualizerPersistence(next)
  }

  const applyBands = (bands: EqualizerBand[]) => {
    setEqualizerBands(bands)
    applyFilters(bands)
    scheduleEqualizerPersistence(bands)
  }

  const applyPreset = (preset: EqualizerPreset) => {
    if (preset.bands) {
      applyBands(preset.bands.map((band) => ({ ...band })))
      return
    }
    // gains-only presets snap each band back to the default frequency/type so
    // a previously-edited band (e.g. lowshelf flipped to peaking) is restored.
    applyBands(DEFAULT_EQ_BANDS.map((defaults, index) => ({
      ...defaults,
      gain: clampNumber(preset.gains?.[index] ?? 0, -12, 12),
    })))
  }

  const savePreset = (name: string) => {
    const label = name.trim()
    if (!label) return
    const preset = {
      id: `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || Date.now()}`,
      label,
      bands: equalizerBands().map((band) => ({ ...band })),
    }
    const next = [...customPresets().filter((current) => current.label.toLowerCase() !== label.toLowerCase()), preset]
    setCustomPresets(next)
    writeCustomPresets(next)
  }

  const reset = () => {
    applyBands(DEFAULT_EQ_BANDS.map((band) => ({ ...band })))
  }

  const setEnabled = (isEnabled: boolean) => {
    setEnabledSignal(isEnabled)
    applyFilters(equalizerBands())
  }

  const setNormalizationEnabled = (isEnabled: boolean) => {
    setNormalizationEnabledSignal(isEnabled)
    writeNormalizationEnabled(isEnabled)
    applyNormalization()
  }

  const setLoudness = (loudness: { lufs: number | null | undefined; peak: number | null | undefined }) => {
    currentLoudness = {
      lufs: loudness.lufs ?? null,
      peak: loudness.peak ?? null,
    }
    applyNormalization()
  }

  const setOutputVolume = (volume: number) => {
    outputVolume = clampNumber(volume, 0, 1)
    applyOutputVolume()
  }

  onCleanup(() => {
    if (persistenceTimer !== null) window.clearTimeout(persistenceTimer)
    if (visualizerFrame !== null) window.cancelAnimationFrame(visualizerFrame)
    visualizerResize?.disconnect()
    const audioElement = getAudioElement()
    if (audioElement) {
      audioElement.removeEventListener('play', startVisualizer)
      audioElement.removeEventListener('pause', stopVisualizer)
      audioElement.removeEventListener('ended', stopVisualizer)
    }
    writeEqualizerBands(equalizerBands())
    equalizerFilters.forEach((filter) => filter.disconnect())
    normalizationGain?.disconnect()
    outputGain?.disconnect()
    analyser?.disconnect()
    audioSource?.disconnect()
    void audioContext?.close().catch(() => undefined)
  })

  return {
    bands: equalizerBands,
    customPresets,
    enabled,
    graphPath,
    normalizationEnabled,
    attachVisualizer,
    graphAttached: () => audioSource !== null,
    applyPreset,
    ensureGraph,
    reset,
    savePreset,
    setEnabled,
    setLoudness,
    setNormalizationEnabled,
    setOutputVolume,
    updateBand,
  }
}

/**
 * Renders the collapsible 8-band equalizer controls and curve preview.
 * @param props Equalizer controller props.
 * @returns The equalizer panel UI.
 */
export function EqualizerPanel(props: EqualizerPanelProps) {
  const [open, setOpen] = createSignal(false)
  const [presetName, setPresetName] = createSignal('')
  const presets = createMemo(() => [...EQ_PRESETS, ...props.controller.customPresets()])

  // Attach the Web Audio graph the first time the user actually interacts with
  // the EQ. Doing it earlier breaks iOS background playback, since routing the
  // <audio> through MediaElementSource makes Safari treat it as Web Audio and
  // suspend it on lock screen / app switch.
  const ensureGraph = () => void props.controller.ensureGraph()

  const togglePanel = () => {
    const next = !open()
    setOpen(next)
    if (next) ensureGraph()
  }

  const applyPresetById = (id: string) => {
    const preset = presets().find((candidate) => candidate.id === id)
    if (preset) {
      ensureGraph()
      props.controller.applyPreset(preset)
    }
  }

  const saveCurrentPreset = () => {
    props.controller.savePreset(presetName())
    setPresetName('')
  }

  return (
    <section class="equalizer-panel" classList={{ open: open() }}>
      <div class="equalizer-header">
        <span class="equalizer-title">equalizer</span>
        <button
          class="normalization-toggle"
          type="button"
          aria-pressed={props.controller.normalizationEnabled()}
          aria-label={props.controller.normalizationEnabled() ? 'disable playback normalization' : 'enable playback normalization'}
          onClick={() => {
            ensureGraph()
            props.controller.setNormalizationEnabled(!props.controller.normalizationEnabled())
          }}
        >
          normalize
        </button>
        <button
          class="equalizer-power"
          type="button"
          aria-pressed={props.controller.enabled()}
          aria-label={props.controller.enabled() ? 'disable equalizer' : 'enable equalizer'}
          onClick={() => {
            ensureGraph()
            props.controller.setEnabled(!props.controller.enabled())
          }}
        >
          <Show when={props.controller.enabled()} fallback={<RadioOff size={20} />}>
            <Radio size={20} />
          </Show>
        </button>
        <button class="equalizer-toggle" type="button" aria-expanded={open()} aria-label="toggle equalizer controls" onClick={togglePanel}>
          <ChevronDown size={19} />
        </button>
      </div>
      <Show when={open()}>
        <div class="equalizer-controls" aria-label="8-band equalizer">
          <div class="equalizer-presets" aria-label="equalizer presets">
            <label>
              <span>preset</span>
              <select class="equalizer-preset-select" value="" onChange={(event) => applyPresetById(event.currentTarget.value)}>
                <option value="">select preset</option>
                <For each={presets()}>
                  {(preset) => <option value={preset.id}>{preset.label}</option>}
                </For>
              </select>
            </label>
            <label>
              <span>save as</span>
              <input
                class="equalizer-preset-name"
                type="text"
                value={presetName()}
                placeholder="preset name"
                onInput={(event) => setPresetName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveCurrentPreset()
                }}
              />
            </label>
            <button class="equalizer-preset" type="button" disabled={!presetName().trim()} onClick={saveCurrentPreset}>
              save
            </button>
          </div>
          <Index each={props.controller.bands()}>
            {(band, index) => (
              <div class="equalizer-band">
                <span class="equalizer-band-label">{formatFrequency(band().frequency)}hz</span>
                <input
                  class="equalizer-gain"
                  aria-label={`${formatFrequency(band().frequency)}hz gain`}
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={band().gain}
                  onInput={(event) => {
                    ensureGraph()
                    props.controller.updateBand(index, { gain: event.currentTarget.valueAsNumber })
                  }}
                />
                <small>{band().gain.toFixed(1)} db</small>
                <input
                  class="equalizer-frequency"
                  aria-label={`band ${index + 1} frequency`}
                  type="number"
                  min={EQ_MIN_FREQUENCY}
                  max={EQ_MAX_FREQUENCY}
                  step="10"
                  value={Math.round(band().frequency)}
                  onInput={(event) => props.controller.updateBand(index, { frequency: event.currentTarget.valueAsNumber })}
                />
                <select
                  class="equalizer-filter"
                  aria-label={`band ${index + 1} filter type`}
                  value={band().type}
                  onChange={(event) => props.controller.updateBand(index, { type: event.currentTarget.value as EqualizerFilterType })}
                >
                  <option value="peaking">peak</option>
                  <option value="lowshelf">low shelf</option>
                  <option value="highshelf">high shelf</option>
                </select>
              </div>
            )}
          </Index>
          <div class="equalizer-graph" aria-label="equalizer curve preview">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
              <line class="equalizer-graph-zero" x1="0" y1="50" x2="100" y2="50" />
              <path class="equalizer-graph-curve" d={props.controller.graphPath()} />
            </svg>
            <div class="equalizer-graph-labels" aria-hidden="true">
              <span>20hz</span>
              <span>0db</span>
              <span>20khz</span>
            </div>
          </div>
          <button class="equalizer-reset" type="button" onClick={props.controller.reset}>
            reset eq
          </button>
        </div>
      </Show>
    </section>
  )
}
